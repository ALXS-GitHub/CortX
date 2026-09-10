/**
 * Folding the project sections of the sessions rail (ticket #40).
 *
 * Everything here is a pure decision, deliberately with **no imports at all**:
 * the two questions folding raises are answered by functions a test can run on
 * plain Node (`sectionFold.test.ts`), not by reading a store or a DOM.
 *
 * The two questions:
 *
 * 1. **When must a folded section open itself again?** A fold hides rows; the
 *    tab you are *on* must never be one of them as a result of your own
 *    navigation. So every time the current tab changes — Ctrl+N, the palette,
 *    Ctrl+Tab, `cortx terminal --project`, a new terminal — the section it
 *    lands in unfolds (`groupToReveal`). Folding the section you are already
 *    in stays allowed and stays folded: that one is a deliberate act, and the
 *    header says so by wearing the current-row plate.
 *
 * 2. **What does a folded header still have to say?** Once the rows are gone
 *    the count is the only thing left, so anything that was asking for you
 *    inside must survive the fold. `foldSignalRank` ranks a tab's live state
 *    the way `TerminalStatusGlyph` reads it — the glyph and the rank must
 *    agree, or the header would draw a spinner because a *different* tab had
 *    failed — and `loudestLive` picks the tab whose glyph the header borrows.
 *
 * The fold state itself is a set of workspace ids, kept per Terminal window
 * (see `useRailFoldStore` in `SessionRail.tsx`). Ids, not indices: a fold
 * survives a reorder, a close, and a restart, and an id that no longer exists
 * simply never matches.
 */

/** The tab the window is on, and the section that holds it. */
export interface ActiveTabRef {
  tabId: string;
  workspaceId: string;
}

export function isFolded(folded: readonly string[], workspaceId: string): boolean {
  return folded.includes(workspaceId);
}

export function foldSection(folded: readonly string[], workspaceId: string): string[] {
  return isFolded(folded, workspaceId) ? folded.slice() : [...folded, workspaceId];
}

export function unfoldSection(folded: readonly string[], workspaceId: string): string[] {
  return folded.filter((id) => id !== workspaceId);
}

export function toggleSection(folded: readonly string[], workspaceId: string): string[] {
  return isFolded(folded, workspaceId) ? unfoldSection(folded, workspaceId) : foldSection(folded, workspaceId);
}

/**
 * The section to unfold because the current tab just moved into it, or `null`.
 *
 * `previous === undefined` means "the rail has not looked yet" — the first
 * render after a boot. Nothing is revealed then, on purpose: the state you
 * boot into is the state you left, and a reveal here would quietly undo the
 * fold the user saved last session. `previous === null` is different (there
 * *was* no current tab, and now there is one), and does reveal.
 *
 * The comparison is on the pair, not on the tab id alone, so a tab moved into
 * a folded section — the tab menu can change a tab's project — reveals it too.
 */
export function groupToReveal(
  previous: ActiveTabRef | null | undefined,
  current: ActiveTabRef | null,
  folded: readonly string[]
): string | null {
  if (previous === undefined) return null;
  if (!current) return null;
  if (previous && previous.tabId === current.tabId && previous.workspaceId === current.workspaceId) return null;
  return isFolded(folded, current.workspaceId) ? current.workspaceId : null;
}

/**
 * The part of a tab's live state a folded header can borrow. Structural on
 * purpose: `TabLiveState` (`model.ts`) satisfies it, and this file stays
 * import-free.
 */
export interface FoldSignalLive {
  running: boolean;
  agent?: { state: string };
  attention?: { exitCode?: number | null };
}

/**
 * How loudly a tab is asking for you, 0 meaning "nothing a header should say".
 *
 * The order is `TerminalStatusGlyph`'s own — agent first, then a running
 * command, then a command that finished out of view — so the rank and the
 * glyph can never describe two different things. An agent that is stopped or
 * whose state is unknown ranks 0: its row draws a faint dot, and a faint dot
 * on a section header is noise.
 */
export function foldSignalRank(live: FoldSignalLive): number {
  if (live.agent) {
    if (live.agent.state === 'waiting') return 5;
    if (live.agent.state === 'running') return 3;
    return 0;
  }
  if (live.running) return 2;
  const exitCode = live.attention?.exitCode;
  if (live.attention) return exitCode == null || exitCode === 0 ? 1 : 4;
  return 0;
}

/**
 * The tab whose glyph a folded header shows: the loudest, first one wins a
 * tie so the header follows the rail's order rather than jumping about.
 * `null` when the section has nothing to report.
 */
export function loudestLive<T extends FoldSignalLive>(list: readonly T[]): T | null {
  let best: T | null = null;
  let bestRank = 0;
  for (const live of list) {
    const rank = foldSignalRank(live);
    if (rank > bestRank) {
      best = live;
      bestRank = rank;
    }
  }
  return best;
}
