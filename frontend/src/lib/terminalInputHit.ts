/**
 * Universal input editor — where a click lands (ticket #15, U1).
 *
 * ## The bug this exists for
 *
 * The editor's `<textarea>` is laid over the row the prompt is on, but the
 * prompt's own columns are held by a first-line indent (`place()`), so a
 * click on the shell's PS1 lands on the box without landing on any character.
 * Everything else on the block — the frame, the few pixels of padding above
 * and below the row — belonged to `.cortx-uinput`, which is
 * `pointer-events: none`, so a click there went straight through to xterm's
 * canvas and did nothing at all.
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

/**
 * The caret offset for a point on the text box: `x` px from its left edge,
 * `y` px from its top, `lineHeight` px per visual line.
 *
 * `measure(i)` returns where the caret sits at offset `i` — `left` from the
 * box's left edge, `top` from its top. Text flows left to right then down, so
 * the pair is non-decreasing in `i`: a binary search still works, O(log n) in
 * the length of the line, as long as it compares the visual line first and
 * the column only within it.
 *
 * Why the line cannot be a filter applied afterwards: once the text wraps,
 * one `x` matches one offset *per line*, so a search on `x` alone lands on
 * whichever of them the binary split happened to reach.
 *
 * It is called with `y = 0` and a flat `top` for a line that has not wrapped,
 * which is the case it used to be written for (`caretOffsetAt`, removed when
 * the box stopped scrolling sideways).
 */
export function caretOffsetAtPoint(
  text: string,
  x: number,
  y: number,
  lineHeight: number,
  measure: (index: number) => { left: number; top: number }
): number {
  if (!text) return 0;
  const end = text.length;
  const h = lineHeight > 0 ? lineHeight : 1;
  const lineOf = (top: number) => Math.round(top / h);
  const target = Math.floor(y / h);
  // True while offset `i` is still before the point, reading the line first.
  const before = (i: number) => {
    const p = measure(i);
    const line = lineOf(p.top);
    return line === target ? p.left <= x : line < target;
  };
  // Above, or left of, the very first glyph.
  if (!before(0)) return 0;

  let lo = 0;
  let hi = end;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (before(mid)) lo = mid;
    else hi = mid - 1;
  }
  if (lo >= end) return end;
  // Nearest character edge, but only against a neighbour on the same line: at
  // a wrap the next offset is a whole line away and is never "half a glyph".
  const a = measure(lo);
  const b = measure(lo + 1);
  const same = lineOf(a.top) === lineOf(b.top);
  const offset = same && b.left > a.left && x - a.left > (b.left - a.left) / 2 ? lo + 1 : lo;
  return alignToCodePoint(text, offset);
}
