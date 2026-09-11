/**
 * xterm.js session registry for the integrated terminal.
 *
 * One `Terminal` instance lives per terminal id (`service:<id>`, `shell:<id>`,
 * ...) for as long as the tab exists, regardless of whether it is currently
 * rendered. React views (`XtermView`) only *mount* and *unmount* the session's
 * DOM container; the terminal keeps receiving bytes from the backend while
 * hidden, so switching tabs or restoring one from the tray is instant and
 * never re-parses the scrollback.
 *
 * Data flow: backend PTY → Tauri Channel → `term.write(bytes)`.
 * Input flow: `term.onData` → `write_terminal` → PTY.
 */
import { Terminal, type ITheme, type IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { CanvasAddon } from '@xterm/addon-canvas';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ImageAddon } from '@xterm/addon-image';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ClipboardAddon, type IClipboardProvider } from '@xterm/addon-clipboard';
import { SerializeAddon } from '@xterm/addon-serialize';
import type { LigaturesAddon } from '@xterm/addon-ligatures';
import '@xterm/xterm/css/xterm.css';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { toast } from 'sonner';
import type { TerminalBellStyle, TerminalCursorInactiveStyle, TerminalOsc52Access } from '@/types';
import * as api from '@/lib/tauri';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { getXtermThemeOverride, isWindowThemeActive, themeToXterm } from '@/lib/terminalTheme';
import { IS_MAC } from '@/lib/keybindings';
import {
  copyOnSelectEnabled,
  macOptionIsMetaOption,
  macOptionMetaSequence,
  overrideKeySequence,
  smoothScrollDuration,
} from '@/lib/terminalKeys';
import { TerminalImageFilter, type ImagePart } from '@/lib/terminalImages';
import { attachInputPosition, inputPositionSetting, refreshInputPositions } from '@/lib/terminalInputPosition';
import { attachInputEditor, inputEditorEnabled, refreshInputEditors } from '@/lib/terminalInputEditor';
import { isLinkOpenClick, registerFileLinkProvider } from '@/lib/terminalLinks';
import {
  attachBlocks,
  blockActionBarEnabled,
  blockDividersEnabled,
  blockGutterEnabled,
  blocksEnabled,
  copySelectedBlock,
  openSelectedBlockMenu,
  refreshBlocks,
} from '@/lib/terminalBlocks';
import { openTerminalSettingsPanel } from '@/components/terminal/settings/meta';
import { decideCommandNotification } from '@/components/terminal/settings/notificationPolicy';

/** One queued piece of output, plus the callback owed to whoever wrote it. */
interface QueuedPart extends ImagePart {
  done?: () => void;
}

export interface TerminalSession {
  id: string;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  image: ImageAddon;
  /** DOM node xterm renders into; moved between React containers on mount. */
  container: HTMLDivElement;
  opened: boolean;
  attachToken: number | null;
  webgl: WebglAddon | null;
  /** Canvas renderer (alternative GPU-free accelerated renderer). */
  canvas: CanvasAddon | null;
  /** Font ligatures, when `terminal.ligatures` is on (issue 12). Needs
   *  `term.element`, so it is only ever loaded after `open()`. */
  ligatures: LigaturesAddon | null;
  /** Timer that takes the visual bell's flash class back off (issue 11). */
  bellTimer: number | null;
  disposables: IDisposable[];
  /** True while the backend scrollback snapshot is being parsed (see attach). */
  replaying: boolean;
  /** Repairs iTerm2 images and translates kitty graphics (see terminalImages). */
  images: TerminalImageFilter;
  /** Output waiting to be written, in order (a kitty frame can need decoding). */
  pending: QueuedPart[];
  /** A part of `pending` is being awaited; nothing else may be written. */
  draining: boolean;
  /** Size last accepted by the backend PTY, so a lost resize can be retried. */
  sentSize: { cols: number; rows: number } | null;
  /** Whatever currently answers OSC 52 for this session: the `ClipboardAddon`
   *  when access is granted, the handler that swallows and reports the
   *  sequence when it is denied. Swapped in place when the setting changes
   *  (see `attachOsc52`). */
  osc52: IDisposable | null;
}

const sessions = new Map<string, TerminalSession>();

// Dev-only escape hatch so the live sessions can be poked from DevTools / CDP
// (Vite's HMR gives a fresh module instance to dynamic imports, so this is the
// only reliable way to reach the map the app is actually using).
if (import.meta.env.DEV) {
  (window as unknown as { __cortxTerminalSessions?: Map<string, TerminalSession> }).__cortxTerminalSessions = sessions;
}

const IS_WINDOWS = /Windows/i.test(navigator.userAgent);

/** True inside the dedicated Terminal window (whose panes are see-through
 *  so the theme's window opacity / wallpaper show behind the text). */
const IS_TERMINAL_WINDOW = (() => {
  try {
    const label = getCurrentWindow().label;
    // `terminal`, plus `terminal-2`… for a window a tab was detached into
    // (ticket #20) — they are see-through and themed just the same.
    return label === 'terminal' || label.startsWith('terminal-');
  } catch {
    return false;
  }
})();

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

// Fallback palettes for windows where no terminal theme is loaded (the
// dock in the main window): VS Code "Dark Modern" / "Light Modern", the same
// values as the bundled `dark-modern` / `light-modern` themes.
const DARK_ANSI = {
  black: '#1e1e1e',
  red: '#f14c4c',
  green: '#23d18b',
  yellow: '#f5f543',
  blue: '#3b8eea',
  magenta: '#d670d6',
  cyan: '#29b8db',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

const LIGHT_ANSI = {
  black: '#000000',
  red: '#cd3131',
  green: '#107c10',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
};

let probeCanvas: CanvasRenderingContext2D | null | undefined;

/**
 * Resolve a CSS custom property (the app's tokens are `oklch(...)`, which
 * xterm's colour parser doesn't understand) to `[r, g, b]` by painting it on
 * a 1×1 canvas. Returns null when the value is missing or unparseable.
 */
function resolveCssColor(varName: string): [number, number, number] | null {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return null;
  if (probeCanvas === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    probeCanvas = canvas.getContext('2d', { willReadFrequently: true });
  }
  const ctx = probeCanvas;
  if (!ctx) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = raw;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (a === 0) return null;
  return [r, g, b];
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark');
}

/**
 * The overview ruler (see `createSession`) always paints a 1 px rule down its
 * own left edge, in `theme.overviewRulerBorder` — which xterm defaults to
 * **black**. A black hairline the height of every pane, on every theme and
 * over the wallpaper of the Terminal window, is not a thing CortX is asking
 * for: the ruler is meant to be invisible until something is marked in it.
 * So the colour is transparent, and the ruler only ever shows its marks.
 */
const OVERVIEW_RULER_BORDER = 'rgba(0, 0, 0, 0)';

/**
 * xterm palette: the active / previewed terminal theme when the theme store
 * has one (see `stores/terminalThemeStore`), else derived from the app's
 * CSS tokens.
 */
export function buildTerminalTheme(): ITheme {
  return { ...buildPaletteTheme(), overviewRulerBorder: OVERVIEW_RULER_BORDER };
}

function buildPaletteTheme(): ITheme {
  const override = getXtermThemeOverride();
  const selectionColor = useAppStore.getState().settings?.terminal.selectionColor;
  if (override) {
    return themeToXterm(override, { transparentBackground: IS_TERMINAL_WINDOW, selectionColor });
  }
  const dark = isDarkTheme();
  // Panes of the Terminal window are always see-through: the window itself
  // paints the theme colour and the wallpaper behind them (the window is
  // opaque unless the user asked for transparency, so this can never leak
  // the desktop). A theme that has not loaded yet must not blank the
  // wallpaper with an opaque canvas either.
  if (IS_TERMINAL_WINDOW) {
    const fgOnly = resolveCssColor('--terminal-fg') ?? resolveCssColor('--foreground') ?? (dark ? [229, 229, 229] : [36, 36, 36]);
    return {
      background: 'rgba(0, 0, 0, 0)',
      foreground: toHex(fgOnly),
      cursor: toHex(fgOnly),
      cursorAccent: 'rgba(0, 0, 0, 0)',
      selectionBackground: selectionColor?.trim() || `rgba(${fgOnly[0]}, ${fgOnly[1]}, ${fgOnly[2]}, 0.25)`,
      selectionInactiveBackground: selectionColor?.trim() || `rgba(${fgOnly[0]}, ${fgOnly[1]}, ${fgOnly[2]}, 0.15)`,
      ...(dark ? DARK_ANSI : LIGHT_ANSI),
    };
  }
  const bg = resolveCssColor('--bg-terminal') ?? resolveCssColor('--card') ?? (dark ? [30, 30, 30] : [255, 255, 255]);
  const fg = resolveCssColor('--terminal-fg') ?? resolveCssColor('--foreground') ?? (dark ? [229, 229, 229] : [36, 36, 36]);
  const ansi = dark ? DARK_ANSI : LIGHT_ANSI;
  return {
    background: toHex(bg),
    foreground: toHex(fg),
    cursor: toHex(fg),
    cursorAccent: toHex(bg),
    selectionBackground: selectionColor?.trim() || `rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, 0.25)`,
    selectionInactiveBackground: selectionColor?.trim() || `rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, 0.15)`,
    ...ansi,
  };
}

let themeObserver: MutationObserver | null = null;

function ensureThemeObserver() {
  if (themeObserver) return;
  themeObserver = new MutationObserver(() => applyThemeToAll());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
}

// ---------------------------------------------------------------------------
// Font (Settings > Integrated terminal; synced through settings.json)
// ---------------------------------------------------------------------------

const DEFAULT_FONT_STACK =
  'ui-monospace, "Cascadia Mono", "Cascadia Code", Consolas, "JetBrains Mono", Menlo, Monaco, monospace';
const DEFAULT_FONT_SIZE = 12;

/** xterm font options from the user's settings, with the bundled stack as fallback. */
function clampWeight(w: number | undefined): number | undefined {
  if (w === undefined || !Number.isFinite(w)) return undefined;
  return Math.min(900, Math.max(100, Math.round(w / 100) * 100));
}

export function terminalFontOptions(): {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  fontWeight: number;
  fontWeightBold: number;
} {
  const cfg = useAppStore.getState().settings?.terminal;
  const family = cfg?.fontFamily?.trim();
  const size = cfg?.fontSize;
  const renderer = cfg?.renderer ?? 'canvas';
  const lh = cfg?.lineHeight;
  const ls = cfg?.letterSpacing;
  // A user font still falls back to the stack for glyphs it lacks.
  const fontFamily = family ? `"${family.replace(/"/g, '')}", ${DEFAULT_FONT_STACK}` : DEFAULT_FONT_STACK;
  const requested = size && size >= 8 && size <= 32 ? size : DEFAULT_FONT_SIZE;
  return {
    letterSpacing: ls !== undefined && ls >= -2 && ls <= 6 ? ls : undefined,
    fontWeight: clampWeight(cfg?.fontWeight) ?? 400,
    fontWeightBold: clampWeight(cfg?.fontWeightBold) ?? 700,
    fontFamily,
    fontSize: snapFontSize(fontFamily, requested, renderer),
    lineHeight: lh && lh >= 1 && lh <= 2 ? lh : defaultLineHeight(renderer),
  };
}

// ---------------------------------------------------------------------------
// Scrollback (issue 42)
// ---------------------------------------------------------------------------

export const DEFAULT_SCROLLBACK_LINES = 10000;

/** Default size cap of `command-history.jsonl`, in megabytes (see `historyMaxMb`). */
export const DEFAULT_HISTORY_MAX_MB = 10;
export const MIN_SCROLLBACK_LINES = 1000;
export const MAX_SCROLLBACK_LINES = 200000;
/**
 * Past this, the settings card warns. Not a limit — a number worth thinking
 * about: it is paid *per terminal*, and twenty open tabs at 50 000 lines are
 * a million lines of grid held in memory.
 */
export const SCROLLBACK_WARN_LINES = 50000;

/** Lines kept behind the viewport, per terminal. Clamped, never trusted raw. */
export function terminalScrollbackLines(): number {
  const raw = useAppStore.getState().settings?.terminal.scrollbackLines;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_SCROLLBACK_LINES;
  return Math.min(MAX_SCROLLBACK_LINES, Math.max(MIN_SCROLLBACK_LINES, Math.round(raw)));
}

// ---------------------------------------------------------------------------
// Bell (issue 11)
// ---------------------------------------------------------------------------

export function bellStyle(): TerminalBellStyle {
  return useAppStore.getState().settings?.terminal.bell ?? 'visual';
}

/** A second bell inside this window is the same event, not a new one. */
const BELL_COALESCE_MS = 400;
/**
 * A bell that lands this soon after a command ended in the same terminal is
 * that command's own bell — the `\a` a build prints on its last line. If the
 * notification policy is going to announce that command anyway, the pane says
 * nothing: one event, one signal. See the note on `handleBell`.
 */
const BELL_AFTER_COMMAND_MS = 2000;
/** How long the pane stays lit. Long enough to catch the eye, short enough
 *  not to be read as a state. Matches `--cortx-bell-flash` in the CSS. */
const BELL_FLASH_MS = 260;

let bellAudio: AudioContext | null | undefined;

/**
 * A short tone, synthesised rather than shipped: a WAV asset would have to be
 * bundled, and no platform exposes "play the system beep" to a webview.
 * Deliberately quiet and brief — a bell is a hint, not an alarm.
 */
function playBellTone() {
  try {
    if (bellAudio === undefined) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      bellAudio = Ctor ? new Ctor() : null;
    }
    const ctx = bellAudio;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  } catch {
    // No audio device, autoplay refused, context creation blocked: a bell is
    // never worth an error.
    bellAudio = null;
  }
}

/** Epoch ms of the last bell honoured, per terminal. */
const lastBellAt = new Map<string, number>();

/**
 * `BEL` (`0x07`) — until now CortX did nothing at all with it, so a build that
 * ended on a bell produced no sign of any kind (issue 11).
 *
 * **Why this never turns into a toast or a desktop notification.** Those two
 * channels already belong to `notificationPolicy`, which fires on `OSC 133;D`
 * — the end of a command. A build that fails *and* rings would then announce
 * itself twice for one event. So the bell is confined to the pane it came
 * from (a flash, plus a tone at `audible`), which is a channel the policy
 * never uses; and on top of that, a bell arriving in the wake of a command
 * the policy is about to report is dropped outright.
 *
 * The flash is also the more useful half: it says *which* pane rang, which a
 * sound cannot.
 */
function handleBell(session: TerminalSession) {
  // A restored snapshot is replayed byte for byte, bells included.
  if (session.replaying) return;
  const style = bellStyle();
  if (style === 'off') return;

  const now = Date.now();
  // `printf '\a\a\a'` is one bell, not three.
  const previous = lastBellAt.get(session.id);
  if (previous !== undefined && now - previous < BELL_COALESCE_MS) return;

  if (bellIsCommandNotification(session.id, now)) return;
  lastBellAt.set(session.id, now);

  const el = session.container;
  if (session.bellTimer !== null) window.clearTimeout(session.bellTimer);
  // Off then on, so a second bell restarts the animation instead of landing
  // mid-fade and being invisible.
  el.classList.remove('cortx-bell');
  void el.offsetWidth;
  el.classList.add('cortx-bell');
  session.bellTimer = window.setTimeout(() => {
    el.classList.remove('cortx-bell');
    session.bellTimer = null;
  }, BELL_FLASH_MS);

  if (style === 'audible') playBellTone();
}

/**
 * True when this bell is the tail of a command the notification policy is
 * going to report on its own. Exactly the same decision the policy makes, on
 * the same facts, so nothing is suppressed that would not have been announced.
 */
function bellIsCommandNotification(id: string, now: number): boolean {
  try {
    const store = useAppStore.getState();
    const state = store.terminalStates.get(id);
    const finishedAt = state?.lastFinishedAt ?? null;
    if (!finishedAt || now - finishedAt > BELL_AFTER_COMMAND_MS) return false;
    return (
      decideCommandNotification(store.settings?.terminal, {
        command: state?.lastCommand ?? null,
        exitCode: state?.lastExitCode ?? null,
        durationMs: state?.lastDurationMs ?? 0,
        inView: store.isTerminalInView(id),
        windowFocused: typeof document === 'undefined' || document.hasFocus(),
      }) !== null
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Ligatures (issue 12)
// ---------------------------------------------------------------------------

export function ligaturesEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.ligatures === true;
}

/**
 * Load or unload `@xterm/addon-ligatures` to match the setting.
 *
 * Three facts about the installed version (0.10.0) that decide the shape of
 * this:
 *
 *  - `activate()` throws unless `term.element` exists, so it can only run
 *    once the session has been opened — never from `createSession`.
 *  - it sets `font-feature-settings` on `term.element` and registers a
 *    character joiner. The joiner is honoured by all three renderers, but the
 *    GPU one bakes the font features into its texture atlas when it starts,
 *    so it has to be reloaded *after* the addon or the atlas keeps the
 *    unligated glyphs. Hence the renderer reload below.
 *  - it bundles a whole OpenType parser (~200 KB) for the fonts it can read
 *    through the browser's local-font API, and the setting is off by default.
 *    So it is imported dynamically: nobody pays to parse it until they ask
 *    for ligatures.
 */
async function applyLigatures(session: TerminalSession) {
  if (!session.opened) return;
  const wanted = ligaturesEnabled();
  if (wanted === !!session.ligatures) return;
  if (!wanted) {
    session.ligatures?.dispose();
    session.ligatures = null;
  } else {
    try {
      const { LigaturesAddon } = await import('@xterm/addon-ligatures');
      // Switched off again, session gone, or another call got there first
      // while the chunk was loading.
      if (!ligaturesEnabled() || !sessions.has(session.id) || !session.opened || session.ligatures) return;
      const addon = new LigaturesAddon();
      session.term.loadAddon(addon);
      session.ligatures = addon;
    } catch (err) {
      console.warn('Ligatures unavailable:', err);
      session.ligatures = null;
      return;
    }
  }
  // Rebuild the accelerated renderer against the new font features.
  if (session.webgl) {
    session.webgl.dispose();
    session.webgl = null;
  }
  if (session.canvas) {
    session.canvas.dispose();
    session.canvas = null;
  }
  applyRenderer(session);
}

/**
 * Default line height per renderer. The GPU renderer redraws box / powerline
 * glyphs to the cell, so it tolerates a roomier line; the browser renderer
 * draws them at their own size, and only a line box of exactly 1 lets them
 * touch cell to cell (a powerline prompt shows gaps otherwise).
 */
function defaultLineHeight(renderer: string): number {
  return renderer === 'dom' ? 1 : 1.2;
}
/**
 * Extra spacing is **off** by default: powerline / Nerd Font glyphs are
 * designed to touch cell to cell, and a spacing of even one pixel tears the
 * prompt's separators apart. The heavy look this used to compensate for
 * came from the GPU renderer, which is no longer the default (see the
 * `renderer` setting). The Settings field
 * still lets a font be tuned by hand.
 */
export const DEFAULT_LETTER_SPACING = 0;

let advanceCanvas: CanvasRenderingContext2D | null | undefined;
const advanceCache = new Map<string, number>();

/** Horizontal advance of one glyph of `fontFamily` at `fontSize`, in CSS px. */
function glyphAdvance(fontFamily: string, fontSize: number): number {
  const key = `${fontSize}|${fontFamily}`;
  const cached = advanceCache.get(key);
  if (cached !== undefined) return cached;
  if (advanceCanvas === undefined) advanceCanvas = document.createElement('canvas').getContext('2d');
  if (!advanceCanvas) return fontSize * 0.6;
  advanceCanvas.font = `${fontSize}px ${fontFamily}`;
  const width = advanceCanvas.measureText('W'.repeat(50)).width / 50;
  advanceCache.set(key, width);
  return width;
}

/**
 * A family CSS could not resolve renders in the fallback stack, silently: the
 * terminal simply looks like the default and nothing says why. `Hack NF` is
 * a real Nerd Fonts family name — on Windows, where family names were once
 * capped at 31 characters — and it exists nowhere else, so a settings file
 * carried from a Windows machine to a Mac falls back without a word (issue 34).
 *
 * There is no API that answers "is this family installed" in every webview
 * (`queryLocalFonts` is Chromium-only, so it exists in WebView2 and in
 * neither WKWebView nor WebKitGTK), so this measures instead — and *what* it
 * measures was changed by issue 49.
 *
 * It used to compare the requested family against a family that certainly
 * does not exist, both above `monospace`: equal advances meant both had
 * fallen through to the generic. That reads a real font as missing whenever
 * its advance happens to match the generic's, and the risk is not theoretical
 * — `Hack` and `Menlo` share exactly the same advance (`1233/2048 em`, both
 * descend from Bitstream Vera), so on a machine whose `monospace` generic is
 * Menlo an installed Hack would have been called missing. It only held
 * because WKWebView's `monospace` is Courier (`0.60010 em`). A coincidence,
 * not a guarantee, and one macOS release could end it.
 *
 * What is measured now is the family **against itself**, above two generics
 * whose metrics differ: `"X", serif` and `"X", monospace`. A family that
 * really resolves is used in both stacks and gives one width twice; a family
 * that does not resolve falls through to two different generics and gives two
 * widths. Nothing is compared to a generic any more, so no font can be
 * mistaken for one. Same cost: two measurements either way, both cached.
 *
 * The one thing it still cannot see is a font the webview refuses to use even
 * though the system has it — on macOS, anything under `~/Library/Fonts`
 * (issue 49). That is not a wrong answer: the terminal genuinely cannot draw
 * with it. The settings card explains the fix.
 */

/** CSS generic families: a name xterm passes straight through, never missing. */
const CSS_GENERIC_FAMILIES = new Set([
  'monospace',
  'serif',
  'sans-serif',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-monospace',
  'ui-serif',
  'ui-sans-serif',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);

export function fontFamilyResolves(family: string): boolean {
  const name = family.trim();
  if (!name) return true;
  if (CSS_GENERIC_FAMILIES.has(name.toLowerCase())) return true;
  // No 2D context (a test environment, a webview without canvas): nothing can
  // be measured, and an unverifiable font is never accused.
  if (advanceCanvas === undefined) advanceCanvas = document.createElement('canvas').getContext('2d');
  if (!advanceCanvas) return true;
  // A big size makes the two advances differ by whole pixels when they differ
  // at all; the measurement is cached, so it costs nothing to repeat.
  const size = 64;
  const quoted = `"${name.replace(/"/g, '')}"`;
  const overSerif = glyphAdvance(`${quoted}, serif`, size);
  const overMono = glyphAdvance(`${quoted}, monospace`, size);
  return Math.abs(overSerif - overMono) <= 0.01;
}

/**
 * Font size that makes one cell an exact number of CSS pixels.
 *
 * A monospace advance is a fraction of the em (Hack is 0.602 em), so at most
 * sizes a cell is fractional — 7.82 px at 13. The browser renderer then
 * starts every cell between two device pixels: glyphs are resampled (blurry)
 * and the edge of a powerline separator leaves a hairline against its
 * neighbour. Scaling the size by a hair (13 → 13.288, cell exactly 8 px)
 * puts every cell on a whole pixel and both problems disappear. The GPU
 * renderer redraws box and powerline glyphs at the cell size, so it is left
 * alone.
 */
export function snapFontSize(fontFamily: string, fontSize: number, renderer: string): number {
  if (renderer !== 'dom') return fontSize;
  const advance = glyphAdvance(fontFamily, fontSize);
  if (advance <= 0) return fontSize;
  const perPx = advance / fontSize;
  const target = Math.round(advance);
  if (target < 1) return fontSize;
  const snapped = target / perPx;
  // Only a nudge: never move the size the user asked for by a visible amount.
  return Math.abs(snapped - fontSize) <= 0.8 ? Math.round(snapped * 1000) / 1000 : fontSize;
}

/** Push family, size (with the window zoom), line height and letter spacing to one terminal. */
function applyFontMetrics(term: Terminal, font: ReturnType<typeof terminalFontOptions>) {
  const renderer = useAppStore.getState().settings?.terminal.renderer ?? 'canvas';
  const size = snapFontSize(font.fontFamily, Math.max(6, font.fontSize + zoomDelta), renderer);
  term.options.fontFamily = font.fontFamily;
  term.options.fontSize = size;
  term.options.lineHeight = font.lineHeight;
  term.options.letterSpacing = font.letterSpacing ?? DEFAULT_LETTER_SPACING;
  term.options.fontWeight = font.fontWeight;
  term.options.fontWeightBold = font.fontWeightBold;
}

// ---------------------------------------------------------------------------
// Cursor + padding (Settings > Terminal appearance; DEV-13 P3)
// ---------------------------------------------------------------------------

const DEFAULT_PADDING = 8;

/**
 * What the cursor of a pane that does *not* have the focus looks like
 * (issue 52). xterm's default is `outline` — the same shape, hollow — which
 * is a fine answer for one terminal and a poor one for a window full of
 * splits, where the first thing you need to know is which pane your keys are
 * going to. `none` makes that unmistakable; `bar` keeps a trace of where the
 * cursor was.
 *
 * A setting rather than a value, because the answer depends on how the user
 * works: with one pane open the outline is the better look, and taking it
 * away would be a change nobody asked for. The default therefore does not
 * move.
 */
const DEFAULT_CURSOR_INACTIVE_STYLE: TerminalCursorInactiveStyle = 'outline';

/** xterm cursor options from the user's settings. */
export function terminalCursorOptions(): {
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
  cursorInactiveStyle: TerminalCursorInactiveStyle;
} {
  const cfg = useAppStore.getState().settings?.terminal;
  return {
    cursorStyle: cfg?.cursorStyle ?? 'bar',
    cursorBlink: cfg?.cursorBlink ?? true,
    cursorInactiveStyle: cfg?.cursorInactiveStyle ?? DEFAULT_CURSOR_INACTIVE_STYLE,
  };
}

/**
 * Minimum contrast ratio between text and its background (issue 52).
 *
 * xterm's default is `1`, which means "leave every colour exactly as the
 * program and the theme wrote it". `4.5` is WCAG AA: xterm then lightens or
 * darkens a foreground colour, per cell, only when the pair falls below it.
 *
 * A setting, not a value, and the default deliberately stays at `1`: raising
 * it rewrites colours the theme author chose — a dim grey comment, the muted
 * half of a diff — and CortX ships dozens of themes whose whole point is the
 * palette. It is offered because the same feature is what rescues a
 * third-party theme whose `brightBlack` is unreadable on its own background.
 * VS Code exposes exactly this, with the same default.
 */
export const DEFAULT_MINIMUM_CONTRAST = 1;
export const MAX_MINIMUM_CONTRAST = 21;

export function terminalMinimumContrast(): number {
  const raw = useAppStore.getState().settings?.terminal.minimumContrastRatio;
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_MINIMUM_CONTRAST;
  return Math.min(MAX_MINIMUM_CONTRAST, Math.max(1, raw));
}

/**
 * Screen reader support (issue 52). Off by default, and that is not an
 * oversight: xterm mirrors the rows into live DOM elements when it is on,
 * which costs on every render — the reason xterm ships it off too. Without
 * it the terminal is *completely* silent to VoiceOver and NVDA, so it has to
 * be reachable; behind a setting is where it belongs.
 */
export function screenReaderModeEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.screenReaderMode === true;
}

/** Inner padding of every terminal, in px (clamped 0–48). */
export function terminalPadding(): number {
  const raw = useAppStore.getState().settings?.terminal.padding;
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_PADDING;
  return Math.min(48, Math.max(0, Math.round(raw)));
}

/** Push the padding to `.cortx-xterm` (via `--terminal-padding`) and refit. */
export function applyTerminalPadding() {
  document.documentElement.style.setProperty('--terminal-padding', `${terminalPadding()}px`);
  for (const s of sessions.values()) {
    if (s.container.isConnected) fitTerminal(s.id);
  }
  // The usable height changed, so did the number of blank rows under the
  // prompt (ticket #15, U0).
  refreshInputPositions();
  // The block gutter is drawn inside that padding (#7).
  refreshBlocks();
}

/** Everything about blocks that a redraw has to notice (ticket #7). */
function blockSettingsKey(): string {
  return [blocksEnabled(), blockGutterEnabled(), blockDividersEnabled(), blockActionBarEnabled()].join('|');
}

let settingsSubscribed = false;

/** Re-apply font, cursor and padding to every session when the settings change. */
function ensureSettingsSubscription() {
  if (settingsSubscribed) return;
  settingsSubscribed = true;
  applyTerminalPadding();
  let lastFont = JSON.stringify(terminalFontOptions());
  let lastCursor = JSON.stringify(terminalCursorOptions());
  let lastPadding = terminalPadding();
  let lastSmoothScroll = smoothScrollDuration();
  let lastInputPosition = inputPositionSetting();
  let lastInputEditor = inputEditorEnabled();
  let lastBlocks = blockSettingsKey();
  let lastMacOption = macOptionIsMetaOption();
  let lastOsc52 = osc52Access();
  let lastScrollback = terminalScrollbackLines();
  let lastLigatures = ligaturesEnabled();
  let lastMinimumContrast = terminalMinimumContrast();
  let lastScreenReader = screenReaderModeEnabled();
  useAppStore.subscribe(() => {
    const font = terminalFontOptions();
    const fontKey = JSON.stringify(font);
    if (fontKey !== lastFont) {
      lastFont = fontKey;
      for (const s of sessions.values()) {
        applyFontMetrics(s.term, font);
        if (s.container.isConnected) fitTerminal(s.id);
      }
      // The cell height moved: the bottom-pinned offset is measured in cells.
      refreshInputPositions();
    }
    applyRendererToAll();
    const cursor = terminalCursorOptions();
    const cursorKey = JSON.stringify(cursor);
    if (cursorKey !== lastCursor) {
      lastCursor = cursorKey;
      for (const s of sessions.values()) {
        s.term.options.cursorStyle = cursor.cursorStyle;
        s.term.options.cursorBlink = cursor.cursorBlink;
        s.term.options.cursorInactiveStyle = cursor.cursorInactiveStyle;
      }
    }
    const padding = terminalPadding();
    if (padding !== lastPadding) {
      lastPadding = padding;
      applyTerminalPadding();
    }
    const smooth = smoothScrollDuration();
    if (smooth !== lastSmoothScroll) {
      lastSmoothScroll = smooth;
      for (const s of sessions.values()) s.term.options.smoothScrollDuration = smooth;
    }
    // Ticket #15: both are inert while off, but flipping them has to take
    // effect without reopening the terminals.
    const position = inputPositionSetting();
    if (position !== lastInputPosition) {
      lastInputPosition = position;
      refreshInputPositions();
    }
    const editor = inputEditorEnabled();
    if (editor !== lastInputEditor) {
      lastInputEditor = editor;
      refreshInputEditors();
    }
    // Ticket #7: switching blocks off tears the overlay down; switching the
    // gutter off only stops drawing the bars.
    const blocks = blockSettingsKey();
    if (blocks !== lastBlocks) {
      lastBlocks = blocks;
      refreshBlocks();
    }
    // ⌥ on macOS: xterm takes the flag live, and `wordKeys` / `never` only
    // differ in the key handler, which reads the setting on every keystroke.
    const macOption = macOptionIsMetaOption();
    if (macOption !== lastMacOption) {
      lastMacOption = macOption;
      for (const s of sessions.values()) s.term.options.macOptionIsMeta = macOption;
    }
    // Issue 36: OSC 52 takes effect on the terminals already open — the
    // addon (or the handler that stands in for it) is swapped per session,
    // so nobody has to restart a shell to grant or revoke this.
    const osc52 = osc52Access();
    if (osc52 !== lastOsc52) {
      lastOsc52 = osc52;
      for (const s of sessions.values()) attachOsc52(s);
    }
    // Issue 42: xterm takes `scrollback` live and trims the buffer on the
    // spot when it shrinks — which also drops the block markers past the new
    // limit, exactly as the settings card warns.
    const scrollback = terminalScrollbackLines();
    if (scrollback !== lastScrollback) {
      lastScrollback = scrollback;
      for (const s of sessions.values()) s.term.options.scrollback = scrollback;
    }
    // Issue 12: only the sessions already opened can load the addon; the
    // others pick it up in `mountTerminal`.
    const ligatures = ligaturesEnabled();
    if (ligatures !== lastLigatures) {
      lastLigatures = ligatures;
      for (const s of sessions.values()) void applyLigatures(s);
    }
    // Issue 52: both are live options — xterm drops its colour cache when the
    // contrast ratio moves, and builds or tears down the accessibility DOM
    // when the screen reader flag does. Nobody has to reopen a terminal.
    const minimumContrast = terminalMinimumContrast();
    if (minimumContrast !== lastMinimumContrast) {
      lastMinimumContrast = minimumContrast;
      for (const s of sessions.values()) s.term.options.minimumContrastRatio = minimumContrast;
    }
    const screenReader = screenReaderModeEnabled();
    if (screenReader !== lastScreenReader) {
      lastScreenReader = screenReader;
      for (const s of sessions.values()) s.term.options.screenReaderMode = screenReader;
    }
  });
}

export function applyThemeToAll() {
  const theme = buildTerminalTheme();
  for (const s of sessions.values()) {
    // Panes of the Terminal window are always see-through: the window paints
    // the theme colour and the wallpaper behind them.
    s.term.options.allowTransparency = IS_TERMINAL_WINDOW;
    s.term.options.theme = theme;
  }
}

// ---------------------------------------------------------------------------
// Clipboard helpers
// ---------------------------------------------------------------------------

/** Copy the selection. `clear` false keeps the highlight (copy on select). */
async function copySelection(term: Terminal, clear = true): Promise<boolean> {
  if (!term.hasSelection()) return false;
  const text = term.getSelection();
  try {
    await writeText(text);
  } catch (err) {
    console.error('Clipboard write failed:', err);
    return false;
  }
  if (clear) term.clearSelection();
  return true;
}

async function pasteFromClipboard(term: Terminal) {
  try {
    const text = await readText();
    if (text) term.paste(text);
  } catch (err) {
    console.error('Clipboard read failed:', err);
  }
}

/**
 * Does the webview paste by itself on Ctrl/Cmd+V?
 *
 * It does on Chromium (Windows, Linux) and on macOS through the Edit menu,
 * and xterm.js listens for the resulting DOM `paste` event to send a
 * correctly bracketed paste. So CortX must *not* read the clipboard on
 * Ctrl+V as well — that pasted everything twice, since returning `false`
 * from a custom key handler stops xterm's own key processing but never
 * cancels the browser's default action.
 *
 * `null` until the first Ctrl+V of this window says which it is; a webview
 * that turns out not to paste (no `paste` event within `PASTE_PROBE_MS`)
 * gets the manual paste, then and from then on.
 */
let webviewPastesOnCtrlV: boolean | null = null;
let pasteProbe: number | null = null;
const PASTE_PROBE_MS = 250;

/** A DOM paste reached a terminal: the webview does handle Ctrl+V. */
function noteWebviewPaste() {
  webviewPastesOnCtrlV = true;
  if (pasteProbe !== null) {
    window.clearTimeout(pasteProbe);
    pasteProbe = null;
  }
}

function probeWebviewPaste(term: Terminal) {
  if (pasteProbe !== null) return;
  pasteProbe = window.setTimeout(() => {
    pasteProbe = null;
    if (webviewPastesOnCtrlV !== null) return;
    webviewPastesOnCtrlV = false;
    void pasteFromClipboard(term);
  }, PASTE_PROBE_MS);
}

// ---------------------------------------------------------------------------
// OSC 52 — clipboard access from the programs running in the terminal
// ---------------------------------------------------------------------------

/**
 * What a program may do with the system clipboard through OSC 52 (issue 36).
 *
 * `ESC ] 52 ; c ; <base64> BEL` sets the clipboard, and `ESC ] 52 ; c ; ? BEL`
 * asks for its contents, which the emulator writes back **into the PTY**.
 * It is an escape sequence like any other, so anything that reaches the PTY
 * can emit one: a program behind `ssh`, a process in a container, a script
 * nobody read, a `cat` on a crafted file. Writing lets it replace what the
 * user copied (the classic trick swaps the command they believe they copied
 * from a doc); reading hands it whatever they last copied anywhere.
 *
 * `@xterm/addon-clipboard@0.2.0` really does implement both directions: its
 * `BrowserClipboardProvider.readText` calls `navigator.clipboard.readText()`
 * for the `c` selection and the addon echoes the answer back with
 * `terminal.input()`. So until this setting existed, both paths were open.
 *
 * Warp (`terminal.osc52_clipboard_access`) denies it by default; so do we.
 */
export function osc52Access(): TerminalOsc52Access {
  return useAppStore.getState().settings?.terminal.osc52 ?? 'deny';
}

/** Sessions that have already told the user something was refused. */
const osc52Notified = new Set<string>();

/**
 * One notice per session, the first time an access is refused — otherwise a
 * denial is completely silent and the tmux user whose yank stopped working
 * has nothing at all to go on. The command that asked is the one the shell
 * integration reports as running, which is exactly the current block.
 */
function noteOsc52Refusal(terminalId: string, what: 'read' | 'write') {
  if (osc52Notified.has(terminalId)) return;
  osc52Notified.add(terminalId);
  const command = useAppStore.getState().terminalStates.get(terminalId)?.command?.trim();
  const who = command ? `"${command}"` : 'A program';
  const verb = what === 'read' ? 'read the clipboard' : 'change the clipboard';
  toast.warning('Clipboard access blocked', {
    description:
      `${who} tried to ${verb} through an OSC 52 escape sequence. ` +
      'Terminal settings → Integrated terminal → Clipboard access from programs (OSC 52). ' +
      'Write only is the level for tmux and neovim.',
    // The panel only exists in the Terminal window; from the dock the path
    // above is all we can honestly offer.
    action: IS_TERMINAL_WINDOW
      ? { label: 'Settings', onClick: () => openTerminalSettingsPanel() }
      : undefined,
  });
}

/**
 * The clipboard the addon talks to. Deliberately not its default provider:
 * that one goes through `navigator.clipboard`, which needs the webview's
 * permission and focus, while the rest of CortX copies and pastes through
 * Tauri's clipboard plugin (see `copySelection` / `pasteFromClipboard`).
 *
 * `allowRead` false is the `writeOnly` level: the read answer is an empty
 * string, so a program that asks is told the clipboard is empty rather than
 * left hanging.
 */
function osc52Provider(terminalId: string, allowRead: boolean): IClipboardProvider {
  return {
    async readText(selection): Promise<string> {
      if (!allowRead) {
        noteOsc52Refusal(terminalId, 'read');
        return '';
      }
      // `p` is the X11 primary selection; there is no such thing here.
      if ((selection as string) !== 'c') return '';
      try {
        return (await readText()) ?? '';
      } catch (err) {
        console.error('OSC 52 clipboard read failed:', err);
        return '';
      }
    },
    async writeText(selection, text): Promise<void> {
      if ((selection as string) !== 'c') return;
      try {
        await writeText(text);
      } catch (err) {
        console.error('OSC 52 clipboard write failed:', err);
      }
    },
  };
}

/**
 * Install the OSC 52 handling the current setting calls for, replacing
 * whatever was installed before. Applies to a live session: xterm's addon
 * manager wraps `dispose()` so an addon can be unloaded, and the addon's own
 * `dispose` unregisters its OSC handler.
 */
function attachOsc52(session: TerminalSession) {
  session.osc52?.dispose();
  session.osc52 = null;
  // The user just moved the setting: a refusal after that is news again.
  // Still one notice at a time — never one per attempt.
  osc52Notified.delete(session.id);
  const access = osc52Access();
  if (access === 'deny') {
    // The addon is not loaded at all — nothing can reach a clipboard API.
    // A handler of our own still claims the sequence (xterm would drop an
    // unhandled OSC in silence) so the attempt can be reported once.
    session.osc52 = session.term.parser.registerOscHandler(52, (data) => {
      noteOsc52Refusal(session.id, data.split(';')[1] === '?' ? 'read' : 'write');
      return true;
    });
    return;
  }
  const addon = new ClipboardAddon(undefined, osc52Provider(session.id, access === 'readWrite'));
  session.term.loadAddon(addon);
  session.osc52 = addon;
}

// ---------------------------------------------------------------------------
// Links (issue 48)
// ---------------------------------------------------------------------------

/**
 * The modifier a link needs before it opens: Ctrl, or ⌘ on macOS.
 *
 * Ticket #43 made that the rule for the file paths in `lib/terminalLinks` —
 * a plain click in a terminal is a click in a *terminal*, it places a
 * selection and it must never navigate anywhere on its own. The two other
 * kinds of link live here, so the rule is applied here for both of them: the
 * URLs the `WebLinksAddon` finds in the output, and the `OSC 8` links a
 * program declares. One gesture for all three, whichever one you are looking
 * at — and one implementation of it, `isLinkOpenClick`, so the three can
 * never drift apart.
 */
function linkModifierHeld(event: MouseEvent | undefined): boolean {
  return event ? isLinkOpenClick(event) : false;
}

/**
 * Open a link the terminal produced, in the system browser.
 *
 * The scheme filter is not decoration. `OSC 8` lets the program choose the
 * URI, text and all: anything that can write to the PTY — a file you `cat`,
 * a process behind `ssh` — can declare a link on `javascript:`, and handing
 * that to the webview would run it inside CortX. `file:` and `data:` are the
 * same class of problem. Only `http` and `https` leave this function.
 *
 * xterm's `OscLinkProvider` refuses non-http(s) URIs of its own accord too,
 * unless `allowNonHttpProtocols` is turned on — which it is not, and must not
 * be. Two belts: this one is the one CortX controls, and it covers the
 * `WebLinksAddon` path with the same line of code.
 */
function openTerminalLink(event: MouseEvent | undefined, uri: string): void {
  if (!linkModifierHeld(event)) return;
  if (!/^https?:\/\//i.test(uri)) return;
  openExternal(uri).catch((err) => console.error('Failed to open URL:', err));
}

/**
 * What xterm does with an `OSC 8` hyperlink — the sequence `eza`, `gh`,
 * `cargo`, `delta`, `rustc` and most CI output use to declare a link on a
 * piece of text (issue 48).
 *
 * Without this, xterm falls back to `confirm()` with "WARNING: This link
 * could potentially be dangerous", a native modal that blocks the whole
 * webview and warns the user against their own terminal, and then opens the
 * URL with `window.open()` — *inside* the app, since nothing here is a
 * browser. So the one link kind the program declared explicitly, the most
 * trustworthy of the three, was the only one handled badly. It now takes the
 * very same path as a URL the `WebLinksAddon` spots: the same modifier, the
 * same scheme filter, the same `openExternal`.
 *
 * No `hover` on purpose: the target panel is `LinkHover`'s
 * (`lib/terminalLinks`), which tracks the pointer itself over both kinds of
 * link, and a second tooltip would fight it. What it cannot yet show is an
 * `OSC 8` target whose *text* is not a URL — it reads the grid, and the URI
 * of an OSC 8 link is not in the grid.
 */
const OSC8_LINK_HANDLER = {
  activate: (event: MouseEvent, uri: string) => openTerminalLink(event, uri),
};

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

function createSession(id: string): TerminalSession {
  ensureThemeObserver();
  ensureSettingsSubscription();
  const font = terminalFontOptions();
  const cursor = terminalCursorOptions();

  const term = new Terminal({
    allowProposedApi: true, // needed by addon-image / unicode11
    cursorBlink: cursor.cursorBlink,
    cursorStyle: cursor.cursorStyle,
    // Which pane the keys are going to, seen at a glance (issue 52).
    cursorInactiveStyle: cursor.cursorInactiveStyle,
    // `OSC 8` hyperlinks; without it xterm shows a `confirm()` warning and
    // opens the URL inside the webview. See `OSC8_LINK_HANDLER`.
    linkHandler: OSC8_LINK_HANDLER,
    // Terminal window: the canvas is see-through so the theme's window
    // opacity and wallpaper show behind the text (see lib/terminalTheme).
    allowTransparency: IS_TERMINAL_WINDOW,
    fontFamily: font.fontFamily,
    fontSize: snapFontSize(
      font.fontFamily,
      Math.max(6, font.fontSize + zoomDelta),
      useAppStore.getState().settings?.terminal.renderer ?? 'canvas'
    ),
    lineHeight: font.lineHeight,
    letterSpacing: font.letterSpacing ?? DEFAULT_LETTER_SPACING,
    fontWeight: font.fontWeight,
    fontWeightBold: font.fontWeightBold,
    scrollback: terminalScrollbackLines(),
    theme: buildTerminalTheme(),
    // ⌥ on macOS: off by default so the ordinary ⌥ layer of a French,
    // Swiss or AZERTY keyboard ([ ] { } | @) still types characters. The
    // word-motion chords come back through the key handler below; the
    // `always` mode is what turns this flag on. Ignored off macOS.
    macOptionIsMeta: macOptionIsMetaOption(),
    scrollOnUserInput: true,
    // Wheel scrolling glides instead of jumping a line at a time. Typing
    // still snaps to the bottom instantly (xterm disables the animation for
    // `scrollOnUserInput`), so this costs nothing at the prompt.
    smoothScrollDuration: smoothScrollDuration(),
    drawBoldTextInBrightColors: true,
    // Issue 52. The overview ruler is the strip beside the scrollbar where
    // decorations are drawn at their position in the *whole* buffer, not the
    // viewport — a minimap of the scrollback. CortX already asks for it
    // without having it: the find bar passes `matchOverviewRuler` /
    // `activeMatchColorOverviewRuler` colours (`FindBar.tsx`), which xterm
    // has been dropping on the floor because the ruler is only created when
    // a width is set. Eight px is the width of the terminal's scrollbar
    // (`styles/terminal-window.css`), which the ruler sits over and which
    // xterm sizes from this very number; the ruler paints nothing where
    // there is no decoration, so the scrollbar shows through it.
    overviewRuler: { width: 8 },
    // Issue 52: a glyph one cell wide whose ink spills into the next cell is
    // squeezed back into its own. This is the Nerd Font / ambiguous-width
    // case, which is CortX's daily bread — a powerline separator or a folder
    // glyph that bleeds over the character after it.
    rescaleOverlappingGlyphs: true,
    // Issue 52: `1` (xterm's default) leaves every colour as the theme wrote
    // it; `4.5` is WCAG AA. A setting, because raising it rewrites colours
    // the theme author chose — see `terminalMinimumContrast`.
    minimumContrastRatio: terminalMinimumContrast(),
    // Issue 52: off unless the user asks. Mirrors the rows into live DOM for
    // VoiceOver / NVDA, and costs on every render — see `screenReaderModeEnabled`.
    screenReaderMode: screenReaderModeEnabled(),
    // Tells xterm which reflow quirks to expect from ConPTY.
    windowsPty: IS_WINDOWS ? { backend: 'conpty' } : undefined,
  });

  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';
  // URLs spotted in the output. Same gesture and same filter as the `OSC 8`
  // links above (issue 48, ticket #43): Ctrl / ⌘ + click, `http(s)` only.
  term.loadAddon(new WebLinksAddon((event, uri) => openTerminalLink(event, uri)));
  // Sixel + iTerm2 inline images. Kitty graphics reach the same renderer
  // through `lib/terminalImages`, which rewrites them as iTerm2 sequences —
  // the addon has no kitty support and xterm.js has no APC handler at all.
  const image = new ImageAddon({
    sixelSupport: true,
    iipSupport: true,
    enableSizeReports: true,
    pixelLimit: 16777216,
    storageLimit: 128,
    showPlaceholder: true,
  });
  term.loadAddon(image);

  const container = document.createElement('div');
  container.className = 'cortx-xterm h-full w-full';

  const session: TerminalSession = {
    id,
    term,
    fit,
    search,
    image,
    container,
    opened: false,
    attachToken: null,
    webgl: null,
    canvas: null,
    ligatures: null,
    bellTimer: null,
    disposables: [],
    replaying: false,
    images: new TerminalImageFilter({
      // Answering the kitty support query is what makes programs use it.
      respond: (data) => {
        if (session.replaying) return;
        api.writeTerminal(id, data).catch(() => {});
      },
      kitty: () => useAppStore.getState().settings?.terminal.kittyGraphics !== false,
    }),
    pending: [],
    draining: false,
    sentSize: null,
    osc52: null,
  };

  // OSC 52 — what programs like tmux / neovim use to reach the system
  // clipboard, and what anything else on the PTY can use just as easily.
  // Denied by default; see `attachOsc52`.
  attachOsc52(session);

  // Clickable file paths (and `file:line:col`) next to the URL detection the
  // WebLinksAddon already does. Registered second, so URLs still win.
  session.disposables.push(registerFileLinkProvider(term, id));

  // Keyboard input → PTY. Errors (process already gone) are expected; ignore.
  session.disposables.push(
    term.onData((data) => {
      if (session.replaying) return;
      api.writeTerminal(id, data).catch(() => {});
    })
  );
  session.disposables.push(
    term.onResize(() => {
      pushTerminalSize(session);
    })
  );

  // `BEL` (issue 11): a flash of the pane, and a tone at `audible`. Never a
  // toast — see `handleBell`.
  session.disposables.push(term.onBell(() => handleBell(session)));

  // Copy / paste conventions (Windows Terminal style): Ctrl+C with a selection
  // copies instead of interrupting (unless copy on select already did it);
  // Ctrl+V and Ctrl+Shift+V paste; Ctrl+Shift+C always copies.
  //
  // On macOS those chords are on ⌘, and Ctrl belongs to the terminal: Ctrl+C
  // is the interrupt whatever is selected, and Ctrl+V is how Claude Code and
  // Codex read an *image* off the clipboard (zorg #28) — CortX used to swallow
  // it and paste the clipboard's text instead, so an image could not be
  // pasted at all there.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;

    // Keys a plain VT terminal cannot express — today only Shift+Enter,
    // which would otherwise send the same CR as Enter (see lib/terminalKeys).
    const sequence = overrideKeySequence(e);
    if (sequence !== null) {
      e.preventDefault();
      term.input(sequence, true);
      return false;
    }

    // macOS, `macOptionAsMeta: wordKeys` (the default): ⌥B / ⌥F / ⌥D / ⌥V
    // and ⌥⌫ are sent as ESC + key, everything else is left to macOS to
    // compose. See `lib/terminalKeys` for why the list is closed.
    const meta = macOptionMetaSequence(e);
    if (meta !== null) {
      e.preventDefault();
      term.input(meta, true);
      return false;
    }

    // AltGr is Ctrl+Alt on Windows and Linux, and it is how a French, Swiss
    // or AZERTY keyboard types `@ # { } [ ] \ |`. It must never be read as
    // one of the copy / paste chords below, or `AltGr+V` would paste instead
    // of typing its character.
    const mod = (IS_MAC ? e.metaKey : e.ctrlKey || e.metaKey) && !e.altKey;
    if (!mod) return true;
    if (e.code === 'KeyC') {
      // Ctrl/Cmd+Shift+C always copies. With nothing selected it used to copy
      // nothing at all; when a command block is selected (Ctrl+↑ / Ctrl+↓ or a
      // click on its gutter bar) it copies that block instead — see #7.
      if (e.shiftKey) {
        e.preventDefault();
        if (!term.hasSelection() && copySelectedBlock(id)) return false;
        void copySelection(term);
        return false;
      }
      // Ctrl+C over a selection copies — but only while copy on select is
      // off. With it on the text is already in the clipboard, so Ctrl+C
      // stays the interrupt that Claude Code and Codex need.
      if (term.hasSelection() && !copyOnSelectEnabled()) {
        e.preventDefault();
        void copySelection(term);
        return false;
      }
      return true;
    }
    if (e.code === 'KeyV') {
      // Ctrl/Cmd+Shift+V: no webview implements this one everywhere (macOS
      // has no menu entry for it), so read the clipboard by hand — and
      // cancel the event so Chromium's "paste and match style" does not
      // paste a second time.
      if (e.shiftKey || webviewPastesOnCtrlV === false) {
        e.preventDefault();
        void pasteFromClipboard(term);
        return false;
      }
      // Plain Ctrl/Cmd+V: leave the paste to the webview. Returning false
      // only keeps xterm from *also* sending ^V to the pty; the DOM `paste`
      // event still fires and xterm's own handler brackets and writes the
      // text — exactly once.
      if (webviewPastesOnCtrlV === null) probeWebviewPaste(term);
      return false;
    }
    return true;
  });

  container.addEventListener('paste', noteWebviewPaste, true);

  // Right-click: copy the selection if there is one, otherwise paste — except
  // over a command block the user has deliberately selected (#7), which opens
  // that block's menu instead. Right-click keeps meaning "paste" everywhere
  // else, and always when no block is selected.
  container.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (term.hasSelection()) {
      void copySelection(term);
    } else if (!openSelectedBlockMenu(id, e.clientX, e.clientY)) {
      void pasteFromClipboard(term);
    }
  });

  // Copy on select (Warp, and the X11 tradition): the text of a *mouse*
  // selection reaches the clipboard as soon as the drag ends — never during
  // it, never for an empty or whitespace-only selection, and the highlight
  // stays where it is. Keyboard selections (select all) are left alone.
  let mouseSelecting = false;
  container.addEventListener('mousedown', (e) => {
    if (e.button === 0) mouseSelecting = true;
  });
  // On `document`: a drag very often ends with the pointer outside the pane.
  const onMouseUp = (e: MouseEvent) => {
    if (e.button !== 0 || !mouseSelecting) return;
    mouseSelecting = false;
    if (!copyOnSelectEnabled()) return;
    // One turn later: xterm settles the selection in its own listener for
    // this very mouseup, and a plain click has cleared it by then.
    window.setTimeout(() => {
      if (!term.hasSelection() || !term.getSelection().trim()) return;
      void copySelection(term, false);
    }, 0);
  };
  document.addEventListener('mouseup', onMouseUp, true);
  session.disposables.push({ dispose: () => document.removeEventListener('mouseup', onMouseUp, true) });

  sessions.set(id, session);
  return session;
}

/** Renderer from the settings (`webgl` when unset). */
function currentRenderer(): 'webgl' | 'canvas' | 'dom' {
  return useAppStore.getState().settings?.terminal.renderer ?? 'canvas';
}

/** Attach the accelerated renderer the settings ask for (none in `dom`). */
function applyRenderer(session: TerminalSession) {
  if (!session.opened) return;
  const renderer = currentRenderer();
  if (renderer !== 'webgl' && session.webgl) {
    session.webgl.dispose();
    session.webgl = null;
  }
  if (renderer !== 'canvas' && session.canvas) {
    session.canvas.dispose();
    session.canvas = null;
  }
  if (renderer === 'webgl' && !session.webgl) tryLoadWebgl(session);
  if (renderer === 'canvas' && !session.canvas) tryLoadCanvas(session);
}

function applyRendererToAll() {
  for (const s of sessions.values()) applyRenderer(s);
}

/**
 * Canvas renderer: like the GPU one it draws box, block and powerline
 * characters itself at the exact cell size (no seams), but it rasterises
 * text through the platform's engine, so glyphs stay as fine as the DOM
 * renderer's.
 */
function tryLoadCanvas(session: TerminalSession) {
  try {
    const canvas = new CanvasAddon();
    session.term.loadAddon(canvas);
    session.canvas = canvas;
  } catch (err) {
    console.warn('Canvas renderer unavailable, using the DOM renderer:', err);
    session.canvas = null;
  }
}

function tryLoadWebgl(session: TerminalSession) {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      webgl.dispose();
      session.webgl = null;
    });
    session.term.loadAddon(webgl);
    session.webgl = webgl;
  } catch (err) {
    // Canvas/DOM renderer fallback — slower but always works.
    console.warn('WebGL renderer unavailable, using DOM renderer:', err);
    session.webgl = null;
  }
}

/**
 * Programs that ask the terminal for its background colour (OSC 11) and
 * then paint their own rows with it — Claude Code's input line, for one —
 * would draw an opaque slab of theme colour over the wallpaper. In a themed
 * Terminal window, an explicit truecolor background equal to the theme
 * background is turned back into the default (transparent) background.
 * Pure ASCII rewrite of `48;2;R;G;B` / `48:2::R:G:B`, applied per chunk.
 */
let bgFilter: { key: string; pattern: RegExp } | null = null;

function neutraliseThemeBackground(bytes: Uint8Array): Uint8Array {
  if (!IS_TERMINAL_WINDOW) return bytes;
  const theme = getXtermThemeOverride();
  const hex = theme?.background;
  if (!hex || !isWindowThemeActive()) return bytes;
  if (bgFilter?.key !== hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
    if (!m) return bytes;
    const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
    // Only inside a CSI sequence (`ESC [ … m`), so the same digits typed as
    // plain text are left alone.
    bgFilter = {
      key: hex,
      pattern: new RegExp(`(\\x1b\\[[0-9;:]*?)48(?:;2;${r};${g};${b}|:2::?${r}:${g}:${b})(?=[;:m])`, 'g'),
    };
  }
  // Cheap pre-check: the sequence is rare, most chunks pass untouched.
  let has48 = false;
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0x34 && bytes[i + 1] === 0x38) {
      has48 = true;
      break;
    }
  }
  if (!has48) return bytes;
  let latin1 = '';
  for (let i = 0; i < bytes.length; i++) latin1 += String.fromCharCode(bytes[i]);
  // Keep the CSI prefix the pattern captured ('$1' + '49' would be read as
  // group 149 by some engines, hence the function form).
  const replaced = latin1.replace(bgFilter.pattern, (_m, prefix: string) => `${prefix}49`);
  if (replaced === latin1) return bytes;
  const out = new Uint8Array(replaced.length);
  for (let i = 0; i < replaced.length; i++) out[i] = replaced.charCodeAt(i);
  return out;
}

/**
 * PTY output → xterm, through the image filter.
 *
 * The filter hands back the chunk as a list of parts: bytes ready to write,
 * and now and then a promise (a kitty frame that has to be inflated or
 * re-encoded). Everything goes through one FIFO per session so a promise can
 * never let later bytes overtake earlier ones.
 */
function writeFromPty(session: TerminalSession, bytes: Uint8Array, done?: () => void) {
  const parts: QueuedPart[] = session.images.feed(neutraliseThemeBackground(bytes));
  if (done) {
    if (parts.length) parts[parts.length - 1].done = done;
    else parts.push({ done });
  }
  if (!parts.length) return;
  session.pending.push(...parts);
  drainPending(session);
}

function drainPending(session: TerminalSession) {
  if (session.draining) return;
  while (session.pending.length) {
    const part = session.pending[0];
    if (part.promise) {
      session.draining = true;
      part.promise
        .catch(() => null)
        .then((resolved) => {
          session.draining = false;
          if (session.pending[0] !== part) return;
          session.pending.shift();
          if (resolved?.length) session.term.write(resolved, part.done);
          else part.done?.();
          drainPending(session);
        });
      return;
    }
    session.pending.shift();
    if (part.bytes?.length) session.term.write(part.bytes, part.done);
    else part.done?.();
  }
}

async function attach(session: TerminalSession) {
  if (session.attachToken !== null) return;
  try {
    let first = true;
    const token = await api.attachTerminal(session.id, (bytes) => {
      if (first) {
        // The stored scrollback. It still contains the queries the shell
        // made when it started (device attributes, cursor position…) and
        // xterm would answer them again — straight into the shell's input
        // line. Mute keyboard/response output until the replay is parsed.
        first = false;
        session.replaying = true;
        writeFromPty(session, bytes, () => {
          session.replaying = false;
        });
        return;
      }
      writeFromPty(session, bytes);
    });
    // The session may have been disposed while the invoke was in flight.
    if (!sessions.has(session.id)) {
      api.detachTerminal(session.id, token).catch(() => {});
      return;
    }
    session.attachToken = token;
    // The PTY exists for sure now: a size that was refused while it was still
    // spawning (see pushTerminalSize) gets through this time.
    pushTerminalSize(session);
  } catch (err) {
    console.error(`Failed to attach terminal ${session.id}:`, err);
  }
}

/**
 * Tell the backend the size xterm actually has.
 *
 * This has to be belt and braces, because a PTY whose row count disagrees
 * with xterm's is *silently* broken: ConPTY anchors every absolute cursor
 * move (`ESC [ row ; col H`) to the bottom of its own screen, so once the
 * screen has filled, a terminal that is N rows taller than the PTY has
 * everything drawn N rows too high — output lands on top of the lines above
 * the prompt instead of below it (DEV-13, the fastfetch report). While the
 * screen is still short, both sides count from the top and nothing shows,
 * which is why it only bites after the first screenful.
 *
 * Two holes are closed here. `term.onResize` only fires when the size
 * *changes*, so a shell spawned at a size that happens to equal xterm's
 * starting 80×24 was never corrected; and the resize sent while the shell was
 * still spawning was rejected by the backend ("No running terminal") and the
 * error thrown away. So: send after every fit, remember what the backend
 * accepted, and try again on the next fit and right after the attach.
 */
function pushTerminalSize(session: TerminalSession) {
  const { cols, rows } = session.term;
  if (cols < 2 || rows < 2) return;
  if (session.sentSize?.cols === cols && session.sentSize.rows === rows) return;
  const size = { cols, rows };
  session.sentSize = size;
  api.resizeTerminal(session.id, cols, rows).catch(() => {
    // Most likely the PTY is not registered yet. Forget it so the next fit
    // (or the attach) tries again instead of trusting a size nobody applied.
    if (session.sentSize === size) session.sentSize = null;
  });
}

/** Get (or lazily create) the session for a terminal id. */
export function getTerminalSession(id: string): TerminalSession {
  return sessions.get(id) ?? createSession(id);
}

/**
 * Render the session inside `parent`. Safe to call repeatedly; the xterm DOM
 * is simply re-parented. The backend subscription starts on first mount.
 */
export function mountTerminal(id: string, parent: HTMLElement): TerminalSession {
  const session = getTerminalSession(id);
  if (session.container.parentElement !== parent) {
    parent.appendChild(session.container);
  }
  if (!session.opened) {
    session.term.open(session.container);
    session.opened = true;
    // Issue 12: needs `term.element`, and has to come before the accelerated
    // renderer so the texture atlas is built with the font features on.
    void applyLigatures(session);
    // Ticket #15. Both need `term.element`, so they can only start once xterm
    // has opened; both are inert until their setting is switched on, and both
    // live on the session container, which is what gets re-parented between
    // the dock and the Terminal window.
    session.disposables.push(attachInputPosition(id, session.term, session.container));
    session.disposables.push(attachInputEditor(id, session.term, session.container, () => session.replaying));
    // Command blocks (#7): same deal — an overlay on the session container,
    // inert until the shell emits its first OSC 133 marker, and silent while
    // a restored snapshot is being replayed.
    session.disposables.push(attachBlocks(id, session.term, session.container, () => session.replaying));
    // Fit before the first output is consumed, and so the pane's size is
    // known to the next shell that spawns.
    fitTerminal(id);
    attach(session);
  }
  // GPU renderer only while on screen (see unmountTerminal): a window with
  // 20 tabs holds one WebGL context per *visible* pane, not per tab.
  applyRenderer(session);
  // Two frames: layout must settle before fit() can measure the container.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      fitTerminal(id);
      // The pane moved (tab switched, detached to the Terminal window): the
      // bottom offset and the editor's anchor are measured in this container.
      refreshInputPositions();
      refreshInputEditors();
      refreshBlocks();
    })
  );
  return session;
}

/** Detach the DOM without destroying the session (tab switched / hidden).
 *  Releases the WebGL context; the buffer stays in memory and the DOM
 *  renderer takes over until the next mount reloads WebGL. */
export function unmountTerminal(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  session.container.remove();
  if (session.webgl) {
    session.webgl.dispose();
    session.webgl = null;
  }
  if (session.canvas) {
    session.canvas.dispose();
    session.canvas = null;
  }
}

export function fitTerminal(id: string) {
  const session = sessions.get(id);
  if (!session?.opened || !session.container.isConnected) return;
  try {
    session.fit.fit();
  } catch {
    // fit() throws when the container has no size yet; the ResizeObserver
    // in XtermView calls us again once it does.
    return;
  }
  // Re-assert the size even when xterm's did not change: `onResize` is not
  // enough on its own (see pushTerminalSize).
  pushTerminalSize(session);
  // Remember the size on the leaf: a restored shell is spawned at the size it
  // will have, instead of being resized after its prompt is already on screen.
  const { cols, rows } = session.term;
  if (cols > 2 && rows > 2) {
    useTerminalLayoutStore.getState().updateLeafSize(id, cols, rows);
  }
}

/**
 * Size a shell should be spawned at, read from a terminal already on screen
 * (`preferred` first, then any mounted one). `null` when nothing is mounted —
 * the caller then leaves it to the backend default.
 *
 * Spawning at the final size matters: a PTY resized after the shell has drawn
 * its prompt leaves the line editor writing several lines above it, because
 * the coordinates it captured no longer match the reflowed buffer.
 */
export function measuredTerminalSize(preferred?: string): { cols: number; rows: number } | null {
  const usable = (s: TerminalSession | undefined) =>
    s?.opened && s.container.isConnected && s.term.cols > 2 && s.term.rows > 2
      ? { cols: s.term.cols, rows: s.term.rows }
      : null;
  const first = preferred ? usable(sessions.get(preferred)) : null;
  if (first) return first;
  // Widest pane on screen: a new tab is a single full-width pane, so the
  // largest mounted terminal is the closest match.
  let best: { cols: number; rows: number } | null = null;
  for (const s of sessions.values()) {
    const size = usable(s);
    if (size && (!best || size.cols * size.rows > best.cols * best.rows)) best = size;
  }
  return best;
}

export function focusTerminal(id: string) {
  const session = sessions.get(id);
  if (!session?.opened || !session.container.isConnected) return;
  session.term.focus();
}

/** Scroll to the bottom of the buffer. */
export function scrollTerminalToBottom(id: string) {
  sessions.get(id)?.term.scrollToBottom();
}

/** Wipe the visible buffer and the backend scrollback (the "Clear" button). */
export function clearTerminal(id: string) {
  const session = sessions.get(id);
  session?.term.clear();
  api.clearTerminalScrollback(id).catch(() => {});
}

/** Tear the session down for good (tab closed). */
export function disposeTerminal(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  session.pending = [];
  session.images.reset();
  if (session.attachToken !== null) {
    api.detachTerminal(id, session.attachToken).catch(() => {});
  }
  for (const d of session.disposables) d.dispose();
  session.osc52?.dispose();
  session.osc52 = null;
  osc52Notified.delete(id);
  if (session.bellTimer !== null) window.clearTimeout(session.bellTimer);
  session.bellTimer = null;
  lastBellAt.delete(id);
  session.webgl?.dispose();
  session.canvas?.dispose();
  session.ligatures?.dispose();
  session.ligatures = null;
  session.term.dispose();
  session.container.remove();
}

export function hasTerminalSession(id: string): boolean {
  return sessions.has(id);
}

/** Ids of every session held by this window (mounted or not). */
export function listTerminalSessionIds(): string[] {
  return Array.from(sessions.keys());
}

/**
 * The buffer of a session as plain lines with colours (no cursor movement),
 * for the restore snapshot. `null` when the session has no content yet.
 */
export function serializeTerminalSession(id: string, scrollback = 200): string | null {
  const session = sessions.get(id);
  if (!session?.opened) return null;
  try {
    let serializer = serializers.get(id);
    if (!serializer) {
      serializer = new SerializeAddon();
      session.term.loadAddon(serializer);
      serializers.set(id, serializer);
      session.disposables.push({ dispose: () => serializers.delete(id) });
    }
    const text = serializer.serialize({ scrollback });
    return text.trim().length > 0 ? text : null;
  } catch {
    return null;
  }
}

const serializers = new Map<string, SerializeAddon>();

// ---------------------------------------------------------------------------
// Zoom: Ctrl+= / Ctrl+- / Ctrl+0 and Ctrl+wheel
// ---------------------------------------------------------------------------

const ZOOM_MIN = -6;
const ZOOM_MAX = 12;
// One level per window (the dock and the Terminal window each keep their
// own), remembered across restarts: Settings owns the base font size, this
// is the offset the user dialled on top of it and expects to find again.
const ZOOM_KEY = `cortx-terminal-zoom:${IS_TERMINAL_WINDOW ? 'terminal' : 'main'}`;

function readStoredZoom(): number {
  try {
    const raw = localStorage.getItem(ZOOM_KEY);
    if (raw === null) return 0;
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return 0;
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, n));
  } catch {
    // localStorage can be unavailable; the zoom is simply not remembered.
    return 0;
  }
}

function storeZoom() {
  try {
    if (zoomDelta === 0) localStorage.removeItem(ZOOM_KEY);
    else localStorage.setItem(ZOOM_KEY, String(zoomDelta));
  } catch {
    // see readStoredZoom
  }
}

let zoomDelta = readStoredZoom();

function applyZoomToAll() {
  const font = terminalFontOptions();
  for (const s of sessions.values()) {
    applyFontMetrics(s.term, font);
    if (s.container.isConnected) fitTerminal(s.id);
  }
}

/** Grow / shrink every terminal of this window by `step` px. Returns the resulting font size. */
export function adjustTerminalZoom(step: number): number {
  zoomDelta = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomDelta + step));
  storeZoom();
  applyZoomToAll();
  return terminalFontOptions().fontSize + zoomDelta;
}

export function resetTerminalZoom(): number {
  zoomDelta = 0;
  storeZoom();
  applyZoomToAll();
  return terminalFontOptions().fontSize;
}

export function currentTerminalZoomDelta(): number {
  return zoomDelta;
}
