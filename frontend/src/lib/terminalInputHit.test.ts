/**
 * Tests for "where does a click on the input block land" (ticket #15, U1).
 *
 * Same shape as `terminalInputState.test.ts`: pure module, plain Node, no
 * bundler and no jsdom.
 *
 *     node src/lib/terminalInputHit.test.ts
 *
 * What is pinned down: a click anywhere on the block — on the shell's own
 * prompt, in the middle of a glyph, past the end of the line — resolves to the
 * caret offset a text field would have chosen, and never to the middle of a
 * surrogate pair. This is the third attempt at this bug; the point of the file
 * is that the *placement rule* can no longer regress silently.
 */
import { alignToCodePoint, caretOffsetAt } from './terminalInputHit.ts';

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

/** A monospace "font": every code unit is `w` px wide. */
function mono(w: number) {
  return (index: number) => index * w;
}

/** Counts how often the search asked the DOM for a width. */
function counting(measure: (i: number) => number) {
  const calls: number[] = [];
  const fn = (i: number) => {
    calls.push(i);
    return measure(i);
  };
  return { fn, calls };
}

// --- the offset a click resolves to ---------------------------------------

test('an empty editor always resolves to 0', () => {
  assert.equal(caretOffsetAt('', 0, mono(8)), 0);
  assert.equal(caretOffsetAt('', 500, mono(8)), 0);
});

test('a click left of the text — on the shell prompt — is the start of the line', () => {
  // This is the case the block never handled: the pointer is on the PS1, i.e.
  // at a negative offset from the start of the text box.
  assert.equal(caretOffsetAt('git status', -140, mono(8)), 0);
  assert.equal(caretOffsetAt('git status', 0, mono(8)), 0);
});

test('a click past the end of the line is the end of the line', () => {
  assert.equal(caretOffsetAt('git status', 10 * 8, mono(8)), 10);
  assert.equal(caretOffsetAt('git status', 4000, mono(8)), 10);
});

test('a click inside a glyph snaps to the nearer edge', () => {
  const text = 'git status';
  // Cell 3 spans 24..32 px.
  assert.equal(caretOffsetAt(text, 25, mono(8)), 3, 'left half stays before the glyph');
  assert.equal(caretOffsetAt(text, 31, mono(8)), 4, 'right half moves past it');
  assert.equal(caretOffsetAt(text, 28, mono(8)), 3, 'exactly half stays before');
});

test('every column of a line is reachable', () => {
  const text = 'npm run build -- --watch';
  for (let i = 0; i <= text.length; i++) {
    // The middle of cell `i` must resolve to `i`.
    assert.equal(caretOffsetAt(text, i * 9 + 1, mono(9)), i, `column ${i}`);
  }
});

test('a proportional font is handled too — no cell-width arithmetic', () => {
  // 'i' is narrow, 'W' is wide: dividing by a mean cell width would drift.
  const widths: Record<string, number> = { i: 3, W: 17, ' ': 5 };
  const text = 'iiWWi W';
  const advance = (index: number) => {
    let total = 0;
    for (let i = 0; i < index; i++) total += widths[text[i]] ?? 8;
    return total;
  };
  // i i W W i ' ' W  ->  0 3 6 23 40 43 48 65
  assert.equal(advance(text.length), 65);
  assert.equal(caretOffsetAt(text, 7, advance), 2, 'just past the second i');
  assert.equal(caretOffsetAt(text, 22, advance), 3, 'right half of the first W');
  assert.equal(caretOffsetAt(text, 64, advance), 7, 'right half of the last W');
});

test('the search is logarithmic, not a scan', () => {
  const text = 'x'.repeat(1000);
  const { fn, calls } = counting(mono(8));
  caretOffsetAt(text, 4004, fn);
  // ~log2(1000) probes plus the three edge reads; a scan would be 1000.
  if (calls.length > 24) throw new Error(`${calls.length} measurements for 1000 chars`);
});

// --- surrogate pairs -------------------------------------------------------

test('a click never splits a surrogate pair', () => {
  const text = 'a😀b'; // 4 code units: a, D83D, DE00, b
  // Whatever the pointer says, offset 2 (between the halves) is never returned.
  for (let x = -20; x < 60; x++) {
    const offset = caretOffsetAt(text, x, mono(8));
    assert.equal(offset === 2, false, `x=${x} landed inside the emoji`);
  }
});

test('alignToCodePoint clamps and steps off a pair', () => {
  const text = 'a😀b';
  assert.equal(alignToCodePoint(text, -5), 0);
  assert.equal(alignToCodePoint(text, 99), 4);
  assert.equal(alignToCodePoint(text, 2), 1, 'the low surrogate belongs to the pair before it');
  assert.equal(alignToCodePoint(text, 3), 3, 'the end of the pair is a legal caret');
});

console.log(`terminalInputHit: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  x ${f}`);
  throw new Error(`${failures.length} test(s) failed`);
}
