/**
 * Tests for the frozen Ctrl+Tab cycle (issue 45b).
 *
 * Same shape as `terminalInputState.test.ts` and `terminalBlockModel.test.ts`:
 * the module under test is pure, so this runs on plain Node with nothing but
 * type stripping —
 *
 *     bun run test      (node --test "src/**\/*.test.ts")
 *
 * A failure throws at the end of the module, so the exit code carries the
 * result.
 *
 * What is pinned down here is the bug the snapshot exists to prevent: a cycle
 * that re-reads the recently-used order sees it reorder under it and
 * ping-pongs between two tabs. Everything below is a way of asking "does the
 * third press reach the third tab back?" — plus the two things that happen to
 * a snapshot in real use: a tab closing under it, and the order it must leave
 * behind when the modifier comes up.
 */
import {
  advanceTabCycle,
  beginTabCycle,
  finishTabCycle,
  pruneTabCycle,
  stepTabCycle,
  tabCycleTarget,
  type TabCycleState,
} from './tabCycle.ts';

// --- a test runner in twenty lines ----------------------------------------

const failures: string[] = [];
let passed = 0;

function test(name: string, body: () => void) {
  try {
    body();
    passed++;
  } catch (error) {
    failures.push(`${name}\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}

const assert = {
  equal(actual: unknown, expected: unknown, note = '') {
    if (!Object.is(actual, expected)) {
      throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}${note ? ` (${note})` : ''}`);
    }
  },
  deepEqual(actual: unknown, expected: unknown, note = '') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`expected ${b}, got ${a}${note ? ` (${note})` : ''}`);
  },
};

function report() {
  console.log(`tabCycle: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} test(s) failed`);
  }
}

/** Press Ctrl+Tab `times` times on a live state, returning the tab shown each time. */
function press(state: TabCycleState, times: number, delta: 1 | -1 = 1, alive?: ReadonlySet<string>): string[] {
  const seen: string[] = [];
  let current: TabCycleState | null = state;
  for (let i = 0; i < times; i++) {
    current = advanceTabCycle(current!, delta, alive);
    if (!current) break;
    seen.push(tabCycleTarget(current));
  }
  return seen;
}

/**
 * The same presses, returning the state they leave rather than the tabs seen.
 * `advanceTabCycle` deliberately takes `1 | -1` — one keypress is one step, and
 * widening it so a test could say "twice" would let the real caller skip a tab.
 */
function pressState(state: TabCycleState, times: number): TabCycleState {
  let next = state;
  for (let i = 0; i < times; i += 1) next = advanceTabCycle(next, 1)!;
  return next;
}

// --- taking the snapshot ---------------------------------------------------

test('a single tab is not a cycle', () => {
  assert.equal(beginTabCycle(['a'], 'a'), null);
  assert.equal(beginTabCycle([], null), null);
});

test('the snapshot starts on the tab you are looking at', () => {
  const state = beginTabCycle(['b', 'a', 'c'], 'b')!;
  assert.equal(state.index, 0);
  assert.equal(tabCycleTarget(state), 'b');
});

test('a current tab missing from the order starts at the front rather than nowhere', () => {
  const state = beginTabCycle(['b', 'a'], 'zzz')!;
  assert.equal(state.index, 0);
});

test('repeats in the order are folded away (a tab is in the cycle once)', () => {
  const state = beginTabCycle(['b', 'a', 'b', 'c', 'a'], 'b')!;
  assert.deepEqual(state.order, ['b', 'a', 'c']);
});

// --- walking it ------------------------------------------------------------

test('holding the modifier walks back through the stack, it does not ping-pong', () => {
  // The bug: re-reading the recently-used order on every press gives
  // ['a', 'b', 'a', 'b'] — the stack reorders itself under the cycle.
  const state = beginTabCycle(['d', 'c', 'b', 'a'], 'd')!;
  assert.deepEqual(press(state, 3), ['c', 'b', 'a']);
});

test('one press lands on the tab you came from', () => {
  const state = beginTabCycle(['d', 'c', 'b'], 'd')!;
  assert.deepEqual(press(state, 1), ['c']);
});

test('Shift walks the snapshot the other way, and wraps', () => {
  const state = beginTabCycle(['d', 'c', 'b'], 'd')!;
  assert.deepEqual(press(state, 2, -1), ['b', 'c']);
});

test('forward wraps round to where it started', () => {
  const state = beginTabCycle(['d', 'c', 'b'], 'd')!;
  assert.deepEqual(press(state, 4), ['c', 'b', 'd', 'c']);
});

test('going forward then back returns to the same tab', () => {
  const state = beginTabCycle(['d', 'c', 'b', 'a'], 'd')!;
  const forward = advanceTabCycle(advanceTabCycle(state, 1)!, 1)!;
  assert.equal(tabCycleTarget(forward), 'b');
  assert.equal(tabCycleTarget(advanceTabCycle(forward, -1)!), 'c');
});

// --- a tab that dies under the cycle --------------------------------------

test('a tab closed mid-cycle is skipped, not switched to', () => {
  const state = beginTabCycle(['d', 'c', 'b', 'a'], 'd')!;
  const alive = new Set(['d', 'b', 'a']);
  assert.deepEqual(press(state, 2, 1, alive), ['b', 'a']);
});

test('closing the tab the cycle is standing on keeps its place in the order', () => {
  const state = beginTabCycle(['d', 'c', 'b', 'a'], 'd')!;
  const onC = advanceTabCycle(state, 1)!;
  assert.equal(tabCycleTarget(onC), 'c');
  // 'c' is gone: the cycle sits where 'c' was, so the next press gives 'b'.
  const pruned = pruneTabCycle(onC, new Set(['d', 'b', 'a']))!;
  assert.deepEqual(pruned.order, ['d', 'b', 'a']);
  assert.equal(tabCycleTarget(pruned), 'b');
  assert.equal(tabCycleTarget(advanceTabCycle(pruned, 1)!), 'a');
});

test('the cycle ends when fewer than two tabs are left (a close, a scope change)', () => {
  const state = beginTabCycle(['d', 'c', 'b'], 'd')!;
  assert.equal(pruneTabCycle(state, new Set(['d'])), null);
  assert.equal(advanceTabCycle(state, 1, new Set(['d'])), null);
  assert.equal(advanceTabCycle(state, 1, new Set()), null);
});

test('a scope change that hides part of the list leaves a cycle over what is left', () => {
  const state = beginTabCycle(['d', 'c', 'b', 'a'], 'd')!;
  // Only the project's own tabs are visible now.
  assert.deepEqual(press(state, 3, 1, new Set(['d', 'a'])), ['a', 'd', 'a']);
});

test('pruning nothing hands back the very same state', () => {
  const state = beginTabCycle(['d', 'c'], 'd')!;
  assert.equal(pruneTabCycle(state, new Set(['d', 'c'])), state);
});

// --- releasing the modifier ------------------------------------------------

test('the tab you stopped on becomes the most recent', () => {
  const state = beginTabCycle(['d', 'c', 'b', 'a'], 'd')!;
  assert.deepEqual(finishTabCycle(advanceTabCycle(state, 1)!), ['c', 'd', 'b', 'a']);
});

test('the tabs merely passed through keep their old places', () => {
  // A → C → B: stopping on B must leave [B, A, C], so the next Ctrl+Tab goes
  // back to A. Recording each intermediate switch would leave [B, C, A] and
  // send it to C, a tab that was only ever flashed past.
  const state = beginTabCycle(['a', 'c', 'b'], 'a')!;
  assert.deepEqual(finishTabCycle(pressState(state, 2)), ['b', 'a', 'c']);
});

test('a cycle that came back to where it started changes nothing', () => {
  const state = beginTabCycle(['a', 'c', 'b'], 'a')!;
  assert.deepEqual(finishTabCycle(pressState(state, 3)), ['a', 'c', 'b']);
});

test('releasing after a close commits only the tabs that are left', () => {
  const state = beginTabCycle(['d', 'c', 'b', 'a'], 'd')!;
  const after = advanceTabCycle(state, 1, new Set(['d', 'b', 'a']))!;
  assert.deepEqual(finishTabCycle(after), ['b', 'd', 'a']);
});

// --- one press, as the keyboard wiring makes it ---------------------------
//
// `stepTabCycle` is the whole of the decision `actions.ts` makes on Ctrl+Tab:
// continue the snapshot we hold, or take a new one. The five situations below
// are the ones a real gesture runs into.

/** The tabs of a scope, as ids: alive set and recently-used order in one go. */
function scope(...ids: string[]): { alive: Set<string>; order: string[] } {
  return { alive: new Set(ids), order: ids };
}

test('the first press snapshots and moves one notch', () => {
  const { alive, order } = scope('d', 'c', 'b', 'a');
  const state = stepTabCycle({ state: null, order, currentId: 'd', alive, delta: 1 })!;
  assert.deepEqual(state.order, ['d', 'c', 'b', 'a']);
  assert.equal(tabCycleTarget(state), 'c');
});

test('a press while the modifier is held walks the snapshot, never a fresh one', () => {
  // The ping-pong, reproduced: after the first press the recently-used order
  // has put 'c' in front. Passing that reordered list back in must change
  // nothing, because a cycle is already running.
  const first = stepTabCycle({ ...scope('d', 'c', 'b', 'a'), state: null, currentId: 'd', delta: 1 })!;
  const second = stepTabCycle({ ...scope('c', 'd', 'b', 'a'), state: first, currentId: 'c', delta: 1 })!;
  assert.equal(tabCycleTarget(second), 'b');
  assert.deepEqual(second.order, ['d', 'c', 'b', 'a']);
});

test('a single tab is not a cycle, however the press arrives', () => {
  assert.equal(stepTabCycle({ ...scope('a'), state: null, currentId: 'a', delta: 1 }), null);
  assert.equal(stepTabCycle({ ...scope(), state: null, currentId: null, delta: 1 }), null);
});

test('Ctrl+Shift+Tab as the first press goes back from the start', () => {
  const { alive, order } = scope('d', 'c', 'b', 'a');
  const state = stepTabCycle({ state: null, order, currentId: 'd', alive, delta: -1 })!;
  assert.equal(tabCycleTarget(state), 'a');
});

test('a tab closed mid-cycle is skipped, not switched to', () => {
  const first = stepTabCycle({ ...scope('d', 'c', 'b', 'a'), state: null, currentId: 'd', delta: 1 })!;
  // 'b' is closed while the modifier is still down.
  const second = stepTabCycle({ state: first, order: ['c', 'd', 'a'], currentId: 'c', alive: new Set(['d', 'c', 'a']), delta: 1 })!;
  assert.equal(tabCycleTarget(second), 'a');
  assert.deepEqual(second.order, ['d', 'c', 'a']);
});

test('a scope change that empties the snapshot starts a new cycle rather than going dead', () => {
  const first = stepTabCycle({ ...scope('d', 'c', 'b', 'a'), state: null, currentId: 'd', delta: 1 })!;
  // The window narrows to a project none of those tabs belong to.
  const second = stepTabCycle({ ...scope('x', 'y', 'z'), state: first, currentId: 'x', delta: 1 })!;
  assert.deepEqual(second.order, ['x', 'y', 'z']);
  assert.equal(tabCycleTarget(second), 'y');
});

test('a snapshot with two survivors keeps being walked across a scope change', () => {
  const first = stepTabCycle({ ...scope('d', 'c', 'b', 'a'), state: null, currentId: 'd', delta: 1 })!;
  const second = stepTabCycle({ state: first, order: ['c', 'a'], currentId: 'c', alive: new Set(['c', 'a']), delta: 1 })!;
  assert.deepEqual(second.order, ['c', 'a']);
  assert.equal(tabCycleTarget(second), 'a');
});

test('a jump to another tab mid-gesture abandons the snapshot', () => {
  // Ctrl still down, but Ctrl+1 (or a click) moved the tab: carrying on from
  // the old index would walk a list the screen no longer agrees with.
  const first = stepTabCycle({ ...scope('d', 'c', 'b', 'a'), state: null, currentId: 'd', delta: 1 })!;
  const second = stepTabCycle({ state: first, order: ['a', 'c', 'd', 'b'], currentId: 'a', alive: new Set(['d', 'c', 'b', 'a']), delta: 1 })!;
  assert.deepEqual(second.order, ['a', 'c', 'd', 'b']);
  assert.equal(tabCycleTarget(second), 'c');
});

test('a fresh snapshot never offers a tab that is out of scope', () => {
  // `recentTabs()` is already scoped, but the two arguments come from two
  // reads of the store; a stale id in the order must not be cycled to.
  const state = stepTabCycle({ state: null, order: ['d', 'gone', 'c'], currentId: 'd', alive: new Set(['d', 'c']), delta: 1 })!;
  assert.deepEqual(state.order, ['d', 'c']);
  assert.equal(tabCycleTarget(state), 'c');
});

report();
