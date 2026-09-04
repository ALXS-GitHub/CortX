/**
 * Universal input editor — the surface (ticket #15, phase U1).
 *
 * A `<textarea>` laid over the grid exactly where the shell's input line
 * starts, driven by the pure state machine in `terminalInputState.ts`. The
 * editor owns the text: nothing reaches the PTY while the user types, and the
 * whole line goes out at once on Enter, so the shell's own line editor
 * (PSReadLine, ZLE) does all its usual work — history, alias expansion, the
 * `133;C` marker — on a line it reads in one go.
 *
 * It only ever appears between an `OSC 133;B` the shell really emitted and the
 * submission. Without shell integration, over `ssh`, inside a REPL, in the
 * alternate screen or while a snapshot is being replayed, nothing here shows
 * and the terminal behaves byte for byte as it does today. The setting itself
 * (`terminal.inputEditor`) is off by default.
 *
 * Anything the editor cannot honour — Tab, Ctrl+R, ↑/↓, a function key —
 * triggers a **hand-off**: the current text is written to the PTY *without* a
 * CR, the editor closes, and the key follows in the same write. PSReadLine
 * then completes (or searches) the real line exactly as it does now. That is
 * what makes U1 shippable without a completion engine of our own; the real one
 * is ticket #17.
 *
 * Everything is plain DOM: the editor is a child of the session container, so
 * it is re-parented with it between the dock and the Terminal window, it
 * inherits the U0 `translateY`, and no React surface has to know it exists.
 */
import type { IDisposable, Terminal } from '@xterm/xterm';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { toast } from 'sonner';
import * as api from '@/lib/tauri';
import { useAppStore } from '@/stores/appStore';
import { copyOnSelectEnabled } from '@/lib/terminalKeys';
import { TerminalInputMachine, type KeyDescriptor } from '@/lib/terminalInputState';

/** The editor is beta: off unless the user asks for it. */
export function inputEditorEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.inputEditor === true;
}

function handoffEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.inputEditorHandoff !== false;
}

function ghostEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.inlineSuggestions !== false;
}

/**
 * How long after a prompt marker we still believe grid text is typeahead the
 * shell echoed (characters typed while the previous command was finishing).
 * Long enough for ConPTY to repaint, short enough never to swallow the echo
 * of a line the shell itself started.
 */
const ADOPT_WINDOW_MS = 600;

const MIN_GHOST_PREFIX = 2;
const HISTORY_LIMIT = 400;

// ---------------------------------------------------------------------------
// History for the in-editor ghost text
//
// `terminalSuggest.ts` draws its ghost by reading the grid, which is empty
// while the editor owns the text — so it simply goes quiet and there is never
// a second ghost in the wrong place (plan §6.9). The editor keeps the feature
// alive with its own copy of the same history.
// ---------------------------------------------------------------------------

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
  if (prefix.length < MIN_GHOST_PREFIX) return null;
  const lower = prefix.toLowerCase();
  for (const cmd of history) {
    if (cmd.length > prefix.length && cmd.toLowerCase().startsWith(lower)) return cmd.slice(prefix.length);
  }
  return null;
}

// ---------------------------------------------------------------------------

function describe(e: KeyboardEvent): KeyDescriptor {
  return { key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
}

/** First line of a paste; U1 refuses the rest rather than run it by accident. */
function firstLine(text: string): { line: string; truncated: boolean } {
  const normalised = text.replace(/\r\n?/g, '\n');
  const index = normalised.indexOf('\n');
  if (index < 0) return { line: normalised, truncated: false };
  return { line: normalised.slice(0, index), truncated: normalised.slice(index + 1).trim().length > 0 };
}

class InputEditorController {
  id: string;
  term: Terminal;
  /** `.cortx-xterm`, the element xterm renders into. */
  container: HTMLElement;
  isReplaying: () => boolean;

  machine = new TerminalInputMachine();
  root: HTMLDivElement;
  field: HTMLTextAreaElement;
  ghost: HTMLDivElement;
  ghostTyped: HTMLSpanElement;
  ghostRest: HTMLSpanElement;

  /** Remainder currently offered as ghost text (→ accepts it). */
  suggestion = '';
  /** Grid text seen before this deadline is treated as typeahead. */
  adoptUntil = 0;
  /** `cursorInactiveStyle` to put back when the editor closes. */
  previousInactiveCursor: Terminal['options']['cursorInactiveStyle'];
  frame = 0;
  disposables: IDisposable[] = [];
  cleanup: Array<() => void> = [];

  constructor(id: string, term: Terminal, container: HTMLElement, isReplaying: () => boolean) {
    this.id = id;
    this.term = term;
    this.container = container;
    this.isReplaying = isReplaying;
    this.previousInactiveCursor = term.options.cursorInactiveStyle;

    const root = document.createElement('div');
    root.className = 'cortx-input';
    root.hidden = true;
    const ghost = document.createElement('div');
    ghost.className = 'cortx-input-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    this.ghostTyped = document.createElement('span');
    this.ghostTyped.className = 'cortx-input-ghost-typed';
    this.ghostRest = document.createElement('span');
    this.ghostRest.className = 'cortx-input-ghost-rest';
    ghost.append(this.ghostTyped, this.ghostRest);
    const field = document.createElement('textarea');
    field.className = 'cortx-input-field';
    field.rows = 1;
    field.spellcheck = false;
    field.autocapitalize = 'off';
    field.setAttribute('autocorrect', 'off');
    field.setAttribute('aria-label', 'Terminal input');
    root.append(ghost, field);
    container.appendChild(root);
    this.root = root;
    this.ghost = ghost;
    this.field = field;

    this.listen();
    void loadHistory();
  }

  // -- wiring ---------------------------------------------------------------

  listen() {
    const { term } = this;
    this.disposables.push(
      term.parser.registerOscHandler(133, (data) => {
        this.onMarker(data.split(';')[0]);
        // Never consumed: the ghost-text and position handlers need it too.
        return false;
      })
    );
    this.disposables.push(
      term.buffer.onBufferChange((buffer) => {
        this.machine.bufferChanged(buffer.type === 'alternate' ? 'alternate' : 'normal');
        this.schedule();
      })
    );
    this.disposables.push(term.onWriteParsed(() => this.schedule()));
    this.disposables.push(term.onResize(() => this.schedule()));
    this.disposables.push(term.onScroll(() => this.schedule()));

    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement,
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
      capture = false
    ) => {
      target.addEventListener(type, handler as EventListener, capture);
      this.cleanup.push(() => target.removeEventListener(type, handler as EventListener, capture));
    };

    on(this.field, 'keydown', (e) => this.onKeyDown(e));
    on(this.field, 'input', () => this.onInput());
    on(this.field, 'paste', (e) => this.onPaste(e));
    on(this.field, 'keyup', () => this.syncCaret());
    on(this.field, 'mouseup', () => this.syncCaret());
    on(this.field, 'blur', () => this.setGhost(''));
    // A line longer than the pane scrolls inside the textarea; the ghost has
    // to follow or the suggestion drifts away from the caret.
    on(this.field, 'scroll', () => {
      this.ghost.scrollLeft = this.field.scrollLeft;
    });

    // Focus discipline (plan §6.5): while the editor is up it is the one
    // keyboard target. A mouse selection may take the focus for the duration
    // of the drag; it comes back as soon as there is nothing selected.
    on(this.container, 'focusin', (e) => {
      if (!this.machine.isEditing || this.root.hidden) return;
      if (e.target === this.field) return;
      if (this.term.hasSelection()) return;
      this.field.focus();
    });
    on(this.container, 'mouseup', () => {
      if (!this.machine.isEditing || this.root.hidden) return;
      if (this.term.hasSelection()) return;
      this.field.focus();
    });
    // …and a key typed while the grid still holds the focus (right after a
    // selection) is routed into the editor instead of being lost to the PTY.
    on(
      this.container,
      'keydown',
      (e) => {
        if (!this.machine.isEditing || this.root.hidden) return;
        if (e.target === this.field) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const printable = e.key.length === 1;
        if (!printable && !['Enter', 'Backspace', 'Tab', 'Escape'].includes(e.key) && !e.key.startsWith('Arrow')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.field.focus();
        if (printable) {
          this.machine.insert(e.key);
          this.syncOut();
        } else {
          this.onKeyDown(e);
        }
      },
      true
    );
  }

  dispose() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    for (const off of this.cleanup) off();
    this.cleanup = [];
    this.hide();
    this.machine.reset();
    this.root.remove();
  }

  // -- state ----------------------------------------------------------------

  /** Every condition of the activation contract, checked at the marker. */
  canActivate(): boolean {
    if (!inputEditorEnabled()) return false;
    if (useAppStore.getState().settings?.terminal.shellIntegration === false) return false;
    // A restored scrollback replays the shell's old markers: no editor then.
    if (this.isReplaying()) return false;
    return this.term.buffer.active.type === 'normal';
  }

  onMarker(kind: string) {
    const buf = this.term.buffer.active;
    this.machine.handoffEnabled = handoffEnabled();
    this.machine.marker(kind, {
      canActivate: this.canActivate(),
      anchor: { y: buf.baseY + buf.cursorY, x: buf.cursorX },
    });
    // Characters typed while the last command was finishing sat in the shell's
    // buffer and are about to be echoed: watch for them for a moment.
    if (kind === 'B') this.adoptUntil = performance.now() + ADOPT_WINDOW_MS;
    this.schedule();
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.refresh();
    });
  }

  refresh() {
    if (!this.machine.isEditing || !inputEditorEnabled()) {
      this.hide();
      return;
    }
    this.adoptTypeahead();
    if (this.root.hidden) this.show();
    this.place();
  }

  /** Force the editor shut (setting turned off, session going away). */
  close() {
    this.machine.reset();
    this.hide();
  }

  show() {
    this.root.hidden = false;
    // The grid's own cursor would sit under ours at the prompt.
    this.previousInactiveCursor = this.term.options.cursorInactiveStyle;
    this.term.options.cursorInactiveStyle = 'none';
    this.applyFont();
    this.syncOut();
    // Never steal the keyboard from another pane: only take it when this pane
    // already had it.
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.container.contains(active) && active !== this.field) {
      this.field.focus();
    }
  }

  hide() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.term.options.cursorInactiveStyle = this.previousInactiveCursor;
    const hadFocus = document.activeElement === this.field;
    this.field.value = '';
    this.setGhost('');
    // Give the keyboard back to the grid, or the next keystroke is lost.
    if (hadFocus) this.term.focus();
  }

  // -- geometry -------------------------------------------------------------

  screenElement(): HTMLElement | null {
    return (this.term.element?.querySelector('.xterm-screen') as HTMLElement | null) ?? null;
  }

  applyFont() {
    const { options } = this.term;
    const style = this.root.style;
    style.fontFamily = String(options.fontFamily ?? 'monospace');
    style.fontSize = `${options.fontSize ?? 12}px`;
    style.fontWeight = String(options.fontWeight ?? 400);
    style.letterSpacing = `${options.letterSpacing ?? 0}px`;
  }

  /** Put the editor on the prompt's own cell, whatever the pane's layout. */
  place() {
    const screen = this.screenElement();
    const anchor = this.machine.anchor;
    // Defensive: `hide()` and not `hidden = true`, so the grid cursor is put
    // back and the keyboard does not stay on an invisible field.
    if (!screen || !anchor) {
      this.hide();
      return;
    }
    const buf = this.term.buffer.active;
    const row = anchor.y - buf.viewportY;
    // Scrolled out of sight: hide rather than draw the editor over the output.
    if (row < 0 || row >= this.term.rows) {
      this.root.style.visibility = 'hidden';
      return;
    }
    this.root.style.visibility = '';
    // Re-applied every pass: the font, the zoom and the theme can all change
    // while the editor is open, and it has to stay the terminal's own text.
    this.applyFont();
    const host = this.container.getBoundingClientRect();
    const rect = screen.getBoundingClientRect();
    const cellHeight = rect.height / Math.max(1, this.term.rows);
    const cellWidth = rect.width / Math.max(1, this.term.cols);
    const left = rect.left - host.left + anchor.x * cellWidth;
    const top = rect.top - host.top + row * cellHeight;
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
    this.root.style.height = `${Math.max(1, Math.round(cellHeight))}px`;
    this.root.style.width = `${Math.max(cellWidth * 2, rect.width - anchor.x * cellWidth)}px`;
    this.root.style.lineHeight = `${Math.max(1, Math.round(cellHeight))}px`;
  }

  // -- text in and out ------------------------------------------------------

  /** Machine → DOM (after an action the machine handled itself). */
  syncOut() {
    const { machine, field } = this;
    if (field.value !== machine.text) field.value = machine.text;
    if (field.selectionStart !== machine.caret || field.selectionEnd !== machine.caret) {
      field.setSelectionRange(machine.caret, machine.caret);
    }
    this.updateGhost();
  }

  syncCaret() {
    if (!this.machine.isEditing) return;
    this.machine.setText(this.field.value, this.field.selectionStart ?? this.field.value.length);
    this.updateGhost();
  }

  onInput() {
    if (!this.machine.isEditing) {
      this.field.value = '';
      return;
    }
    const value = this.field.value;
    if (value.includes('\n')) {
      // A multi-line drop that got past the paste handler (drag and drop, IME).
      const { line } = firstLine(value);
      this.field.value = line;
      this.machine.setText(line, line.length);
      this.syncOut();
      toast.warning('Only the first line was kept', {
        description: 'Multi-line input arrives with U2; nothing is ever run by accident.',
      });
      return;
    }
    this.machine.setText(value, this.field.selectionStart ?? value.length);
    // Typing snaps back to the bottom, exactly like `scrollOnUserInput` does
    // for the grid — otherwise the editor is off screen while you type in it.
    this.term.scrollToBottom();
    this.updateGhost();
  }

  onPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text');
    if (text === undefined) return;
    e.preventDefault();
    this.insertText(text);
  }

  insertText(raw: string) {
    const { line, truncated } = firstLine(raw);
    if (line) {
      this.machine.setText(this.field.value, this.field.selectionStart ?? this.field.value.length);
      this.machine.insert(line);
      this.syncOut();
    }
    if (truncated) {
      toast.warning('Only the first line was pasted', {
        description: 'Multi-line input arrives with U2; nothing is ever run by accident.',
      });
    }
  }

  setGhost(rest: string) {
    this.suggestion = rest;
    this.ghostTyped.textContent = rest ? this.machine.text : '';
    this.ghostRest.textContent = rest;
  }

  updateGhost() {
    if (!ghostEnabled() || !this.machine.isEditing) {
      this.setGhost('');
      return;
    }
    const text = this.machine.text;
    if (this.machine.caret !== text.length) {
      this.setGhost('');
      return;
    }
    this.setGhost(findSuggestion(text) ?? '');
  }

  // -- keyboard -------------------------------------------------------------

  write(data: string) {
    if (!data) return;
    api.writeTerminal(this.id, data).catch(() => {});
  }

  onKeyDown(e: KeyboardEvent) {
    if (!this.machine.isEditing) return;
    // A grid selection keeps the copy conventions of `terminalSessions.ts`,
    // which never sees these events: our field has the focus, not xterm's.
    // Ctrl+Shift+C always copies; Ctrl+C only copies while copy-on-select is
    // off — with it on the text is already in the clipboard and Ctrl+C stays
    // the interrupt.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyC' && this.term.hasSelection()) {
      if (e.shiftKey || !copyOnSelectEnabled()) {
        e.preventDefault();
        const text = this.term.getSelection();
        this.term.clearSelection();
        void writeText(text).catch(() => {});
        return;
      }
    }
    // → accepts the ghost, exactly like in the grid today.
    if (
      e.key === 'ArrowRight' &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      this.suggestion &&
      this.machine.caret === this.machine.text.length
    ) {
      e.preventDefault();
      const full = this.machine.text + this.suggestion;
      this.machine.setText(full, full.length);
      this.syncOut();
      return;
    }
    this.machine.handoffEnabled = handoffEnabled();
    const action = this.machine.key(describe(e));
    switch (action.type) {
      case 'none':
        return;
      case 'edit':
        e.preventDefault();
        this.syncOut();
        return;
      case 'write':
        e.preventDefault();
        this.write(action.data);
        this.syncOut();
        return;
      case 'submit':
        e.preventDefault();
        rememberCommand(action.text);
        // One write: the line and its CR must not be split by the IPC.
        this.write(action.data);
        this.hide();
        return;
      case 'handoff':
        e.preventDefault();
        // The text goes out *without* a CR, then the key itself, in a single
        // write so nothing can reorder them. The shell's line editor takes it
        // from here for the rest of this line.
        this.hide();
        this.write(action.flush + action.data);
        return;
      case 'paste':
        e.preventDefault();
        void readText()
          .then((text) => {
            if (text) this.insertText(text);
          })
          .catch(() => {});
        return;
      case 'scroll':
        e.preventDefault();
        this.term.scrollPages(action.pages);
        return;
    }
  }

  // -- typeahead ------------------------------------------------------------

  /** What the shell has echoed between the prompt anchor and the cursor. */
  gridInput(): string | null {
    const buf = this.term.buffer.active;
    const anchor = this.machine.anchor;
    if (!anchor || buf.type !== 'normal') return null;
    const cursorY = buf.baseY + buf.cursorY;
    if (cursorY < anchor.y) return null;
    let text = '';
    for (let y = anchor.y; y <= cursorY; y++) {
      const line = buf.getLine(y);
      if (!line) return null;
      const from = y === anchor.y ? anchor.x : 0;
      const to = y === cursorY ? buf.cursorX : undefined;
      text += line.translateToString(true, from, to);
    }
    return text;
  }

  /**
   * Characters typed while the previous command was still finishing went to
   * the PTY and are sitting in the shell's line buffer. Take them over and
   * erase them there, so Enter cannot run the same line twice.
   *
   * Only for a moment after the prompt marker, only while our editor is still
   * empty, and only once — see plan §6.1, this is the fragile part of U1.
   */
  adoptTypeahead() {
    if (!this.adoptUntil || performance.now() > this.adoptUntil) return;
    if (this.machine.text.length > 0) return;
    const echoed = this.gridInput();
    if (!echoed || !echoed.trim()) return;
    const erase = this.machine.adoptTypeahead(echoed);
    if (!erase) return;
    this.adoptUntil = 0;
    this.write(erase);
    this.syncOut();
  }
}

const controllers = new Map<string, InputEditorController>();

/**
 * Attach the editor to a session (idempotent). `container` is the element
 * xterm renders into; the editor becomes one of its children so it follows the
 * session between surfaces and inherits the U0 offset.
 */
export function attachInputEditor(
  terminalId: string,
  term: Terminal,
  container: HTMLElement,
  isReplaying: () => boolean
): IDisposable {
  if (!controllers.has(terminalId)) {
    controllers.set(terminalId, new InputEditorController(terminalId, term, container, isReplaying));
  }
  return { dispose: () => detachInputEditor(terminalId) };
}

function detachInputEditor(terminalId: string) {
  const controller = controllers.get(terminalId);
  if (!controller) return;
  controllers.delete(terminalId);
  controller.dispose();
}

/** The setting changed: close every editor that may no longer show. */
export function refreshInputEditors() {
  const on = inputEditorEnabled();
  for (const controller of controllers.values()) {
    if (!on) controller.close();
    else controller.schedule();
  }
}
