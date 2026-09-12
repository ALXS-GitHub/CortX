/**
 * Tests for "where does a click on the input block land" (ticket #15, U1).
 *
 * Same shape as `terminalInputState.test.ts`: pure module, plain Node, no
 * bundler and no jsdom.
 *
 *     node src/lib/terminalInputHit.test.ts
 *
 * What is pinned down: a click anywhere on the block — on the shell's own
 * prompt, in the middle of a glyph, past the end of the line, on the second
 * row of a line that wrapped — resolves to the caret offset a text field
 * would have chosen, and never to the middle of a surrogate pair. This is the
 * third attempt at this bug; the point of the file is that the *placement
 * rule* can no longer regress silently.
 */
import { alignToCodePoint, caretOffsetAtPoint } from './terminalInputHit.ts';

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

/** Height of one visual line in every layout below. */
const LINE = 16;

/** A monospace "font" on a single line: every code unit is `w` px wide. */
function mono(w: number) {
  return (index: number) => ({ left: index * w, top: 0 });
}

/**
 * A monospace font on a box `cols` wide holding `len` code units: the text
 * wraps, so offset `i` sits on row `i / cols` at column `i % cols` — the
 * geometry the browser produces for `white-space: pre-wrap; word-break:
 * break-all`.
 *
 * The one exception is the very last offset of a text that fills its last row
 * exactly. `len / cols` would put it alone on a row that does not exist: with
 * nothing after it there is no line to start, so the browser paints it at the
 * *end* of the last real row. Getting this wrong is what makes "click to the
 * right of the last row" look like an off-by-one.
 */
function wrapped(w: number, cols: number, len: number) {
  return (index: number) => {
    if (index === len && len > 0 && len % cols === 0) {
      return { left: cols * w, top: (len / cols - 1) * LINE };
    }
    return { left: (index % cols) * w, top: Math.floor(index / cols) * LINE };
  };
}

/** The single-line call the old one-dimensional search used to make. */
function at(text: string, x: number, measure: (i: number) => { left: number; top: number }) {
  return caretOffsetAtPoint(text, x, 0, LINE, measure);
}

/** Counts how often the search asked the DOM for a position. */
function counting(measure: (i: number) => { left: number; top: number }) {
  const calls: number[] = [];
  const fn = (i: number) => {
    calls.push(i);
    return measure(i);
  };
  return { fn, calls };
}

// --- the offset a click resolves to ---------------------------------------

test('an empty editor always resolves to 0', () => {
  assert.equal(at('', 0, mono(8)), 0);
  assert.equal(at('', 500, mono(8)), 0);
});

test('a click left of the text — on the shell prompt — is the start of the line', () => {
  // This is the case the block never handled: the pointer is on the PS1, i.e.
  // at a negative offset from the start of the text box.
  assert.equal(at('git status', -140, mono(8)), 0);
  assert.equal(at('git status', 0, mono(8)), 0);
});

test('a click past the end of the line is the end of the line', () => {
  assert.equal(at('git status', 10 * 8, mono(8)), 10);
  assert.equal(at('git status', 4000, mono(8)), 10);
});

test('a click inside a glyph snaps to the nearer edge', () => {
  const text = 'git status';
  // Cell 3 spans 24..32 px.
  assert.equal(at(text, 25, mono(8)), 3, 'left half stays before the glyph');
  assert.equal(at(text, 31, mono(8)), 4, 'right half moves past it');
  assert.equal(at(text, 28, mono(8)), 3, 'exactly half stays before');
});

test('every column of a line is reachable', () => {
  const text = 'npm run build -- --watch';
  for (let i = 0; i <= text.length; i++) {
    // The middle of cell `i` must resolve to `i`.
    assert.equal(at(text, i * 9 + 1, mono(9)), i, `column ${i}`);
  }
});

test('a proportional font is handled too — no cell-width arithmetic', () => {
  // 'i' is narrow, 'W' is wide: dividing by a mean cell width would drift.
  const widths: Record<string, number> = { i: 3, W: 17, ' ': 5 };
  const text = 'iiWWi W';
  const advance = (index: number) => {
    let total = 0;
    for (let i = 0; i < index; i++) total += widths[text[i]] ?? 8;
    return { left: total, top: 0 };
  };
  // i i W W i ' ' W  ->  0 3 6 23 40 43 48 65
  assert.equal(advance(text.length).left, 65);
  assert.equal(at(text, 7, advance), 2, 'just past the second i');
  assert.equal(at(text, 22, advance), 3, 'right half of the first W');
  assert.equal(at(text, 64, advance), 7, 'right half of the last W');
});

test('the search is logarithmic, not a scan', () => {
  const text = 'x'.repeat(1000);
  const { fn, calls } = counting(mono(8));
  at(text, 4004, fn);
  // ~log2(1000) probes plus the three edge reads; a scan would be 1000.
  if (calls.length > 24) throw new Error(`${calls.length} measurements for 1000 chars`);
});

// --- a line that wrapped ---------------------------------------------------

test('a click on the second row lands on the second row', () => {
  // 20 chars on a 10-column box: 0..9 on row 0, 10..19 on row 1.
  const text = 'npm run build -- -w0';
  const m = wrapped(8, 10, text.length);
  // Row 1, column 3. A search on `x` alone would have answered 3.
  assert.equal(caretOffsetAtPoint(text, 3 * 8 + 1, LINE + 4, LINE, m), 13);
  assert.equal(caretOffsetAtPoint(text, 0, LINE + 4, LINE, m), 10, 'start of the second row');
});

test('every column of a wrapped line is reachable, on both rows', () => {
  const text = 'x'.repeat(20);
  const m = wrapped(8, 10, text.length);
  for (let i = 0; i < 20; i++) {
    const row = Math.floor(i / 10);
    const col = i % 10;
    assert.equal(caretOffsetAtPoint(text, col * 8 + 1, row * LINE + 4, LINE, m), i, `offset ${i}`);
  }
});

test('past the end of a row stays on that row', () => {
  // The empty space right of a wrapped row belongs to the row: clicking it
  // must not drop the caret onto the row below.
  //
  // The answer is 9, not 10, and that is the wrap's own ambiguity rather than
  // an off-by-one. Offset 10 is the boundary: it is both the end of row 0 and
  // the start of row 1, and the browser reports the *downstream* position for
  // it — `left: 0, top: LINE`. Our caret is drawn by repeating the text
  // before it, so a caret at 10 would be painted at the start of row 1. On a
  // click at the far right of row 0 that is the wrong row, so the last offset
  // actually painted on row 0 is the honest answer.
  const text = 'x'.repeat(20);
  const m = wrapped(8, 10, text.length);
  assert.equal(caretOffsetAtPoint(text, 4000, 4, LINE, m), 9, 'last caret painted on the first row');
  assert.equal(caretOffsetAtPoint(text, 4000, LINE + 4, LINE, m), 20, 'end of the last row');
});

test('above the first row is the start, below the last is the end', () => {
  const text = 'x'.repeat(20);
  const m = wrapped(8, 10, text.length);
  assert.equal(caretOffsetAtPoint(text, 40, -30, LINE, m), 0);
  assert.equal(caretOffsetAtPoint(text, 40, 9 * LINE, LINE, m), 20);
});

test('the search stays logarithmic once the text wraps', () => {
  const text = 'x'.repeat(1000);
  const { fn, calls } = counting(wrapped(8, 10, text.length));
  caretOffsetAtPoint(text, 40, 60 * LINE, LINE, fn);
  if (calls.length > 24) throw new Error(`${calls.length} measurements for 1000 chars`);
});

// --- surrogate pairs -------------------------------------------------------

test('a click never splits a surrogate pair', () => {
  const text = 'a😀b'; // 4 code units: a, D83D, DE00, b
  // Whatever the pointer says, offset 2 (between the halves) is never returned.
  for (let x = -20; x < 60; x++) {
    const offset = at(text, x, mono(8));
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
