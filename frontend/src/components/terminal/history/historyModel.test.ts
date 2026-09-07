/**
 * Tests for the command-history model (#39).
 *
 * Same shape as `terminalBlockModel.test.ts`: the module under test imports no
 * value at all (its two imports are `import type`, which Node strips), so this
 * runs on plain Node —
 *
 *     bun run test      (node --test "src/**\/*.test.ts")
 *
 * What is worth pinning down is the wording (a duration that jumps from
 * `950 ms` to `1.0 s` and an age that says `yesterday` are the two things you
 * read on every row), the translation of the filter bar into a backend query —
 * where sending `""` instead of dropping the key would silently mean "match
 * the empty string" — and the fact that a history row inherits the block
 * toolbar's refusals rather than inventing its own.
 */
import type { HistoryRecord } from '@/lib/tauri';
import {
  EMPTY_HISTORY_FILTERS,
  HISTORY_BLOCK_ACTIONS,
  buildQuery,
  exitLabel,
  exitTone,
  filtersAreEmpty,
  formatAge,
  formatDuration,
  historyCommandLabel,
  historyRowKey,
  recordActionContext,
  recordAsBlock,
  shortDir,
  type HistoryFilters,
} from './historyModel.ts';

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
  deepEqual(actual: unknown, expected: unknown, note = '') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`expected ${b}, got ${a}${note ? ` (${note})` : ''}`);
  },
  ok(value: unknown, note = '') {
    if (!value) throw new Error(`expected truthy${note ? ` (${note})` : ''}`);
  },
};

function report() {
  console.log(`historyModel: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  x ${f}`);
    throw new Error(`${failures.length} test(s) failed`);
  }
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function record(over: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    ts: 1_757_000_000_000,
    terminalId: 'shell:a',
    durationMs: 1200,
    command: 'cargo build',
    cwd: 'C:/work/cortx/frontend',
    projectId: 'cortx',
    exitCode: 0,
    ...over,
  };
}

// --- ages ------------------------------------------------------------------

test('an age says the least it can get away with', () => {
  const now = 10 * DAY;
  assert.equal(formatAge(now - 5 * SECOND, now), 'just now');
  assert.equal(formatAge(now - 59 * SECOND, now), 'just now');
  assert.equal(formatAge(now - 3 * MINUTE, now), '3 min ago');
  assert.equal(formatAge(now - HOUR, now), '1 h ago');
  assert.equal(formatAge(now - 5 * HOUR, now), '5 h ago');
  assert.equal(formatAge(now - DAY, now), 'yesterday');
  assert.equal(formatAge(now - 3 * DAY, now), '3 days ago');
});

test('an age past a week rounds up to weeks and months', () => {
  const now = 400 * DAY;
  assert.equal(formatAge(now - 8 * DAY, now), '1 week ago');
  assert.equal(formatAge(now - 20 * DAY, now), '2 weeks ago');
  assert.equal(formatAge(now - 200 * DAY, now), '6 months ago');
});

test('a record from the future reads as now, never as a negative age', () => {
  assert.equal(formatAge(1000, 0), 'just now', 'a clock that moved back');
  assert.equal(formatAge(Number.NaN, 0), 'just now');
});

// --- durations -------------------------------------------------------------

test('a duration never shows more than two units', () => {
  assert.equal(formatDuration(0), '0 ms');
  assert.equal(formatDuration(42), '42 ms');
  assert.equal(formatDuration(999), '999 ms', 'sub-second stays in milliseconds');
  assert.equal(formatDuration(1000), '1.0 s');
  assert.equal(formatDuration(4230), '4.2 s');
  assert.equal(formatDuration(12_400), '12 s', 'past ten seconds the decimal says nothing');
  assert.equal(formatDuration(90_000), '1 min 30 s');
  assert.equal(formatDuration(120_000), '2 min', 'a round minute drops the seconds');
  assert.equal(formatDuration(3 * HOUR), '3 h');
  assert.equal(formatDuration(3 * HOUR + 12 * MINUTE), '3 h 12 min');
});

test('a nonsense duration renders as nothing rather than as NaN', () => {
  assert.equal(formatDuration(-1), '');
  assert.equal(formatDuration(Number.NaN), '');
});

// --- exit codes ------------------------------------------------------------

test('an unknown exit code is not a failure', () => {
  assert.equal(exitTone(0), 'ok');
  assert.equal(exitTone(1), 'failed');
  assert.equal(exitTone(130), 'failed');
  assert.equal(exitTone(undefined), 'unknown', 'the shell never reported one');
  assert.equal(exitTone(null), 'unknown');
  assert.equal(exitLabel(0), 'ok');
  assert.equal(exitLabel(101), 'exit 101');
  assert.equal(exitLabel(undefined), '');
});

// --- paths and commands ----------------------------------------------------

test('a directory keeps its tail, whichever separator wrote it', () => {
  assert.equal(shortDir('C:/work/cortx/frontend'), '…/cortx/frontend');
  assert.equal(shortDir('C:\\work\\cortx\\frontend'), '…/cortx/frontend');
  assert.equal(shortDir('/work/cortx/frontend/src', 3), '…/cortx/frontend/src');
  assert.equal(shortDir('/tmp'), '/tmp', 'short enough to show whole');
  assert.equal(shortDir(undefined), '');
  assert.equal(shortDir(null), '');
});

test('a command is flattened to one line and elided', () => {
  assert.equal(historyCommandLabel('  git   status  '), 'git status');
  assert.equal(historyCommandLabel('a\nb\nc'), 'a b c', 'a multi-line command must not break the row');
  assert.equal(historyCommandLabel('x'.repeat(20), 10), `${'x'.repeat(9)}…`);
  assert.equal(historyCommandLabel(null), '');
});

test('two commands finishing in the same millisecond get different keys', () => {
  const a = record();
  const b = record();
  assert.ok(historyRowKey(a, 0) !== historyRowKey(b, 1), 'the position takes part in the key');
});

// --- filters -> query ------------------------------------------------------

test('an empty filter bar asks for the whole file', () => {
  assert.ok(filtersAreEmpty(EMPTY_HISTORY_FILTERS));
  assert.deepEqual(buildQuery(EMPTY_HISTORY_FILTERS, 0, 50), { limit: 50, offset: 0 });
});

test('empty fields are dropped, not sent as empty strings', () => {
  const filters: HistoryFilters = { ...EMPTY_HISTORY_FILTERS, search: '   ', projectId: '', cwd: '' };
  const query = buildQuery(filters, 0, 10);
  assert.deepEqual(query, { limit: 10, offset: 0 }, 'a blank search is no search at all');
});

test('every filter reaches the backend, and paging is offset by page', () => {
  const filters: HistoryFilters = {
    search: ' docker  compose ',
    projectId: 'cortx',
    cwd: 'C:/work/cortx',
    failuresOnly: true,
    slowOnly: true,
    slowSeconds: 10,
  };
  assert.deepEqual(buildQuery(filters, 2, 100), {
    limit: 100,
    offset: 200,
    search: 'docker  compose',
    projectId: 'cortx',
    cwd: 'C:/work/cortx',
    failuresOnly: true,
    minDurationMs: 10_000,
  });
  assert.ok(!filtersAreEmpty(filters));
});

test('a negative page cannot ask for a negative offset', () => {
  assert.equal(buildQuery(EMPTY_HISTORY_FILTERS, -3, 20).offset, 0);
});

test('the slow filter only bites when it is switched on', () => {
  const armed: HistoryFilters = { ...EMPTY_HISTORY_FILTERS, slowSeconds: 60 };
  assert.equal(buildQuery(armed, 0).minDurationMs, undefined, 'a threshold with the switch off is not a filter');
  assert.equal(buildQuery({ ...armed, slowOnly: true }, 0).minDurationMs, 60_000);
});

// --- actions borrowed from the block toolbar -------------------------------

test('a record dresses up as the finished block it once was', () => {
  const block = recordAsBlock(record({ exitCode: 101 }));
  assert.equal(block.status, 'done');
  assert.equal(block.exitCode, 101);
  assert.equal(block.command, 'cargo build');
  assert.equal(block.folded, false);
  assert.equal(recordAsBlock(record({ command: undefined })).command, null);
});

test('the history never claims to have output it did not keep', () => {
  const ctx = recordActionContext(record(), { atPrompt: true, inputEditor: false });
  assert.equal(ctx.hiddenLines, 0, 'only the command is stored, so every output action is refused');
  assert.equal(ctx.hasCommand, true);
  assert.equal(recordActionContext(record({ command: '   ' }), { atPrompt: true, inputEditor: false }).hasCommand, false);
});

test('the busy and input-editor refusals are handed straight to the block list', () => {
  const busy = recordActionContext(record(), { atPrompt: false, inputEditor: false });
  assert.equal(busy.atPrompt, false);
  const editing = recordActionContext(record(), { atPrompt: true, inputEditor: true });
  assert.equal(editing.inputEditor, true);
});

test('the three borrowed actions are the ones a row can honour', () => {
  assert.deepEqual([...HISTORY_BLOCK_ACTIONS], ['rerun', 'reinput', 'copyCommand']);
});

report();
