/**
 * Universal input editor — the state machine (ticket #15, phase U1).
 *
 * This module is deliberately **pure**: no DOM, no xterm, no store, no
 * imports at all. Everything that can go wrong in the editor — when it may
 * appear, which key is honoured, which key gives the line back to the shell,
 * and the two traps the plan singled out (Ctrl+D on a non-empty line, closing
 * on submission rather than on `OSC 133;C`) — lives here, so it can be tested
 * without a browser. `terminalInputEditor.ts` is the thin shell that wires it
 * to xterm and to a `<textarea>`.
 *
 * ## The contract (plans/universal_input.md §3.a)
 *
 * The editor exists **only** between an `OSC 133;B` the shell really emitted
 * and the moment the user submits. No shell integration, `ssh`, a REPL, a
 * TUI, a broken profile → no `B` → `classic` forever, i.e. today's behaviour
 * byte for byte. That is the *fail safe* property: when in doubt, no editor.
 *
 * ```
 *                 133;B  (normal buffer, integration seen, setting on)
 *   ┌──────────┐ ─────────────────────────────────────────────────► ┌──────────┐
 *   │ classic  │                                                    │ editing  │
 *   │ (default)│ ◄───────────────────────────────────────────────── │          │
 *   └──────────┘  submit · 133;A · 133;C/D · hand-off · alternate    └──────────┘
 * ```
 *
 * Two things the plan insists on, and that the tests pin down:
 *
 * - **Ctrl+D only reaches the PTY when the editor is empty.** The shell's own
 *   line buffer is empty at all times (we never type into it), so a Ctrl+D
 *   forwarded while our editor holds text would kill the shell just as the
 *   user meant to delete a character.
 * - **We leave on submission, never on `133;C`.** Under PowerShell `C` comes
 *   from PSReadLine's Enter handler; without PSReadLine there is no `C` at
 *   all and the editor would stay up for the whole command.
 */

/** Where a pane is: typing into the shell's own line editor, or into ours. */
export type InputPhase = 'classic' | 'editing';

/** The parts of a `KeyboardEvent` the machine looks at. */
export interface KeyDescriptor {
  key: string;
  /**
   * `KeyboardEvent.code`, the physical key. Only read for a ⌥ chord on macOS,
   * where `key` is already the glyph macOS composed (`⌥B` is `∫`).
   */
  code?: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/** How ⌥ reads on macOS — `terminal.macOptionAsMeta`, see `terminalKeys.ts`. */
export type MacOptionMode = 'never' | 'wordKeys' | 'always';

/**
 * The five chords `wordKeys` reserves, by `KeyboardEvent.code`, and what each
 * one sends after the `ESC`. Fixed on purpose — see `terminalKeys.ts` for why
 * this is not a per-layout dead-key table. Lives here, in the pure module, so
 * the grid (`terminalKeys.macOptionMetaSequence`) and the editor read the
 * very same list.
 *
 * `⌥⌫` is readline's `backward-kill-word`, which is `ESC` + DEL (0x7f), not
 * `ESC` + BS. ⌥B / ⌥F are `backward-word` / `forward-word`, ⌥D is
 * `kill-word`; ⌥V is what Claude Code reads for "paste the image on the
 * clipboard" (zorg #28), and in a plain shell it is `yank-nth-arg`.
 */
export const MAC_OPTION_WORD_KEYS: Readonly<Record<string, string>> = {
  KeyB: 'b',
  KeyD: 'd',
  KeyF: 'f',
  KeyV: 'v',
  Backspace: '\x7f',
};

/** Where the shell said its input line starts (`baseY + cursorY`, `cursorX`). */
export interface InputAnchor {
  y: number;
  x: number;
}

/**
 * What the caller must do about a key. Anything but `none` is preventDefault'd.
 *
 * - `none` — not ours: let the textarea (or the app's shortcuts) have it.
 * - `edit` — text / caret changed; push them back to the textarea.
 * - `write` — send `data` to the PTY and **stay** in the editor.
 * - `submit` — send `data` (text + CR); the machine is already back to classic.
 * - `handoff` — write `flush` to the PTY *without* a CR, hide the editor, then
 *   send `data` so the shell's line editor handles the key on the full line.
 * - `paste` — read the clipboard into the editor.
 * - `scroll` — scroll the grid by `pages` screens.
 * - `complete` — open CortX's completion menu on the current line (U2.b).
 * - `history` — open the command-history palette on it (U2.d).
 *
 * The last two are *requests*, not commitments: the machine stays exactly
 * where it is, and a caller with nothing to show (no engine, no palette
 * mounted) is free to fall back to {@link TerminalInputMachine.handoff}.
 */
export type InputAction =
  | { type: 'none' }
  | { type: 'edit' }
  | { type: 'write'; data: string }
  | { type: 'submit'; data: string; text: string }
  | { type: 'handoff'; flush: string; data: string }
  | { type: 'paste' }
  | { type: 'scroll'; pages: number }
  | { type: 'complete' }
  | { type: 'history' };

/** Which key opens CortX's completion menu (`terminal.completionMenu`). */
export type CompletionMenuKey = 'ctrlSpace' | 'tab' | 'off';

/** ESC + CR — "new line, do not submit" (see `terminalKeys.ts`). */
export const ESC_CR_SEQUENCE = '\x1b\r';

/** DEL, the byte that makes a shell line editor erase one character. */
export const ERASE_BYTE = '\x7f';

/**
 * The control byte a shell expects for `Ctrl+<key>`, or null when the
 * combination has no C0 encoding (digits, `=`, F-keys with Ctrl…).
 */
export function controlByte(key: string): string | null {
  if (key.length !== 1) return null;
  const lower = key.toLowerCase();
  if (lower >= 'a' && lower <= 'z') return String.fromCharCode(lower.charCodeAt(0) - 96);
  switch (key) {
    case '@':
    case ' ':
      return '\x00';
    case '[':
      return '\x1b';
    case '\\':
      return '\x1c';
    case ']':
      return '\x1d';
    case '^':
      return '\x1e';
    case '_':
    case '?':
      return '\x1f';
    default:
      return null;
  }
}

/** VT sequences for the function keys, so a hand-off can replay them. */
const FUNCTION_KEYS: Record<string, string> = {
  F1: '\x1bOP',
  F2: '\x1bOQ',
  F3: '\x1bOR',
  F4: '\x1bOS',
  F5: '\x1b[15~',
  F6: '\x1b[17~',
  F7: '\x1b[18~',
  F8: '\x1b[19~',
  F9: '\x1b[20~',
  F10: '\x1b[21~',
  F11: '\x1b[23~',
  F12: '\x1b[24~',
};

const WHITESPACE = /\s/;

/** Start of the word before `caret` (emacs `backward-word`). */
export function wordStart(text: string, caret: number): number {
  let i = Math.max(0, Math.min(caret, text.length));
  while (i > 0 && WHITESPACE.test(text[i - 1])) i--;
  while (i > 0 && !WHITESPACE.test(text[i - 1])) i--;
  return i;
}

/** End of the word after `caret` (emacs `forward-word`). */
export function wordEnd(text: string, caret: number): number {
  let i = Math.max(0, Math.min(caret, text.length));
  while (i < text.length && WHITESPACE.test(text[i])) i++;
  while (i < text.length && !WHITESPACE.test(text[i])) i++;
  return i;
}

/** Conditions the caller checks before the machine may open the editor. */
export interface ActivationContext {
  /** Setting on, shell integration on, main buffer, not replaying a snapshot. */
  canActivate: boolean;
  /** Cursor position at the end of the prompt, when the marker is `B`. */
  anchor: InputAnchor;
}

/**
 * One pane's editor state. Owns the text: nothing is sent to the PTY while
 * the user types; the whole line goes out at once on submission.
 */
export class TerminalInputMachine {
  phase: InputPhase = 'classic';
  text = '';
  caret = 0;
  anchor: InputAnchor | null = null;
  /** The shell has emitted at least one OSC 133 marker on this terminal. */
  integrationSeen = false;
  /**
   * Unhandled keys give the line back to the shell (`Tab`, ↑/↓, a function
   * key…). Off, they are swallowed and the editor stays — the "the editor is
   * only for lines you type in one go" fallback of the plan (§6.8).
   *
   * Since U2 this is the escape hatch it was meant to be rather than the
   * nominal path of the most-used keys: Ctrl+R opens CortX's history palette,
   * Ctrl+Space (or Tab) CortX's completion menu, and the ghost text follows
   * the line the editor holds.
   */
  handoffEnabled = true;

  /**
   * Which key asks for CortX's own completion menu, mirroring the
   * `terminal.completionMenu` setting. Kept as a field rather than read from a
   * store so the machine stays pure: the caller refreshes it before each key,
   * exactly as it does for {@link handoffEnabled}.
   *
   * `tab` moves Tab from a hand-off to the menu; `off` puts Ctrl+Space back to
   * being swallowed and leaves Tab to the shell.
   */
  completionMenu: CompletionMenuKey = 'ctrlSpace';

  /**
   * How ⌥ reads on macOS (`terminal.macOptionAsMeta`), or null anywhere else.
   * Refreshed by the caller before each key, like {@link handoffEnabled}.
   *
   * Off a Mac, a bare Alt chord is Meta and nothing else: a character that
   * needs a third level comes through AltGr, which reports Ctrl+Alt and falls
   * through to the textarea. On a Mac there is no AltGr — ⌥ *is* the third
   * level, and on French-PC, Swiss or ABC-AZERTY layouts `\ | [ ] { } @ # ~`
   * are all typed with it. Reading ⌥8 as Meta handed the line off as `ESC \`
   * (ticket #46): the block vanished, nothing was typed, and the rest of the
   * line was the bare shell's — where ⌥← / ⌥→ print `;3D` / `;3C`.
   */
  macOption: MacOptionMode | null = null;

  /**
   * Text parked across a prompt redraw. `133;A` fires far more often than one
   * expects (Ctrl+C, Ctrl+L, a resize, PSReadLine re-invoking the prompt); the
   * line the user was writing must survive it.
   */
  draft: string | null = null;

  /** Back to square one (pane closed, session disposed, setting turned off). */
  reset(): void {
    this.phase = 'classic';
    this.text = '';
    this.caret = 0;
    this.anchor = null;
    this.draft = null;
  }

  get isEditing(): boolean {
    return this.phase === 'editing';
  }

  /** An `OSC 133;<kind>` reached the parser. */
  marker(kind: string, ctx: ActivationContext): void {
    this.integrationSeen = true;
    switch (kind) {
      case 'A':
        // The shell is drawing a prompt: whatever we had is not on screen any
        // more. Keep it as a draft for the `B` that follows.
        if (this.phase === 'editing') {
          this.draft = this.text;
          this.leave();
        }
        break;
      case 'B':
        this.anchor = ctx.anchor;
        // Already editing: only the anchor moves (bash re-emits `B` on every
        // redraw because it lives inside PS1).
        if (this.phase === 'editing') return;
        if (!ctx.canActivate) {
          this.draft = null;
          return;
        }
        this.phase = 'editing';
        this.text = this.draft ?? '';
        this.caret = this.text.length;
        this.draft = null;
        break;
      case 'C':
      case 'D':
        // We normally left on submission already; this is the safety net for
        // a line the shell started on its own (a hand-off, a paste).
        if (this.phase === 'editing') {
          this.draft = null;
          this.leave();
        }
        break;
      default:
        break;
    }
  }

  /** The main/alternate buffer switched: a TUI owns the pane. */
  bufferChanged(type: 'normal' | 'alternate'): void {
    if (type !== 'alternate') return;
    this.draft = null;
    this.leave();
  }

  /** The textarea changed under the user's fingers (typing, IME, paste). */
  setText(text: string, caret: number): void {
    if (this.phase !== 'editing') return;
    this.text = text;
    this.caret = Math.max(0, Math.min(caret, text.length));
  }

  /** Insert `chunk` at the caret (used for paste and for redirected keys). */
  insert(chunk: string): void {
    if (this.phase !== 'editing' || !chunk) return;
    this.text = this.text.slice(0, this.caret) + chunk + this.text.slice(this.caret);
    this.caret += chunk.length;
  }

  /**
   * Typeahead: characters typed before the prompt came back landed in the
   * shell's own buffer and it has just echoed them. Take them over and return
   * the erase sequence that empties the shell's buffer, or null when there is
   * nothing to adopt.
   */
  adoptTypeahead(echoed: string): string | null {
    if (this.phase !== 'editing' || this.text.length > 0) return null;
    const trimmed = echoed.replace(/\s+$/, '');
    if (!trimmed) return null;
    this.text = trimmed;
    this.caret = trimmed.length;
    return ERASE_BYTE.repeat(Array.from(trimmed).length);
  }

  /** Decide what a key does. Only meaningful while `editing`. */
  key(k: KeyDescriptor): InputAction {
    if (this.phase !== 'editing') return { type: 'none' };
    // Cmd on macOS: the platform's own copy / paste / select-all. Never ours.
    if (k.meta && !k.ctrl) return { type: 'none' };

    if (k.key === 'Enter') {
      // Ctrl+Shift+Enter is the app's `pane.maximize` shortcut (handled on a
      // capturing listener long before this): swallow it so the textarea
      // cannot slip a line break in behind the window's back.
      if (k.ctrl && k.shift && !k.alt) return { type: 'edit' };
      // Shift+Enter — and Ctrl+Enter, which Warp accepts too, and Alt+Enter,
      // which xterm already encodes this way — mean "new line, do not
      // submit". Multi-line is U2, so for now give the line back and let the
      // shell see the ESC+CR it sees today.
      if (k.shift || k.ctrl || k.alt) return this.handoff(ESC_CR_SEQUENCE);
      const text = this.text;
      this.draft = null;
      this.leave();
      return { type: 'submit', data: text + '\r', text };
    }
    if (k.ctrl && !k.alt) return this.ctrlKey(k);
    if (k.alt && !k.ctrl) return this.altKey(k);
    // AltGr on a French keyboard reports ctrl+alt together: it must fall
    // through to the textarea so `~ # { [ | ` can be typed.
    return this.plainKey(k);
  }

  // -------------------------------------------------------------------------

  ctrlKey(k: KeyDescriptor): InputAction {
    const key = k.key.toLowerCase();
    if (k.shift) {
      // Ctrl+Shift+V has no webview default everywhere: read the clipboard.
      if (key === 'v') return { type: 'paste' };
      // Ctrl+Shift+C / +F / +D … stay with the app's own shortcuts.
      return { type: 'none' };
    }
    switch (key) {
      case 'c':
        // The panic key. Always forwarded, whatever we hold; the shell prints
        // `^C` and redraws a prompt, which resynchronises everything.
        this.text = '';
        this.caret = 0;
        this.draft = null;
        return { type: 'write', data: '\x03' };
      case 'd':
        // THE trap: forwarded only on an empty editor. The shell's buffer is
        // always empty, so an EOF sent while we hold text kills the shell.
        if (this.text.length === 0) return { type: 'write', data: '\x04' };
        if (this.caret < this.text.length) {
          this.text = this.text.slice(0, this.caret) + this.text.slice(this.caret + 1);
        }
        return { type: 'edit' };
      case 'z':
        return { type: 'write', data: '\x1a' };
      case 'l':
        // The shell clears the screen and redraws an empty prompt. Our text is
        // ours: it stays, and the following `B` re-anchors it.
        return { type: 'write', data: '\x0c' };
      case 'a':
        this.caret = 0;
        return { type: 'edit' };
      case 'e':
        this.caret = this.text.length;
        return { type: 'edit' };
      case 'u':
        this.text = this.text.slice(this.caret);
        this.caret = 0;
        return { type: 'edit' };
      case 'k':
        this.text = this.text.slice(0, this.caret);
        return { type: 'edit' };
      case 'w': {
        const start = wordStart(this.text, this.caret);
        this.text = this.text.slice(0, start) + this.text.slice(this.caret);
        this.caret = start;
        return { type: 'edit' };
      }
      case 'v':
        // The webview pastes into the textarea by itself.
        return { type: 'none' };
      case 'r':
        // Reverse history search, CortX's own (U2.d): the history palette
        // opens on the line so far and hands a command back. Nothing leaves
        // the editor — if no palette is mounted the caller hands off to the
        // shell's `\x12` itself, which is U1's behaviour to the byte.
        return { type: 'history' };
      case ' ':
        // CortX's own completion key (`terminal.completionMenu`, default
        // `ctrlSpace`). Handing it off would close the editor to send the
        // shell a NUL, which no line editor does anything with — so the user
        // would lose what they typed for nothing: swallowed when the menu is
        // bound elsewhere, and the menu itself when it is bound here (U2.b).
        return this.completionMenu === 'ctrlSpace' ? { type: 'complete' } : { type: 'none' };
      default: {
        const bytes = controlByte(k.key);
        return bytes ? this.handoff(bytes) : { type: 'none' };
      }
    }
  }

  altKey(k: KeyDescriptor): InputAction {
    switch (k.key) {
      case 'ArrowLeft':
        this.caret = wordStart(this.text, this.caret);
        return { type: 'edit' };
      case 'ArrowRight':
        this.caret = wordEnd(this.text, this.caret);
        return { type: 'edit' };
      case 'Backspace': {
        const start = wordStart(this.text, this.caret);
        this.text = this.text.slice(0, start) + this.text.slice(this.caret);
        this.caret = start;
        return { type: 'edit' };
      }
      default: {
        if (k.key.length === 1) {
          const meta = this.optionMeta(k);
          // A character macOS composed with ⌥: the textarea types it.
          return meta === null ? { type: 'none' } : this.handoff('\x1b' + meta);
        }
        const seq = FUNCTION_KEYS[k.key];
        return seq ? this.handoff('\x1b' + seq) : { type: 'none' };
      }
    }
  }

  /**
   * The key a printable Alt / ⌥ chord stands for as Meta, or null when it is
   * a character to type — the same rule the grid follows
   * (`terminalKeys.macOptionMetaSequence`, xterm's `macOptionIsMeta`):
   *
   * - not a Mac: Alt is Meta, `key` as it comes;
   * - `never`: ⌥ only ever composes;
   * - `wordKeys`: Meta for the closed list of {@link MAC_OPTION_WORD_KEYS},
   *   read on the physical key since `key` holds the composed glyph (`∫`);
   * - `always`: Meta for every chord, again from the physical key when it is
   *   a letter or a digit.
   */
  optionMeta(k: KeyDescriptor): string | null {
    if (this.macOption === null) return k.key;
    if (this.macOption === 'never') return null;
    const code = k.code ?? '';
    if (this.macOption === 'wordKeys') {
      const word = MAC_OPTION_WORD_KEYS[code];
      // Backspace never gets here (it is not printable, and edits locally).
      if (word === undefined || word.length !== 1) return null;
      return k.shift ? word.toUpperCase() : word;
    }
    const letter = /^Key([A-Z])$/.exec(code)?.[1];
    if (letter) return k.shift ? letter : letter.toLowerCase();
    const digit = /^Digit(\d)$/.exec(code)?.[1];
    return digit ?? k.key;
  }

  plainKey(k: KeyDescriptor): InputAction {
    switch (k.key) {
      case 'Escape':
        // Something typed: Esc clears it (and stays in the editor). Nothing
        // typed: the shell may want the Esc.
        if (this.text.length > 0) {
          this.text = '';
          this.caret = 0;
          return { type: 'edit' };
        }
        return this.handoff('\x1b');
      case 'Tab':
        // With `completionMenu: 'tab'` the key belongs to CortX's own menu,
        // here as much as in the grid. Otherwise the hand-off does what it has
        // always done: PSReadLine / zsh complete the real line. Shift+Tab is
        // never ours — it is the shell's back-tab.
        if (!k.shift && this.completionMenu === 'tab') return { type: 'complete' };
        return this.handoff(k.shift ? '\x1b[Z' : '\t');
      case 'ArrowUp':
        return this.handoff('\x1b[A');
      case 'ArrowDown':
        return this.handoff('\x1b[B');
      case 'PageUp':
        return { type: 'scroll', pages: -1 };
      case 'PageDown':
        return { type: 'scroll', pages: 1 };
      default: {
        const seq = FUNCTION_KEYS[k.key];
        if (seq) return this.handoff(seq);
        return { type: 'none' };
      }
    }
  }

  /**
   * Give the line back to the shell: the text goes to the PTY **without** a
   * CR, the editor closes, and the key is replayed so the shell's own line
   * editor acts on the full line. Nothing runs; the editor comes back at the
   * next prompt.
   */
  handoff(data: string): InputAction {
    if (!this.handoffEnabled) return { type: 'edit' };
    const flush = this.text;
    this.draft = null;
    this.leave();
    return { type: 'handoff', flush, data };
  }

  leave(): void {
    this.phase = 'classic';
    this.text = '';
    this.caret = 0;
  }
}
