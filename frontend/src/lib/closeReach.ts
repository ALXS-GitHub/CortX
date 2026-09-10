/**
 * How far a bulk close reaches, in words (ticket #37).
 *
 * The integrated dock and the Terminal windows are two surfaces, and a bulk
 * action belongs to the one it was pressed in — but the Terminal windows are
 * *one* surface between them: "close all terminals" pressed in one of them
 * closes the others' terminals too. That is the rule the user asked for, and
 * it means a single click can take down shells in a window that is not even on
 * screen. So every such action has to say so **before** it runs: the menu
 * entry carries the reach under it, and the confirmation puts it in the
 * question.
 *
 * Pure on purpose (no store, no React, no DOM): the phrasing is the part worth
 * pinning down in a test, and `closeReach.test.ts` does exactly that.
 */

/** One Terminal window's share of what a close is about to take. */
export interface WindowShare {
  /** What the user calls that window: "Terminal", "Terminal 2"… */
  name: string;
  /** How many of the tabs being closed live there. */
  count: number;
}

/**
 * How many windows a reach is spelled out for before it is summarised. Two
 * names read fine; past that the list is longer than the question it qualifies.
 */
const NAMED_WINDOWS_MAX = 2;

/**
 * "3 in Terminal 2" — what a close takes from windows other than the one it
 * was pressed in, or `null` when it takes nothing from them.
 *
 * `shares` is expected in menu order (window 1 first); empty and zero-count
 * entries are ignored so callers can hand over a raw tally.
 */
export function describeCloseReach(shares: WindowShare[]): string | null {
  const named = shares.filter((w) => w.count > 0);
  if (named.length === 0) return null;
  if (named.length <= NAMED_WINDOWS_MAX) {
    return named.map((w) => `${w.count} in ${w.name}`).join(' and ');
  }
  const total = named.reduce((sum, w) => sum + w.count, 0);
  return `${total} in ${named.length} other Terminal windows`;
}

/**
 * The question a bulk close asks. `subject` is the sentence without its
 * question mark ("Close these 7 terminals"); the reach is appended to it, so a
 * close that stays in this window keeps the plain question it always had.
 *
 *     closeQuestion('Close these 7 terminals', [{ name: 'Terminal 2', count: 3 }])
 *     → 'Close these 7 terminals, including 3 in Terminal 2?'
 */
export function closeQuestion(subject: string, shares: WindowShare[]): string {
  const reach = describeCloseReach(shares);
  return reach ? `${subject}, including ${reach}?` : `${subject}?`;
}
