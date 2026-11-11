/**
 * Tests for the grid view's tile layout (ticket #55).
 *
 * Same shape as `sectionOrder.test.ts`: the module under test is pure and
 * imports nothing, so this runs on plain Node with nothing but type stripping —
 *
 *     bun run test      (node --test "src/**\/*.test.ts")
 */
import { arrangeGrid, gridShape, MIN_TILE_HEIGHT, MIN_TILE_WIDTH, type GridTabFacts } from './gridLayout.ts';

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
  ok(value: boolean, note = '') {
    if (!value) throw new Error(`expected true${note ? ` (${note})` : ''}`);
  },
};

function report() {
  console.log(`gridLayout: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} gridLayout test(s) failed`);
  }
}

// A laptop-sized content area, and a tall narrow one.
const WIDE = [1400, 800] as const;
const TALL = [700, 1200] as const;

test('one tile fills the area', () => {
  assert.deepEqual(gridShape(1, ...WIDE), { columns: 1, rows: 1 });
});

test('two tiles sit side by side when wide, stacked when tall', () => {
  assert.deepEqual(gridShape(2, ...WIDE), { columns: 2, rows: 1 });
  assert.deepEqual(gridShape(2, ...TALL), { columns: 1, rows: 2 });
});

test('four make a square, six a 3 × 2 on a wide screen', () => {
  assert.deepEqual(gridShape(4, ...WIDE), { columns: 2, rows: 2 });
  assert.deepEqual(gridShape(6, ...WIDE), { columns: 3, rows: 2 });
});

test('every tile has a cell, and no row is entirely empty', () => {
  for (let n = 1; n <= 30; n++) {
    for (const [w, h] of [WIDE, TALL, [1920, 1080], [900, 500]] as const) {
      const { columns, rows } = gridShape(n, w, h);
      assert.ok(columns * rows >= n, `${n} tiles in ${w}×${h}`);
      assert.ok(columns * (rows - 1) < n, `${n} tiles in ${w}×${h}: an empty row`);
    }
  }
});

test('too many to fit readably: the rows keep their height and the grid scrolls', () => {
  const { columns, rows } = gridShape(30, ...WIDE);
  assert.ok(WIDE[1] / rows < MIN_TILE_HEIGHT, 'it does not fit');
  assert.deepEqual(columns, Math.floor(WIDE[0] / MIN_TILE_WIDTH), 'as many readable columns as fit');
});

test('no tile, or no size yet, still answers', () => {
  assert.deepEqual(gridShape(0, ...WIDE), { columns: 1, rows: 0 });
  assert.deepEqual(gridShape(5, 0, 0), { columns: 3, rows: 2 });
});

const fact = (tab: string, groupKey: string, railIndex: number, phase: GridTabFacts<string>['phase'], lastActivity = 0) => ({
  tab,
  groupKey,
  groupName: groupKey.toUpperCase(),
  railIndex,
  phase,
  lastActivity,
});
const FACTS = [
  fact('shell', 'a', 0, null),
  fact('busy', 'b', 1, 'working', 30),
  fact('asks', 'a', 2, 'needs-you', 10),
  fact('rest', 'b', 3, 'idle', 50),
  fact('fresh', 'a', 4, 'done', 20),
];
const plain = { sort: 'rail', agentsOnly: false, hideIdle: false, groupByProject: false } as const;
const names = (groups: ReturnType<typeof arrangeGrid<string>>) => groups.map((g) => [g.name, g.tabs]);

test('by default: every tab, in rail order, one block', () => {
  assert.deepEqual(names(arrangeGrid(FACTS, plain)), [[null, ['shell', 'busy', 'asks', 'rest', 'fresh']]]);
});

test('attention first, or the latest active first', () => {
  assert.deepEqual(arrangeGrid(FACTS, { ...plain, sort: 'attention' })[0].tabs, ['asks', 'fresh', 'busy', 'rest', 'shell']);
  assert.deepEqual(arrangeGrid(FACTS, { ...plain, sort: 'recent' })[0].tabs, ['rest', 'busy', 'fresh', 'asks', 'shell']);
});

test('agents only, without the idle ones', () => {
  assert.deepEqual(arrangeGrid(FACTS, { ...plain, agentsOnly: true, hideIdle: true })[0].tabs, ['busy', 'asks', 'fresh']);
  assert.deepEqual(arrangeGrid([fact('shell', 'a', 0, null)], { ...plain, agentsOnly: true }), [], 'nothing left: no group');
});

test('by project: sections in rail order, each sorted', () => {
  assert.deepEqual(names(arrangeGrid(FACTS, { ...plain, groupByProject: true, sort: 'attention' })), [
    ['A', ['asks', 'fresh', 'shell']],
    ['B', ['busy', 'rest']],
  ]);
});

report();
