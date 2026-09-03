/**
 * Inline history suggestions ("ghost text"), Warp-style, for any shell that
 * emits the OSC 133 shell-integration markers (`cortx init` does).
 *
 * How it works, entirely on the xterm side of the PTY:
 * - OSC 133 `B` tells us where the input line starts (cursor position at
 *   prompt end); `C` / `A` tell us when the user is no longer typing.
 * - After every key or echo we read the text between that start and the
 *   cursor straight from the buffer, look for the most recent history entry
 *   that extends it, and draw the remainder as a dimmed decoration at the
 *   cursor.
 * - → accepts (the remainder is typed into the PTY, so the shell sees it as
 *   keystrokes); Esc hides it until the next key.
 *
 * Off in the alternate screen (TUIs), while a command runs, or when the
 * cursor is not at the end of the input.
 */
import type { IDecoration, IDisposable, Terminal } from '@xterm/xterm';
import '@/styles/terminal-suggest.css';
import * as api from '@/lib/tauri';
import { getTerminalSession } from '@/lib/terminalSessions';
import { useAppStore } from '@/stores/appStore';

const MIN_PREFIX = 2;
const HISTORY_LIMIT = 400;

/** Shared, most-recent-first command history (backend file + live additions). */
let history: string[] = [];
let historyLoaded: Promise<void> | null = null;

function loadHistory(): Promise<void> {
  if (!historyLoaded) {
    historyLoaded = api
      .getCommandHistory(HISTORY_LIMIT)
      .then((records) => {
        const seen = new Set<string>();
        const list: string[] = [];
        for (const r of records) {
          const cmd = r.command?.trim();
          if (!cmd || seen.has(cmd)) continue;
          seen.add(cmd);
          list.push(cmd);
        }
        // Live additions may have arrived first; keep them ahead.
        history = [...history, ...list.filter((c) => !history.includes(c))];
      })
      .catch(() => {});
  }
  return historyLoaded;
}

function rememberCommand(cmd: string) {
  const trimmed = cmd.trim();
  if (!trimmed) return;
  history = [trimmed, ...history.filter((c) => c !== trimmed)].slice(0, HISTORY_LIMIT);
}

function findSuggestion(prefix: string): string | null {
  if (prefix.length < MIN_PREFIX) return null;
  const lower = prefix.toLowerCase();
  for (const cmd of history) {
    if (cmd.length > prefix.length && cmd.toLowerCase().startsWith(lower)) return cmd.slice(prefix.length);
  }
  return null;
}

function decodeCommandParam(data: string): string | null {
  const b64 = data.split(';').find((p) => p.startsWith('cmd='))?.slice(4);
  if (!b64) return null;
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

interface InputStart {
  /** Absolute buffer line (baseY + cursorY at prompt end). */
  y: number;
  x: number;
}

class SuggestionController {
  private phase: 'prompt' | 'input' | 'running' = 'prompt';
  private start: InputStart | null = null;
  private decoration: IDecoration | null = null;
  private remainder = '';
  private muted = false;
  private scheduled = false;
  private readonly disposables: IDisposable[] = [];
  private readonly term: Terminal;
  private readonly terminalId: string;

  constructor(term: Terminal, terminalId: string) {
    this.term = term;
    this.terminalId = terminalId;
    this.disposables.push(
      term.parser.registerOscHandler(133, (data) => {
        this.onMarker(data);
        // Not consumed: keep the sequence visible to other handlers.
        return false;
      })
    );
    this.disposables.push(term.onWriteParsed(() => this.schedule()));
    this.disposables.push(term.onData(() => this.schedule()));
    this.disposables.push(term.onResize(() => this.hide()));
  }

  dispose() {
    this.hide();
    for (const d of this.disposables) d.dispose();
  }

  /** Dev diagnostics. */
  debug() {
    return { phase: this.phase, start: this.start, remainder: this.remainder, muted: this.muted, input: this.currentInput() };
  }

  /** Called from the key handler: true when the key was consumed. */
  handleKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown') return false;
    if (e.key === 'Escape' && this.decoration) {
      this.muted = true;
      this.hide();
      return false; // the shell may want Esc too
    }
    if (e.key === 'ArrowRight' && this.decoration && this.remainder && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const text = this.remainder;
      this.hide();
      api.writeTerminal(this.terminalId, text).catch(() => {});
      return true;
    }
    if (e.key.length === 1 || e.key === 'Backspace') this.muted = false;
    return false;
  }

  private onMarker(data: string) {
    const [kind] = data.split(';');
    switch (kind) {
      case 'A':
        this.phase = 'prompt';
        this.start = null;
        this.hide();
        break;
      case 'B': {
        const buf = this.term.buffer.active;
        this.start = { y: buf.baseY + buf.cursorY, x: buf.cursorX };
        this.phase = 'input';
        this.muted = false;
        break;
      }
      case 'C': {
        this.phase = 'running';
        this.hide();
        const cmd = decodeCommandParam(data);
        if (cmd) rememberCommand(cmd);
        break;
      }
      case 'D':
        this.phase = 'prompt';
        this.hide();
        break;
    }
  }

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.refresh();
    });
  }

  private currentInput(): string | null {
    const buf = this.term.buffer.active;
    if (buf.type === 'alternate' || !this.start) return null;
    const cursorY = buf.baseY + buf.cursorY;
    if (cursorY < this.start.y) return null;
    // Anything typed after the cursor? Then we are editing mid-line: no ghost.
    const cursorLine = buf.getLine(cursorY);
    if (!cursorLine) return null;
    const after = cursorLine.translateToString(true, buf.cursorX);
    if (after.trim().length > 0) return null;
    let text = '';
    for (let y = this.start.y; y <= cursorY; y++) {
      const line = buf.getLine(y);
      if (!line) return null;
      const from = y === this.start.y ? this.start.x : 0;
      const to = y === cursorY ? buf.cursorX : undefined;
      text += line.translateToString(true, from, to);
    }
    return text;
  }

  private refresh() {
    if (this.phase !== 'input' || this.muted) {
      this.hide();
      return;
    }
    const input = this.currentInput();
    const prefix = input?.trimStart() ?? '';
    const suggestion = prefix ? findSuggestion(prefix) : null;
    if (!suggestion) {
      this.hide();
      return;
    }
    this.show(suggestion);
  }

  private show(remainder: string) {
    const buf = this.term.buffer.active;
    const room = Math.max(0, this.term.cols - buf.cursorX);
    const visible = remainder.slice(0, room);
    if (!visible) {
      this.hide();
      return;
    }
    if (this.decoration && this.remainder === remainder) return;
    this.hide();
    this.remainder = remainder;
    const marker = this.term.registerMarker(0);
    if (!marker) return;
    const decoration = this.term.registerDecoration({ marker, x: buf.cursorX, width: visible.length, layer: 'top' });
    if (!decoration) return;
    decoration.onRender((el) => {
      el.textContent = visible;
      // Add, never replace: xterm's own `xterm-decoration` class carries the
      // `position: absolute` that puts the element at the cursor cell. Wiping
      // it dropped the ghost into the flow at the top-left of the screen.
      el.classList.add('cortx-ghost');
    });
    this.decoration = decoration;
  }

  private hide() {
    this.decoration?.dispose();
    this.decoration = null;
    this.remainder = '';
  }
}

const controllers = new Map<string, SuggestionController>();

// Dev-only escape hatch for CDP-driven checks (see terminalSessions.ts).
if (import.meta.env.DEV) {
  (window as unknown as { __cortxSuggest?: { controllers: Map<string, SuggestionController>; history: () => string[] } }).__cortxSuggest = {
    controllers,
    history: () => history,
  };
}

function enabled(): boolean {
  return useAppStore.getState().settings?.terminal.inlineSuggestions !== false;
}

/** Attach ghost-text suggestions to a session (idempotent). */
export function attachSuggestions(terminalId: string) {
  if (controllers.has(terminalId) || !enabled()) return;
  const session = getTerminalSession(terminalId);
  void loadHistory();
  const controller = new SuggestionController(session.term, terminalId);
  controllers.set(terminalId, controller);
  // Keys reach xterm's hidden textarea inside the container; a capturing
  // listener on the container runs first and can swallow the accept key.
  const onKey = (e: KeyboardEvent) => {
    if (controller.handleKey(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  session.container.addEventListener('keydown', onKey, true);
  session.disposables.push({
    dispose: () => {
      session.container.removeEventListener('keydown', onKey, true);
      controller.dispose();
      controllers.delete(terminalId);
    },
  });
}
