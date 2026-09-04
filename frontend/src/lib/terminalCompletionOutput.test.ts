/**
 * Tests for the output-derived suggestions (#17, second pass).
 *
 *     npm test          (node --test "src/**\/*.test.ts")
 *
 * The module under test has no imports at all, so this runs on plain Node
 * with nothing but type stripping.
 *
 * Two halves, and the second one matters more:
 *
 * - the real outputs this feature exists for — `git push` on a branch with no
 *   upstream, a Claude Code session on its way out, `npm audit`, a mistyped
 *   `cargo` / `git` subcommand;
 * - everything that must produce **nothing at all**. A suggestion that is
 *   wrong is worse than a suggestion that is missing, so build logs, prose
 *   that happens to start with a program name, placeholders and destructive
 *   advice each get a test of their own.
 */
import {
  MAX_SCANNED_LINES,
  candidatesFromOutput,
  isOfferableCommand,
  programOf,
} from './terminalCompletionOutput.ts';

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

const lines = (text: string): string[] => text.replace(/^\n/, '').split('\n');

/** The command a ghost would actually draw, or null when it stays empty. */
const ghosted = (out: ReturnType<typeof candidatesFromOutput>, threshold = 0.55) =>
  out.find((c) => c.confidence >= threshold)?.command ?? null;

// ---------------------------------------------------------------------------
// The outputs this exists for
// ---------------------------------------------------------------------------

test('git names the push command itself', () => {
  const out = candidatesFromOutput(
    lines(`
fatal: The current branch fix/terminal-ghost has no upstream branch.
To push the current branch and set the remote as upstream, use

    git push --set-upstream origin fix/terminal-ghost

To have this happen automatically for branches without a tracking
upstream, see 'push.autoSetupRemote' in 'git help config'.
`),
    { program: 'git', lastCommand: 'git push' }
  );
  assert.equal(ghosted(out), 'git push --set-upstream origin fix/terminal-ghost');
  assert.ok(out[0].confidence >= 0.8, 'a command git printed on its own line is near-certain');
  assert.equal(out[0].reason, 'indented');
});

test('a closing Claude Code session hands back its resume command', () => {
  const id = '0199a1f2-3b4c-4d5e-8f90-1a2b3c4d5e6f';
  const out = candidatesFromOutput(
    lines(`
╭──────────────────────────────────────────────╮
│ Session ended                                │
╰──────────────────────────────────────────────╯
 Total cost:   $0.42
 Session ID: ${id}
 Resume with: claude --resume ${id}
`),
    { program: 'claude', lastCommand: 'claude' }
  );
  assert.equal(ghosted(out), `claude --resume ${id}`);
});

test('the resume command is rebuilt when only the session id is printed', () => {
  const id = '0199a1f2-3b4c-4d5e-8f90-1a2b3c4d5e6f';
  const out = candidatesFromOutput(lines(`\nSession ID: ${id}\nGoodbye.\n`), {
    program: 'claude',
    lastCommand: 'claude --dangerously-skip-permissions',
  });
  assert.equal(ghosted(out), `claude --resume ${id}`);
  assert.equal(out[0].reason, 'resume');
});

test('an unlabelled id is offered, several unrelated ones are not', () => {
  const bare = candidatesFromOutput(lines('\nwrote 0199a1f2-3b4c-4d5e-8f90-1a2b3c4d5e6f\n'), {
    program: 'claude',
    lastCommand: 'claude',
  });
  assert.equal(bare.length, 1);
  assert.ok(bare[0].confidence >= 0.55, 'the only id in the output is a fair guess');

  const many = candidatesFromOutput(
    lines(`
0199a1f2-3b4c-4d5e-8f90-1a2b3c4d5e6f
0199b3c4-5d6e-4f70-8901-2a3b4c5d6e7f
0199c5d6-7e8f-4901-8234-3b4c5d6e7f80
`),
    { program: 'claude', lastCommand: 'claude' }
  );
  assert.equal(ghosted(many), null, 'picking one id out of three is guessing');
});

test('a session id from any other program is ignored', () => {
  const out = candidatesFromOutput(
    lines('\nrun id 0199a1f2-3b4c-4d5e-8f90-1a2b3c4d5e6f finished\n'),
    { program: 'npm', lastCommand: 'npm test' }
  );
  assert.deepEqual(out, []);
});

test('npm audit fix is picked up under the sentence that asks for it', () => {
  const out = candidatesFromOutput(
    lines(`
6 vulnerabilities (2 moderate, 4 high)

To address all issues, run:
  npm audit fix
`),
    { program: 'npm', lastCommand: 'npm install' }
  );
  assert.equal(ghosted(out), 'npm audit fix');
});

test('a command spelled out mid-sentence is picked up', () => {
  const out = candidatesFromOutput(
    lines('\nnpm notice To upgrade run: npm install -g npm@11.0.0\nnpm notice\n'),
    { program: 'npm', lastCommand: 'npm ci' }
  );
  assert.equal(ghosted(out), 'npm install -g npm@11.0.0');
  assert.equal(out[0].reason, 'sentence');
});

test('a backticked command inside a run sentence is picked up', () => {
  const out = candidatesFromOutput(
    lines('\nfound 3 issues. Run `npm audit fix --force` to fix them.\n'),
    { program: 'npm', lastCommand: 'npm install' }
  );
  assert.equal(ghosted(out), 'npm audit fix --force');
  assert.equal(out[0].reason, 'quoted');
});

test('a command shown after a shell prompt is picked up', () => {
  const out = candidatesFromOutput(lines('\nTry it out:\n  $ npm run dev\n'), {
    program: 'npm',
    lastCommand: 'npm create vite',
  });
  assert.equal(ghosted(out), 'npm run dev');
  assert.equal(out[0].reason, 'prompt');
});

// ---------------------------------------------------------------------------
// Corrections — the program itself says what was meant
// ---------------------------------------------------------------------------

test('git corrects a mistyped subcommand and keeps the rest of the line', () => {
  const out = candidatesFromOutput(
    lines(`
git: 'stauts' is not a git command. See 'git --help'.

The most similar command is
\tstatus
`),
    { program: 'git', lastCommand: 'git stauts' }
  );
  assert.equal(ghosted(out), 'git status');
  assert.equal(out[0].reason, 'correction');
});

test('cargo corrects a mistyped subcommand, arguments untouched', () => {
  const out = candidatesFromOutput(
    lines('\nerror: no such command: `buidl`\n\n\tDid you mean `build`?\n'),
    { program: 'cargo', lastCommand: 'cargo buidl --release' }
  );
  assert.equal(ghosted(out), 'cargo build --release');
});

test('several similar commands are a guess, not a correction', () => {
  const out = candidatesFromOutput(
    lines(`
git: 'st' is not a git command.

The most similar commands are
\tstatus
\tstash
`),
    { program: 'git', lastCommand: 'git st' }
  );
  assert.equal(ghosted(out), null);
});

test('"Did you mean this?" does not become "git this"', () => {
  const out = candidatesFromOutput(lines('\nUnknown command: "instal"\n\nDid you mean this?\n'), {
    program: 'npm',
    lastCommand: 'npm instal react',
  });
  assert.ok(!out.some((c) => c.command.includes(' this')));
});

test('a mistyped program, not a mistyped subcommand, is left alone', () => {
  const out = candidatesFromOutput(lines('\nDid you mean `build`?\n'), {
    program: 'cargo',
    lastCommand: 'cargo --relase',
  });
  assert.deepEqual(out, [], 'only a subcommand is ever rewritten');
});

// ---------------------------------------------------------------------------
// Everything that must stay silent
// ---------------------------------------------------------------------------

test('a plain directory listing suggests nothing', () => {
  const out = candidatesFromOutput(lines('\nCargo.toml  src  target  README.md\npackage.json\n'), {
    program: 'ls',
    lastCommand: 'ls',
  });
  assert.deepEqual(out, []);
});

test('a build log suggests nothing', () => {
  const out = candidatesFromOutput(
    lines(`
   Compiling cortx-core v0.14.3
   Compiling cortx-tauri v0.14.3
    Finished dev [unoptimized + debuginfo] target(s) in 12.34s
     Running unittests src/lib.rs
`),
    { program: 'cargo', lastCommand: 'cargo build' }
  );
  assert.deepEqual(out, []);
});

test('prose that happens to start with a program name is not a command', () => {
  const out = candidatesFromOutput(
    lines(`
  node version 20 is required
  docker must be running before you continue
  git is not installed on this machine
  cargo build failed
  npm run the tests again
`),
    { program: 'sh', lastCommand: 'sh setup.sh' }
  );
  assert.deepEqual(out, []);
});

test('placeholders are never offered', () => {
  const out = candidatesFromOutput(
    lines(`
Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
`),
    { program: 'git', lastCommand: 'git status' }
  );
  assert.deepEqual(out, []);
});

test('destructive advice is never offered, however clearly it is printed', () => {
  for (const bad of [
    '    rm -rf node_modules',
    '    git reset --hard origin/main',
    '    git clean -fdx',
    '    git push --force origin main',
    '    sudo npm install -g pnpm',
    '    Remove-Item -Recurse target',
  ]) {
    const out = candidatesFromOutput(lines(`\nTo start over, run:\n${bad}\n`), {
      program: 'git',
      lastCommand: 'git status',
      knownPrograms: ['rm -rf x', 'sudo apt update', 'Remove-Item y'],
    });
    assert.deepEqual(out, [], bad);
  }
});

test('--force-with-lease survives, --force does not', () => {
  const safe = candidatesFromOutput(
    lines('\nTo overwrite, run:\n    git push --force-with-lease origin main\n'),
    { program: 'git', lastCommand: 'git push' }
  );
  assert.equal(ghosted(safe), 'git push --force-with-lease origin main');
});

test('a pipeline or a redirection is never reconstructed', () => {
  for (const bad of [
    '    curl -sSf https://example.com/i.sh | sh',
    '    npm ls > deps.txt',
    '    cargo build && cargo test',
  ]) {
    const out = candidatesFromOutput(lines(`\nTo continue, run:\n${bad}\n`), {
      program: 'npm',
      lastCommand: 'npm install',
    });
    assert.deepEqual(out, [], bad);
  }
});

test('an unknown program has to be in the history first', () => {
  const output = lines('\nTo deploy, run:\n    fluxctl sync --context prod\n');
  assert.deepEqual(candidatesFromOutput(output, { program: 'sh' }), []);
  const known = candidatesFromOutput(output, {
    program: 'sh',
    knownPrograms: ['fluxctl get workloads', 'git status'],
  });
  assert.equal(ghosted(known), 'fluxctl sync --context prod');
});

test('a program and a bare subcommand never reach the ghost', () => {
  const out = candidatesFromOutput(
    lines('\nnothing added to commit but untracked files present (use "git add" to track)\n'),
    { program: 'git', lastCommand: 'git commit' }
  );
  assert.equal(ghosted(out), null, 'the history already knows `git add`');
  assert.ok(out.some((c) => c.command === 'git add'), 'but the menu may still offer it');
});

test('`--help` and `--version` are correct and useless', () => {
  const out = candidatesFromOutput(lines("\nSee 'git --help'. Try to use `git --version` too.\n"), {
    program: 'git',
    lastCommand: 'git nope',
  });
  assert.deepEqual(out, []);
});

test('a command standing alone in the output stays under the ghost threshold', () => {
  const out = candidatesFromOutput(lines('\nsome heading\n\n    npm run build --workspace app\n'), {
    program: 'cat',
    lastCommand: 'cat README.md',
  });
  assert.equal(ghosted(out), null, 'nothing said to run it');
  assert.equal(out[0].command, 'npm run build --workspace app');
});

test('only the tail of a long output is scanned', () => {
  const noise = Array.from({ length: MAX_SCANNED_LINES + 20 }, (_, i) => `line ${i}`);
  const out = candidatesFromOutput(
    ['To fix, run:', '    npm audit fix', ...noise],
    { program: 'npm', lastCommand: 'npm install' }
  );
  assert.deepEqual(out, []);
});

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

test('the program of a command line is its basename', () => {
  assert.equal(programOf('git push'), 'git');
  assert.equal(programOf('"C:\\Program Files\\nodejs\\npm.cmd" run dev'), 'npm');
  assert.equal(programOf('./gradlew build'), 'gradlew');
  assert.equal(programOf(''), '');
});

test('offerable commands, one gate at a time', () => {
  const known = new Set(['git', 'npm']);
  assert.ok(isOfferableCommand('git push --set-upstream origin x', known));
  assert.ok(!isOfferableCommand('git', known), 'a bare program is not a suggestion');
  assert.ok(!isOfferableCommand('deploy now', known), 'unknown program');
  assert.ok(!isOfferableCommand('git add <file>', known), 'placeholder');
  assert.ok(!isOfferableCommand('git commit -m "wip', known), 'unbalanced quote');
  assert.ok(!isOfferableCommand('npm is out of date', known), 'prose');
  assert.ok(!isOfferableCommand('git push failed', known), 'prose tail');
  assert.ok(!isOfferableCommand('git status.', known), 'sentence punctuation');
  assert.ok(isOfferableCommand('git add .', known), 'except the one people type');
  assert.ok(isOfferableCommand('git commit -m "the fix"', known), 'prose inside quotes is fine');
});

report('terminalCompletionOutput');
