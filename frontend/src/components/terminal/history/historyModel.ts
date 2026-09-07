/**
 * Pure model of the command-history view (#39).
 *
 * `runtime/command-history.jsonl` has held when, where, in which project, with
 * which exit code and for how long every command ran since DEV-13 P0 — and
 * until now the only thing reading it was the ghost-text ranking. This module
 * holds the part of the view that is worth pinning down in a test: how a
 * record is worded (age, duration, exit code, directory), how the filter state
 * becomes a backend query, and which of the block toolbar's actions a history
 * row inherits.
 *
 * Nothing here imports a value, so it runs under `node --test` — see
 * `historyModel.test.ts`. The runtime glue (clipboard, PTY writes, Explorer)
 * lives in `historyActions.ts`.
 */
import type { BlockActionContext, BlockActionId, TerminalBlock } from '@/lib/terminalBlockModel';
import type { HistoryQuery, HistoryRecord } from '@/lib/tauri';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Rows fetched per page. One screenful is ~20; this is several scrolls. */
export const HISTORY_PAGE_SIZE = 120;

/**
 * What "a long command" means in the `Slow only` filter, in seconds.
 *
 * Hard-coded rather than a setting: `AppSettings.terminal` is owned by another
 * change right now. The chip offers the three thresholds below, and the view
 * remembers the choice for the session only.
 */
export const HISTORY_SLOW_SECONDS = [2, 10, 60] as const;
export type HistorySlowSeconds = (typeof HISTORY_SLOW_SECONDS)[number];
export const HISTORY_DEFAULT_SLOW_SECONDS: HistorySlowSeconds = 10;

// ---------------------------------------------------------------------------
// Filter state -> backend query
// ---------------------------------------------------------------------------

/** What the filter bar holds. Every field is "no filter" when empty/false. */
export interface HistoryFilters {
  search: string;
  /** Project id, or `''` for every project. */
  projectId: string;
  /** Exact working directory, or `''` for every directory. */
  cwd: string;
  /** Only commands that exited non-zero. */
  failuresOnly: boolean;
  /** Only commands that ran at least `slowSeconds`. */
  slowOnly: boolean;
  slowSeconds: HistorySlowSeconds;
}

export const EMPTY_HISTORY_FILTERS: HistoryFilters = {
  search: '',
  projectId: '',
  cwd: '',
  failuresOnly: false,
  slowOnly: false,
  slowSeconds: HISTORY_DEFAULT_SLOW_SECONDS,
};

/** True when nothing is filtering — used to word the empty state. */
export function filtersAreEmpty(f: HistoryFilters): boolean {
  return !f.search.trim() && !f.projectId && !f.cwd && !f.failuresOnly && !f.slowOnly;
}

/**
 * The backend query for one page. Empty fields are dropped rather than sent as
 * `""`, so Rust never has to tell "no filter" from "match the empty string".
 */
export function buildQuery(f: HistoryFilters, page: number, pageSize = HISTORY_PAGE_SIZE): HistoryQuery {
  const query: HistoryQuery = { limit: pageSize, offset: Math.max(0, page) * pageSize };
  const search = f.search.trim();
  if (search) query.search = search;
  if (f.projectId) query.projectId = f.projectId;
  if (f.cwd) query.cwd = f.cwd;
  if (f.failuresOnly) query.failuresOnly = true;
  if (f.slowOnly) query.minDurationMs = f.slowSeconds * 1000;
  return query;
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago a command finished, in the shortest form that still says it:
 * seconds under a minute, then minutes, hours, days, weeks. A record from the
 * future (a clock that moved) reads `just now` rather than a negative age.
 */
export function formatAge(ts: number, now: number): string {
  const ms = now - ts;
  if (!Number.isFinite(ms) || ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    return h === 1 ? '1 h ago' : `${h} h ago`;
  }
  const days = Math.floor(ms / DAY);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  return months <= 1 ? '1 month ago' : `${months} months ago`;
}

/**
 * How long it ran. Sub-second stays in milliseconds (that is the difference
 * between `ls` and `ls` over a network share), then one decimal of a second,
 * then minutes and hours — never more than two units, so the column keeps its
 * width.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < MINUTE) return `${Math.round(ms / 1000)} s`;
  if (ms < HOUR) {
    const min = Math.floor(ms / MINUTE);
    const sec = Math.round((ms % MINUTE) / 1000);
    return sec === 0 ? `${min} min` : `${min} min ${sec} s`;
  }
  const hours = Math.floor(ms / HOUR);
  const min = Math.round((ms % HOUR) / MINUTE);
  return min === 0 ? `${hours} h` : `${hours} h ${min} min`;
}

/** Right-hand column for the exit code: nothing when it succeeded. */
export function exitLabel(exitCode: number | null | undefined): string {
  if (exitCode === null || exitCode === undefined) return '';
  return exitCode === 0 ? 'ok' : `exit ${exitCode}`;
}

export type ExitTone = 'ok' | 'failed' | 'unknown';

/**
 * How to colour a row's exit code. An unknown code is *not* a failure — the
 * same rule the ranking uses, so a command interrupted before the shell could
 * report is never shown as broken.
 */
export function exitTone(exitCode: number | null | undefined): ExitTone {
  if (exitCode === null || exitCode === undefined) return 'unknown';
  return exitCode === 0 ? 'ok' : 'failed';
}

/**
 * A directory short enough for a column: the last two segments, prefixed with
 * an ellipsis when anything was dropped. Handles both separators, because the
 * history can hold paths written by a shell that used the other one.
 */
export function shortDir(path: string | null | undefined, segments = 2): string {
  if (!path) return '';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= segments) return path;
  return `…/${parts.slice(-segments).join('/')}`;
}

/** One line of a command, elided — long pipelines must not break the row. */
export function historyCommandLabel(command: string | null | undefined, max = 160): string {
  const oneLine = (command ?? '').replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/**
 * Stable React key. `ts` alone collides (two panes can finish inside the same
 * millisecond), so the terminal and the position take part.
 */
export function historyRowKey(record: HistoryRecord, index: number): string {
  return `${record.ts}:${record.terminalId}:${index}`;
}

// ---------------------------------------------------------------------------
// Actions, borrowed from the block toolbar
// ---------------------------------------------------------------------------

/**
 * The block-toolbar actions a history row inherits verbatim. They are asked
 * for by id from `blockActions` rather than re-declared, so their labels,
 * their hints and the reasons they are disabled stay the same as on the block
 * they came from — including "put back at the prompt" being refused while the
 * universal input editor owns the line.
 */
export const HISTORY_BLOCK_ACTIONS = ['rerun', 'reinput', 'copyCommand'] as const satisfies readonly BlockActionId[];

/** The two a *record* has that a block on screen does not: its directory. */
export const HISTORY_OWN_ACTIONS = ['copyCwd', 'openCwd'] as const;

export type HistoryActionId = (typeof HISTORY_BLOCK_ACTIONS)[number] | (typeof HISTORY_OWN_ACTIONS)[number];

/**
 * A record dressed up as the block it once was, so `blockActions` can rule on
 * it. The line numbers are meaningless here (nothing is on screen) and are
 * never read by the action list; what it does read is the command, the exit
 * code and the status.
 */
export function recordAsBlock(record: HistoryRecord): TerminalBlock {
  return {
    id: 0,
    start: 0,
    outputStart: null,
    endExclusive: null,
    command: record.command ?? null,
    exitCode: record.exitCode ?? null,
    status: 'done',
    folded: false,
  };
}

/** What `blockActions` needs to judge a history row. */
export function recordActionContext(
  record: HistoryRecord,
  opts: { atPrompt: boolean; inputEditor: boolean }
): BlockActionContext {
  return {
    block: recordAsBlock(record),
    hasCommand: Boolean(record.command?.trim()),
    // The history keeps the command, never its output — so every
    // output-dependent action comes back disabled, which is the truth.
    hiddenLines: 0,
    atPrompt: opts.atPrompt,
    inputEditor: opts.inputEditor,
  };
}
