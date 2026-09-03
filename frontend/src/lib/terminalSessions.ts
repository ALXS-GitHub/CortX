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
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ImageAddon } from '@xterm/addon-image';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as api from '@/lib/tauri';
import { useAppStore } from '@/stores/appStore';
import { getXtermThemeOverride, isWindowThemeActive, themeToXterm } from '@/lib/terminalTheme';

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
  disposables: IDisposable[];
  /** True while the backend scrollback snapshot is being parsed (see attach). */
  replaying: boolean;
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
    return getCurrentWindow().label === 'terminal';
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
 * xterm palette: the active / previewed terminal theme when the theme store
 * has one (see `stores/terminalThemeStore`), else derived from the app's
 * CSS tokens.
 */
export function buildTerminalTheme(): ITheme {
  const override = getXtermThemeOverride();
  if (override) {
    return themeToXterm(override, { transparentBackground: IS_TERMINAL_WINDOW });
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
      selectionBackground: `rgba(${fgOnly[0]}, ${fgOnly[1]}, ${fgOnly[2]}, 0.25)`,
      selectionInactiveBackground: `rgba(${fgOnly[0]}, ${fgOnly[1]}, ${fgOnly[2]}, 0.15)`,
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
    selectionBackground: `rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, 0.25)`,
    selectionInactiveBackground: `rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, 0.15)`,
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
export function terminalFontOptions(): { fontFamily: string; fontSize: number; lineHeight: number } {
  const cfg = useAppStore.getState().settings?.terminal;
  const family = cfg?.fontFamily?.trim();
  const size = cfg?.fontSize;
  const lh = cfg?.lineHeight;
  return {
    // A user font still falls back to the stack for glyphs it lacks.
    fontFamily: family ? `"${family.replace(/"/g, '')}", ${DEFAULT_FONT_STACK}` : DEFAULT_FONT_STACK,
    fontSize: size && size >= 8 && size <= 32 ? size : DEFAULT_FONT_SIZE,
    lineHeight: lh && lh >= 1 && lh <= 2 ? lh : DEFAULT_LINE_HEIGHT,
  };
}

const DEFAULT_LINE_HEIGHT = 1.2;
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
  const width = advanceCanvas.measureText('WWWWWWWWWW').width / 10;
  advanceCache.set(key, width);
  return width;
}

/**
 * xterm truncates the cell width to whole pixels, so a font whose advance is
 * 8.43 px is drawn in 8 px cells: glyphs overlap and look bold and cramped
 * (Hack at 14 px, for one). One pixel of letter spacing when the fraction is
 * large restores the spacing the font was designed with.
 */
export function autoLetterSpacing(fontFamily: string, fontSize: number): number {
  const advance = glyphAdvance(fontFamily, fontSize);
  const fraction = advance - Math.floor(advance);
  // Anything but a near-integral advance gets the extra pixel: a hair of air
  // between glyphs beats clipped, overlapping strokes.
  return fraction >= 0.15 ? 1 : 0;
}

/** Push family, size (with the window zoom), line height and letter spacing to one terminal. */
function applyFontMetrics(term: Terminal, font: { fontFamily: string; fontSize: number; lineHeight: number }) {
  const size = Math.max(6, font.fontSize + zoomDelta);
  term.options.fontFamily = font.fontFamily;
  term.options.fontSize = size;
  term.options.lineHeight = font.lineHeight;
  term.options.letterSpacing = autoLetterSpacing(font.fontFamily, size);
}

// ---------------------------------------------------------------------------
// Cursor + padding (Settings > Terminal appearance; DEV-13 P3)
// ---------------------------------------------------------------------------

const DEFAULT_PADDING = 8;

/** xterm cursor options from the user's settings. */
export function terminalCursorOptions(): { cursorStyle: 'block' | 'underline' | 'bar'; cursorBlink: boolean } {
  const cfg = useAppStore.getState().settings?.terminal;
  return {
    cursorStyle: cfg?.cursorStyle ?? 'bar',
    cursorBlink: cfg?.cursorBlink ?? true,
  };
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
  useAppStore.subscribe(() => {
    const font = terminalFontOptions();
    const fontKey = JSON.stringify(font);
    if (fontKey !== lastFont) {
      lastFont = fontKey;
      for (const s of sessions.values()) {
        applyFontMetrics(s.term, font);
        if (s.container.isConnected) fitTerminal(s.id);
      }
    }
    const cursor = terminalCursorOptions();
    const cursorKey = JSON.stringify(cursor);
    if (cursorKey !== lastCursor) {
      lastCursor = cursorKey;
      for (const s of sessions.values()) {
        s.term.options.cursorStyle = cursor.cursorStyle;
        s.term.options.cursorBlink = cursor.cursorBlink;
      }
    }
    const padding = terminalPadding();
    if (padding !== lastPadding) {
      lastPadding = padding;
      applyTerminalPadding();
    }
  });
}

export function applyThemeToAll() {
  const theme = buildTerminalTheme();
  for (const s of sessions.values()) {
    s.term.options.theme = theme;
  }
}

// ---------------------------------------------------------------------------
// Clipboard helpers
// ---------------------------------------------------------------------------

async function copySelection(term: Terminal): Promise<boolean> {
  if (!term.hasSelection()) return false;
  const text = term.getSelection();
  try {
    await writeText(text);
  } catch (err) {
    console.error('Clipboard write failed:', err);
    return false;
  }
  term.clearSelection();
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
    // Terminal window: the canvas is see-through so the theme's window
    // opacity and wallpaper show behind the text (see lib/terminalTheme).
    allowTransparency: IS_TERMINAL_WINDOW,
    fontFamily: font.fontFamily,
    fontSize: Math.max(6, font.fontSize + zoomDelta),
    lineHeight: font.lineHeight,
    letterSpacing: autoLetterSpacing(font.fontFamily, Math.max(6, font.fontSize + zoomDelta)),
    scrollback: 10000,
    theme: buildTerminalTheme(),
    macOptionIsMeta: true,
    scrollOnUserInput: true,
    drawBoldTextInBrightColors: true,
    // Tells xterm which reflow quirks to expect from ConPTY.
    windowsPty: IS_WINDOWS ? { backend: 'conpty' } : undefined,
  });

  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';
  term.loadAddon(
    new WebLinksAddon((_event, uri) => {
      openExternal(uri).catch((err) => console.error('Failed to open URL:', err));
    })
  );
  // Sixel + iTerm2 inline images. (Kitty graphics land in a later addon release.)
  const image = new ImageAddon({
    sixelSupport: true,
    iipSupport: true,
    enableSizeReports: true,
    pixelLimit: 16777216,
    storageLimit: 128,
    showPlaceholder: true,
  });
  term.loadAddon(image);
  // OSC 52: lets programs like tmux / neovim write to the system clipboard.
  term.loadAddon(new ClipboardAddon());

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
    disposables: [],
    replaying: false,
  };

  // Keyboard input → PTY. Errors (process already gone) are expected; ignore.
  session.disposables.push(
    term.onData((data) => {
      if (session.replaying) return;
      api.writeTerminal(id, data).catch(() => {});
    })
  );
  session.disposables.push(
    term.onResize(({ cols, rows }) => {
      api.resizeTerminal(id, cols, rows).catch(() => {});
    })
  );

  // Copy / paste conventions (Windows Terminal style): Ctrl+C with a selection
  // copies instead of interrupting; Ctrl+V and Ctrl+Shift+V paste;
  // Ctrl+Shift+C always copies.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return true;
    if (e.code === 'KeyC') {
      if (e.shiftKey || term.hasSelection()) {
        copySelection(term);
        return false;
      }
      return true;
    }
    if (e.code === 'KeyV') {
      pasteFromClipboard(term);
      return false;
    }
    return true;
  });

  // Right-click: copy the selection if there is one, otherwise paste.
  container.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (term.hasSelection()) {
      copySelection(term);
    } else {
      pasteFromClipboard(term);
    }
  });

  sessions.set(id, session);
  return session;
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
        session.term.write(neutraliseThemeBackground(bytes), () => {
          session.replaying = false;
        });
        return;
      }
      session.term.write(neutraliseThemeBackground(bytes));
    });
    // The session may have been disposed while the invoke was in flight.
    if (!sessions.has(session.id)) {
      api.detachTerminal(session.id, token).catch(() => {});
      return;
    }
    session.attachToken = token;
  } catch (err) {
    console.error(`Failed to attach terminal ${session.id}:`, err);
  }
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
    attach(session);
  }
  // GPU renderer only while on screen (see unmountTerminal): a window with
  // 20 tabs holds one WebGL context per *visible* pane, not per tab.
  if (!session.webgl) tryLoadWebgl(session);
  // Two frames: layout must settle before fit() can measure the container.
  requestAnimationFrame(() => requestAnimationFrame(() => fitTerminal(id)));
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
}

export function fitTerminal(id: string) {
  const session = sessions.get(id);
  if (!session?.opened || !session.container.isConnected) return;
  try {
    session.fit.fit();
  } catch {
    // fit() throws when the container has no size yet; the ResizeObserver
    // in XtermView calls us again once it does.
  }
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
  if (session.attachToken !== null) {
    api.detachTerminal(id, session.attachToken).catch(() => {});
  }
  for (const d of session.disposables) d.dispose();
  session.webgl?.dispose();
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
// Zoom (per window, not persisted): Ctrl+= / Ctrl+- / Ctrl+0
// ---------------------------------------------------------------------------

let zoomDelta = 0;
const ZOOM_MIN = -6;
const ZOOM_MAX = 12;

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
  applyZoomToAll();
  return terminalFontOptions().fontSize + zoomDelta;
}

export function resetTerminalZoom(): number {
  zoomDelta = 0;
  applyZoomToAll();
  return terminalFontOptions().fontSize;
}

export function currentTerminalZoomDelta(): number {
  return zoomDelta;
}
