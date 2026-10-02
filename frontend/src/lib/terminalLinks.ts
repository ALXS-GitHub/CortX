/**
 * Clickable file paths in the terminal (DEV-13), and the hover surface every
 * terminal link gets (ticket #31 + `general.link_tooltip`).
 *
 * `WebLinksAddon` only ever underlines URLs. Compiler and linter output is
 * full of paths instead — `src/main.rs:42:7`, `C:\dev\x\build.log`,
 * `./scripts/build.ts` — and those are what you actually want to click.
 *
 * How it stays cheap: the underline is an xterm **link provider**, so it only
 * ever looks at the few lines around the row under the pointer, never at the
 * buffer. The only disk access is an `exists()` per distinct candidate,
 * memoised for a few seconds — a path that does not resolve is not underlined
 * at all, which is what keeps every word with a slash in it from becoming a
 * link. Finding the candidates — paths with a space in them and paths a
 * program cut over two rows included (zorg #49) — is `terminalPathScan.ts`.
 *
 * Relative paths are resolved against the terminal's live directory, which
 * shell integration reports over OSC 7 (`TerminalShellState.cwd`).
 *
 * ## What opens a link (zorg #43)
 *
 * **Ctrl+click** (⌘+click on macOS) opens the path: a text file or a position
 * in the editor CortX already uses elsewhere (at the line the output pointed
 * at), any other file with the OS's default program, a directory in the file
 * manager. Holding Alt as well reveals it in its folder instead.
 *
 * A **plain click opens nothing**. In a terminal the left button belongs to
 * the text: it places the caret and drags out a selection, and that is true of
 * the pixels a link happens to sit on too. VS Code, iTerm2 and Windows
 * Terminal all require a modifier for the same reason — copying half of an
 * error message should never launch an editor. Shift and Alt on their own are
 * left to the terminal as well (Shift extends a selection, Alt moves the
 * caret), so the old Alt/Shift-click reveal is now Ctrl+Alt+click.
 *
 * The gesture-free way in is the hover panel below: its buttons answer to an
 * ordinary click, because a button is a button.
 *
 * ## The hover surface (ticket #31)
 *
 * An underline is an affordance for *one* gesture, and it does not say where
 * that gesture leads. Two things were missing:
 *
 * 1. **The target.** Warp shows it (`general.link_tooltip`). On a path it is
 *    plainly useful — `src/main.rs` says nothing about which checkout it is —
 *    and on a URL it is a security matter: the text a program printed is not
 *    necessarily where the link goes.
 * 2. **The actions.** "Open" and "Open folder", the two things you want to do
 *    with a path, with a real button each rather than a modifier you have to
 *    know about.
 *
 * They are one surface, because they answer the same question. It is driven
 * by our *own* pointer tracking (`LinkHover`), not by xterm's `ILink.hover`,
 * for two reasons: xterm's linkifier drops and re-asks for the link on every
 * viewport render, which would make the panel flicker under a running
 * command; and the URL links belong to `WebLinksAddon`, whose `ILink` we do
 * not build and cannot hook. One watcher covers both kinds in both windows.
 *
 * `LinkHover` also carries a **click fallback** for paths. xterm activates a
 * link from the linkifier's `_currentLink`, which the same render churn can
 * clear between `mousedown` and `mouseup`; the fallback re-resolves the token
 * under the pointer on a Ctrl+click and opens it, de-duplicated against the
 * provider's own activation so a working click never opens twice.
 *
 * ## The cursor, and why the underline stays
 *
 * The underline says *this is a link*; it no longer promises that a click will
 * follow it, so the promise has to be made and withdrawn somewhere else — the
 * pointer cursor. Over a link it is now an I-beam like the rest of the grid
 * (a plain click really does select text there) and it turns into a hand the
 * moment Ctrl is held, which is exactly VS Code's affordance.
 *
 * The underline itself is *not* gated on Ctrl, for a mechanical reason: it is
 * a decoration xterm reads once, when the linkifier asks the provider for the
 * line under the pointer, and it is painted by the renderer — there is no API
 * to re-evaluate it on a keydown. Faking it would mean tearing the link cache
 * down and rebuilding it on every Ctrl press, i.e. the same flicker under a
 * running command that this module already goes out of its way to avoid. And
 * an underline is honest either way: it marks a link, and the panel that comes
 * up on the same hover names the gesture.
 */
import type { IDisposable, ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { exists } from '@tauri-apps/plugin-fs';
import { toast } from 'sonner';
import { homeDir } from '@tauri-apps/api/path';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import '@/styles/terminal-links.css';
import * as api from '@/lib/tauri';
import { IS_MAC } from '@/lib/keybindings';
import { useAppStore } from '@/stores/appStore';
import { pathCandidates, pickPathLinks, type FoundPath, type ScanLine } from '@/lib/terminalPathScan';
import type { TerminalConfig } from '@/types';

/**
 * Does this click mean "open this link"? (zorg #43)
 *
 * Ctrl on Windows and Linux, ⌘ on macOS — where Ctrl+click *is* the context
 * menu, so it must not be an accelerator for anything. Left button only: the
 * right button opens the terminal's own menu, and the middle one pastes.
 *
 * Exported because every way a link can be opened has to agree on the
 * gesture: this provider, the click fallback in `LinkHover`, and — over in
 * `terminalSessions.ts` — the `WebLinksAddon` handler and the `OSC 8` one,
 * whose `linkModifierHeld` is this same test.
 */
export function isLinkOpenClick(event: MouseEvent): boolean {
  if (event.button !== 0) return false;
  return IS_MAC ? event.metaKey : event.ctrlKey;
}

/**
 * Ctrl+Alt+click shows the containing folder instead of opening the file.
 * Shift is deliberately not part of it any more: in every terminal Shift+click
 * extends the selection, and that is a gesture we have no business overriding
 * now that the modifier is what decides whether anything opens at all.
 */
function wantsReveal(event: MouseEvent): boolean {
  return event.altKey;
}

/**
 * `cortx-link-mod` on `<body>` while the open modifier is held — the one thing
 * that still promises a click will follow the link (see the module header).
 * Installed once, on the first terminal that gets a link provider, and left
 * there: it is two listeners doing a `getModifierState` call, and the panel
 * singleton below sets the same precedent.
 *
 * Capture phase, because the terminal eats plenty of keystrokes on their way
 * up; `blur` clears the class, since a keyup that happens in another window
 * never reaches us.
 */
const MOD_CLASS = 'cortx-link-mod';
let modifierWatched = false;

function watchOpenModifier(): void {
  if (modifierWatched || typeof window === 'undefined') return;
  modifierWatched = true;
  const sync = (held: boolean) => document.body.classList.toggle(MOD_CLASS, held);
  const fromKey = (e: KeyboardEvent) =>
    sync(e.getModifierState(IS_MAC ? 'Meta' : 'Control'));
  window.addEventListener('keydown', fromKey, true);
  window.addEventListener('keyup', fromKey, true);
  window.addEventListener('blur', () => sync(false));
}

/**
 * URLs, the same shape `WebLinksAddon` underlines (its `strictUrlRegex`, with
 * `g` so the whole line can be scanned). Kept in step on purpose: the panel
 * must appear on exactly what the addon made clickable, never on more.
 */
const URL_CANDIDATE = /(?:https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/g;
const IS_WINDOWS = /Windows/i.test(navigator.userAgent);

/**
 * Logical lines read on each side of the hovered one. A path a program cut
 * over several rows can start above the pointer, or go on below it.
 */
const CONTEXT_LINES = 3;
/** Paths looked up per row, each costing up to a dozen `exists()` calls. */
const MAX_CANDIDATES = 24;
const CACHE_TTL_MS = 8000;
const CACHE_MAX = 500;

/** Rest on a link this long before the panel appears. */
const HOVER_DELAY_MS = 110;
/**
 * Safety net, not the mechanism. Reaching the panel does not depend on being
 * quick: it is flush against the token (`PANEL_OVERLAP_PX`) and the pointer
 * entering it disarms every grid timer. This only covers a pointer that leaves
 * the link sideways and comes back, or the diagonal shortcut into a panel the
 * clamp pushed off the token's own column.
 */
const HOVER_CLOSE_MS = 140;
/**
 * How far the panel laps over the token's first pixel row (ticket #42).
 *
 * The panel used to sit 2px above the token, and those 2px belonged to neither
 * of them: crossing them fired one more `mousemove` on the grid, which armed a
 * `present()` for a cell holding no link — and that timer then fired *after*
 * the pointer had already reached the panel and killed it under the cursor.
 * Zero would be enough in exact arithmetic, but `offsetHeight` is an integer
 * rounded off a fractional box, so one pixel of overlap absorbs the remainder.
 * It costs the top pixel of the link's own row, which carries no glyph.
 */
const PANEL_OVERLAP_PX = 1;
/** A click is ignored when the provider just opened the very same target. */
const ACTIVATION_DEDUP_MS = 600;

const existsCache = new Map<string, { at: number; ok: boolean }>();

/**
 * Lookups still on their way. The underline and the hover panel scan the same
 * rows at the same moment, and since #49 each path is asked about in several
 * lengths: without this, every one of them crossed the IPC bridge twice.
 */
const existsInFlight = new Map<string, Promise<boolean>>();

async function pathExists(path: string): Promise<boolean> {
  const now = Date.now();
  const hit = existsCache.get(path);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.ok;
  const pending = existsInFlight.get(path);
  if (pending) return pending;
  const lookup = exists(path)
    .catch(() => false)
    .then((ok) => {
      existsInFlight.delete(path);
      if (existsCache.size >= CACHE_MAX) existsCache.clear();
      existsCache.set(path, { at: now, ok });
      return ok;
    });
  existsInFlight.set(path, lookup);
  return lookup;
}

let homeDirCache: string | null = null;
async function home(): Promise<string | null> {
  if (homeDirCache === null) {
    try {
      homeDirCache = (await homeDir()).replace(/[\\/]+$/, '');
    } catch {
      homeDirCache = '';
    }
  }
  return homeDirCache || null;
}

/**
 * `terminal.linkTooltip` is not in `TerminalConfig` yet (the type and the Rust
 * model are owned elsewhere this round — see the ticket report). Reading it
 * through this widening keeps the default in one place and compiles either
 * way, before and after the field lands.
 */
type LinkConfig = TerminalConfig & { linkTooltip?: boolean };

function linkConfig(): LinkConfig | undefined {
  return useAppStore.getState().settings?.terminal as LinkConfig | undefined;
}

/** Underline file paths and open them (default on). */
function filePathLinksEnabled(): boolean {
  return linkConfig()?.filePathLinks !== false;
}

/** Show the target + actions panel on hover (default on). */
function linkTooltipEnabled(): boolean {
  return linkConfig()?.linkTooltip !== false;
}

/** Live cwd of a terminal (OSC 7), else the directory its shell opened in. */
function terminalDirectory(terminalId: string): string | undefined {
  const app = useAppStore.getState();
  const live = app.terminalStates.get(terminalId)?.cwd;
  if (live) return live;
  if (terminalId.startsWith('shell:')) return app.shellRuntimes.get(terminalId.slice('shell:'.length))?.cwd;
  return undefined;
}

function isAbsolute(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/');
}

function joinPath(base: string, rel: string): string {
  const sep = IS_WINDOWS && /[\\]/.test(base) ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${sep}${rel}`;
}

/**
 * One separator on Windows. `assets/logo.png` printed in a shell whose cwd is
 * `C:\repo` used to resolve to `C:\repo\assets/logo.png`: the filesystem takes
 * it, but the panel showed it half and half and `explorer.exe` refused it.
 * Only a drive or UNC path is rewritten — a Git Bash `/c/repo` is left alone.
 */
function nativeSeparators(path: string): string {
  if (!IS_WINDOWS || !(/^[A-Za-z]:/.test(path) || /^[\\/]{2}[^\\/]/.test(path))) return path;
  return path.replace(/\//g, '\\');
}

/** Absolute path a candidate points at, or null when it cannot be resolved. */
export async function resolveCandidate(raw: string, cwd: string | undefined): Promise<string | null> {
  if (raw.startsWith('~')) {
    const h = await home();
    if (!h) return null;
    return nativeSeparators(raw.length === 1 ? h : joinPath(h, raw.slice(2)));
  }
  if (isAbsolute(raw)) return nativeSeparators(raw);
  if (!cwd) return null;
  return nativeSeparators(joinPath(cwd, raw.replace(/^\.[\\/]/, '')));
}

/**
 * The whole logical line `y` belongs to, with the buffer cell every character
 * came from. Walking the cells (instead of `translateToString` + modulo) is
 * what keeps the ranges right on a line holding a wide glyph, whose second
 * cell contributes no character.
 */
function logicalLine(term: Terminal, y: number): (ScanLine & { startY: number; endY: number }) | null {
  const buffer = term.buffer.active;
  let startY = y;
  while (startY > 0 && buffer.getLine(startY)?.isWrapped) startY--;
  let endY = y;
  while (endY + 1 < buffer.length && buffer.getLine(endY + 1)?.isWrapped) endY++;
  const cell = buffer.getNullCell();
  const cells: { x: number; y: number }[] = [];
  let text = '';
  for (let i = startY; i <= endY; i++) {
    const line = buffer.getLine(i);
    if (!line) return null;
    for (let x = 0; x < line.length; x++) {
      line.getCell(x, cell);
      if (cell.getWidth() === 0) continue; // spacer of a wide glyph
      const chars = cell.getChars() || ' ';
      for (let k = 0; k < chars.length; k++) cells.push({ x, y: i });
      text += chars;
    }
  }
  return { text, cells, startY, endY };
}

/**
 * The logical line holding row `y`, with `CONTEXT_LINES` more on each side:
 * a path cut by a hard line break is in pieces across them (zorg #49).
 */
function scanWindow(term: Terminal, y: number): ScanLine[] {
  const middle = logicalLine(term, y);
  if (!middle) return [];
  const lines: ScanLine[] = [middle];
  let above = middle.startY;
  for (let i = 0; i < CONTEXT_LINES && above > 0; i++) {
    const line = logicalLine(term, above - 1);
    if (!line) break;
    lines.unshift(line);
    above = line.startY;
  }
  let below = middle.endY;
  for (let i = 0; i < CONTEXT_LINES && below + 1 < term.buffer.active.length; i++) {
    const line = logicalLine(term, below + 1);
    if (!line) break;
    lines.push(line);
    below = line.endY;
  }
  return lines;
}

/**
 * Every existing path that crosses buffer row `row`, resolved. The one scan
 * both the underline and the hover panel go through, so they never disagree
 * about where a path starts and ends.
 */
async function pathLinksOn(term: Terminal, terminalId: string, row: number): Promise<FoundPath[]> {
  // Same ceiling as before #49: a screenful of `ls` is not worth 200 lookups.
  const candidates = pathCandidates(scanWindow(term, row), term.cols, row).slice(0, MAX_CANDIDATES);
  if (!candidates.length) return [];
  const cwd = terminalDirectory(terminalId);
  const found = await pickPathLinks(candidates, async (raw) => {
    const resolved = await resolveCandidate(raw, cwd);
    return resolved && (await pathExists(resolved)) ? resolved : null;
  });
  return found.filter((f) => f.cells.some((c) => c.y === row));
}

/**
 * The last thing `activate` opened. The click fallback in `LinkHover` checks
 * it so a link xterm activated normally is not opened a second time.
 */
let lastActivation = { key: '', at: 0 };

function activationKey(path: string, reveal: boolean): string {
  return `${reveal ? 'reveal' : 'open'}\u0000${path}`;
}

/**
 * Open what was clicked. A position (`src/main.rs:42:7`) goes to the editor
 * **at that line** — landing on line 1 would throw away the very information
 * that made the link worth clicking. Without one, a text file still goes to
 * the editor, anything else (an image, a PDF) to the program the OS opens it
 * with, and a directory to the file manager: the backend decides, see
 * `cortx_core::terminal::open_path`. `reveal` (Ctrl+Alt+click, or the "Open
 * folder" button) shows the containing folder with the item selected.
 */
async function activate(path: string, reveal: boolean, line?: number, column?: number) {
  lastActivation = { key: activationKey(path, reveal), at: Date.now() };
  try {
    if (reveal) await api.revealInFileManager(path);
    else await api.openTerminalPath(path, line, column);
  } catch (err) {
    // A click that opens nothing and says nothing is indistinguishable from a
    // dead link — which is exactly how ticket #31 was reported. The Rust side
    // now returns a real message when VS Code is not on PATH; surface it.
    const message = err instanceof Error ? err.message : String(err);
    toast.error('Could not open that path', { description: message });
    console.error('Failed to open path from the terminal:', err);
  }
}

// ---------------------------------------------------------------------------
// The hover panel
// ---------------------------------------------------------------------------

/** Lucide outlines, as bare path data (`lucide-react` is React-only). */
const ICON_PATHS = {
  file: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v5h5', 'M9 13h6', 'M9 17h4'],
  folder: ['M2 8a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z'],
  external: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  copy: [
    'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Z',
    'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  ],
} as const;

type IconId = keyof typeof ICON_PATHS;

const SVG_NS = 'http://www.w3.org/2000/svg';

function iconSvg(id: IconId): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICON_PATHS[id]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

interface LinkAction {
  label: string;
  icon: IconId;
  run: () => void;
}

interface PanelOptions {
  /** The resolved absolute target, monospaced. */
  target: string;
  /** `:42:7`, kept apart so it stays readable when the path fades. */
  position: string;
  actions: LinkAction[];
  /** Written inline; see the header of `styles/terminal-links.css`. */
  palette: { fg: string; bg: string };
  /** Screen rectangle of the token, in client coordinates. */
  anchor: { left: number; top: number; bottom: number };
  /** The pointer reached the panel; nothing armed on the grid may close it. */
  onEnter: () => void;
  /** The pointer left the panel and did not go back to the link. */
  onLeave: () => void;
}

/**
 * One panel for the whole document: only one link can be hovered at a time,
 * and a `fixed` element on `<body>` escapes the pane's `overflow: hidden`
 * (a compiler error on row 0 would otherwise have its panel clipped away).
 */
class LinkPanel {
  private readonly root: HTMLDivElement;
  private readonly targetEl: HTMLSpanElement;
  private readonly actionsEl: HTMLDivElement;
  /** Whoever is showing it now; `hide` from anyone else is ignored. */
  private owner: object | null = null;
  private pointerInside = false;
  private onEnter: (() => void) | null = null;
  private onLeave: (() => void) | null = null;

  constructor() {
    const root = document.createElement('div');
    root.className = 'cortx-link-pop';
    root.hidden = true;
    const target = document.createElement('span');
    target.className = 'cortx-link-target';
    const actions = document.createElement('div');
    actions.className = 'cortx-link-actions';
    root.append(target, actions);
    root.addEventListener('mouseenter', () => {
      this.pointerInside = true;
      this.onEnter?.();
    });
    root.addEventListener('mouseleave', () => {
      this.pointerInside = false;
      this.onLeave?.();
    });
    // Never let the grid see it: a mousedown there would clear the selection
    // and, with the input editor up, move the caret. `preventDefault` is the
    // other half — without it the button takes the focus and the next
    // keystroke after "Open" would go nowhere instead of to the shell.
    root.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    document.body.appendChild(root);
    this.root = root;
    this.targetEl = target;
    this.actionsEl = actions;
  }

  get isPointerInside(): boolean {
    return this.pointerInside;
  }

  isOwnedBy(owner: object): boolean {
    return this.owner === owner;
  }

  show(owner: object, options: PanelOptions): void {
    this.owner = owner;
    this.onEnter = options.onEnter;
    this.onLeave = options.onLeave;
    this.root.style.setProperty('--cortx-link-fg', options.palette.fg);
    this.root.style.setProperty('--cortx-link-bg', options.palette.bg);

    this.targetEl.textContent = options.target;
    if (options.position) {
      const pos = document.createElement('span');
      pos.className = 'cortx-link-pos';
      pos.textContent = options.position;
      this.targetEl.appendChild(pos);
    }
    this.targetEl.title = options.target + options.position;

    const buttons = options.actions.map((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cortx-link-action';
      button.appendChild(iconSvg(action.icon));
      button.appendChild(document.createTextNode(action.label));
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        action.run();
        this.hide(owner);
      });
      return button;
    });
    // The gesture, spelled out. The panel is where a plain click *does* work,
    // so it is also the only honest place to say what a click on the link
    // itself needs (zorg #43); dimmed, and last, so it never competes with the
    // buttons next to it.
    const hint = document.createElement('span');
    hint.className = 'cortx-link-hint';
    hint.textContent = IS_MAC ? '⌘ click' : 'Ctrl click';
    hint.title = IS_MAC
      ? '⌘-click the link to open it — a plain click selects text'
      : 'Ctrl-click the link to open it — a plain click selects text';
    this.actionsEl.replaceChildren(...buttons, hint);

    // Measure before placing: the panel is as wide as the target it shows.
    this.root.style.left = '0px';
    this.root.style.top = '0px';
    this.root.style.visibility = 'hidden';
    this.root.hidden = false;
    const width = this.root.offsetWidth;
    const height = this.root.offsetHeight;
    // The clamp only ever pushes the panel *left*, and it stops at
    // `innerWidth - width - 8`, so its right edge never lands short of the
    // token's first column: straight up from where the link starts is always
    // into the panel.
    const left = Math.max(8, Math.min(options.anchor.left, window.innerWidth - width - 8));
    // Above the link and lapping over its first pixel row, so the pointer
    // crosses no strip that belongs to neither of them (ticket #42); below it,
    // just as flush, when there is no room up there.
    let top = options.anchor.top - height + PANEL_OVERLAP_PX;
    if (top < 8) top = options.anchor.bottom - PANEL_OVERLAP_PX;
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
    this.root.style.visibility = '';
  }

  hide(owner: object): void {
    if (this.owner !== owner) return;
    this.owner = null;
    this.onEnter = null;
    this.onLeave = null;
    this.pointerInside = false;
    this.root.hidden = true;
    this.actionsEl.replaceChildren();
  }
}

let panelInstance: LinkPanel | null = null;

/** The panel, built the first time a link is actually hovered. */
function panel(): LinkPanel {
  panelInstance ??= new LinkPanel();
  return panelInstance;
}

// ---------------------------------------------------------------------------
// Hover tracking
// ---------------------------------------------------------------------------

/** A link found under the pointer, before it is resolved. */
interface RawToken {
  kind: 'path' | 'url';
  /** The text as printed. */
  text: string;
  line?: number;
  column?: number;
  /** Absolute buffer row the pointer is on, and the token's span on it. */
  row: number;
  startX: number;
  endX: number;
}

/** The same token once its real destination is known. */
interface ResolvedToken extends RawToken {
  /** Absolute path, or the URL. */
  target: string;
}

function spanOnRow(
  cells: { x: number; y: number }[],
  from: number,
  to: number,
  row: number
): { startX: number; endX: number } | null {
  let startX = -1;
  let endX = -1;
  for (let i = Math.max(0, from); i < to && i < cells.length; i++) {
    const cell = cells[i];
    if (cell.y !== row) continue;
    if (startX < 0 || cell.x < startX) startX = cell.x;
    if (cell.x > endX) endX = cell.x;
  }
  return startX < 0 ? null : { startX, endX };
}

/**
 * The pointer watcher: what is under the mouse, the panel that describes it,
 * and the click fallback. One per session; it owns no state xterm needs, so
 * it is inert until the pointer actually enters the pane.
 */
class LinkHover {
  private readonly term: Terminal;
  private readonly terminalId: string;
  private element: HTMLElement | null = null;
  private renderHook: IDisposable | null = null;
  private readonly disposables: IDisposable[] = [];
  /** Bumped on every pointer move: an async resolve for an older one is dropped. */
  private generation = 0;
  private lastCol = -1;
  private lastRow = -1;
  private currentKey = '';
  private downCell: { col: number; row: number } | null = null;
  private hoverTimer = 0;
  private closeTimer = 0;

  constructor(term: Terminal, terminalId: string) {
    this.term = term;
    this.terminalId = terminalId;
    watchOpenModifier();
    // `registerFileLinkProvider` runs in `createSession`, before `term.open()`:
    // there is no DOM to listen on yet. The first render is when there is.
    this.tryAttach();
    if (!this.element) this.renderHook = term.onRender(() => this.tryAttach());
    this.disposables.push(term.onScroll(() => this.close()));
    this.disposables.push(term.onResize(() => this.close()));
  }

  dispose(): void {
    this.renderHook?.dispose();
    this.renderHook = null;
    window.clearTimeout(this.hoverTimer);
    window.clearTimeout(this.closeTimer);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    const element = this.element;
    if (element) {
      element.removeEventListener('mousemove', this.onMove);
      element.removeEventListener('mouseleave', this.onLeaveGrid);
      element.removeEventListener('mousedown', this.onDown);
      element.removeEventListener('click', this.onClick);
      this.element = null;
    }
    panelInstance?.hide(this);
  }

  private tryAttach(): void {
    if (this.element) return;
    const element = this.term.element;
    if (!element) return;
    this.element = element;
    element.addEventListener('mousemove', this.onMove);
    element.addEventListener('mouseleave', this.onLeaveGrid);
    element.addEventListener('mousedown', this.onDown);
    element.addEventListener('click', this.onClick);
    // We may be *inside* the render event right now; unsubscribe next tick
    // rather than mutating the emitter's listener list while it fires.
    const hook = this.renderHook;
    this.renderHook = null;
    if (hook) queueMicrotask(() => hook.dispose());
  }

  // -- geometry -----------------------------------------------------------

  private screen(): HTMLElement | null {
    return (this.term.element?.querySelector('.xterm-screen') as HTMLElement | null) ?? null;
  }

  /**
   * The buffer cell under the pointer. Measured off `.xterm-screen` rather
   * than assumed from the font: the pane can carry a `translateY` (the
   * bottom-pinned input) and a fractional cell size, and a wrong row would
   * describe a link the user is not looking at.
   */
  private cellAt(e: MouseEvent): { col: number; row: number; cellW: number; cellH: number; rect: DOMRect } | null {
    const screen = this.screen();
    if (!screen) return null;
    const rect = screen.getBoundingClientRect();
    const cols = this.term.cols;
    const rows = this.term.rows;
    if (cols < 1 || rows < 1 || rect.width <= 0 || rect.height <= 0) return null;
    const cellW = rect.width / cols;
    const cellH = rect.height / rows;
    const col = Math.floor((e.clientX - rect.left) / cellW);
    const viewportRow = Math.floor((e.clientY - rect.top) / cellH);
    if (col < 0 || col >= cols || viewportRow < 0 || viewportRow >= rows) return null;
    return { col, row: this.term.buffer.active.viewportY + viewportRow, cellW, cellH, rect };
  }

  // -- what is under the pointer ------------------------------------------

  private findUrl(col: number, row: number): RawToken | null {
    const logical = logicalLine(this.term, row);
    if (!logical) return null;
    // Index in the logical text of the character in that cell. `<=` rather
    // than `===` so the second cell of a wide glyph still resolves.
    let index = -1;
    for (let i = 0; i < logical.cells.length; i++) {
      const cell = logical.cells[i];
      if (cell.y < row) continue;
      if (cell.y > row || cell.x > col) break;
      index = i;
    }
    if (index < 0) return null;

    // URLs first, exactly as the linkifier orders its providers.
    URL_CANDIDATE.lastIndex = 0;
    for (let m = URL_CANDIDATE.exec(logical.text); m; m = URL_CANDIDATE.exec(logical.text)) {
      if (index < m.index || index >= m.index + m[0].length) continue;
      const span = spanOnRow(logical.cells, m.index, m.index + m[0].length, row);
      if (!span) return null;
      return { kind: 'url', text: m[0], row, ...span };
    }

    return null;
  }

  /**
   * The link under a cell, with its real destination: a URL as printed, or a
   * path once the disk has confirmed it (see `pathLinksOn`).
   */
  private async findLink(col: number, row: number, wantPaths: boolean): Promise<ResolvedToken | null> {
    const url = this.findUrl(col, row);
    if (url) return { ...url, target: url.text };
    if (!wantPaths) return null;
    for (const found of await pathLinksOn(this.term, this.terminalId, row)) {
      const span = spanOnRow(found.cells, 0, found.cells.length, row);
      if (!span || col < span.startX || col > span.endX) continue;
      return { kind: 'path', text: found.raw, line: found.line, column: found.column, row, ...span, target: found.target };
    }
    return null;
  }

  // -- pointer ------------------------------------------------------------

  private readonly onMove = (e: MouseEvent) => {
    // A program that took the mouse (a TUI, `htop`) owns every event on the
    // grid: nothing of ours may float over it. Same when the panel is off.
    if (!linkTooltipEnabled() || this.term.modes.mouseTrackingMode !== 'none') {
      if (this.currentKey) this.close();
      return;
    }
    // A button is down: this is a drag, not a hover.
    if (e.buttons !== 0) return;
    const cell = this.cellAt(e);
    if (!cell) {
      this.scheduleClose();
      return;
    }
    if (cell.col === this.lastCol && cell.row === this.lastRow) return;
    this.lastCol = cell.col;
    this.lastRow = cell.row;
    window.clearTimeout(this.closeTimer);
    window.clearTimeout(this.hoverTimer);
    const generation = ++this.generation;
    this.hoverTimer = window.setTimeout(() => {
      void this.present(cell.col, cell.row, cell.cellW, cell.cellH, generation);
    }, HOVER_DELAY_MS);
  };

  private readonly onLeaveGrid = () => {
    this.scheduleClose();
  };

  private readonly onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const cell = this.cellAt(e);
    this.downCell = cell ? { col: cell.col, row: cell.row } : null;
  };

  /**
   * The click fallback. xterm activates a link from the linkifier's cached
   * `currentLink`, which a viewport render between `mousedown` and `mouseup`
   * can clear — a link then looks alive and does nothing at all. This
   * re-resolves the token under the pointer and opens it, unless the provider
   * has just opened the very same thing.
   */
  private readonly onClick = (e: MouseEvent) => {
    // Ctrl / ⌘ or nothing happens — a bare click belongs to the selection.
    if (!isLinkOpenClick(e)) return;
    if (!filePathLinksEnabled()) return;
    if (this.term.modes.mouseTrackingMode !== 'none') return;
    const cell = this.cellAt(e);
    if (!cell) return;
    // A drag is a selection, never a click on a link.
    if (!this.downCell || this.downCell.col !== cell.col || this.downCell.row !== cell.row) return;
    if (this.term.hasSelection() && this.term.getSelection().trim()) return;
    const reveal = wantsReveal(e);
    void (async () => {
      const resolved = await this.findLink(cell.col, cell.row, true);
      if (!resolved || resolved.kind !== 'path') return;
      if (
        Date.now() - lastActivation.at < ACTIVATION_DEDUP_MS &&
        lastActivation.key === activationKey(resolved.target, reveal)
      ) {
        return;
      }
      await activate(resolved.target, reveal, resolved.line, resolved.column);
    })();
  };

  // -- the panel ----------------------------------------------------------

  private async present(col: number, row: number, cellW: number, cellH: number, generation: number): Promise<void> {
    if (generation !== this.generation) return;
    // The pointer is on the panel: it owns the surface until it leaves it, and
    // a cell the pointer merely passed over on the way there does not get to
    // move it or take it away.
    if (this.pointerOnPanel()) return;
    const resolved = await this.findLink(col, row, filePathLinksEnabled());
    if (generation !== this.generation) return;
    if (this.pointerOnPanel()) return;
    // A cell with no link is not a reason to tear the panel down on the spot —
    // that is what made the buttons unreachable. Arm the grace period instead
    // and let it re-check where the pointer actually ended up.
    if (!resolved) {
      this.scheduleClose();
      return;
    }
    const position =
      resolved.kind === 'path' && resolved.line !== undefined
        ? `:${resolved.line}${resolved.column === undefined ? '' : `:${resolved.column}`}`
        : '';
    const key = `${resolved.kind}\u0000${resolved.target}${position}\u0000${resolved.row}\u0000${resolved.startX}`;
    // Sweeping along the same link must not re-open (and re-animate) the panel.
    if (key === this.currentKey && panelInstance?.isOwnedBy(this)) return;

    const screen = this.screen();
    if (!screen) return;
    const rect = screen.getBoundingClientRect();
    const viewportRow = resolved.row - this.term.buffer.active.viewportY;
    const top = rect.top + viewportRow * cellH;
    this.currentKey = key;
    panel().show(this, {
      target: resolved.target,
      position,
      actions: this.actionsFor(resolved),
      palette: this.palette(),
      anchor: {
        left: rect.left + resolved.startX * cellW,
        top,
        bottom: top + cellH,
      },
      onEnter: () => {
        // The pointer made it across. Whatever the grid still has armed — a
        // `present` for the cell it left, a grace period from the `mouseleave`
        // that firing this very handler implies — must not outlive the arrival.
        window.clearTimeout(this.hoverTimer);
        window.clearTimeout(this.closeTimer);
        this.lastCol = -1;
        this.lastRow = -1;
      },
      onLeave: () => this.scheduleClose(),
    });
  }

  private actionsFor(token: ResolvedToken): LinkAction[] {
    if (token.kind === 'url') {
      const url = token.target;
      return [
        {
          label: 'Open',
          icon: 'external',
          run: () => {
            openExternal(url).catch((err) => {
                toast.error('Could not open that link', {
                  description: err instanceof Error ? err.message : String(err),
                });
                console.error('Failed to open URL:', err);
              });
          },
        },
        {
          label: 'Copy',
          icon: 'copy',
          run: () => {
            writeText(url).catch((err) => console.error('Failed to copy the URL:', err));
          },
        },
      ];
    }
    const path = token.target;
    return [
      { label: 'Open', icon: 'file', run: () => void activate(path, false, token.line, token.column) },
      { label: 'Open folder', icon: 'folder', run: () => void activate(path, true) },
    ];
  }

  /**
   * The two colours the panel is built from. They come from the palette xterm
   * is drawing with, never from the app chrome: over a themed window the panel
   * sits on the wallpaper, and an accent-derived surface stains it.
   */
  private palette(): { fg: string; bg: string } {
    const theme = this.term.options.theme ?? {};
    return {
      fg: theme.foreground?.trim() || 'var(--terminal-fg, var(--foreground))',
      bg: theme.background?.trim() || 'var(--terminal-window-solid, var(--card))',
    };
  }

  /** The panel we put up is the one under the pointer right now. */
  private pointerOnPanel(): boolean {
    return panelInstance !== null && panelInstance.isOwnedBy(this) && panelInstance.isPointerInside;
  }

  private scheduleClose(): void {
    window.clearTimeout(this.hoverTimer);
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      if (panelInstance?.isPointerInside) return;
      this.close();
    }, HOVER_CLOSE_MS);
  }

  private close(): void {
    window.clearTimeout(this.hoverTimer);
    window.clearTimeout(this.closeTimer);
    this.generation++;
    this.lastCol = -1;
    this.lastRow = -1;
    this.currentKey = '';
    panelInstance?.hide(this);
  }
}

/**
 * Underline existing file paths on the hovered line, open them on click, and
 * describe every link (path or URL) on hover. Register it *after* the
 * WebLinksAddon so URLs keep their own handler.
 */
export function registerFileLinkProvider(term: Terminal, terminalId: string): IDisposable {
  const provider: ILinkProvider = {
    provideLinks(bufferLineNumber, callback) {
      if (!filePathLinksEnabled()) {
        callback(undefined);
        return;
      }
      void pathLinksOn(term, terminalId, bufferLineNumber - 1).then((found) => {
        const links = found.map((path): ILink => {
          const first = path.cells[0];
          const last = path.cells[path.cells.length - 1];
          return {
            text: path.target,
            // A path cut over two rows is one range: xterm's ranges run in
            // reading order from `start` to `end`, across rows.
            range: {
              start: { x: first.x + 1, y: first.y + 1 },
              end: { x: last.x + 1, y: last.y + 1 },
            },
            // xterm hands us every left-button mouseup on the link; the
            // modifier is what tells an *open* from a click that was only
            // ever meant to put the caret down (zorg #43).
            activate: (event) => {
              if (!isLinkOpenClick(event)) return;
              void activate(path.target, wantsReveal(event), path.line, path.column);
            },
          };
        });
        callback(links.length ? links : undefined);
      });
    },
  };
  const registration = term.registerLinkProvider(provider);
  const hover = new LinkHover(term, terminalId);
  return {
    dispose() {
      registration.dispose();
      hover.dispose();
    },
  };
}
