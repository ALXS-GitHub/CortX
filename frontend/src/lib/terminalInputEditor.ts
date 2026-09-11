/**
 * Universal input editor — the surface (ticket #15, phase U1).
 *
 * A **block** laid over the row the shell's prompt is on: a full-width,
 * *unframed* strip (see `styles/terminal-input.css`) holding a `<textarea>`,
 * driven by the pure state machine in `terminalInputState.ts`. The editor owns
 * the text: nothing reaches the PTY while the user types, and the whole line
 * goes out at once on Enter, so the shell's own line editor (PSReadLine, ZLE)
 * does all its usual work — history, alias expansion, the `133;C` marker — on
 * a line it reads in one go.
 *
 * Owning the line is what makes this the equivalent of **Warp's universal
 * input**, not its classic one. (An earlier version of this header, and of
 * the stylesheet's, said the opposite and used it to justify the missing
 * frame.) Warp's `Classic` is the shell's own line editor left in charge
 * under `honor_ps1` — which is what CortX does when `terminal.inputEditor` is
 * off. The frame is absent for its own reason, unrelated to either: the strip
 * sits on the prompt's row, so it *is* the prompt and a border around it
 * would read as a widget dropped on the terminal (commit `d70beb0`). Warp
 * frames its universal input because that one is a separate surface below the
 * output, with affordances of its own.
 *
 * It only ever appears between an `OSC 133;B` the shell really emitted and the
 * submission. Without shell integration, over `ssh`, inside a REPL, in the
 * alternate screen or while a snapshot is being replayed, nothing here shows
 * and the terminal behaves byte for byte as it does today. The setting itself
 * (`terminal.inputEditor`) is off by default.
 *
 * Anything the editor cannot honour — Tab, ↑/↓, a function key — triggers a
 * **hand-off**: the current text is written to the PTY *without* a CR, the
 * editor closes, and the key follows in the same write. PSReadLine then
 * completes (or searches) the real line exactly as it does now. That is what
 * made U1 shippable without a completion engine of our own.
 *
 * ## U2 — the editor stopped costing you the features it was meant to carry
 *
 * U1 shipped with the hand-off as the *nominal* path of the most-used keys,
 * which meant switching `terminal.inputEditor` on switched CortX's own
 * completions and suggestions off. Three of the four are back where Warp puts
 * them — in the input, not in the shell:
 *
 * - **Ghost text (U2.a).** The ranked engine of `terminalSuggest.ts` (history,
 *   what the last command's output told you to run, specs, paths) is published
 *   through `terminalCompletionMenu.ts` and read here against `machine.text`
 *   instead of the grid. → accepts it, Ctrl+→ one word.
 * - **Completion menu (U2.b).** Ctrl+Space — or Tab with
 *   `terminal.completionMenu: 'tab'` — opens the very same floating list the
 *   grid opens, anchored on *our* caret. ↑/↓ move, Enter/Tab accept, Esc
 *   closes. Nothing to offer → the key falls back to what it did before.
 * - **History palette (U2.d).** Ctrl+R opens the command-history view
 *   (`components/terminal/history/`) in its `pick` mode: nothing is written to
 *   any PTY, and the command chosen simply replaces the buffer.
 *
 * Multi-line (U2.c) is **not** done: Shift+Enter still hands the line back
 * with the ESC+CR of today.
 *
 * The one ordering trap, and the reason `terminalSuggest.ts` asks
 * `inputEditorOwnsLine()` rather than "is the setting on": its key listener is
 * a *capturing* one on the session container, so it sees the keys typed into
 * our textarea before the textarea does. It steps aside for exactly as long as
 * the machine is editing — and not one prompt longer, so a REPL or an `ssh`
 * session, where the editor never opens, keeps the grid's ghost text.
 *
 * Everything is plain DOM: the editor is a child of the session container, so
 * it is re-parented with it between the dock and the Terminal window, it
 * inherits the U0 `translateY`, and no React surface has to know it exists.
 *
 * ## The cursor
 *
 * The first version relied on the browser's own textarea caret. It is a 1 px
 * hairline, it does not follow the terminal's `cursorStyle` / `cursorBlink`,
 * and — the actual bug — it draws *nothing at all* when the field does not
 * hold the DOM focus, which happened every time the prompt came back while
 * the focus was anywhere but inside this pane. The grid, still focused, kept
 * drawing *its* cursor and swallowed the keystrokes. So:
 *
 * - the native caret is suppressed and a caret of our own is drawn on a layer
 *   above the text (`renderCaret`), following `cursorStyle` and `cursorBlink`;
 * - `takeFocus()` is deliberate about when the field may claim the keyboard,
 *   and the focus is bounced back to it whenever anything inside the pane
 *   steals it;
 * - the grid's cursor is hidden (`cursorInactiveStyle: 'none'`) *and* the grid
 *   is explicitly blurred, so there is never a second cursor blinking next to
 *   ours.
 *
 * ## The mouse
 *
 * Drawing a caret is only half of "the cursor works": the user also has to be
 * able to *put it somewhere*. The block is a full-width strip, but the only
 * element in it that ever accepted the mouse was the `<textarea>`, and the
 * textarea starts on the column the prompt ends on — everything left of it
 * (the frame, the shell's own PS1 shown inside the block) and the padding
 * above and below the row were `pointer-events: none` and let the click fall
 * through to xterm's canvas, where it did nothing but start a grid selection.
 * Clicking *on the prompt* therefore could not move the caret at all.
 *
 * So the block now has a hit layer (`.cortx-uinput-hit`) covering all of it,
 * sitting *under* the text box so the textarea keeps the browser's own click,
 * drag-select and double-click wherever it already worked. Outside it the
 * point is mapped to a caret offset by `terminalInputHit.ts`, measured on the
 * caret layer itself so it is exact for any font.
 *
 * The deliberate trade-off: a drag that *starts* on the prompt row no longer
 * selects the grid's text there — a strip cannot be an editor and a grid
 * selection at the same time, and Warp makes the same call. Every other row is
 * untouched.
 */
import type { IDisposable, Terminal } from '@xterm/xterm';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { toast } from 'sonner';
import * as api from '@/lib/tauri';
import { useAppStore } from '@/stores/appStore';
import { copyOnSelectEnabled } from '@/lib/terminalKeys';
import {
  TerminalInputMachine,
  type CompletionMenuKey,
  type InputAction,
  type KeyDescriptor,
} from '@/lib/terminalInputState';
import { caretOffsetAt } from '@/lib/terminalInputHit';
import { acceptanceFor, aliasHintFor, type CompletionItem } from '@/lib/terminalCompletion';
import { onCompletionData, peekAliases } from '@/lib/terminalCompletionData';
import {
  closeMenu,
  getEngine,
  getMenuState,
  registerAccept,
  setMenuState,
} from '@/lib/terminalCompletionMenu';
import { openCommandHistory } from '@/components/terminal/history/openHistory';

/** The editor is beta: off unless the user asks for it. */
export function inputEditorEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.inputEditor === true;
}

/**
 * Does the universal input editor hold the line of this terminal right now?
 *
 * The question `terminalSuggest.ts` has to ask before it touches the ghost,
 * the menu or a keystroke. Not "is the setting on": the editor only exists
 * between a real `OSC 133;B` and the submission, and everywhere it is *not*
 * up — a REPL, `ssh`, a TUI, a running command — the grid is still where the
 * line is and the grid engine must go on working exactly as before.
 */
export function inputEditorOwnsLine(terminalId: string): boolean {
  return controllers.get(terminalId)?.machine.isEditing === true;
}

function completionMenuKey(): CompletionMenuKey {
  return useAppStore.getState().settings?.terminal.completionMenu ?? 'ctrlSpace';
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
/** Rows the completion menu may hold at once, as in the grid. */
const MENU_LIMIT = 40;

/**
 * Breathing room around the prompt row, in px. Asymmetric on purpose: above
 * the row there is output (a tall frame would draw its border through the
 * descenders of the line before), below it there is nothing until the command
 * runs — so the block grows downwards.
 */
const PAD_TOP = 2;
const PAD_BOTTOM = 5;
/** Space kept between the caret's column and the right edge of the block. */
const TEXT_INSET_RIGHT = 6;
/**
 * Columns of typing room the text box is guaranteed, however far right the
 * shell said its prompt ended. ConPTY repaints the screen on its own terms and
 * a bogus `cursorX` would otherwise push the box off the right edge — an
 * editor nothing can be typed or clicked into.
 */
const MIN_TEXT_COLS = 4;

// ---------------------------------------------------------------------------
// Ghost text (U2.a)
//
// `terminalSuggest.ts` draws its ghost by reading the grid, which is empty
// while the editor owns the text — so it goes quiet and there is never a
// second ghost in the wrong place (plan §6.9). What it does *not* do any more
// is take the feature down with it: it publishes its ranked engine (history of
// this window, the previous command's output, specs, git refs, paths) and the
// block asks it about `machine.text`.
//
// The flat list below stays as the fallback for the one case where there is no
// engine to ask — the editor is attached on `mountTerminal`, the suggestion
// controller a frame later from `XtermView` — so the very first prompt of a
// pane still gets a ghost instead of nothing.
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

/** The real engine when it is attached, the flat history until then. */
function suggestFor(terminalId: string, line: string): string | null {
  const engine = getEngine(terminalId);
  if (engine) return engine.ghost(line);
  return findSuggestion(line);
}

// ---------------------------------------------------------------------------

function describe(e: KeyboardEvent): KeyDescriptor {
  return { key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
}

/** The part of a suggestion Ctrl+→ accepts: one word, separator included. */
function nextWord(remainder: string): string {
  return remainder.match(/^\s*\S+\s?/)?.[0] ?? remainder;
}

/** First line of a paste; U1 refuses the rest rather than run it by accident. */
function firstLine(text: string): { line: string; truncated: boolean } {
  const normalised = text.replace(/\r\n?/g, '\n');
  const index = normalised.indexOf('\n');
  if (index < 0) return { line: normalised, truncated: false };
  return { line: normalised.slice(0, index), truncated: normalised.slice(index + 1).trim().length > 0 };
}

/** A colour that would paint nothing (the Terminal window's canvas is see-through). */
function isTransparent(colour: string | undefined): boolean {
  if (!colour) return true;
  const value = colour.trim().toLowerCase();
  if (value === 'transparent' || value === 'none') return true;
  // `rgba(0, 0, 0, 0)` and `#rrggbb00`.
  return /,\s*0(\.0+)?\s*\)$/.test(value) || /^#[0-9a-f]{6}00$/.test(value);
}

class InputEditorController {
  id: string;
  term: Terminal;
  /** `.cortx-xterm`, the element xterm renders into. */
  container: HTMLElement;
  isReplaying: () => boolean;

  machine = new TerminalInputMachine();
  root: HTMLDivElement;
  frame: HTMLDivElement;
  /** The whole strip's click target — see the header, "The mouse". */
  hit: HTMLDivElement;
  text: HTMLDivElement;
  field: HTMLTextAreaElement;
  ghost: HTMLDivElement;
  ghostTyped: HTMLSpanElement;
  ghostRest: HTMLSpanElement;
  caretLayer: HTMLDivElement;
  caretLead: HTMLSpanElement;
  caret: HTMLElement;
  caretGlyph: HTMLSpanElement;

  /** Remainder currently offered as ghost text (→ accepts it). */
  suggestion = '';
  /** True while *this* block owns the floating completion menu (U2.b). */
  menuOpen = false;
  /** Undo of the accepter pushed for the duration of that menu. */
  offAccept: (() => void) | null = null;
  /** Grid text seen before this deadline is treated as typeahead. */
  adoptUntil = 0;
  /** `cursorInactiveStyle` to put back when the editor closes. */
  previousInactiveCursor: Terminal['options']['cursorInactiveStyle'];
  frameId = 0;
  syncFrame = 0;
  disposables: IDisposable[] = [];
  cleanup: Array<() => void> = [];

  constructor(id: string, term: Terminal, container: HTMLElement, isReplaying: () => boolean) {
    this.id = id;
    this.term = term;
    this.container = container;
    this.isReplaying = isReplaying;
    this.previousInactiveCursor = term.options.cursorInactiveStyle;

    const root = document.createElement('div');
    root.className = 'cortx-uinput';
    root.hidden = true;
    root.dataset.focus = 'false';

    const frame = document.createElement('div');
    frame.className = 'cortx-uinput-frame';

    // Appended *before* the text box on purpose: at equal z-index the later
    // sibling wins the hit test, so the textarea still takes every click that
    // falls inside it (native drag-select, double-click…) and this layer only
    // ever sees the rest of the block.
    const hit = document.createElement('div');
    hit.className = 'cortx-uinput-hit';
    hit.setAttribute('aria-hidden', 'true');

    const text = document.createElement('div');
    text.className = 'cortx-uinput-text';

    const ghost = document.createElement('div');
    ghost.className = 'cortx-uinput-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    this.ghostTyped = document.createElement('span');
    this.ghostTyped.className = 'cortx-uinput-ghost-typed';
    this.ghostRest = document.createElement('span');
    this.ghostRest.className = 'cortx-uinput-ghost-rest';
    ghost.append(this.ghostTyped, this.ghostRest);

    const field = document.createElement('textarea');
    field.className = 'cortx-uinput-field';
    field.rows = 1;
    field.wrap = 'off';
    field.spellcheck = false;
    field.autocapitalize = 'off';
    field.setAttribute('autocorrect', 'off');
    field.setAttribute('aria-label', 'Terminal input');

    const caretLayer = document.createElement('div');
    caretLayer.className = 'cortx-uinput-caret-layer';
    caretLayer.setAttribute('aria-hidden', 'true');
    this.caretLead = document.createElement('span');
    this.caret = document.createElement('i');
    this.caret.className = 'cortx-uinput-caret';
    this.caretGlyph = document.createElement('span');
    this.caretGlyph.className = 'cortx-uinput-caret-glyph';
    this.caret.append(this.caretGlyph);
    caretLayer.append(this.caretLead, this.caret);

    text.append(ghost, field, caretLayer);
    root.append(frame, hit, text);
    container.appendChild(root);

    this.root = root;
    this.frame = frame;
    this.hit = hit;
    this.text = text;
    this.ghost = ghost;
    this.field = field;
    this.caretLayer = caretLayer;

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
    // A source that finished loading in the background (the ranked history, a
    // `--help` spec, git refs) has to reach the block too, or a ghost that was
    // one fetch away would never appear on the line being typed.
    const offData = onCompletionData(() => {
      if (this.machine.isEditing && !this.root.hidden) this.render();
    });
    this.cleanup.push(offData);

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
    // A click moves `selectionStart` without ever firing a `keyup`, and a
    // drag can end on the field, past it, or with a double-click's own
    // `select`: read the caret back on all of them.
    on(this.field, 'mouseup', () => this.syncCaret());
    on(this.field, 'click', () => this.syncCaret());
    on(this.field, 'select', () => this.syncCaret());
    // Chromium fires `selectionchange` on the field itself (since 121), which
    // is the only event that keeps our caret glued to the browser's while an
    // arrow key auto-repeats — `keyup` never fires then.
    {
      const onSelectionChange = () => this.syncCaret();
      this.field.addEventListener('selectionchange', onSelectionChange);
      this.cleanup.push(() => this.field.removeEventListener('selectionchange', onSelectionChange));
    }
    on(this.field, 'focus', () => {
      this.root.dataset.focus = 'true';
      this.restartBlink();
    });
    on(this.field, 'blur', () => {
      this.root.dataset.focus = 'false';
      this.setGhost('');
    });
    // A line longer than the block scrolls inside the textarea; the ghost and
    // the caret have to follow or they drift away from the text.
    on(this.field, 'scroll', () => this.syncScroll());

    // The rest of the block (see the header, "The mouse"): a click on the
    // shell's own prompt, in the frame's padding or past the right edge of
    // the text used to reach xterm's canvas and do nothing. It now puts the
    // caret where the pointer is.
    on(this.hit, 'mousedown', (e) => this.onBlockMouseDown(e));
    // …and because that layer takes the pointer, the wheel has to be handed
    // back by hand or the pane would stop scrolling while the cursor rests on
    // the prompt row.
    on(this.hit, 'wheel', (e) => this.onBlockWheel(e));

    // Focus discipline (plan §6.5): while the editor is up it is the one
    // keyboard target. A mouse selection may take the focus for the duration
    // of the drag; it comes back as soon as there is nothing selected.
    on(this.container, 'focusin', (e) => {
      if (!this.machine.isEditing || this.root.hidden) return;
      if (e.target === this.field) return;
      if (this.term.hasSelection()) return;
      this.focusField();
    });
    on(this.container, 'mouseup', () => {
      if (!this.machine.isEditing || this.root.hidden) return;
      if (this.term.hasSelection()) return;
      this.focusField();
    });
    // …and a key typed while the grid still holds the focus (right after a
    // selection, or after `focusTerminal()` put it back) is routed into the
    // editor instead of being lost to the PTY.
    on(
      this.container,
      'keydown',
      (e) => {
        if (!this.machine.isEditing || this.root.hidden) return;
        if (e.target === this.field) return;
        if (this.term.hasSelection()) return;
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
        this.focusField();
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.machine.insert(e.key);
          this.syncOut();
          return;
        }
        // Everything else goes through the very same path as a key typed in
        // the field. Only stop it when the machine actually claimed it, so
        // an app shortcut the editor ignores still reaches xterm.
        this.onKeyDown(e);
        if (e.defaultPrevented) e.stopImmediatePropagation();
      },
      true
    );
  }

  dispose() {
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    if (this.syncFrame) cancelAnimationFrame(this.syncFrame);
    this.syncFrame = 0;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    for (const off of this.cleanup) off();
    this.cleanup = [];
    this.dismissMenu();
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
    if (this.frameId) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = 0;
      this.refresh();
    });
  }

  refresh() {
    if (!this.machine.isEditing || !inputEditorEnabled()) {
      this.hide();
      return;
    }
    this.adoptTypeahead();
    // Placed *before* it is shown: focusing a zero-sized element is what a
    // browser is least reliable about.
    if (!this.place()) return;
    if (this.root.hidden) this.show();
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
    this.applyStyle();
    this.syncOut();
    this.focusField();
  }

  hide() {
    this.dismissMenu();
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.root.dataset.focus = 'false';
    this.term.options.cursorInactiveStyle = this.previousInactiveCursor;
    const hadFocus = document.activeElement === this.field;
    this.field.value = '';
    this.setGhost('');
    // Give the keyboard back to the grid, or the next keystroke is lost.
    if (hadFocus) this.term.focus();
  }

  // -- focus ----------------------------------------------------------------

  /**
   * Claim the keyboard — but never from somewhere it legitimately is.
   *
   * Taking it whenever the prompt comes back would steal it from another pane
   * or from a text field in the app; taking it *only* when this pane already
   * had it (what the first version did) left the editor caret-less and mute
   * whenever the focus had wandered to the body, which is the common case
   * after a click on the window chrome or a tab switch.
   */
  focusField() {
    if (this.root.hidden || !this.machine.isEditing) return;
    if (document.activeElement === this.field) return;
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && this.container.contains(active);
    const idle = !active || active === document.body || active === document.documentElement;
    if (!inside && !idle) return;
    // Taking the focus is what blurs xterm's own helper textarea, which is
    // what makes `cursorInactiveStyle: 'none'` take effect — so this single
    // call is also what guarantees there is never a second cursor.
    this.field.focus({ preventScroll: true });
    this.root.dataset.focus = document.activeElement === this.field ? 'true' : 'false';
  }

  // -- mouse ----------------------------------------------------------------

  /**
   * A click anywhere on the block that the textarea did not already take.
   *
   * `preventDefault` comes *before* the focus on purpose: on a non-editable
   * element it is what stops the webview moving the focus somewhere else and
   * xterm starting a grid selection underneath, both of which would undo the
   * caret we are about to place.
   */
  onBlockMouseDown(e: MouseEvent) {
    // Only the primary button. The right one keeps the pane's own menu (copy /
    // paste, the block menu): that listener is on the container and this event
    // still bubbles up to it.
    if (e.button !== 0) return;
    if (!this.machine.isEditing || this.root.hidden) return;
    const offset = this.offsetAt(e.clientX);
    e.preventDefault();
    this.field.focus({ preventScroll: true });
    this.root.dataset.focus = document.activeElement === this.field ? 'true' : 'false';
    this.field.setSelectionRange(offset, offset);
    this.machine.setText(this.field.value, offset);
    this.render();
  }

  /** The hit layer swallows the wheel; give the scroll back to the grid. */
  onBlockWheel(e: WheelEvent) {
    if (!this.machine.isEditing || this.root.hidden) return;
    // `deltaMode`: 0 px, 1 lines, 2 pages. 20 px per line is xterm's own
    // fallback for a pixel wheel when it has no cell height to hand.
    const lines = e.deltaMode === 1 ? e.deltaY : e.deltaMode === 2 ? e.deltaY * this.term.rows : e.deltaY / 20;
    if (!lines) return;
    e.preventDefault();
    this.term.scrollLines(Math.trunc(lines) || Math.sign(lines));
  }

  /**
   * The caret offset a point on the block belongs to.
   *
   * Measured on the caret layer — the very element the caret is drawn on, so
   * the same font, `letter-spacing` and `tab-size` — rather than divided by
   * the cell width, which drifts on ligatures and double-width glyphs exactly
   * as the ghost text does (`terminalSuggest.paint`). The search itself lives
   * in `terminalInputHit.ts` and is tested there.
   */
  offsetAt(clientX: number): number {
    const text = this.machine.text;
    if (!text) return 0;
    const rect = this.field.getBoundingClientRect();
    const x = clientX - rect.left + this.field.scrollLeft;
    const saved = this.caretLead.textContent;
    const offset = caretOffsetAt(text, x, (index) => {
      this.caretLead.textContent = text.slice(0, index);
      // `offsetLeft` is measured from the caret layer (its offset parent) and
      // ignores its `scrollLeft`, which is why `x` adds the scroll back in.
      return this.caret.offsetLeft;
    });
    this.caretLead.textContent = saved;
    return offset;
  }

  // -- geometry -------------------------------------------------------------

  screenElement(): HTMLElement | null {
    return (this.term.element?.querySelector('.xterm-screen') as HTMLElement | null) ?? null;
  }

  /** Font and colours, straight from the terminal — never the app's chrome. */
  applyStyle() {
    const { options } = this.term;
    const style = this.root.style;
    style.fontFamily = String(options.fontFamily ?? 'monospace');
    style.fontSize = `${options.fontSize ?? 12}px`;
    style.fontWeight = String(options.fontWeight ?? 400);
    style.letterSpacing = `${options.letterSpacing ?? 0}px`;
    const theme = options.theme;
    if (theme?.foreground) style.setProperty('--cortx-uinput-fg', theme.foreground);
    if (theme?.cursor) style.setProperty('--cortx-uinput-caret', theme.cursor);
    // The glyph a block caret covers is redrawn in the background colour —
    // except in the Terminal window, where the canvas is see-through and the
    // real colour is the one the stylesheet falls back to.
    if (theme?.background && !isTransparent(theme.background)) {
      style.setProperty('--cortx-uinput-caret-fg', theme.background);
    } else {
      style.removeProperty('--cortx-uinput-caret-fg');
    }
    this.root.dataset.cursor = options.cursorStyle ?? 'bar';
    this.root.dataset.blink = options.cursorBlink ? 'on' : 'off';
  }

  /**
   * Lay the block over the prompt's row, across the grid.
   *
   * Returns false when there is nothing to place on (no screen element yet,
   * anchor scrolled out of sight): the caller must not then show the editor.
   */
  place(): boolean {
    const screen = this.screenElement();
    const anchor = this.machine.anchor;
    // Defensive: `hide()` and not `hidden = true`, so the grid cursor is put
    // back and the keyboard does not stay on an invisible field.
    if (!screen || !anchor) {
      this.hide();
      return false;
    }
    const buf = this.term.buffer.active;
    const row = anchor.y - buf.viewportY;
    // Scrolled out of sight: hide rather than draw the block over the output.
    if (row < 0 || row >= this.term.rows) {
      this.root.style.visibility = 'hidden';
      return !this.root.hidden;
    }
    this.root.style.visibility = '';
    // Re-applied every pass: the font, the zoom and the theme can all change
    // while the editor is open, and it has to stay the terminal's own text.
    this.applyStyle();

    const host = this.container.getBoundingClientRect();
    const rect = screen.getBoundingClientRect();
    const cellHeight = rect.height / Math.max(1, this.term.rows);
    const cellWidth = rect.width / Math.max(1, this.term.cols);
    const gridLeft = rect.left - host.left;
    const gridTop = rect.top - host.top;
    const rowTop = gridTop + row * cellHeight;

    // The frame breathes around the row it wraps. Below the grid it may run a
    // few pixels into the pane's own padding (`.cortx-xterm-host` clips at its
    // padding box, not at its content box), which is what keeps the block from
    // looking sawn off in the "pinned to bottom" mode.
    const top = Math.max(0, Math.round(rowTop - PAD_TOP));
    const bottom = Math.min(host.height + PAD_BOTTOM, Math.round(rowTop + cellHeight + PAD_BOTTOM));

    const style = this.root.style;
    style.left = `${Math.round(gridLeft)}px`;
    style.width = `${Math.max(1, Math.round(rect.width))}px`;
    style.top = `${top}px`;
    style.height = `${Math.max(1, bottom - top)}px`;
    style.lineHeight = `${Math.max(1, Math.round(cellHeight))}px`;
    // A block / underline caret is exactly one cell wide, like the grid's.
    style.setProperty('--cortx-uinput-caret-w', `${Math.max(2, Math.round(cellWidth))}px`);

    // The text box starts on the column the prompt ended on, so what is typed
    // lands where the shell would have echoed it — but never so far right that
    // there is nothing left to type into: `cursorX` comes from ConPTY, which
    // repaints on its own terms, and one bad value must not cost the user the
    // whole editor. The block itself stays full width and clickable either
    // way (`onBlockMouseDown`).
    const width = Math.round(rect.width);
    const room = Math.max(0, width - Math.round(cellWidth * MIN_TEXT_COLS) - TEXT_INSET_RIGHT);
    const textLeft = Math.min(Math.max(0, Math.round(anchor.x * cellWidth)), room);
    const text = this.text.style;
    text.left = `${textLeft}px`;
    text.top = `${Math.round(rowTop) - top}px`;
    text.height = `${Math.max(1, Math.round(cellHeight))}px`;
    text.width = `${Math.max(cellWidth * 2, width - textLeft - TEXT_INSET_RIGHT)}px`;
    return true;
  }

  // -- text in and out ------------------------------------------------------

  /** Machine → DOM (after an action the machine handled itself). */
  syncOut() {
    const { machine, field } = this;
    if (field.value !== machine.text) field.value = machine.text;
    if (field.selectionStart !== machine.caret || field.selectionEnd !== machine.caret) {
      field.setSelectionRange(machine.caret, machine.caret);
    }
    this.render();
  }

  syncCaret() {
    if (!this.machine.isEditing) return;
    this.machine.setText(this.field.value, this.field.selectionStart ?? this.field.value.length);
    this.render();
  }

  /**
   * Read the caret back *after* the browser has acted on a key we let through
   * (an arrow, Home, End). Doing it on `keyup` alone loses an auto-repeating
   * arrow, which never sends one.
   */
  deferSync() {
    if (this.syncFrame) return;
    this.syncFrame = requestAnimationFrame(() => {
      this.syncFrame = 0;
      this.syncCaret();
    });
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
    this.render();
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

  // -- completion menu (U2.b) -----------------------------------------------

  /**
   * The cursor cell, in viewport coordinates, for the `position: fixed` list.
   *
   * Read off the caret element itself rather than computed from the anchor
   * column: the caret is already placed by the text that precedes it, so this
   * is right for tabs, accents and double-width glyphs by construction — the
   * same argument as `terminalInputHit.ts`.
   */
  menuAnchor() {
    const rect = this.caret.getBoundingClientRect();
    const cellHeight = rect.height || this.root.getBoundingClientRect().height || 16;
    return { left: rect.left, top: rect.top, bottom: rect.top + cellHeight, cellHeight };
  }

  /** Candidates for the line as it stands, or an empty list. */
  /** What the first token of the line expands to, when it is a CortX alias. */
  private aliasHint(): string | null {
    return aliasHintFor(this.machine.text, peekAliases());
  }

  menuItems(): CompletionItem[] {
    const engine = getEngine(this.id);
    if (!engine) return [];
    // Mid-line completion would have to decide what "the word under the
    // caret" means for a line the engine analyses from its start; the ghost
    // makes the same call. Anywhere but the end, the key falls back.
    if (this.machine.caret !== this.machine.text.length) return [];
    return engine.items(this.machine.text, MENU_LIMIT);
  }

  /**
   * Open the list on the current line. Returns false when there is nothing to
   * offer — the caller then does whatever the key did before (hand Tab to
   * PSReadLine, swallow Ctrl+Space), so CortX having nothing to say never
   * costs the user the shell's own completion.
   */
  openMenu(): boolean {
    const items = this.menuItems();
    if (items.length === 0) {
      this.dismissMenu();
      return false;
    }
    if (!this.offAccept) this.offAccept = registerAccept(this.id, (i) => this.acceptMenu(i));
    this.menuOpen = true;
    setMenuState(this.id, {
      open: true,
      items,
      index: 0,
      anchor: this.menuAnchor(),
      hint: this.aliasHint(),
    });
    // The ghost would sit on top of the list's first row.
    this.setGhost('');
    return true;
  }

  /** The line changed under an open list: re-filter it, or close it. */
  refreshMenu() {
    if (!this.menuOpen) return;
    // Someone else closed it in the store (a stray `133;A` on the grid side):
    // let go of the accepter rather than hold a stale one.
    if (!getMenuState(this.id).open) {
      this.dismissMenu();
      return;
    }
    const items = this.menuItems();
    if (items.length === 0) {
      this.dismissMenu();
      return;
    }
    const previous = getMenuState(this.id);
    setMenuState(this.id, {
      open: true,
      items,
      index: Math.min(previous.index, items.length - 1),
      anchor: this.menuAnchor(),
      hint: this.aliasHint(),
    });
  }

  dismissMenu() {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    closeMenu(this.id);
    this.offAccept?.();
    this.offAccept = null;
  }

  /**
   * Accept a row. Unlike the grid — which types backspaces and characters into
   * the PTY because the shell owns the line there — the editor owns it, so the
   * replacement is done in the buffer and nothing is written to the terminal.
   */
  acceptMenu(index: number) {
    const item = getMenuState(this.id).items[index];
    this.dismissMenu();
    if (!item || !this.machine.isEditing) return;
    const line = this.machine.text;
    const acceptance = acceptanceFor(line, item);
    if (!acceptance) return;
    const caret = Math.max(0, Math.min(this.machine.caret, line.length));
    const from = Math.max(0, caret - acceptance.backspaces);
    const next = line.slice(0, from) + acceptance.text + line.slice(caret);
    this.machine.setText(next, from + acceptance.text.length);
    this.syncOut();
    this.focusField();
  }

  /**
   * Keys the open list claims. Everything else falls through to the machine
   * and re-filters the list on the next `render()`, exactly like the grid's.
   */
  handleMenuKey(e: KeyboardEvent): boolean {
    if (!this.menuOpen) return false;
    if (!getMenuState(this.id).open) {
      this.dismissMenu();
      return false;
    }
    if (e.altKey || e.metaKey) return false;
    const menu = getMenuState(this.id);
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (e.ctrlKey) return false;
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const n = menu.items.length;
        setMenuState(this.id, { ...menu, index: (menu.index + delta + n) % n });
        e.preventDefault();
        return true;
      }
      case 'Enter':
      case 'Tab':
        if (e.ctrlKey || e.shiftKey) return false;
        e.preventDefault();
        this.acceptMenu(menu.index);
        return true;
      case 'Escape':
        e.preventDefault();
        this.dismissMenu();
        return true;
      default:
        return false;
    }
  }

  // -- history palette (U2.d) -----------------------------------------------

  /**
   * Ctrl+R: the command-history view, opened in its `pick` mode — rows write
   * to no PTY and Enter hands the command back here. Returns false when no
   * view is mounted in this window, so the caller can fall back to the shell's
   * own reverse search.
   *
   * Only `projectId` narrows the list. The view's `cwd` filter is an exact
   * directory match (`terminal::history`), so passing the terminal's cwd would
   * show an empty palette from any subdirectory of the project — the filter is
   * there in the view for the user to pick from its facets.
   */
  openHistory(): boolean {
    const line = this.machine.text.trim();
    const projectId = getEngine(this.id)?.scope().projectId ?? null;
    this.dismissMenu();
    return openCommandHistory({
      search: line || undefined,
      projectId: projectId ?? undefined,
      pick: (command) => this.adoptPicked(command),
    });
  }

  /** A row was chosen: it becomes the line, ready to be edited or run. */
  adoptPicked(command: string) {
    const line = command.split('\n')[0]?.trim() ?? '';
    if (!line || !this.machine.isEditing) return;
    this.machine.setText(line, line.length);
    this.syncOut();
    // The dialog restores the focus itself, asynchronously and after this
    // callback: claim it back once its own restoration has run, then once
    // more in case that restoration was the later of the two.
    const refocus = () => {
      if (!this.machine.isEditing || this.root.hidden) return;
      this.field.focus({ preventScroll: true });
      this.root.dataset.focus = document.activeElement === this.field ? 'true' : 'false';
    };
    setTimeout(refocus, 0);
    setTimeout(refocus, 80);
  }

  // -- drawing --------------------------------------------------------------

  /** Everything that depends on the text: the ghost, the caret, the list. */
  render() {
    this.updateGhost();
    this.renderCaret();
    this.syncScroll();
    // Last, and on purpose: the list is anchored on the caret's own box, so
    // it has to be re-anchored *after* `renderCaret` has moved it, or it
    // trails the text by one keystroke.
    this.refreshMenu();
  }

  setGhost(rest: string) {
    this.suggestion = rest;
    this.ghostTyped.textContent = rest ? this.machine.text : '';
    this.ghostRest.textContent = rest;
  }

  updateGhost() {
    // The list already says everything the ghost would, in more detail, and
    // it is drawn over the row the ghost lives on.
    if (!ghostEnabled() || !this.machine.isEditing || this.menuOpen) {
      this.setGhost('');
      return;
    }
    const text = this.machine.text;
    if (this.machine.caret !== text.length) {
      this.setGhost('');
      return;
    }
    this.setGhost(suggestFor(this.id, text) ?? '');
  }

  /**
   * The caret. Positioned by the text that precedes it, repeated transparent
   * on its own layer — no measuring, so tabs, accents and double-width glyphs
   * all land where the browser itself would have put the caret.
   */
  renderCaret() {
    const text = this.machine.text;
    const caret = Math.max(0, Math.min(this.machine.caret, text.length));
    this.caretLead.textContent = text.slice(0, caret);
    // A block caret covers the glyph under it and redraws it inverted, the way
    // the grid's own block cursor does.
    const block = this.root.dataset.cursor === 'block';
    const under = block ? text.slice(caret, caret + 1) : '';
    this.caretGlyph.textContent = under === '\t' ? '' : under;
    this.restartBlink();
  }

  /** Blinking restarts on every edit: a moving caret must never be invisible. */
  restartBlink() {
    if (this.root.dataset.blink !== 'on') return;
    const style = this.caret.style;
    style.animation = 'none';
    // Force a reflow so the animation really starts over.
    void this.caret.offsetWidth;
    style.animation = '';
  }

  /** Long line: the textarea scrolls, both overlays must scroll with it. */
  syncScroll() {
    const left = this.field.scrollLeft;
    if (this.ghost.scrollLeft !== left) this.ghost.scrollLeft = left;
    if (this.caretLayer.scrollLeft !== left) this.caretLayer.scrollLeft = left;
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
    // The open list gets first refusal: ↑/↓ walk it, Enter/Tab accept, Esc
    // closes — and none of those may reach the machine while it is up.
    if (this.handleMenuKey(e)) return;
    // → accepts the ghost, exactly like in the grid today; Ctrl+→ takes one
    // word, like PSReadLine's `AcceptNextSuggestionWord`.
    if (
      e.key === 'ArrowRight' &&
      !e.altKey &&
      !e.metaKey &&
      this.suggestion &&
      this.machine.caret === this.machine.text.length
    ) {
      e.preventDefault();
      const taken = e.ctrlKey ? nextWord(this.suggestion) : this.suggestion;
      const full = this.machine.text + taken;
      this.machine.setText(full, full.length);
      this.syncOut();
      return;
    }
    this.machine.handoffEnabled = handoffEnabled();
    this.machine.completionMenu = completionMenuKey();
    const action = this.machine.key(describe(e));
    switch (action.type) {
      case 'none':
        // Left to the textarea (arrows, Home/End, a plain character): the
        // caret it moves is ours, so redraw it once the browser has moved it.
        this.deferSync();
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
      case 'complete':
        // Nothing to offer: give the key back to whoever had it before U2 —
        // the shell for Tab, nobody for Ctrl+Space.
        if (this.openMenu()) {
          e.preventDefault();
          return;
        }
        if (e.key === 'Tab') {
          // Only a plain Tab ever reaches here (Shift+Tab is handed off by
          // the machine), so the shell gets the very byte it got before U2.
          e.preventDefault();
          this.fallback(this.machine.handoff('\t'));
        }
        return;
      case 'history':
        e.preventDefault();
        // No history view mounted in this window: U1's behaviour, byte for
        // byte — the line goes out without a CR and PSReadLine searches it.
        if (!this.openHistory()) this.fallback(this.machine.handoff('\x12'));
        return;
    }
  }

  /**
   * Carry out an action the machine produced outside `onKeyDown`'s switch —
   * the hand-off a `complete` or a `history` falls back to. Only the two
   * shapes `handoff()` can return are possible.
   */
  fallback(action: InputAction) {
    if (action.type === 'handoff') {
      this.hide();
      this.write(action.flush + action.data);
      return;
    }
    // Hand-off switched off: the key is swallowed and the line stays.
    this.syncOut();
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
