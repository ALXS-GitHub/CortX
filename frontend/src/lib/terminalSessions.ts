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
import '@xterm/xterm/css/xterm.css';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import * as api from '@/lib/tauri';

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
}

const sessions = new Map<string, TerminalSession>();

// Dev-only escape hatch so the live sessions can be poked from DevTools / CDP
// (Vite's HMR gives a fresh module instance to dynamic imports, so this is the
// only reliable way to reach the map the app is actually using).
if (import.meta.env.DEV) {
  (window as unknown as { __cortxTerminalSessions?: Map<string, TerminalSession> }).__cortxTerminalSessions = sessions;
}

const IS_WINDOWS = /Windows/i.test(navigator.userAgent);

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/** VS Code "Dark Modern" ANSI palette. */
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

/** VS Code "Light Modern" ANSI palette. */
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

export function buildTerminalTheme(): ITheme {
  const dark = isDarkTheme();
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

  const term = new Terminal({
    allowProposedApi: true, // needed by addon-image / unicode11
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: 'ui-monospace, "Cascadia Mono", "Cascadia Code", Consolas, "JetBrains Mono", Menlo, Monaco, monospace',
    fontSize: 12,
    lineHeight: 1.2,
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
  };

  // Keyboard input → PTY. Errors (process already gone) are expected; ignore.
  session.disposables.push(
    term.onData((data) => {
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

async function attach(session: TerminalSession) {
  if (session.attachToken !== null) return;
  try {
    const token = await api.attachTerminal(session.id, (bytes) => {
      session.term.write(bytes);
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
    tryLoadWebgl(session);
    attach(session);
  }
  // Two frames: layout must settle before fit() can measure the container.
  requestAnimationFrame(() => requestAnimationFrame(() => fitTerminal(id)));
  return session;
}

/** Detach the DOM without destroying the session (tab switched / hidden). */
export function unmountTerminal(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  session.container.remove();
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
