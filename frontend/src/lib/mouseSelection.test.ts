/**
 * Tests for the drag threshold of copy on select (a click that slips by a
 * pixel must not copy anything).
 *
 * The module under test is pure, so this runs on plain Node with nothing but
 * type stripping —
 *
 *     bun run test      (node --test "src/**\/*.test.ts")
 */
import { DRAG_THRESHOLD_PX, isDeliberateSelection, type PressStart } from './mouseSelection.ts';

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
};

function report() {
  console.log(`mouseSelection: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} mouseSelection test(s) failed`);
  }
}

const press = (x: number, y: number, clicks = 1, shiftKey = false): PressStart => ({ x, y, clicks, shiftKey });

// --- the tests -------------------------------------------------------------

test('a click that does not move is not a selection', () => {
  assert.equal(isDeliberateSelection(press(100, 100), 100, 100), false);
});

test('a click that slips by a pixel or two is not a selection', () => {
  // Enough to cross the middle of a cell or the edge of a row in xterm.
  assert.equal(isDeliberateSelection(press(100, 100), 102, 101), false);
  assert.equal(isDeliberateSelection(press(100, 100), 100, 96), false);
});

test('a real drag is a selection', () => {
  assert.equal(isDeliberateSelection(press(100, 100), 100 + DRAG_THRESHOLD_PX, 100), true);
  assert.equal(isDeliberateSelection(press(100, 100), 40, 160), true);
});

test('a double or triple click selects without moving', () => {
  assert.equal(isDeliberateSelection(press(100, 100, 2), 100, 100), true);
  assert.equal(isDeliberateSelection(press(100, 100, 3), 101, 100), true);
});

test('a Shift+click extends the selection without moving', () => {
  assert.equal(isDeliberateSelection(press(100, 100, 1, true), 100, 100), true);
});

report();
