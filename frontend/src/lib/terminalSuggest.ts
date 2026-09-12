/**
 * Inline history suggestions ("ghost text") and the completion menu, Warp
 * style, for any shell that emits the OSC 133 shell-integration markers
 * (`cortx init` does).
 *
 * How it works, entirely on the xterm side of the PTY:
 * - OSC 133 `B` tells us where the input line starts (cursor position at
 *   prompt end); `C` / `A` tell us when the user is no longer typing.
 * - After every key or echo we read the text between that start and the
 *   cursor straight from the buffer and hand it to the completion engine
 *   (`terminalCompletion.ts` — a pure module, no xterm in sight, so the input
 *   editor of ticket #15 can reuse it as is).
 * - Between `C` and `D` we know exactly which lines are the command's
 *   **output**, so when it finishes we read them once and ask
 *   `terminalCompletionOutput.ts` what the program just told the user to run
 *   (`git push --set-upstream origin …`, `claude --resume <id>`). That is the
 *   suggestion people actually want next, and no history can produce it.
 * - The best continuation is drawn as a dimmed decoration at the cursor —
 *   **only when the engine is confident enough**; below the threshold the
 *   ghost stays empty, because a wrong suggestion is worse than none. →
 *   accepts (the remainder is typed into the PTY, so the shell sees it as
 *   keystrokes), Ctrl+→ accepts one word; Esc hides it until the next key.
 * - Ctrl+Space (configurable, see `completionMenu`) opens a floating list of
 *   *every* candidate: history, subcommands and flags learned from `--help`,
 *   git refs, `package.json` scripts, paths. ↑/↓ move, Enter/Tab accept, Esc
 *   closes. Typing while it is open goes to the shell as usual and the list
 *   just re-filters itself.
 *
 * Latency: nothing here awaits. Every source is read synchronously from an
 * in-memory cache (`terminalCompletionData.ts`); a miss schedules a
 * background fetch and the display updates when the answer lands.
 *
 * Off in the alternate screen (TUIs), while a command runs, or when the
 * cursor is not at the end of the input.
 *
 * ## The universal input editor (U2)
 *
 * When the editor of ticket #15 holds the line, the grid this module reads is
 * empty — so drawing from it would be drawing from nothing. It steps aside for
 * exactly that case (`inputEditorOwnsLine`) and **publishes its engine**
 * instead, through `terminalCompletionMenu.ts`: the editor asks it about the
 * text in its `<textarea>` and draws the ghost in its own block, and the
 * floating menu below is the same store, the same rows, anchored on the
 * editor's caret.
 *
 * The distinction matters: the test is per prompt, not per setting. With the
 * editor switched on but not up — `ssh`, a REPL, a shell with no integration —
 * the line is back in the grid and everything here works as it always did.
 */
import type { IDecoration, IDisposable, Terminal } from '@xterm/xterm';
import '@/styles/terminal-suggest.css';
import * as api from '@/lib/tauri';
import { getTerminalSession } from '@/lib/terminalSessions';
import { useAppStore } from '@/stores/appStore';
import { inputEditorOwnsLine } from '@/lib/terminalInputEditor';
import { boundaryLine } from '@/lib/terminalBlockModel';
import { projectIdForPath } from '@/lib/terminalLayout';
import {
  acceptanceFor,
  aliasHintFor,
  completeLine,
  ghostFor,
  GHOST_THRESHOLDS,
  type CompletionData,
  type CompletionItem,
  type GhostLevel,
} from '@/lib/terminalCompletion';
import {
  candidatesFromOutput,
  MAX_SCANNED_LINES,
  programOf,
  type OutputCandidate,
} from '@/lib/terminalCompletionOutput';
import {
  onCompletionData,
  peek,
  peekHistory,
  type CompletionScope,
} from '@/lib/terminalCompletionData';
import {
  closeMenu,
  forgetMenu,
  getMenuState,
  registerAccept,
  registerEngine,
  setMenuState,
  type EngineScope,
} from '@/lib/terminalCompletionMenu';

const MIN_PREFIX = 2;
const MENU_LIMIT = 40;

/**
 * The advice printed by the command *before* last is still worth something —
 * running `ls` between a failed `git push` and the fix should not throw the
 * fix away — but it is one step staler, so it loses this much confidence.
 * Anything older is dropped: stale advice is exactly how a suggestion engine
 * starts being wrong.
 */
const STALE_PENALTY = 0.1;

/**
 * Commands seen live in this window since it opened. The on-disk history is
 * only written when a command *finishes*, so this keeps the one you just
 * launched available straight away; it is merged in front of the ranked list.
 */
const liveCommands: string[] = [];

function rememberCommand(cmd: string) {
  const trimmed = cmd.trim();
  if (!trimmed) return;
  const i = liveCommands.indexOf(trimmed);
  if (i >= 0) liveCommands.splice(i, 1);
  liveCommands.unshift(trimmed);
  liveCommands.splice(100);
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

/** Longest project root that contains `cwd` (the terminal's project). */
function projectIdFor(cwd: string | null): string | null {
  return projectIdForPath(cwd, useAppStore.getState().projects);
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
  /** First output line of the command currently running (set by `133;C`). */
  private outputStart: number | null = null;
  /** Command line of the block currently running, for the correction rules. */
  private runningCommand: string | null = null;
  /** What the last finished command's output told the user to run. */
  private fresh: OutputCandidate[] = [];
  /** The same, from the command before it — one step staler. */
  private stale: OutputCandidate[] = [];
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
    // A source that finished loading (history, a spec, git refs) redraws
    // whatever is on screen; it never interrupts what is being typed.
    const offData = onCompletionData(() => this.schedule());
    this.disposables.push({ dispose: offData });
    const offAccept = registerAccept(terminalId, (index) => this.acceptMenu(index));
    this.disposables.push({ dispose: offAccept });
    // U2: the universal input editor holds its line in a `<textarea>`, so it
    // cannot read it back out of the grid — but every ranked source lives
    // here. Publish the engine and let it ask (see `terminalCompletionMenu`).
    const offEngine = registerEngine(terminalId, {
      ghost: (line) => this.ghostText(line),
      items: (line, limit) => this.itemsFor(line, limit),
      scope: () => this.scope(),
    });
    this.disposables.push({ dispose: offEngine });
  }

  // -- The engine, for a surface that owns its own line (U2) ----------------

  /** The remainder to draw after `line`, whoever holds it. */
  ghostText(line: string): string | null {
    const typed = line.trimStart();
    if (!typed) return null;
    return ghostFor(typed, this.dataFor(typed), { minPrefix: MIN_PREFIX, threshold: threshold() })?.text ?? null;
  }

  /** Every candidate for `line`, best first. Indices are relative to `line`. */
  itemsFor(line: string, limit = MENU_LIMIT): CompletionItem[] {
    return completeLine(line, this.dataFor(line), limit);
  }

  dispose() {
    this.hide();
    closeMenu(this.terminalId);
    forgetMenu(this.terminalId);
    for (const d of this.disposables) d.dispose();
  }

  /** Dev diagnostics. */
  debug() {
    return {
      phase: this.phase,
      start: this.start,
      remainder: this.remainder,
      muted: this.muted,
      input: this.currentInput(),
      output: this.outputCandidates(),
      menu: getMenuState(this.terminalId),
    };
  }

  /** Called from the key handler: true when the key was consumed. */
  handleKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown') return false;
    // This listener is on the session container and therefore also sees keys
    // typed into the universal input editor's textarea — and, being in the
    // capture phase, it sees them *first*. While that editor holds the line,
    // the grid this engine reads is empty and everything we did here would
    // fight it: it drives the ghost and the menu itself, through the engine
    // published in `terminalCompletionMenu`.
    //
    // The test is "does the editor own *this* line", not "is the setting on"
    // (which is what U1 asked, and what switched the whole feature off for
    // everyone who enabled the editor): over `ssh`, in a REPL, while a command
    // runs, the editor is not up and the grid is where the line is.
    if (inputEditorOwnsLine(this.terminalId)) return false;
    const menu = getMenuState(this.terminalId);

    if (menu.open) {
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          const delta = e.key === 'ArrowDown' ? 1 : -1;
          const n = menu.items.length;
          setMenuState(this.terminalId, { ...menu, index: (menu.index + delta + n) % n });
          return true;
        }
        case 'Enter':
        case 'Tab':
          this.acceptMenu(menu.index);
          return true;
        case 'Escape':
          closeMenu(this.terminalId);
          return true;
        default:
          // Anything else (letters, Backspace, Ctrl+C…) goes to the shell;
          // the list re-filters itself from the grid on the next frame.
          break;
      }
    }

    if (this.isMenuKey(e)) {
      // When there is nothing to offer, the key must reach the shell: with
      // `completionMenu: 'tab'` that is what keeps PSReadLine's own
      // completion working everywhere CortX has nothing better to say.
      return this.openMenu();
    }

    if (e.key === 'Escape' && this.decoration) {
      this.muted = true;
      this.hide();
      return false; // the shell may want Esc too
    }
    if (e.key === 'ArrowRight' && this.decoration && this.remainder && !e.altKey && !e.metaKey) {
      // Ctrl+→ takes one word, like PSReadLine's `AcceptNextSuggestionWord`;
      // → takes the lot.
      const text = e.ctrlKey ? nextWord(this.remainder) : this.remainder;
      this.hide();
      api.writeTerminal(this.terminalId, text).catch(() => {});
      return true;
    }
    if (e.key.length === 1 || e.key === 'Backspace') this.muted = false;
    return false;
  }

  private isMenuKey(e: KeyboardEvent): boolean {
    if (this.phase !== 'input') return false;
    const mode = useAppStore.getState().settings?.terminal.completionMenu ?? 'ctrlSpace';
    if (mode === 'off') return false;
    if (mode === 'tab') return e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
    return e.ctrlKey && !e.altKey && !e.metaKey && (e.key === ' ' || e.code === 'Space');
  }

  private scope(): CompletionScope & EngineScope {
    const cwd = useAppStore.getState().terminalStates.get(this.terminalId)?.cwd ?? null;
    return { cwd, projectId: projectIdFor(cwd) };
  }

  /**
   * History from the backend ranking, with the commands launched in this
   * window since it opened pushed in front (they are not on disk yet).
   */
  private history(scope: CompletionScope) {
    const ranked = peekHistory(scope);
    if (liveCommands.length === 0) return ranked;
    const top = (ranked[0]?.score ?? 0) + 1;
    const seen = new Set(liveCommands);
    const live = liveCommands.map((command, i) => ({
      command,
      score: top + (liveCommands.length - i),
      count: 1,
      lastTs: Date.now(),
      failed: false,
      sameCwd: true,
      sameProject: true,
    }));
    return [...live, ...ranked.filter((r) => !seen.has(r.command))];
  }

  private onMarker(data: string) {
    const [kind] = data.split(';');
    switch (kind) {
      case 'A':
        this.phase = 'prompt';
        this.start = null;
        this.hide();
        closeMenu(this.terminalId);
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
        closeMenu(this.terminalId);
        const cmd = decodeCommandParam(data);
        this.runningCommand = cmd;
        if (cmd) rememberCommand(cmd);
        const buf = this.term.buffer.active;
        // Same one-line convention as the block model: the shells disagree
        // about whether `C` lands before or after the echoed newline.
        this.outputStart = boundaryLine(buf.baseY + buf.cursorY, buf.cursorX);
        break;
      }
      case 'D':
        this.phase = 'prompt';
        this.hide();
        closeMenu(this.terminalId);
        this.harvestOutput();
        break;
    }
  }

  // -- What the command that just ran told the user to do next -------------

  /**
   * Read the finished command's output once and turn it into candidates.
   *
   * Called from `133;D` only: this is the whole cost of the feature, it is
   * paid when a command ends rather than while typing, and it is bounded by
   * `MAX_SCANNED_LINES`.
   */
  private harvestOutput() {
    const start = this.outputStart;
    const command = this.runningCommand;
    this.outputStart = null;
    this.runningCommand = null;
    if (start === null || !outputEnabled()) return;

    const buf = this.term.buffer.active;
    if (buf.type === 'alternate') return; // a TUI drew elsewhere
    const end = boundaryLine(buf.baseY + buf.cursorY, buf.cursorX);
    if (end <= start) {
      this.rotate([]);
      return;
    }
    const from = Math.max(start, end - MAX_SCANNED_LINES);
    const lines: string[] = [];
    for (let y = from; y < end; y++) {
      lines.push(buf.getLine(y)?.translateToString(true) ?? '');
    }
    this.rotate(
      candidatesFromOutput(lines, {
        program: command ? programOf(command) : null,
        lastCommand: command,
        knownPrograms: peekHistory(this.scope()).map((h) => h.command),
      })
    );
  }

  private rotate(next: OutputCandidate[]) {
    this.stale = this.fresh;
    this.fresh = next;
  }

  /** Fresh candidates first, then the previous block's, one notch less sure. */
  private outputCandidates(): OutputCandidate[] {
    if (this.stale.length === 0) return this.fresh;
    const seen = new Set(this.fresh.map((c) => c.command.toLowerCase()));
    const aged = this.stale
      .filter((c) => !seen.has(c.command.toLowerCase()))
      .map((c) => ({ ...c, confidence: c.confidence - STALE_PENALTY }));
    return [...this.fresh, ...aged].sort((a, b) => b.confidence - a.confidence);
  }

  /** Everything the engine may use for `line`, sources merged. */
  private dataFor(line: string): CompletionData {
    const scope = this.scope();
    const data = peek(line, scope);
    data.history = this.history(scope);
    data.output = this.outputCandidates();
    return data;
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
    if (this.phase !== 'input') {
      this.hide();
      closeMenu(this.terminalId);
      return;
    }
    // The editor owns the line: its ghost is drawn in the block and its menu
    // is in this very store. Redrawing from the grid — which is empty — would
    // hide one and close the other on the next byte of output.
    if (inputEditorOwnsLine(this.terminalId)) {
      this.hide();
      return;
    }
    const input = this.currentInput();
    const line = input?.trimStart() ?? '';
    if (getMenuState(this.terminalId).open) this.renderMenu(line);

    if (this.muted) {
      this.hide();
      return;
    }
    const suggestion = line
      ? ghostFor(line, this.dataFor(line), { minPrefix: MIN_PREFIX, threshold: threshold() })
      : null;
    if (!suggestion) {
      this.hide();
      return;
    }
    this.show(suggestion.text);
  }

  // -- Completion menu ----------------------------------------------------

  /** Returns true when the menu actually opened (so the key was consumed). */
  private openMenu(): boolean {
    const input = this.currentInput();
    if (input === null) return false;
    this.renderMenu(input.trimStart(), true);
    return getMenuState(this.terminalId).open;
  }

  /** Cursor cell in viewport coordinates, for the fixed-position menu. */
  private anchorPx() {
    const screen = this.term.element?.querySelector('.xterm-screen') as HTMLElement | null;
    if (!screen) return null;
    const rect = screen.getBoundingClientRect();
    const cellW = rect.width / Math.max(1, this.term.cols);
    const cellH = rect.height / Math.max(1, this.term.rows);
    const buf = this.term.buffer.active;
    const left = rect.left + buf.cursorX * cellW;
    const top = rect.top + buf.cursorY * cellH;
    return { left, top, bottom: top + cellH, cellHeight: cellH };
  }

  private renderMenu(line: string, opening = false) {
    const data = this.dataFor(line);
    const items = completeLine(line, data, MENU_LIMIT);
    if (items.length === 0) {
      // While opening, keep the menu shut rather than flashing an empty box;
      // while open, a line that no longer matches closes it.
      closeMenu(this.terminalId);
      return;
    }
    const previous = getMenuState(this.terminalId);
    const keepIndex =
      !opening && previous.open
        ? Math.min(previous.index, items.length - 1)
        : 0;
    setMenuState(this.terminalId, {
      open: true,
      items,
      index: keepIndex,
      anchor: this.anchorPx(),
      // What `cc` stands for, while `cc` is on the line (#38).
      hint: aliasHintFor(line, data.aliases ?? []),
    });
    // The ghost would sit on top of the list's first row.
    this.hide();
  }

  private acceptMenu(index: number) {
    const menu = getMenuState(this.terminalId);
    const item: CompletionItem | undefined = menu.items[index];
    closeMenu(this.terminalId);
    if (!item) return;
    const line = this.currentInput()?.trimStart();
    if (line === undefined || line === null) return;
    const acceptance = acceptanceFor(line, item);
    if (!acceptance) return;
    // Erase-then-type, as keystrokes: the shell's own line editor stays the
    // single source of truth for what is on the line.
    const keys = '\x7f'.repeat(acceptance.backspaces) + acceptance.text;
    if (keys) api.writeTerminal(this.terminalId, keys).catch(() => {});
  }

  // -- Ghost text ---------------------------------------------------------

  /**
   * Width and height of one cell, in CSS pixels.
   *
   * `.xterm-screen` is sized to exactly `cols × cell.width`, so dividing is
   * the same number the renderer draws with — including the device-pixel
   * rounding and the `letterSpacing` option, which is precisely what a plain
   * run of DOM text cannot reproduce.
   */
  private cell(): { width: number; height: number } | null {
    const screen = this.term.element?.querySelector('.xterm-screen') as HTMLElement | null;
    if (!screen) return null;
    const rect = screen.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      width: rect.width / Math.max(1, this.term.cols),
      height: rect.height / Math.max(1, this.term.rows),
    };
  }

  private show(remainder: string) {
    const buf = this.term.buffer.active;
    const room = Math.max(0, this.term.cols - buf.cursorX);
    // By code point, so an astral character is never cut in half.
    const chars = Array.from(remainder).slice(0, room);
    if (chars.length === 0) {
      this.hide();
      return;
    }
    if (this.decoration && this.remainder === remainder) return;
    this.hide();
    this.remainder = remainder;
    const marker = this.term.registerMarker(0);
    if (!marker) return;
    const decoration = this.term.registerDecoration({
      marker,
      x: buf.cursorX,
      width: chars.length,
      layer: 'top',
    });
    if (!decoration) return;
    // `onRender` fires again on every scroll and on every dimension change,
    // which is exactly when the cell size may have moved: repaint from there
    // rather than once at creation.
    decoration.onRender((el) => {
      // Add, never replace: xterm's own `xterm-decoration` class carries the
      // `position: absolute` that puts the element at the cursor cell. Wiping
      // it dropped the ghost into the flow at the top-left of the screen.
      el.classList.add('cortx-ghost');
      this.paint(el, chars);
    });
    this.decoration = decoration;
  }

  /**
   * Draw the ghost as plain terminal text, one character per cell.
   *
   * The decoration element inherits nothing useful: xterm sets the terminal
   * font on `.xterm-rows` and on its hidden measuring element, never on
   * `.xterm-screen`, so `font: inherit` here picked up the *application's* UI
   * font — a proportional sans-serif at the app's own size, next to the
   * monospace grid. That is the "bizarre format".
   *
   * Copying the font over is necessary but not sufficient: the canvas
   * renderer places column *n* at exactly `n × cellWidth`, while a DOM text
   * run advances by the font's natural advance and ligates `->` into one
   * glyph. The two drift apart within a few characters. So each character
   * gets its own box at its own column, ligatures off — pixel-aligned with
   * the real text by construction, whatever the font or the renderer.
   */
  private paint(el: HTMLElement, chars: string[]) {
    const cell = this.cell();
    if (!cell) return;
    const options = this.term.options;
    el.style.fontFamily = options.fontFamily ?? '';
    el.style.fontSize = `${options.fontSize ?? 12}px`;
    el.style.fontWeight = String(options.fontWeight ?? 'normal');
    const signature = `${cell.width.toFixed(3)}|${chars.join('')}`;
    if (el.dataset.ghost === signature) return;
    el.dataset.ghost = signature;
    const frame = document.createDocumentFragment();
    for (let i = 0; i < chars.length; i++) {
      const span = document.createElement('span');
      span.className = 'cortx-ghost-cell';
      span.style.left = `${i * cell.width}px`;
      span.style.width = `${cell.width}px`;
      span.textContent = chars[i];
      frame.appendChild(span);
    }
    el.replaceChildren(frame);
  }

  private hide() {
    this.decoration?.dispose();
    this.decoration = null;
    this.remainder = '';
  }
}

/** The part of a suggestion Ctrl+→ accepts: one word, separator included. */
function nextWord(remainder: string): string {
  const m = remainder.match(/^\s*\S+\s?/);
  return m ? m[0] : remainder;
}

const controllers = new Map<string, SuggestionController>();

// Dev-only escape hatch for CDP-driven checks (see terminalSessions.ts).
if (import.meta.env.DEV) {
  (window as unknown as {
    __cortxSuggest?: { controllers: Map<string, SuggestionController>; history: () => string[] };
  }).__cortxSuggest = {
    controllers,
    history: () => liveCommands,
  };
}

function enabled(): boolean {
  return useAppStore.getState().settings?.terminal.inlineSuggestions !== false;
}

/** Mine the previous command's output for what to run next. Default on. */
function outputEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.suggestionsFromOutput !== false;
}

/**
 * How sure the engine has to be before it draws anything. `strict` shows a
 * ghost only when the answer is all but certain; `loose` is the old
 * always-say-something behaviour.
 */
function threshold(): number {
  const level: GhostLevel =
    useAppStore.getState().settings?.terminal.suggestionConfidence ?? 'balanced';
  return GHOST_THRESHOLDS[level] ?? GHOST_THRESHOLDS.balanced;
}

/** Attach ghost-text suggestions and the completion menu to a session (idempotent). */
export function attachSuggestions(terminalId: string) {
  if (controllers.has(terminalId) || !enabled()) return;
  const session = getTerminalSession(terminalId);
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
