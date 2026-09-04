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
