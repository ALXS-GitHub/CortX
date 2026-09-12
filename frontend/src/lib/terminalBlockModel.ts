/**
 * Command blocks — the pure half (DEV-13 P4, ticket #7).
 *
 * A *block* is one command and its output, delimited by the OSC 133 markers
 * `cortx init` already makes the shell emit: `A` prompt start, `B` prompt end,
 * `C;cmd=<base64>` command start, `D;<exit>` command end. CortX keeps the
 * classic terminal rendering — the grid is still xterm's, byte for byte — and
 * only ever *draws over* it, so everything here is geometry: which absolute
 * buffer lines a block covers, which block a keystroke should jump to, how a
 * *range* of selected blocks is framed and copied, whether a block spills past
 * the edges of the viewport (which is what decides the background plate, the
 * sticky header and the jump-to-bottom button), and how to turn a range of
 * buffer rows back into text.
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
export function dividerOffsetRows(spacing: BlockSpacingRow, blankRows = 1): number {
  // Centred in the *whole* run of blank rows, not half a row up. With
  // `comfortable` the shell leaves two of them, and a rule half a row above
  // the prompt puts a row and a half of air under the output and half a row
  // over the prompt — visibly bottom-heavy. Half the run puts the boundary in
  // the middle whatever the spacing setting is.
  if (spacing === 'above') return -Math.max(1, blankRows) / 2;
  if (spacing === 'first') return 0.5;
  return 0;
}

/**
 * `terminal.blockSpacing`, mirrored here rather than imported: this module has
 * no imports at all, which is what lets its tests run on plain Node.
 */
export type BlockSpacingSetting = 'normal' | 'compact' | 'comfortable';

/**
 * The most blank rows above a prompt that can possibly be *spacing* rather
 * than output, for a given `terminal.blockSpacing`.
 *
 * This is the ceiling that stops the divider from floating away (ticket #15).
 * The rule is centred in the run of blank rows above a prompt, and the run was
 * counted straight off the buffer up to four rows deep — so a command that
 * ends on blank lines (`npm run build`, `cargo test`, near enough everything)
 * had its *output* counted as spacing and the rule ended up two rows above the
 * boundary it is supposed to mark, in the middle of the previous block.
 *
 * The shell integration prints a known number of rows (`shell_init.rs`), so
 * that number is the ceiling: anything past it is output, whatever it looks
 * like. `compact` prints none, which is why it answers `0` — a blank row above
 * a prompt there belongs to the command that just finished.
 *
 * An unset setting answers the largest value rather than the current default:
 * the buffer is still the source of truth for how many rows are *actually*
 * there, and this only ever caps it.
 */
export function spacingRowMax(spacing: BlockSpacingSetting | undefined): number {
  if (spacing === 'compact') return 0;
  if (spacing === 'normal') return 1;
  return MAX_SPACING_ROWS;
}

/** The most spacing rows any setting asks for (`comfortable`). */
export const MAX_SPACING_ROWS = 2;

/**
 * How many blank rows immediately above `start` count as the gap between two
 * blocks, given `isBlank` for an absolute buffer line.
 *
 * Never more than `max` (see `spacingRowMax`) and never less than one — the
 * caller only asks once it knows there is a blank row up there. Reading the
 * buffer rather than the setting is deliberate: a prompt of the user's own
 * that opens on a new line, or a session started before the setting changed,
 * both get the layout they actually have. The cap is what keeps that from
 * swallowing the tail of the previous command's output.
 */
export function spacingRowsAbove(
  start: number,
  isBlank: (line: number) => boolean,
  max = MAX_SPACING_ROWS
): number {
  let n = 0;
  while (n < max && start - 1 - n >= 0 && isBlank(start - 1 - n)) n += 1;
  return Math.max(1, n);
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
// Selection
// ---------------------------------------------------------------------------

/**
 * The ids of every block from `anchorId` to `targetId` inclusive, in buffer
 * order — the set `Shift + click` and `Shift + Ctrl + arrow` extend to.
 *
 * Warp keeps a `SelectedBlocks` made of *ranges* plus a `tail` (the anchor the
 * keyboard extends from). CortX's blocks are a single sorted list, so a range
 * is two indices into it and this is all the arithmetic there is; the
 * controller keeps the anchor and the resulting id set.
 *
 * Either id being unknown (its block was trimmed out of the scrollback while
 * the selection was live) gives an empty list rather than a guess: the caller
 * then falls back to selecting the block that was actually clicked.
 */
export function blockIdsBetween(
  blocks: readonly TerminalBlock[],
  anchorId: number,
  targetId: number
): number[] {
  const from = blocks.findIndex((b) => b.id === anchorId);
  const to = blocks.findIndex((b) => b.id === targetId);
  if (from < 0 || to < 0) return [];
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(blocks[i].id);
  return out;
}

/**
 * Which of a selected block's four edges get a lid.
 *
 * Warp's `compute_border_info`: a run of selected blocks is bordered left and
 * right all the way down, but only gets a *top* edge where the run opens and a
 * *bottom* edge where it closes, so three selected blocks read as one framed
 * object instead of three stacked boxes.
 *
 * The viewport is the second half of the rule: an edge is only drawn where the
 * block's own boundary is really on screen. A selection scrolled through must
 * not grow a lid at the top of the pane — that would draw a line where there
 * is no boundary.
 */
export function selectionEdges(
  blocks: readonly TerminalBlock[],
  index: number,
  isSelected: (id: number) => boolean,
  range: LineRange,
  viewportY: number,
  rows: number
): { top: boolean; bottom: boolean } {
  const above = blocks[index - 1];
  const below = blocks[index + 1];
  const opensRun = !above || !isSelected(above.id);
  const closesRun = !below || !isSelected(below.id);
  return {
    top: opensRun && range.start >= viewportY,
    bottom: closesRun && range.endExclusive <= viewportY + rows,
  };
}

/**
 * Several blocks' text, in buffer order, as one clipboard payload: a blank
 * line between two blocks, and nothing at all for a block that is empty.
 *
 * A blank line is the separator because that is what the blocks look like on
 * the pane (`terminal.blockSpacing` prints exactly one), so what is pasted is
 * what was read.
 */
export function joinBlockTexts(parts: readonly string[]): string {
  return parts.map((p) => p.replace(/\s+$/, '')).filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// Viewport furniture: the card plate, the sticky header, the jump button
// ---------------------------------------------------------------------------

/** Does a block reach past the top / bottom edge of the viewport? */
export interface BlockOverflow {
  above: boolean;
  below: boolean;
}

export function blockOverflow(range: LineRange, viewportY: number, rows: number): BlockOverflow {
  return {
    above: range.start < viewportY,
    below: range.endExclusive > viewportY + rows,
  };
}

/**
 * The air a block's background plate keeps at its top and bottom edge, in px,
 * so two cards never fuse into one slab (`terminal.blockCards`).
 */
export const BLOCK_CARD_GAP = 3;

export interface BlockCardRect {
  /** Top of the plate, in px from the top of the session container. */
  top: number;
  height: number;
  /** The block's own top / bottom edge is on screen: round that corner. */
  roundTop: boolean;
  roundBottom: boolean;
}

/**
 * How far a card reaches past the block's own lines, in *rows*, so that its
 * two edges land on the hairlines that bracket the block rather than on the
 * block's first and last buffer line.
 *
 * `top` is the offset of the block's own divider (`dividerOffsetRows`) and
 * `bottom` the offset of the next block's — both signed, both fractional,
 * both zero when there is no blank row to share or no block below.
 */
export interface BlockCardBleed {
  top: number;
  bottom: number;
}

const NO_BLEED: BlockCardBleed = { top: 0, bottom: 0 };

/**
 * Where a block's background plate goes — the "card" look, and the one thing
 * on this layer that is drawn *under* the grid rather than over it (the
 * Terminal window's xterm canvas is transparent; the dock's is not).
 *
 * The plate spans the block **as the eye reads it**: from the hairline that
 * opens it to the one that opens the block below, minus `gap` px at each end.
 * That is not the same as the block's own lines — with `terminal.blockSpacing`
 * at `normal` or `comfortable` the shell leaves blank rows above each prompt
 * and the rule is centred in them (`dividerOffsetRows`), so a plate stopping
 * at the buffer lines left a whole unpainted row inside what the dividers
 * announce as one block. `bleed` is that difference, and it is the caller's
 * job to pass the very offsets it draws the rules at, so the plate's edge and
 * the hairline are the same line.
 *
 * A block clipped by the viewport keeps its cut edge square and flush:
 * rounding a corner that is only there because the pane ran out of room would
 * draw a card boundary where the block does not end.
 */
export function blockCardRect(
  range: LineRange,
  viewportY: number,
  rows: number,
  metrics: { cell: number; top: number },
  bleed: BlockCardBleed = NO_BLEED,
  gap = BLOCK_CARD_GAP
): BlockCardRect | null {
  // Fractional absolute lines: half a row is exactly what a centred divider
  // asks for, so the clipping is done here rather than through
  // `clipToViewport`, which counts whole rows.
  const start = range.start + bleed.top;
  const end = range.endExclusive + bleed.bottom;
  const visibleTop = Math.max(start, viewportY);
  const visibleBottom = Math.min(end, viewportY + rows);
  if (visibleBottom <= visibleTop) return null;
  const above = start < viewportY;
  const below = end > viewportY + rows;
  const top = metrics.top + (visibleTop - viewportY) * metrics.cell + (above ? 0 : gap);
  const bottom = metrics.top + (visibleBottom - viewportY) * metrics.cell - (below ? 0 : gap);
  if (bottom - top < 1) return null;
  return {
    top,
    height: bottom - top,
    roundTop: !above,
    roundBottom: !below,
  };
}

/**
 * The most of the pane the sticky header may take before it is simply not
 * drawn — Warp's `SNACKBAR_HEADER_MAX_RATIO`. A header is meant to say what
 * you are reading; one that eats a quarter of a short pane *is* what you are
 * reading.
 */
export const STICKY_HEADER_MAX_RATIO = 0.25;

export interface StickyHeaderInput {
  block: TerminalBlock;
  range: LineRange;
  viewportY: number;
  rows: number;
  /** Height of the header itself, in px. */
  headerHeight: number;
  /** Height of one grid row, in px. */
  cell: number;
  /** Height of the whole grid, in px. */
  paneHeight: number;
}

/**
 * Should the block that owns the top of the viewport be named by a header
 * pinned there? (Warp calls it the *snackbar*.)
 *
 * The rules are Warp's, in the order they rule things out:
 *
 * 1. the block must actually have *run* something. A bare prompt has no
 *    command to name, and a block that is still running is Warp's
 *    `should_hide_snackbar_during_long_running_command` — output arriving
 *    under a header that names it is noise, and the command is about to come
 *    back into view at the bottom anyway;
 * 2. the block's own command row must be **off the top of the pane**. While it
 *    is on screen the header would merely repeat the row underneath it;
 * 3. what is left of the block on screen must be at least as tall as the
 *    header. Otherwise the header covers the whole of the thing it describes;
 * 4. and the header must not take more than `STICKY_HEADER_MAX_RATIO` of the
 *    pane.
 *
 * There is no rule 5 about *hover*: unlike the action toolbar, this is not a
 * control that appears where the pointer is — it answers "what am I looking
 * at", which is a question you have while scrolling with no pointer at all.
 */
export function stickyHeaderVisible(input: StickyHeaderInput): boolean {
  const { block, range, viewportY, rows, headerHeight, cell, paneHeight } = input;
  if (block.status !== 'done') return false;
  const overflow = blockOverflow(range, viewportY, rows);
  if (!overflow.above) return false;
  const clip = clipToViewport(range, viewportY, rows);
  if (!clip || clip.count * cell < headerHeight) return false;
  if (paneHeight > 0 && headerHeight > paneHeight * STICKY_HEADER_MAX_RATIO) return false;
  return true;
}

/**
 * Should the companion "go to the end of this block" button be drawn?
 *
 * Warp's `appearance.blocks.show_jump_to_bottom_of_block_button`: "whether to
 * show the jump-to-bottom button in long command output". So: the block spills
 * past the bottom of the pane, and it is a block that ran something — a prompt
 * has no end worth jumping to. A *running* block does keep the button, unlike
 * the header: its end is exactly where a long build's progress is.
 */
export function jumpToBottomVisible(block: TerminalBlock, range: LineRange, viewportY: number, rows: number): boolean {
  if (block.status === 'prompt') return false;
  return blockOverflow(range, viewportY, rows).below;
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

/**
 * WCAG contrast ratio between two CSS colours, 1 (identical) to 21 (black on
 * white), or `null` when either colour cannot be read (a gradient, `oklch()`,
 * a named colour — see `colorLuminance`).
 */
export function contrastRatio(a: string | null | undefined, b: string | null | undefined): number | null {
  const la = colorLuminance(a);
  const lb = colorLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The least contrast an accent must have against the terminal's own background
 * before it may be used as the edge of a selected block.
 *
 * A 2 px border is a thin thing to read, so it needs real separation — but it
 * is decoration, not text, so the 3:1 of WCAG's non-text rule is stricter than
 * it has to be. 2.5 is the line drawn from the case that made this guard
 * necessary: `aespa_wda`'s accent is `#0c161f` on a `#713d39` ground, which
 * comes out at 2.11 and is invisible.
 */
export const ACCENT_EDGE_MIN_CONTRAST = 2.5;

/**
 * May the theme's accent be used as the edge of a selected block?
 *
 * `--accent` is otherwise banned in the Terminal window, and for a good reason
 * — an imported theme is free to make it a near-black. Warp draws the border
 * of a selected block in its accent, which is worth having, so the ban is
 * lifted *here only* and paid for with this guard: an accent that does not
 * separate from the pane's own background is refused and the caller falls back
 * to the neutral edge. An unreadable colour notation (a gradient accent,
 * `oklch()` from the classic skin) is refused for the same reason — we cannot
 * prove it is visible, so we do not bet on it.
 */
export function accentUsableAsEdge(accent: string | null | undefined, background: string | null | undefined): boolean {
  const ratio = contrastRatio(accent, background);
  return ratio !== null && ratio >= ACCENT_EDGE_MIN_CONTRAST;
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
