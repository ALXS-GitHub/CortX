/**
 * Tests for finding paths in terminal output (zorg #49).
 *
 * Same shape as `tabCycle.test.ts`: the module under test is pure, so this
 * runs on plain Node with nothing but type stripping —
 *
 *     bun run test      (node --test "src/**\/*.test.ts")
 *
 * The disk is a `Set` of paths that "exist"; everything else is the real
 * scan. What is pinned down: a path with a space in it, a path a program cut
 * over two rows (mid-word, and at a space), and the old single-run paths —
 * which must not start swallowing the words next to them.
 */
import { parseCandidate, pathCandidates, pickPathLinks, type ScanLine } from './terminalPathScan.ts';

// --- a test runner in twenty lines ----------------------------------------

const failures: string[] = [];
let passed = 0;

async function test(name: string, body: () => void | Promise<void>) {
  try {
    await body();
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
  console.log(`terminalPathScan: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} terminalPathScan test(s) failed`);
  }
}

// --- fixtures --------------------------------------------------------------

/** Rows as a terminal shows them, each its own logical line (hard breaks). */
function rows(...text: string[]): ScanLine[] {
  return text.map((line, y) => ({ text: line, cells: [...line].map((_, x) => ({ x, y })) }));
}

/** Resolve against a fake disk: absolute paths only, the way they are printed. */
function disk(...paths: string[]) {
  const set = new Set(paths);
  return async (raw: string) => (set.has(raw) ? raw : null);
}

async function links(lines: ScanLine[], cols: number, existing: string[], row?: number) {
  const found = await pickPathLinks(pathCandidates(lines, cols, row), disk(...existing));
  return found.map((f) => f.raw);
}

const CLIP = String.raw`C:\Users\Alexis Munch\Videos\PackAKpopIdol_Promo\previews\S07_base_custom_orbit_t3_preview_1080p.mp4`;

// --- tests -----------------------------------------------------------------

await test('a path with a space in it is one link (the ticket)', async () => {
  assert.deepEqual(await links(rows(`saved to ${CLIP}`), 200, [CLIP]), [CLIP]);
});

await test('the half after the space does not win as a relative path', async () => {
  // From `C:\Users\Alexis`, `Munch\Videos\...` would resolve too; the path
  // that starts first swallowed it.
  const rel = String.raw`Munch\Videos\PackAKpopIdol_Promo\previews\S07_base_custom_orbit_t3_preview_1080p.mp4`;
  assert.deepEqual(await links(rows(CLIP), 200, [CLIP, rel]), [CLIP]);
});

await test('two paths separated by a space stay two paths', async () => {
  assert.deepEqual(await links(rows('src/a.ts src/b.ts'), 80, ['src/a.ts', 'src/b.ts']), ['src/a.ts', 'src/b.ts']);
});

await test('column alignment (two spaces) is never stitched', async () => {
  const lines = rows('C:\\My  Dir\\x.txt');
  assert.deepEqual(await links(lines, 80, ['C:\\My  Dir\\x.txt']), []);
});

await test('a position suffix still splits off a stitched path', async () => {
  const lines = rows('error at C:\\My Dir\\main.rs:42:7: oops');
  const found = await pickPathLinks(pathCandidates(lines, 80), disk('C:\\My Dir\\main.rs'));
  assert.equal(found.length, 1);
  assert.equal(found[0].raw, 'C:\\My Dir\\main.rs');
  assert.equal(found[0].line, 42);
  assert.equal(found[0].column, 7);
});

await test('a path cut mid-word at the right edge joins the next row', async () => {
  // 40 columns, the path runs into the edge and goes on, indented, below.
  const head = CLIP.slice(0, 38);
  const tail = CLIP.slice(38);
  const lines = rows(`> ${head}`, `  ${tail}`);
  assert.deepEqual(await links(lines, 40, [CLIP]), [CLIP]);
  // Hovering either row finds it.
  assert.deepEqual(await links(lines, 40, [CLIP], 0), [CLIP]);
  assert.deepEqual(await links(lines, 40, [CLIP], 1), [CLIP]);
});

await test('a path wrapped at its space joins the next row with that space', async () => {
  // `C:\Users\Alexis` then the rest did not fit on the row: wrapped at the space.
  const lines = rows('see C:\\Users\\Alexis', 'Munch\\Videos\\clip-with-a-long-name.mp4');
  const target = 'C:\\Users\\Alexis Munch\\Videos\\clip-with-a-long-name.mp4';
  assert.deepEqual(await links(lines, 24, [target]), [target]);
});

await test('a link over two rows covers both rows, in reading order', async () => {
  const head = CLIP.slice(0, 40);
  const lines = rows(head, CLIP.slice(40));
  const [found] = await pickPathLinks(pathCandidates(lines, 40), disk(CLIP));
  assert.deepEqual(found.cells[0], { x: 0, y: 0 });
  assert.deepEqual(found.cells[found.cells.length - 1], { x: CLIP.length - 41, y: 1 });
});

await test('short rows of `ls` output are not stitched together', async () => {
  // Rows far from the edge are not wrapped: no `src/a.tssrc/b.ts` lookup.
  const candidates = pathCandidates(rows('src/a.ts', 'src/b.ts'), 80);
  assert.deepEqual(
    candidates.map((c) => c.variants.map((v) => v.raw)),
    [['src/a.ts'], ['src/b.ts']]
  );
});

await test('the longest existing length wins over a shorter one', async () => {
  // `C:\Users\Alexis` may well exist on its own; the full path is longer.
  const lines = rows(CLIP);
  assert.deepEqual(await links(lines, 200, ['C:\\Users\\Alexis', CLIP]), [CLIP]);
});

await test('a missing longer path falls back to the run that exists', async () => {
  assert.deepEqual(await links(rows('open src/a.ts now'), 80, ['src/a.ts']), ['src/a.ts']);
});

await test('with a row, paths that never reach it are dropped before any lookup', async () => {
  const lines = rows('src/a.ts', 'nothing here', 'src/b.ts');
  assert.deepEqual(
    pathCandidates(lines, 80, 2).map((c) => c.variants[0].raw),
    ['src/b.ts']
  );
});

await test('parseCandidate keeps its old contract', () => {
  assert.deepEqual(parseCandidate('(src/main.rs:42:7)', 3), { raw: 'src/main.rs', line: 42, column: 7, index: 4, length: 17 });
  assert.equal(parseCandidate('https://x.dev/a', 0), null);
  assert.equal(parseCandidate('--flag/x', 0), null);
  assert.equal(parseCandidate('/', 0), null);
});

report();
