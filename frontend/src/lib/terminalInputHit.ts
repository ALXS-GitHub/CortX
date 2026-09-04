/**
 * Universal input editor — where a click lands (ticket #15, U1).
 *
 * ## The bug this exists for
 *
 * The editor's `<textarea>` is laid over the row the prompt is on, but only
 * over **the columns after the prompt** (`place()` puts its left edge on
 * `anchor.x * cellWidth`, so what is typed lands where the shell would have
 * echoed it). Everything else on the block — the frame, the shell's own PS1
 * inside it, the few pixels of padding above and below the row — belonged to
 * `.cortx-uinput`, which is `pointer-events: none`, so a click there went
 * straight through to xterm's canvas and did nothing at all.
 *
 * That is why "I still cannot place my cursor in the prompt": the only part of
 * the block that ever accepted the mouse was the part *after* the prompt. The
 * fix gives the whole block a hit layer (`.cortx-uinput-hit`) and maps the
 * point to a caret offset with the function below.
 *
 * ## Why it measures instead of dividing by the cell width
 *
 * The grid places column *n* at `n × cellWidth`; a DOM text run advances by
 * the font's own metrics and may ligate. `terminalSuggest.paint()` fights the
 * same drift for its ghost text. So the offset is found by *measuring the very
 * element the caret is drawn on* — same font, same `letter-spacing`, same
 * `tab-size` — through the `measure` callback. A tab, an accent, a
 * double-width glyph or an emoji therefore all land where the browser itself
 * would have put the caret, and the caret ends up exactly under the pointer by
 * construction rather than by arithmetic.
 *
 * Pure on purpose (`measure` is the only door to the DOM), so the search is
 * testable on plain Node like the state machine next to it.
 */

/**
 * The caret offset for a point `x` (px from the start of the text, scrolling
 * already added in).
 *
 * `measure(i)` must return the advance width of `text.slice(0, i)`. It is
 * called O(log n) times — a binary search, not a scan — because every call
 * costs a synchronous layout.
 *
 * The offset returned is the *nearest* character edge, the way every text
 * field behaves: clicking on the left half of a glyph puts the caret before
 * it, on the right half after it. It never splits a surrogate pair.
 */
export function caretOffsetAt(text: string, x: number, measure: (index: number) => number): number {
  if (!text) return 0;
  if (!(x > 0)) return 0;
  const end = text.length;
  // Past the last glyph: the end of the line, whatever the empty space to the
  // right of it is worth.
  if (x >= measure(end)) return end;

  // Largest `lo` whose advance is still left of the pointer.
  let lo = 0;
  let hi = end;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(mid) <= x) lo = mid;
    else hi = mid - 1;
  }
  const left = measure(lo);
  const right = lo < end ? measure(lo + 1) : left;
  const offset = right > left && x - left > (right - left) / 2 ? lo + 1 : lo;
  return alignToCodePoint(text, offset);
}

/**
 * Nudge an index off the middle of a surrogate pair.
 *
 * `setSelectionRange` counts UTF-16 code units, so an index between the two
 * halves of an emoji is a legal number that produces an illegal caret: the
 * next keystroke would cut the character in half.
 */
export function alignToCodePoint(text: string, index: number): number {
  const clamped = Math.max(0, Math.min(index, text.length));
  if (clamped <= 0 || clamped >= text.length) return clamped;
  const code = text.charCodeAt(clamped);
  // A *low* surrogate here means the pair started at `clamped - 1`.
  return code >= 0xdc00 && code <= 0xdfff ? clamped - 1 : clamped;
}
