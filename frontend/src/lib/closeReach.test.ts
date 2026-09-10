/**
 * Tests for the words a cross-window bulk close uses (ticket #37).
 *
 * Same shape as `tabCycle.test.ts`: the module under test is pure, so this
 * runs on plain Node with nothing but type stripping —
 *
 *     bun run test      (node --test "src/**\/*.test.ts")
 *
 * What is pinned down here is the promise the ticket makes: a close that
 * reaches a window the user cannot see must say so, and a close that stays put
 * must not invent a warning. The menu's count and the dialog's question are
 * read from the same tally, so the sentence and the deed cannot drift.
 */
import { closeQuestion, describeCloseReach, type WindowShare } from './closeReach.ts';

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
  console.log(`closeReach: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} closeReach test(s) failed`);
  }
}

const share = (name: string, count: number): WindowShare => ({ name, count });

// --- the tests -------------------------------------------------------------

test('a close that stays in this window says nothing about others', () => {
  assert.equal(describeCloseReach([]), null);
  assert.equal(closeQuestion('Close these 3 terminals', []), 'Close these 3 terminals?');
});

test('a window that loses nothing is not named', () => {
  // A tally may carry every window; only the ones actually losing a tab count.
  assert.equal(describeCloseReach([share('Terminal 2', 0), share('Terminal 3', 0)]), null);
  assert.equal(closeQuestion('Close the 4 other terminals', [share('Terminal 2', 0)]), 'Close the 4 other terminals?');
});

test('one other window is named with its share', () => {
  assert.equal(describeCloseReach([share('Terminal 2', 3)]), '3 in Terminal 2');
  assert.equal(
    closeQuestion('Close these 7 terminals', [share('Terminal 2', 3)]),
    'Close these 7 terminals, including 3 in Terminal 2?'
  );
});

test('two other windows are both named', () => {
  assert.equal(describeCloseReach([share('Terminal 2', 3), share('Terminal 3', 1)]), '3 in Terminal 2 and 1 in Terminal 3');
});

test('past two windows the reach is summarised rather than listed', () => {
  const shares = [share('Terminal 2', 3), share('Terminal 3', 1), share('Terminal 4', 2)];
  assert.equal(describeCloseReach(shares), '6 in 3 other Terminal windows');
  assert.equal(
    closeQuestion('Close these 9 terminals', shares),
    'Close these 9 terminals, including 6 in 3 other Terminal windows?'
  );
});

test('empty windows do not pad the summary', () => {
  // Three entries, one of them empty: two names, so they are spelled out.
  const shares = [share('Terminal 2', 3), share('Terminal 3', 0), share('Terminal 4', 2)];
  assert.equal(describeCloseReach(shares), '3 in Terminal 2 and 2 in Terminal 4');
});

test('the tally order is the order the windows are named in', () => {
  assert.equal(describeCloseReach([share('Terminal 3', 1), share('Terminal 2', 5)]), '1 in Terminal 3 and 5 in Terminal 2');
});

report();
