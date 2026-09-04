/**
 * Command blocks — the pure half (DEV-13 P4, ticket #7).
 *
 * A *block* is one command and its output, delimited by the OSC 133 markers
 * `cortx init` already makes the shell emit: `A` prompt start, `B` prompt end,
 * `C;cmd=<base64>` command start, `D;<exit>` command end. CortX keeps the
 * classic terminal rendering — the grid is still xterm's, byte for byte — and
 * only ever *draws over* it, so everything here is geometry: which absolute
 * buffer lines a block covers, which block a keystroke should jump to, and how
 * to turn a range of buffer rows back into text.
 *
 * Nothing in this module touches xterm, the DOM or the store; `terminalBlocks.ts`
 * is the half that does. That split is what makes the interesting parts
 * testable (`terminalBlockModel.test.ts`).
 */

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

export type BlockMarkerKind = 'A' | 'B' | 'C' | 'D';

export interface ParsedBlockMarker {
  kind: BlockMarkerKind;
  /** `C` only: the command line, decoded from `cmd=<base64 utf-8>`. */
  command?: string;
  /** `D` only: the exit code, when the shell reported one. */
  exitCode?: number;
}

/**
 * Decode the payload of an `OSC 133` sequence (everything after `133;`).
 *
 * Unknown kinds and malformed payloads return `null` rather than throwing:
 * this runs on every byte the PTY sends, and a foreign program emitting its
 * own OSC 133 flavour must never break the pane.
 */
export function parseBlockMarker(data: string): ParsedBlockMarker | null {
  const parts = data.split(';');
  const kind = parts[0];
  switch (kind) {
    case 'A':
    case 'B':
      return { kind };
    case 'C': {
      const command = decodeCommandParam(parts);
      return command === null ? { kind } : { kind, command };
    }
    case 'D': {
      // `133;D` (no code) and `133;D;0` are both legal.
      const raw = parts[1];
      if (raw === undefined || raw === '') return { kind };
      const code = Number.parseInt(raw, 10);
      return Number.isFinite(code) ? { kind, exitCode: code } : { kind };
    }
    default:
      return null;
  }
}

/** `cmd=<base64 utf-8>` among the parameters of a `133;C`, or null. */
function decodeCommandParam(parts: string[]): string | null {
  const b64 = parts.find((p) => p.startsWith('cmd='))?.slice(4);
  if (!b64) return null;
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export type BlockStatus = 'prompt' | 'running' | 'done';

/**
 * One block, in absolute buffer lines (the coordinates xterm markers use, so
 * they stay right while the viewport scrolls).
 *
 * `endExclusive` is the first line *after* the block, which makes an empty
 * block (a prompt nobody used) `start === endExclusive` instead of a range
 * that has to be special-cased everywhere.
 */
export interface TerminalBlock {
  id: number;
  /** Line the prompt starts on. */
  start: number;
  /** First line of the command's output; null until the command starts. */
  outputStart: number | null;
  /** First line after the block; null while the command is still running. */
  endExclusive: number | null;
  /** Command line, from `133;C;cmd=`; null when the shell did not send one. */
  command: string | null;
  exitCode: number | null;
  status: BlockStatus;
  /** The user hid this block's output (purely a drawing decision). */
  folded: boolean;
}

export interface LineRange {
  /** First line, inclusive. */
  start: number;
  /** First line after the range. */
  endExclusive: number;
}

/**
 * Where a boundary marker really falls.
 *
 * The shells disagree about *when* they emit `133;C` / `133;D`, and the
 * difference is exactly one line. PowerShell emits `C` from PSReadLine's
 * `Enter` handler, so the cursor is still at the end of the line the user
 * typed and the output starts on the next one. bash's `DEBUG` trap and zsh's
 * `preexec` run after the newline has been echoed, so the cursor already sits
 * in column 0 of the first output line.
 *
 * The column tells the two apart without knowing which shell is running.
 */
export function boundaryLine(cursorLine: number, cursorX: number): number {
  return cursorX === 0 ? cursorLine : cursorLine + 1;
}

/**
 * The lines a block covers. A running (or never-finished) block is bounded by
 * `liveEnd` — the line after the last one written so far — so a block that is
 * still producing output simply keeps growing.
 */
export function blockRange(block: TerminalBlock, liveEnd: number): LineRange {
  const endExclusive = Math.max(block.start, block.endExclusive ?? liveEnd);
  return { start: block.start, endExclusive };
}

/**
 * The lines a fold hides: the output only, never the prompt and the command —
 * a folded block must still say what it ran. Null when there is nothing to
 * hide (the command produced no output yet, or never started).
 */
export function foldedRange(block: TerminalBlock, liveEnd: number): LineRange | null {
  if (block.outputStart === null) return null;
  const { endExclusive } = blockRange(block, liveEnd);
  if (endExclusive <= block.outputStart) return null;
  return { start: block.outputStart, endExclusive };
}

/**
 * Clip a range of absolute buffer lines to the viewport.
 *
 * `viewportY` is the absolute line drawn on the pane's first row
 * (`buffer.viewportY`). Returns the first *viewport* row and how many rows,
 * or null when the range is entirely off screen. A range that starts above
 * the viewport is clipped, not dropped — that is what keeps a fold covering
 * its output while the user scrolls through it.
 */
export function clipToViewport(range: LineRange, viewportY: number, rows: number): { row: number; count: number } | null {
  const top = Math.max(range.start, viewportY);
  const bottom = Math.min(range.endExclusive, viewportY + rows);
  if (bottom <= top) return null;
  return { row: top - viewportY, count: bottom - top };
}

/**
 * The blank row a block is separated from the previous one by, if any.
 *
 * - `above` — the row *before* the block's first line, which is where
 *   `terminal.blockSpacing = normal` makes the shell integration print one
 *   (`shell_init.rs`). It belongs to no block at all.
 * - `first` — the block's own first row, which is what a prompt that opens on
 *   a newline of its own (oh-my-posh, starship's `add_newline`) produces: the
 *   `OSC 133;A` lands before the newline, so the blank row is inside the
 *   block. The shell integration deliberately adds nothing in that case, to
 *   avoid two blank rows where the user asked for one.
 * - `null` — the prompt follows the output immediately (`compact`, or a shell
 *   without the spacing line).
 */
export type BlockSpacingRow = 'above' | 'first' | null;

/**
 * Where a block's opening hairline goes, as an offset in *rows* from the top
 * of the block's first line.
 *
 * A real blank line is the only way to get vertical air in a grid where every
 * row is exactly one row tall, and when there is one the rule belongs in the
 * *middle* of it: the boundary then has half a row of padding above and half
 * below, instead of a hairline glued to one of the two blocks. The block's
 * action bar is centred on the same offset and therefore lands in that blank
 * row, over nothing anyone wrote.
 *
 * `0` — the block's own top edge — when there is no such row, which is what
 * `compact` gives and what CortX has always drawn.
 */
export function dividerOffsetRows(spacing: BlockSpacingRow): number {
  if (spacing === 'above') return -0.5;
  if (spacing === 'first') return 0.5;
  return 0;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Prompt-to-prompt navigation, from a line rather than from a "current
 * block": after a jump the caller scrolls the block's first line to the top of
 * the viewport, so the anchor of the next jump is that same line and stepping
 * is stable in both directions. With no block selected the anchor is simply
 * the top of the viewport, so the first Ctrl+↑ lands on the prompt just above
 * what is on screen.
 *
 * `blocks` must be sorted by `start` (they are: they are appended in the order
 * the shell announces them, and markers shift together).
 */
export function blockBefore(blocks: readonly TerminalBlock[], line: number): TerminalBlock | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].start < line) return blocks[i];
  }
  return null;
}

export function blockAfter(blocks: readonly TerminalBlock[], line: number): TerminalBlock | null {
  for (const block of blocks) {
    if (block.start > line) return block;
  }
  return null;
}

export function navigateBlocks(
  blocks: readonly TerminalBlock[],
  anchorLine: number,
  direction: 'previous' | 'next'
): TerminalBlock | null {
  return direction === 'previous' ? blockBefore(blocks, anchorLine) : blockAfter(blocks, anchorLine);
}

/** The block a buffer line belongs to (the last one that starts at or above it). */
export function blockAtLine(blocks: readonly TerminalBlock[], line: number, liveEnd: number): TerminalBlock | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const range = blockRange(blocks[i], liveEnd);
    if (line >= range.start && line < range.endExclusive) return blocks[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** One buffer row as the controller reads it out of xterm. */
export interface BufferRowText {
  /** The row's text, *untrimmed* (a wrapped row's trailing spaces matter). */
  text: string;
  /** xterm's `isWrapped`: this row continues the one above it. */
  wrapped: boolean;
}

/**
 * Turn buffer rows back into text: rows flagged `wrapped` are glued to the
 * previous one (a 300-character command must come back as one line, not as
 * three), and every logical line is right-trimmed. The trailing blank lines a
 * grid always has are dropped.
 */
export function joinBufferRows(rows: readonly BufferRowText[]): string {
  const lines: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (i > 0 && row.wrapped && lines.length > 0) lines[lines.length - 1] += row.text;
    else lines.push(row.text);
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.map((l) => l.replace(/\s+$/, '')).join('\n');
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * sRGB relative luminance of a CSS colour, or null when it cannot be read.
 *
 * Only the two notations a terminal palette ever uses are accepted — `#rgb`,
 * `#rgba`, `#rrggbb`, `#rrggbbaa` and `rgb()` / `rgba()`. A named colour or a
 * gradient comes back null and the caller falls back rather than guessing.
 */
export function colorLuminance(color: string | null | undefined): number | null {
  if (!color) return null;
  const value = color.trim().toLowerCase();
  let channels: number[] | null = null;

  const hex = /^#([0-9a-f]+)$/.exec(value);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      channels = [0, 1, 2].map((i) => Number.parseInt(digits[i] + digits[i], 16));
    } else if (digits.length === 6 || digits.length === 8) {
      channels = [0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16));
    }
  } else {
    const fn = /^rgba?\(([^)]+)\)$/.exec(value);
    if (fn) {
      const parts = fn[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((p) => (p.endsWith('%') ? (Number.parseFloat(p) * 255) / 100 : Number.parseFloat(p)));
      if (parts.length === 3) channels = parts;
    }
  }
  if (!channels || channels.some((c) => !Number.isFinite(c))) return null;

  const linear = (c: number) => {
    const s = Math.min(255, Math.max(0, c)) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channels;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * Is the terminal drawing light text on a dark ground?
 *
 * This is what decides whether the block hairline is a *white* wash or a
 * *black* one — the only two colours that stay hue-neutral whatever the theme
 * puts behind them. It is answered from the palette's own background, and
 * failing that from its foreground (a theme that only sets one of the two);
 * dark is the assumption of last resort, because that is what a terminal is.
 *
 * The threshold is a relative luminance of 0.2, which is sRGB 50 % grey.
 */
export function terminalIsDark(background?: string | null, foreground?: string | null): boolean {
  const bg = colorLuminance(background);
  if (bg !== null) return bg < 0.2;
  const fg = colorLuminance(foreground);
  if (fg !== null) return fg >= 0.2;
  return true;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Short human status of a block, for the gutter tooltip and the menu header. */
export function blockStatusLabel(block: TerminalBlock): string {
  switch (block.status) {
    case 'prompt':
      return 'Prompt';
    case 'running':
      return 'Running';
    default:
      if (block.exitCode === null) return 'Finished';
      return block.exitCode === 0 ? 'Succeeded' : `Failed · exit ${block.exitCode}`;
  }
}

/** `true` when the block finished with a non-zero exit code. */
export function blockFailed(block: TerminalBlock): boolean {
  return block.status === 'done' && block.exitCode !== null && block.exitCode !== 0;
}

/** One line of a command, for a menu label. Long commands are elided. */
export function shortCommand(command: string | null, max = 48): string {
  if (!command) return '';
  const oneLine = command.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/** `12 lines hidden`, for the fold cover. */
export function foldLabel(count: number): string {
  return count === 1 ? '1 line hidden' : `${count} lines hidden`;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Everything a block can be asked to do. The list is deliberately the *same*
 * in the hover toolbar and in the menu — `primary` only decides which of them
 * get an icon of their own on the bar and which live behind its `⋯`, so an
 * action can never exist in one surface and be missing from the other.
 */
export type BlockActionId =
  | 'copyCommand'
  | 'copyOutput'
  | 'copyBlock'
  | 'copyMarkdown'
  | 'rerun'
  | 'reinput'
  | 'fold'
  | 'selectText'
  | 'scrollTop'
  | 'scrollBottom';

/** What the controller knows about a block when it builds the action list. */
export interface BlockActionContext {
  block: TerminalBlock;
  /** A command can be read back (the shell sent one, or it is on the grid). */
  hasCommand: boolean;
  /** Output lines the fold hides, or would hide. 0 = the command printed nothing. */
  hiddenLines: number;
  /** The shell is at a prompt — nothing of ours is running in it. */
  atPrompt: boolean;
  /** The universal input editor owns the prompt line (ticket #15, U1). */
  inputEditor: boolean;
}

export interface BlockActionSpec {
  id: BlockActionId;
  label: string;
  /** Right-hand hint in the menu, second line of the toolbar's tooltip. */
  hint?: string;
  disabled: boolean;
  /** Gets its own button on the hover toolbar; the rest are behind the `⋯`. */
  primary: boolean;
  /** A separator is drawn above this entry in the menu. */
  separated?: boolean;
}

/**
 * The actions of one block, in the order they are shown. Nothing is ever
 * dropped from the list — an action that cannot run right now comes back
 * `disabled` with a hint saying why, so the menu never changes shape under
 * the pointer while output is still arriving.
 */
export function blockActions(ctx: BlockActionContext): BlockActionSpec[] {
  const { block, hasCommand, hiddenLines, atPrompt, inputEditor } = ctx;
  const hasOutput = hiddenLines > 0;
  const empty = !hasCommand && !hasOutput;
  const busy = !atPrompt;
  // "Put back at the prompt" types into the shell's own line editor. With the
  // universal input editor on, the line the shell holds and the line CortX
  // shows are two different things — so that one is refused rather than
  // desynchronising them. Re-running is unaffected: it submits immediately.
  const typeHint = busy ? 'busy' : inputEditor ? 'input editor' : undefined;
  return [
    { id: 'copyCommand', label: 'Copy command', disabled: !hasCommand, primary: true },
    { id: 'copyOutput', label: 'Copy output', disabled: !hasOutput, primary: true },
    {
      id: 'copyBlock',
      label: 'Copy command and output',
      hint: 'Ctrl Shift C',
      disabled: empty,
      primary: true,
    },
    { id: 'copyMarkdown', label: 'Copy as Markdown', disabled: empty, primary: false },
    {
      id: 'rerun',
      label: 'Run again',
      separated: true,
      hint: busy ? 'busy' : undefined,
      disabled: busy || !hasCommand,
      primary: true,
    },
    {
      id: 'reinput',
      label: 'Put back at the prompt',
      hint: typeHint,
      disabled: busy || inputEditor || !hasCommand,
      primary: false,
    },
    {
      id: 'fold',
      label: block.folded ? 'Unfold output' : 'Fold output',
      separated: true,
      hint: hasOutput ? foldLabel(hiddenLines) : undefined,
      disabled: !hasOutput,
      primary: true,
    },
    { id: 'selectText', label: 'Select block', disabled: false, primary: false },
    // Warp's `terminal:scroll_to_top_of_selected_block` /
    // `…_bottom_of_selected_block`, which is how you get back to the command
    // that produced a screenful of output — and back down to its end.
    { id: 'scrollTop', label: 'Scroll to top of block', separated: true, disabled: false, primary: false },
    { id: 'scrollBottom', label: 'Scroll to bottom of block', disabled: !hasOutput, primary: false },
  ];
}

/**
 * How wide the hover toolbar will be, in px, for `buttons` buttons — worked
 * out from the CSS rather than measured, so the controller can decide *where*
 * the bar goes before it exists and never has to lay one out to find out it
 * does not fit. Must track `.cortx-blocks-actions` in `terminal-window.css`:
 * 22 px buttons, a 1 px gap, 3 px of padding either side and a 1 px border.
 */
export function blockToolbarWidth(buttons: number): number {
  if (buttons <= 0) return 0;
  return buttons * 22 + (buttons - 1) + 6 + 2;
}

/** The longest run of backticks in `text` (so a fence can always contain it). */
function longestBacktickRun(text: string): number {
  let longest = 0;
  let run = 0;
  for (const ch of text) {
    run = ch === '`' ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return longest;
}

/**
 * A block as a Markdown fenced `console` transcript — the shape you want when
 * a command and what it printed go into a ticket, a commit message or a chat.
 * The command is prefixed `$ ` (continuation lines `> `), the exit code is
 * only mentioned when it is not zero, and the fence grows past any backticks
 * the output itself contains.
 */
export function blockMarkdown(command: string, output: string, exitCode: number | null): string {
  const cmd = command.replace(/\s+$/, '');
  const out = output.replace(/\s+$/, '');
  const lines: string[] = [];
  if (cmd) lines.push(cmd.split('\n').map((line, i) => `${i === 0 ? '$' : '>'} ${line}`).join('\n'));
  if (out) lines.push(out);
  if (exitCode !== null && exitCode !== 0) lines.push(`# exit ${exitCode}`);
  if (lines.length === 0) return '';
  const body = lines.join('\n');
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(body) + 1));
  return `${fence}console\n${body}\n${fence}`;
}
