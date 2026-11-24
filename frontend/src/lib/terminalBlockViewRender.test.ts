/**
 * Tests for the row renderer of the block layout (CORT-57).
 *
 * Plain Node, type stripping only (`npm test`), like the other terminal
 * suites. The cells are fakes with the exact accessor surface xterm's
 * `IBufferCell` has, so what is pinned down here is xterm's own colour rules
 * — bold-as-bright on 0–7 only, inverse with default colours, dim, the
 * contrast floor — and the column bookkeeping a copy relies on.
 */
import {
  buildAnsi,
  buildPalette,
  columnInRun,
  contrast,
  ensureContrast,
  lineIsBlank,
  parseColor,
  renderRow,
  styleFor,
  textBetween,
  usedColumns,
  type CellLike,
  type LineLike,
  type RowContext,
} from './terminalBlockViewRender.ts';

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
  ok(value: unknown, note = '') {
    if (!value) throw new Error(`expected truthy${note ? ` (${note})` : ''}`);
  },
};

function report() {
  console.log(`terminalBlockViewRender: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} test(s) failed`);
  }
}

// --- fake cells -------------------------------------------------------------

interface FakeAttrs {
  fg?: number | [number, number, number];
  bg?: number | [number, number, number];
  bold?: boolean;
  dim?: boolean;
  inverse?: boolean;
  underline?: boolean;
  invisible?: boolean;
}

interface FakeCellData extends FakeAttrs {
  chars: string;
  width: number;
}

class FakeCell implements CellLike {
  d: FakeCellData = { chars: '', width: 1 };
  getWidth() { return this.d.width; }
  getChars() { return this.d.chars; }
  getFgColorMode() { return 0; }
  getBgColorMode() { return 0; }
  getFgColor() {
    const fg = this.d.fg;
    return fg === undefined ? 0 : typeof fg === 'number' ? fg : (fg[0] << 16) | (fg[1] << 8) | fg[2];
  }
  getBgColor() {
    const bg = this.d.bg;
    return bg === undefined ? 0 : typeof bg === 'number' ? bg : (bg[0] << 16) | (bg[1] << 8) | bg[2];
  }
  isBold() { return this.d.bold ? 1 : 0; }
  isItalic() { return 0; }
  isDim() { return this.d.dim ? 1 : 0; }
  isUnderline() { return this.d.underline ? 1 : 0; }
  isInverse() { return this.d.inverse ? 1 : 0; }
  isInvisible() { return this.d.invisible ? 1 : 0; }
  isStrikethrough() { return 0; }
  isOverline() { return 0; }
  isFgDefault() { return this.d.fg === undefined; }
  isBgDefault() { return this.d.bg === undefined; }
  isFgPalette() { return typeof this.d.fg === 'number'; }
  isBgPalette() { return typeof this.d.bg === 'number'; }
  isFgRGB() { return Array.isArray(this.d.fg); }
  isBgRGB() { return Array.isArray(this.d.bg); }
}

class FakeLine implements LineLike {
  cells: FakeCellData[];
  isWrapped: boolean;
  constructor(cells: FakeCellData[], cols: number, isWrapped = false) {
    this.cells = cells.slice();
    while (this.cells.length < cols) this.cells.push({ chars: '', width: 1 });
    this.isWrapped = isWrapped;
  }
  get length() { return this.cells.length; }
  getCell(x: number, cell?: CellLike) {
    const c = (cell as FakeCell) ?? new FakeCell();
    if (x < 0 || x >= this.cells.length) return undefined;
    c.d = this.cells[x];
    return c;
  }
  translateToString(trimRight = false, start = 0, end = this.cells.length) {
    let s = '';
    for (let x = start; x < end && x < this.cells.length; x++) {
      if (this.cells[x].width === 0) continue;
      s += this.cells[x].chars || ' ';
    }
    return trimRight ? s.replace(/\s+$/, '') : s;
  }
}

/** One row from plain text, with optional attributes over column ranges. */
function row(text: string, cols = 20, spans: Array<[number, number, FakeAttrs]> = [], wrapped = false): FakeLine {
  const cells: FakeCellData[] = [];
  for (const ch of Array.from(text)) {
    const wide = /[　-鿿＀-￯]/.test(ch);
    cells.push({ chars: ch, width: wide ? 2 : 1 });
    if (wide) cells.push({ chars: '', width: 0 });
  }
  for (const [from, to, attrs] of spans) {
    for (let x = from; x < to; x++) Object.assign(cells[x], attrs);
  }
  return new FakeLine(cells, cols, wrapped);
}

const THEME = {
  foreground: '#d0d0d0',
  background: '#101010',
  red: '#cc0000',
  brightRed: '#ff5555',
};

function ctx(overrides: Partial<RowContext> = {}): RowContext {
  return {
    palette: buildPalette(THEME, { surface: [16, 16, 16] }),
    cellWidth: 8,
    cell: new FakeCell(),
    fits: (ch) => ch === '─',
    styles: new Map(),
    ...overrides,
  };
}

// --- tests ------------------------------------------------------------------

test('colours parse in every form a theme uses', () => {
  assert.equal(parseColor('#abc')?.join(), '170,187,204');
  assert.equal(parseColor('#102030')?.join(), '16,32,48');
  assert.equal(parseColor('#10203080')?.join(), '16,32,48');
  assert.equal(parseColor('rgba(1, 2, 3, 0.5)')?.join(), '1,2,3');
  assert.equal(parseColor('nonsense'), null);
});

test('the 256 palette has the cube and the grey ramp', () => {
  const ansi = buildAnsi(THEME);
  assert.equal(ansi.length, 256);
  assert.equal(ansi[1].join(), '204,0,0');
  assert.equal(ansi[16].join(), '0,0,0');
  assert.equal(ansi[231].join(), '255,255,255');
  assert.equal(ansi[232].join(), '8,8,8');
  assert.equal(ansi[255].join(), '238,238,238');
});

test('a transparent theme background falls back to the surface colour', () => {
  const p = buildPalette({ ...THEME, background: 'rgba(0, 0, 0, 0)' }, { surface: [40, 41, 42] });
  assert.equal(p.bg.join(), '40,41,42');
});

test('bold lifts palette 0-7 to the bright half, and only those', () => {
  const p = buildPalette(THEME, { surface: [0, 0, 0] });
  assert.ok(styleFor(1, 1, 0, 0, 1, p).includes('#ff5555'), 'bold red is bright red');
  assert.ok(styleFor(1, 9, 0, 0, 1, p).includes('#ff5555'));
  assert.ok(styleFor(1, 1, 0, 0, 0, p).includes('#cc0000'), 'plain red stays red');
  const noBright = { ...p, boldBright: false };
  assert.ok(styleFor(1, 1, 0, 0, 1, noBright).includes('#cc0000'));
});

test('inverse with default colours swaps the theme pair', () => {
  const p = buildPalette(THEME, { surface: [0, 0, 0] });
  const s = styleFor(0, 0, 0, 0, 16, p);
  assert.ok(s.includes('color:#101010'), s);
  assert.ok(s.includes('background:#d0d0d0'), s);
});

test('dim is the colour at half strength, invisible is transparent', () => {
  const p = buildPalette(THEME, { surface: [0, 0, 0] });
  assert.ok(styleFor(0, 0, 0, 0, 4, p).includes('rgba(208,208,208,0.5)'));
  assert.ok(styleFor(1, 1, 0, 0, 32, p).includes('color:transparent'));
});

test('the contrast floor moves the text away from its background', () => {
  const bg: [number, number, number] = [20, 20, 20];
  const fg: [number, number, number] = [40, 40, 40];
  const fixed = ensureContrast(bg, fg, 4.5);
  assert.ok(contrast(bg, fixed) >= 4.5, `${fixed}`);
  assert.equal(ensureContrast(bg, [250, 250, 250], 4.5).join(), '250,250,250', 'already fine');
});

test('a row stops at its last visible cell', () => {
  const c = ctx();
  const line = row('ls -la   ');
  assert.equal(usedColumns(line, c.cell), 6);
  assert.equal(renderRow(line, c), '<span data-c="0">ls -la</span>');
  // A coloured background keeps trailing blanks.
  const bar = row('ok  ', 20, [[2, 4, { bg: 1 }]]);
  assert.equal(usedColumns(bar, c.cell), 4);
});

test('runs split on attributes and carry their column', () => {
  const line = row('err ok', 20, [[0, 3, { fg: 1 }]]);
  const html = renderRow(line, ctx());
  assert.equal(html, '<span data-c="0" style="color:#cc0000">err</span><span data-c="3"> ok</span>');
});

test('wide glyphs get a two-cell box and the next run keeps its column', () => {
  const html = renderRow(row('a日b'), ctx());
  assert.equal(
    html,
    '<span data-c="0">a</span><span data-c="1" class="w" style="width:16px">日</span><span data-c="3">b</span>'
  );
});

test('non-ASCII glyphs that fit stay in the run, the others are boxed', () => {
  assert.equal(renderRow(row('──'), ctx()), '<span data-c="0">──</span>');
  assert.equal(renderRow(row('⠋x'), ctx()), '<span data-c="0" class="w" style="width:8px">⠋</span><span data-c="1">x</span>');
});

test('html is escaped', () => {
  assert.equal(renderRow(row('<a&b>'), ctx()), '<span data-c="0">&lt;a&amp;b&gt;</span>');
});

test('blank rows are recognised, coloured blanks are not', () => {
  const c = ctx();
  assert.ok(lineIsBlank(row(''), c.cell));
  assert.ok(lineIsBlank(row('    '), c.cell));
  assert.ok(!lineIsBlank(row('  ', 20, [[0, 2, { bg: 4 }]]), c.cell));
  assert.ok(lineIsBlank(undefined, c.cell));
});

test('columns inside a run count code points', () => {
  assert.equal(columnInRun(4, 'abcdef', 3), 7);
  assert.equal(columnInRun(0, 'a\u{1F600}b', 3), 2, 'a surrogate pair is one column');
});

test('copied text joins wrapped rows and keeps real newlines', () => {
  const lines = [row('first line ', 11), row('continues', 11, [], true), row('second', 11)];
  const get = (y: number) => lines[y];
  assert.equal(textBetween(get, { line: 0, col: 0 }, { line: 2, col: 6 }), 'first line continues\nsecond');
  assert.equal(textBetween(get, { line: 2, col: 3 }, { line: 0, col: 6 }), 'line continues\nsec', 'reversed ends');
});

report();
