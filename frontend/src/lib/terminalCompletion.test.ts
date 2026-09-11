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
  acceptanceFor,
  aliasCandidates,
  aliasHintFor,
  completeLine,
  ghostFor,
  resolveAlias,
  type AliasSource,
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

// ---------------------------------------------------------------------------
// Aliases (#38) — the registry CortX already owns, as a completion source
// ---------------------------------------------------------------------------

/** One row of Shell Config, with only the fields the engine reads. */
function al(name: string, command: string, extra: Partial<AliasSource> = {}): AliasSource {
  return { name, command, ...extra };
}

const registry = aliasCandidates([
  al('cc', 'claude --dangerously-skip-permissions', { description: 'Claude, unattended' }),
  al('gs', 'git status'),
  al('ls', 'ls --color=auto'),
  // Both faces of the `script` type, taken from the real registry: one that
  // declares a command of its own name, one that is a block of init code.
  al('wslpath', '-', {
    aliasType: 'script',
    script: { powershell: 'function wslpath {\n  return 1\n}' },
  }),
  al('omp-init', '-', {
    aliasType: 'script',
    script: { powershell: '$t = "alxs"\noh-my-posh init pwsh' },
  }),
  al('zoxide-init', '-', { aliasType: 'init', script: { bash: 'zoxide init bash' } }),
]);

test('a script alias is offered only when it declares a command of its own name', () => {
  const names = registry.map((a) => a.name);
  assert.deepEqual(names, ['cc', 'gs', 'ls', 'wslpath']);
  // `omp-init` sets variables and calls oh-my-posh; nothing named `omp-init`
  // exists afterwards. `zoxide-init` is a tool's own output handed to `eval`:
  // its name is a label for the block, never a first token. Offering either
  // would be inventing a command.
  assert.equal(registry.find((a) => a.name === 'wslpath')?.target, null, 'never followed');
  assert.equal(registry.find((a) => a.name === 'wslpath')?.expansion, '', 'one body per shell');
});

test('an alias is a first-token candidate, with its expansion as the detail', () => {
  const items = completeLine('c', { aliases: registry }, 10);
  const cc = items.find((i) => i.value === 'cc');
  assert.ok(cc, 'cc is offered for the prefix c');
  assert.equal(cc?.kind, 'alias');
  assert.equal(cc?.detail, 'Claude, unattended');
  assert.equal(cc?.from, 0);
  // Nothing else is: `gs` and `ls` do not start with a c.
  assert.equal(items.filter((i) => i.kind === 'alias').length, 1);
});

test('an alias is only ever a first token', () => {
  const items = completeLine('git c', { aliases: registry }, 10);
  assert.equal(items.filter((i) => i.kind === 'alias').length, 0);
});

test('an alias that is used outranks the history, one that is not does not', () => {
  const cold = completeLine('c', { aliases: registry, history: [h('cargo build', 9)] }, 10);
  assert.equal(cold[0].kind, 'history', 'an unused alias stays under the history');

  // The ticket's corollary, done as evidence rather than as an identity: the
  // runs of `cc` *and* of `claude` both count, and what is offered is still
  // the form the user types.
  const warm = completeLine(
    'c',
    {
      aliases: registry,
      history: [h('cargo build', 9), h('cc', 9, { count: 30 }), h('claude --resume', 9, { count: 40 })],
    },
    10
  );
  assert.equal(warm[0].value, 'cc');
  assert.equal(warm[0].kind, 'alias');
});

test('an alias resolves to the program whose flags it really takes', () => {
  const cc = registry.find((a) => a.name === 'cc');
  assert.equal(cc?.target, 'claude');
  assert.equal(cc?.targetShift, 1, '`--dangerously-skip-permissions` is one word already supplied');
});

test('an alias that resolves back to its own name is not followed', () => {
  // The walk that looks up the spec would go straight back where it started,
  // and looking `ls` up directly is what happens with no alias at all.
  const ls = registry.find((a) => a.name === 'ls');
  assert.equal(ls?.target, null);
  assert.equal(resolveAlias('ls', [al('ls', 'ls --color=auto')]), null);
  // Same answer when the name only comes back after a hop.
  assert.equal(resolveAlias('a', [al('a', 'b -x'), al('b', 'a -y')]), null);
  // And when it comes back as the program of a longer path.
  assert.equal(resolveAlias('ls', [al('ls', '/usr/bin/ls --color')]), null);
});

test('an alias chain is followed, and a word already supplied is counted', () => {
  const chain = [al('c1', 'c2 --flag'), al('c2', 'cargo build')];
  assert.deepEqual(resolveAlias('c1', chain), {
    program: 'cargo',
    shift: 2,
    expansion: 'c2 --flag',
  });
  assert.equal(resolveAlias('cargo', chain), null, 'a plain program is not an alias');
});

test('a launcher suffix and a quoted path are stripped off the target', () => {
  const found = resolveAlias('cx', [al('cx', '"C:\\Program Files\\nodejs\\claude.cmd" --print')]);
  assert.equal(found?.program, 'claude');
  assert.equal(found?.shift, 1);
});

test('the subcommand slot is not offered twice for an alias that fills it', () => {
  // `gs` is `git status`, so the word after it is git's *second* argument.
  const data: CompletionData = { spec: spec(['status', 'stash']), specShift: 1 };
  const withShift = completeLine('gs st', data, 10);
  assert.equal(withShift.filter((i) => i.kind === 'subcommand').length, 0);
  // Without the shift it is the ordinary subcommand slot, unchanged.
  const plain = completeLine('git st', { spec: spec(['status', 'stash']) }, 10);
  assert.equal(plain.filter((i) => i.kind === 'subcommand').length, 2);
});

test('what is offered is the name, never the expansion', () => {
  // #38 changes what is *proposed*; the line is never rewritten. Accepting
  // `cc` types `cc`, and the shell expands it as it does today.
  const cc = completeLine('c', { aliases: registry }, 10).find((i) => i.kind === 'alias');
  assert.equal(cc?.value, 'cc');
  assert.equal(cc?.label, 'cc');
  assert.equal(
    acceptanceFor('c', cc!)?.text,
    'c ',
    'one keystroke and a space, not the expansion'
  );
});

test('the expansion is shown back, but only on an exact name', () => {
  assert.equal(aliasHintFor('cc --resume', registry), 'cc → claude --dangerously-skip-permissions');
  assert.equal(aliasHintFor('cc', registry), 'cc → claude --dangerously-skip-permissions');
  assert.equal(aliasHintFor('c', registry), null, 'a prefix is not yet an alias');
  assert.equal(aliasHintFor('cargo build', registry), null);
  assert.equal(aliasHintFor('', registry), null);
  // Even the ones that must never be expanded are explained.
  assert.equal(aliasHintFor('ls -l', registry), 'ls → ls --color=auto');
});

report('terminalCompletion');
