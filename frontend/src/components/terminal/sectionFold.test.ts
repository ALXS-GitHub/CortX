/**
 * Tests for the folding decisions of the sessions rail (ticket #40).
 *
 * Same shape as `lib/tabCycle.test.ts`: the module under test is pure and
 * imports nothing, so this runs on plain Node with nothing but type stripping —
 *
 *     bun run test      (node --test "src/**\/*.test.ts")
 *
 * What is pinned down here is the pair of rules a fold has to keep or it
 * becomes a trap: you can never end up on a tab you cannot see because you
 * navigated to it, and a boot must not silently undo the fold you saved.
 */
import {
  foldSection,
  foldSignalRank,
  groupToReveal,
  isFolded,
  loudestLive,
  toggleSection,
  unfoldSection,
  type ActiveTabRef,
} from './sectionFold.ts';

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
  console.log(`sectionFold: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} test(s) failed`);
  }
}

const at = (tabId: string, workspaceId: string): ActiveTabRef => ({ tabId, workspaceId });

// --- the set ---------------------------------------------------------------

test('folding and unfolding a section leaves the others alone', () => {
  const folded = foldSection(['project:a'], 'project:b');
  assert.deepEqual(folded, ['project:a', 'project:b']);
  assert.deepEqual(unfoldSection(folded, 'project:a'), ['project:b']);
  assert.equal(isFolded(folded, 'project:b'), true);
  assert.equal(isFolded(folded, 'free'), false);
});

test('folding a section twice does not list it twice', () => {
  assert.deepEqual(foldSection(['project:a'], 'project:a'), ['project:a']);
});

test('toggle is the click on the header', () => {
  assert.deepEqual(toggleSection([], 'free'), ['free']);
  assert.deepEqual(toggleSection(['free'], 'free'), []);
});

// --- when a folded section opens itself ------------------------------------

test('the first look after a boot reveals nothing', () => {
  // The state you boot into is the state you left; a reveal here would undo
  // the fold the user saved last session.
  assert.equal(groupToReveal(undefined, at('t1', 'project:a'), ['project:a']), null);
});

test('moving to a tab of a folded section reveals it', () => {
  assert.equal(groupToReveal(at('t1', 'free'), at('t2', 'project:a'), ['project:a']), 'project:a');
});

test('moving to a tab of an open section reveals nothing', () => {
  assert.equal(groupToReveal(at('t1', 'free'), at('t2', 'project:a'), ['project:b']), null);
});

test('folding the section you are already in keeps it folded', () => {
  // The user folded the section holding the current tab: that is a deliberate
  // act. The current tab has not changed, so nothing is revealed — the header
  // wearing the current plate is what says where you are.
  const here = at('t1', 'project:a');
  assert.equal(groupToReveal(here, here, ['project:a']), null);
});

test('a tab moved into a folded section reveals it, id unchanged', () => {
  assert.equal(groupToReveal(at('t1', 'free'), at('t1', 'project:a'), ['project:a']), 'project:a');
});

test('the first tab of an empty window reveals its section', () => {
  // `null` is not `undefined`: there really was no current tab, and now
  // there is one.
  assert.equal(groupToReveal(null, at('t1', 'project:a'), ['project:a']), 'project:a');
});

test('losing the current tab reveals nothing', () => {
  assert.equal(groupToReveal(at('t1', 'project:a'), null, ['project:a']), null);
});

// --- what a folded header still says ---------------------------------------

test('the rank follows the glyph, agent first', () => {
  assert.equal(foldSignalRank({ running: true, agent: { state: 'waiting' } }), 5, 'waiting beats everything');
  assert.equal(foldSignalRank({ running: true, agent: { state: 'running' } }), 3, 'a working agent is not a spinner');
  assert.equal(foldSignalRank({ running: false, agent: { state: 'stopped' } }), 0, 'a faint dot is not news');
  assert.equal(foldSignalRank({ running: false, agent: { state: 'unknown' } }), 0);
  assert.equal(foldSignalRank({ running: true }), 2);
  assert.equal(foldSignalRank({ running: false, attention: { exitCode: 1 } }), 4, 'a failure outranks a spinner');
  assert.equal(foldSignalRank({ running: false, attention: { exitCode: 0 } }), 1);
  assert.equal(foldSignalRank({ running: false, attention: { exitCode: null } }), 1);
  assert.equal(foldSignalRank({ running: false }), 0);
});

test('a folded section borrows the loudest tab it holds', () => {
  const waiting = { running: false, agent: { state: 'waiting' } };
  const list = [{ running: false }, { running: true }, waiting, { running: false, attention: { exitCode: 1 } }];
  assert.equal(loudestLive(list) === waiting, true);
});

test('a folded section with nothing to report shows no glyph', () => {
  assert.equal(loudestLive([{ running: false }, { running: false, agent: { state: 'stopped' } }]), null);
  assert.equal(loudestLive([]), null);
});

test('a tie keeps the rail order', () => {
  const first = { running: true };
  assert.equal(loudestLive([first, { running: true }]) === first, true);
});

report();
