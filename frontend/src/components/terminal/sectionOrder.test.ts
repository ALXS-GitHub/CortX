/**
 * Tests for the order of the rail's project sections (ticket #50).
 *
 * Same shape as `sectionFold.test.ts`: the module under test is pure and
 * imports nothing, so this runs on plain Node with nothing but type stripping —
 *
 *     bun run test      (node --test "src/**\/*.test.ts")
 *
 * What is pinned down here: no drag yet changes nothing; a drop shows exactly
 * what the sortable drew; a section the saved list never heard of lands beside
 * its default neighbour; and the sections a window cannot see keep their
 * places when it moves the ones it can.
 */
import { mergeSectionOrder, moveSection, orderSections } from './sectionOrder.ts';

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
  deepEqual(actual: unknown, expected: unknown, note = '') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`expected ${b}, got ${a}${note ? ` (${note})` : ''}`);
  },
};

function report() {
  console.log(`sectionOrder: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} test(s) failed`);
  }
}

const groups = (...ids: string[]) => ids.map((workspaceId) => ({ workspaceId }));
const ids = (list: Array<{ workspaceId: string }>) => list.map((g) => g.workspaceId);
/** `list` read back through what one rail shows. */
const seen = (list: string[], shown: string[]) => list.filter((id) => shown.includes(id));

// --- no drag yet ------------------------------------------------------------

test('nothing saved keeps the default order', () => {
  assert.deepEqual(ids(orderSections(groups('a', 'b', 'free'), undefined)), ['a', 'b', 'free']);
  assert.deepEqual(ids(orderSections(groups('a', 'b', 'free'), [])), ['a', 'b', 'free']);
  assert.deepEqual(mergeSectionOrder(undefined, ['a', 'b', 'free']), ['a', 'b', 'free']);
});

// --- the saved order --------------------------------------------------------

test('the saved order wins over the default one', () => {
  assert.deepEqual(ids(orderSections(groups('a', 'b', 'free'), ['free', 'b', 'a'])), ['free', 'b', 'a']);
});

test('the same objects come back, none added, none lost', () => {
  const list = groups('a', 'b');
  const out = orderSections(list, ['b', 'gone', 'a']);
  assert.deepEqual(out.length, 2);
  assert.deepEqual(out[0] === list[1] && out[1] === list[0], true);
});

test('a section the list never heard of lands after its default neighbour', () => {
  // Default: a, b, c, free — `c` is new. It follows `b`, wherever `b` went.
  assert.deepEqual(ids(orderSections(groups('a', 'b', 'c', 'free'), ['b', 'free', 'a'])), ['b', 'c', 'free', 'a']);
});

test('a new first section lands before its default successor', () => {
  // `a` has no section before it, so it sits right before the first one after
  // it the list holds — here `b`, which the user had put last.
  assert.deepEqual(ids(orderSections(groups('a', 'b', 'c'), ['c', 'b'])), ['c', 'a', 'b']);
});

test('several new sections in a row keep their default order', () => {
  assert.deepEqual(ids(orderSections(groups('a', 'n1', 'n2', 'b'), ['b', 'a'])), ['b', 'a', 'n1', 'n2']);
});

test('ids nobody shows are ignored on screen but kept in the list', () => {
  assert.deepEqual(ids(orderSections(groups('a', 'b'), ['gone', 'b', 'a'])), ['b', 'a']);
  assert.deepEqual(mergeSectionOrder(['gone', 'b', 'a'], ['a', 'b']), ['gone', 'b', 'a']);
});

test('a list written twice over is read once', () => {
  assert.deepEqual(mergeSectionOrder(['b', 'a', 'b', ''], ['a', 'b']), ['b', 'a']);
});

// --- a drop -----------------------------------------------------------------

test('the first drop saves the whole rail, moved', () => {
  assert.deepEqual(moveSection(undefined, ['a', 'b', 'free'], 'free', 'a'), ['free', 'a', 'b']);
});

test('dropped going up, it lands before the one it was dropped on', () => {
  assert.deepEqual(moveSection(['a', 'b', 'c'], ['a', 'b', 'c'], 'c', 'b'), ['a', 'c', 'b']);
});

test('dropped going down, it lands after the one it was dropped on', () => {
  assert.deepEqual(moveSection(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 'b'), ['b', 'a', 'c']);
});

test('a drop on itself or on an unknown id saves the list as it stands', () => {
  assert.deepEqual(moveSection(['b', 'a'], ['b', 'a'], 'a', 'a'), ['b', 'a']);
  assert.deepEqual(moveSection(['b', 'a'], ['b', 'a'], 'a', 'nope'), ['b', 'a']);
});

test('a window that sees only some sections shows what it drew', () => {
  // This rail holds `a` and `c`; `b` and `d` are another window's. Whatever
  // it moves, read back through what it shows, must be the sortable's own
  // result: the dragged one before the target going up, after it going down.
  const saved = ['a', 'b', 'c', 'd'];
  const shown = ['a', 'c'];
  assert.deepEqual(seen(moveSection(saved, shown, 'c', 'a'), shown), ['c', 'a']);
  assert.deepEqual(seen(moveSection(saved, shown, 'a', 'c'), shown), ['c', 'a']);
});

test('the sections out of sight keep their places', () => {
  // Moving `a` below `c` from a rail that cannot see `b` or `d`: `b` and `d`
  // keep their order, and only `a` changed slot.
  assert.deepEqual(moveSection(['a', 'b', 'c', 'd'], ['a', 'c'], 'a', 'c'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveSection(['a', 'b', 'c', 'd'], ['a', 'c'], 'c', 'a'), ['c', 'a', 'b', 'd']);
});

test('a drop involving a section the list never heard of places it first', () => {
  // `c` is new and shown after `b`; dragging it to the top saves it there.
  assert.deepEqual(moveSection(['b', 'a'], ['b', 'c', 'a'], 'c', 'b'), ['c', 'b', 'a']);
});

report();
