/**
 * Tests for the ghost text's confidence gate (#17, second pass).
 *
 *     npm test          (node --test "src/**\/*.test.ts")
 *
 * The engine is pure and its only imports are types, so this runs on plain
 * Node with nothing but type stripping.
 *
 * The first implementation always drew *something*, and that is what made it
 * worse than useless: two letters would pull a sixty-character command out of
 * the history, and a lone filename would turn `cargo b` into `cargo build.rs`.
 * What is pinned down here is the opposite behaviour — the cases where the
 * right answer is to draw nothing.
 */
import {
  GHOST_THRESHOLDS,
  completeLine,
  ghostFor,
  type CompletionData,
} from './terminalCompletion.ts';

// --- a test runner in twenty lines (same shape as the sibling test files) ---

const failures: string[] = [];
let passed = 0;

function test(name: string, body: () => void) {
  try {
    body();
    passed++;
  } catch (error) {
    failures.push(`${name}
    ${error instanceof Error ? error.message : String(error)}`);
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
  ok(value: unknown, note = '') {
    if (!value) throw new Error(`expected a truthy value, got ${JSON.stringify(value)}${note ? ` (${note})` : ''}`);
  },
};

function report(label: string) {
  console.log(`${label}: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} test(s) failed`);
  }
}

type Hist = CompletionData['history'];

/** One history entry, run here, successfully. */
function h(command: string, score: number, extra: Partial<NonNullable<Hist>[number]> = {}) {
  return {
    command,
    score,
    count: 5,
    lastTs: 0,
    failed: false,
    sameCwd: true,
    sameProject: true,
    ...extra,
  };
}

const balanced = { threshold: GHOST_THRESHOLDS.balanced };

/** A learned `--help` spec with only the fields the engine reads. */
function spec(subcommands: string[], flags: string[] = []): CompletionData['spec'] {
  const item = (name: string) => ({ name, takesValue: false });
  return {
    command: 'cargo',
    subcommands: subcommands.map(item),
    flags: flags.map(item),
    fetchedAt: 0,
    source: '--help',
  };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

test('a prefix that clearly points at one command is completed', () => {
  const ghost = ghostFor('npm run bu', { history: [h('npm run build', 8)] }, balanced);
  assert.equal(ghost?.text, 'ild');
  assert.equal(ghost?.source, 'history');
});

test('two commands that diverge at the cursor say nothing', () => {
  const data = { history: [h('git commit -m wip', 8), h('git checkout main', 7.9)] };
  assert.equal(ghostFor('git c', data, balanced), null);
  // Once the prefix picks a side, the ghost comes back.
  assert.equal(ghostFor('git co', data, balanced)?.text, 'mmit -m wip');
});

test('a clear winner survives a rival', () => {
  const data = { history: [h('git commit -m wip', 9), h('git checkout main', 3)] };
  assert.equal(ghostFor('git c', data, balanced)?.text, 'ommit -m wip');
});

test('entries that share the prefix are not rivals', () => {
  const data = { history: [h('npm run build', 8), h('npm run build:watch', 7.9)] };
  assert.equal(ghostFor('npm run b', data, balanced)?.text, 'uild');
});

test('two letters do not pull in a long command', () => {
  const long = 'docker compose -f docker-compose.prod.yml up -d --remove-orphans';
  assert.equal(ghostFor('do', { history: [h(long, 8)] }, balanced), null);
  // Typing more of it is evidence, and the same suggestion then appears.
  assert.ok(ghostFor('docker compose -f', { history: [h(long, 8)] }, balanced));
});

test('a command that never once succeeded is not suggested', () => {
  const data = { history: [h('cargo bild', 6, { failed: true })] };
  assert.equal(ghostFor('cargo b', data, balanced), null);
});

test('a command run somewhere else is weaker than one run here', () => {
  const here = { history: [h('pytest -x', 5)] };
  const elsewhere = { history: [h('pytest -x', 5, { sameCwd: false, sameProject: false })] };
  const a = ghostFor('pyt', here, balanced);
  const b = ghostFor('pyt', elsewhere, balanced);
  assert.ok(a && (!b || a.confidence > b.confidence));
});

test('nothing is suggested below the minimum prefix', () => {
  assert.equal(ghostFor('n', { history: [h('npm run build', 9)] }, balanced), null);
});

// ---------------------------------------------------------------------------
// Word completions
// ---------------------------------------------------------------------------

test('a single matching subcommand is completed', () => {
  assert.equal(ghostFor('cargo bu', { spec: spec(['build']) }, balanced)?.text, 'ild');
});

test('several matching subcommands say nothing', () => {
  assert.equal(ghostFor('cargo b', { spec: spec(['build', 'bench']) }, balanced), null);
});

test('a file that happens to match the first argument is not a completion', () => {
  const data: CompletionData = { paths: [{ name: 'build.rs', value: 'build.rs', isDir: false }] };
  assert.equal(ghostFor('cargo bu', data, balanced), null, 'the user means `build`, not `build.rs`');
  // A separator says the user really is typing a path.
  const nested: CompletionData = {
    paths: [{ name: 'main.rs', value: 'src/main.rs', isDir: false }],
  };
  assert.equal(ghostFor('cargo run src/ma', nested, balanced)?.text, 'in.rs');
});

// ---------------------------------------------------------------------------
// Output candidates
// ---------------------------------------------------------------------------

test('what the last command printed beats what the history remembers', () => {
  const data: CompletionData = {
    history: [h('git push', 9)],
    output: [{ command: 'git push --set-upstream origin feat/x', confidence: 0.85, reason: 'indented' }],
  };
  const ghost = ghostFor('git pu', data, balanced);
  assert.equal(ghost?.source, 'output');
  assert.equal(ghost?.text, 'sh --set-upstream origin feat/x');
});

test('a low-confidence output candidate stays out of the ghost', () => {
  const data: CompletionData = {
    output: [{ command: 'git add', confidence: 0.5, reason: 'quoted' }],
  };
  assert.equal(ghostFor('git a', data, balanced), null);
  // …but the menu still lists it.
  assert.ok(completeLine('git a', data, 10).some((i) => i.kind === 'output'));
});

// ---------------------------------------------------------------------------
// The threshold itself
// ---------------------------------------------------------------------------

test('the confidence levels are ordered and actually change the answer', () => {
  assert.ok(GHOST_THRESHOLDS.strict > GHOST_THRESHOLDS.balanced);
  assert.ok(GHOST_THRESHOLDS.balanced > GHOST_THRESHOLDS.loose);
  const data = { history: [h('git commit -m wip', 8), h('git checkout main', 7.9)] };
  assert.equal(ghostFor('git c', data, { threshold: GHOST_THRESHOLDS.balanced }), null);
  assert.ok(ghostFor('git c', data, { threshold: GHOST_THRESHOLDS.loose }), 'loose still guesses');
});

test('the menu ranks the output above the history above the rest', () => {
  const data: CompletionData = {
    output: [{ command: 'npm audit fix', confidence: 0.85, reason: 'indented' }],
    history: [h('npm run build', 9)],
    npmScripts: [{ name: 'build', description: 'vite build', takesValue: false }],
  };
  const kinds = completeLine('npm', data, 10).map((i) => i.kind);
  assert.equal(kinds[0], 'output');
  assert.ok(kinds.includes('history'));
});

report('terminalCompletion');
