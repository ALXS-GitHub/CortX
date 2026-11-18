/**
 * Was a press in the terminal a selection the user *meant* to make?
 *
 * xterm.js has no drag threshold: any `mousemove` between the press and the
 * release moves the end of the selection, and its coordinates round to the
 * nearest cell *edge* (the left half of a cell selects up to that cell, the
 * right half up to the next one). So a click whose pointer slips by a pixel
 * or two across the middle of a cell selects one character, and a slip across
 * a row edge selects the end of one line and the start of the next. That
 * happens all the time with a trackpad, and above all on the click that
 * brings CortX back to the front: the pointer is still travelling when the
 * button goes down.
 *
 * With copy on select, that accidental selection went straight to the
 * clipboard — over whatever had just been copied in the other app, to be
 * pasted here. Ticket #52 already skipped presses that leave the selection
 * as it was; this is the other half: a selection the press *did* change, but
 * only because the pointer jittered.
 *
 * A press counts as deliberate when it is:
 * - a double or triple click (a word, a line — nothing to drag);
 * - a Shift+click (xterm extends the existing selection without any move);
 * - a drag past `DRAG_THRESHOLD_PX` from where the button went down. Same
 *   idea as the OS drag thresholds (4 px on Windows, a few points on macOS);
 *   one character is ~8 px wide, so selecting a single character by hand
 *   still clears it.
 *
 * Pure on purpose (no store, no DOM): `mouseSelection.test.ts` pins it down.
 */

/** How far (CSS px) the pointer must travel for a single press to be a drag. */
export const DRAG_THRESHOLD_PX = 5;

/** What the `mousedown` that started the press looked like. */
export interface PressStart {
  x: number;
  y: number;
  /** `MouseEvent.detail`: 1 for a click, 2 for a double click, 3 for a triple. */
  clicks: number;
  shiftKey: boolean;
}

export function isDeliberateSelection(down: PressStart, upX: number, upY: number): boolean {
  if (down.clicks >= 2 || down.shiftKey) return true;
  return Math.hypot(upX - down.x, upY - down.y) >= DRAG_THRESHOLD_PX;
}
