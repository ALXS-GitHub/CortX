/**
 * Walking a **frozen** most-recently-used order — the whole of what makes
 * `terminal.ctrlTabBehavior = 'recentlyUsed'` behave like Alt+Tab rather than
 * like a two-tab see-saw (issue 45b).
 *
 * The trap this module exists for: the recently-used order is recomputed
 * every time a tab becomes active, so a cycle that re-reads it on each press
 * walks a list that has just reordered itself under it. Press Ctrl+Tab twice
 * and you are back where you started — A, B, A, B — instead of reaching the
 * third tab back. Every window manager solves it the same way: the list is
 * **snapshotted when the modifier goes down**, walked while it is held, and
 * only committed when it comes up.
 *
 * So: `beginTabCycle` takes the snapshot, `advanceTabCycle` moves an index
 * inside it (and drops ids that died mid-cycle), `tabCycleTarget` reads the
 * tab it points at, and `finishTabCycle` says what the recently-used stack
 * must look like once the modifier is released — the snapshot as it was, with
 * the tab we landed on moved to the front. The tabs we merely passed through
 * keep their old places, which is what makes a *second* Ctrl+Tab go back to
 * where the first one started from.
 *
 * Nothing here touches a store, the DOM or the clock: the caller
 * (`components/terminal/actions.ts`) owns the state, this owns the arithmetic.
 */

/** A cycle in progress: the frozen order, and where in it we are. */
export interface TabCycleState {
  /** Tab ids, most recently used first, as they were when the cycle began. */
  readonly order: readonly string[];
  /** Index in `order` of the tab currently shown. Always in range. */
  readonly index: number;
}

/** `order` without repeats, keeping the first occurrence of each id. */
function unique(order: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of order) {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Take the snapshot. `order` is the recently-used order (current tab first),
 * `currentId` the tab on screen. Null when there is nothing to cycle through:
 * a single tab must leave the key alone rather than pretend to switch.
 *
 * The returned state points **at** the current tab; the first step is a
 * plain `advanceTabCycle`, so a press always moves.
 */
export function beginTabCycle(order: readonly string[], currentId: string | null): TabCycleState | null {
  const ids = unique(order);
  if (ids.length < 2) return null;
  const at = currentId ? ids.indexOf(currentId) : -1;
  return { order: ids, index: at === -1 ? 0 : at };
}

/**
 * Drop from the snapshot every id that is no longer available — a tab closed
 * mid-cycle, or a scope change that hid part of the list — and keep the index
 * pointing at the same place in what is left.
 *
 * Null when fewer than two survive: the cycle is over, whatever the modifier
 * is doing.
 */
export function pruneTabCycle(state: TabCycleState, alive: ReadonlySet<string>): TabCycleState | null {
  const order = state.order.filter((id) => alive.has(id));
  if (order.length === state.order.length) return state;
  if (order.length < 2) return null;
  const current = state.order[state.index];
  let index = order.indexOf(current);
  if (index === -1) {
    // The tab we were on is the one that went away: land where it was, i.e.
    // after everything that used to precede it and is still there.
    let before = 0;
    for (let i = 0; i < state.index; i++) if (alive.has(state.order[i])) before++;
    index = before % order.length;
  }
  return { order, index };
}

/**
 * One press: move `delta` steps through the snapshot, wrapping. `alive`, when
 * given, prunes first — so a tab closed under the cycle is skipped instead of
 * being switched to. Null when there is no longer a cycle to walk.
 */
export function advanceTabCycle(
  state: TabCycleState,
  delta: 1 | -1,
  alive?: ReadonlySet<string> | null
): TabCycleState | null {
  const pruned = alive ? pruneTabCycle(state, alive) : state;
  if (!pruned) return null;
  const n = pruned.order.length;
  return { order: pruned.order, index: (pruned.index + delta + n) % n };
}

/** The tab the cycle currently points at. */
export function tabCycleTarget(state: TabCycleState): string {
  return state.order[state.index];
}

/**
 * The recently-used order to keep once the modifier is released: the tab we
 * stopped on first, then the snapshot as it was, minus that tab.
 *
 * Deriving it from the *snapshot* rather than from the switches that happened
 * along the way is the point. Cycling A → C → B and stopping there must leave
 * `[B, A, C]` — B is where you are, A is what you came from — not `[B, C, A]`,
 * which is what recording each intermediate switch would give and would send
 * the next Ctrl+Tab to a tab you only passed through.
 */
export function finishTabCycle(state: TabCycleState): string[] {
  const target = tabCycleTarget(state);
  return [target, ...state.order.filter((id) => id !== target)];
}

/** Everything one Ctrl+Tab press knows about the world it happens in. */
export interface TabCycleStep {
  /** The cycle already in progress, or null for the first press of a gesture. */
  state: TabCycleState | null;
  /** Recently-used order (current tab first) — read only when a snapshot is taken. */
  order: readonly string[];
  /** The tab on screen right now. */
  currentId: string | null;
  /** The tabs still reachable: alive, and in the current scope. */
  alive: ReadonlySet<string>;
  /** One press, one notch: +1 for Ctrl+Tab, -1 for Ctrl+Shift+Tab. */
  delta: 1 | -1;
}

/**
 * One press, start to finish — the single decision the keyboard wiring makes,
 * kept here so it can be tested without a store (`actions.ts` only owns the
 * variable that holds the result between presses).
 *
 * Continuing beats starting: as long as a cycle is running it is *that*
 * snapshot that moves, which is the whole anti-ping-pong rule. A snapshot is
 * taken only when there is none — the first press — or when the one we had
 * stopped being usable:
 *
 * - fewer than two of its tabs survive (they were closed, or the scope changed
 *   under it). Starting over then is what keeps Ctrl+Tab answering after a
 *   scope change instead of going dead until the modifier comes up;
 * - it is no longer the thing driving the screen — the tab on show is not the
 *   one the cycle points at, so something else moved it while the modifier was
 *   still down (Ctrl+1 halfway through a gesture, a click, another window
 *   switching this one's tab). A cycle that ignored that would carry on from
 *   an index that means nothing any more.
 *
 * Null means "there is nothing to switch to": one tab, or none.
 */
export function stepTabCycle({ state, order, currentId, alive, delta }: TabCycleStep): TabCycleState | null {
  const running = state && tabCycleTarget(state) === currentId ? state : null;
  const continued = running ? advanceTabCycle(running, delta, alive) : null;
  if (continued) return continued;
  const begun = beginTabCycle(order.filter((id) => alive.has(id)), currentId);
  return begun ? advanceTabCycle(begun, delta) : null;
}
