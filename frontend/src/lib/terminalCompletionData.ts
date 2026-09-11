/**
 * Async side of the completion engine (#17): every source that needs the disk
 * or a child process, behind a cache that never makes anyone wait.
 *
 * The contract that keeps typing free:
 *
 * - {@link peek} is **synchronous and never awaits**. It returns whatever is
 *   already in memory — possibly nothing, possibly slightly stale — and, if
 *   the entry is missing or old, schedules a refresh in the background.
 * - A refresh that finishes notifies the subscribers, which simply recompute
 *   from the current line. A late answer for a line the user has moved past
 *   is never read: results are stored per key and the engine only ever looks
 *   up the key it needs *now*. That is the cancellation, without cancellable
 *   IPC.
 * - Identical in-flight requests are deduplicated, and a failure is cached as
 *   an empty result for a short while so a broken source is not retried on
 *   every keystroke.
 */
import * as api from '@/lib/tauri';
import { useAppStore } from '@/stores/appStore';
import type { CommandSpec, CommandSuggestion, PathCompletion, SpecItem } from '@/types';
import {
  aliasCandidates,
  aliasFor,
  analyseLine,
  type AliasEntry,
  type CompletionData,
  type CompletionRequest,
} from '@/lib/terminalCompletion';

interface Entry<T> {
  value: T;
  /** `performance.now()` of the last successful load. */
  at: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();

/** Called whenever any source has fresh data. */
export function onCompletionData(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      /* a broken subscriber must not break the others */
    }
  }
}

class AsyncCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly ttlMs: number;
  private readonly load: (key: string) => Promise<T>;
  /** Newest keys kept; older ones are evicted. */
  private readonly maxEntries: number;

  constructor(ttlMs: number, load: (key: string) => Promise<T>, maxEntries = 40) {
    this.ttlMs = ttlMs;
    this.load = load;
    this.maxEntries = maxEntries;
  }

  /** Cached value (maybe stale), scheduling a refresh when needed. */
  peek(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit || performance.now() - hit.at > this.ttlMs) this.schedule(key);
    return hit?.value;
  }

  /** Drop everything (settings changed, or the user asked for a refresh). */
  clear() {
    this.entries.clear();
  }

  private schedule(key: string) {
    if (this.inflight.has(key)) return;
    const p = this.load(key)
      .then((value) => {
        this.entries.set(key, { value, at: performance.now() });
        if (this.entries.size > this.maxEntries) {
          const oldest = this.entries.keys().next().value;
          if (oldest !== undefined) this.entries.delete(oldest);
        }
        notify();
      })
      .catch(() => {
        // Remember the failure briefly so a missing tool isn't probed again
        // on the next key press.
        const previous = this.entries.get(key);
        if (!previous) this.entries.set(key, { value: undefined as unknown as T, at: performance.now() });
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, p);
  }
}

/** `cwd\u0000projectId` — history ranking depends on both. */
function historyKey(cwd: string | null, projectId: string | null): string {
  return `${cwd ?? ''}\u0000${projectId ?? ''}`;
}

const HISTORY_TTL = 10_000;
/**
 * Aliases are edited by hand in Shell Config, so they move rarely — but when
 * they move the user is *looking* at the terminal to check the change took.
 *
 * Twenty seconds is the compromise, and the reason it has to be a TTL at all
 * is worth writing down: the only cross-window signal that exists is
 * `data-changed`, and the file watcher behind it is deliberately suppressed
 * while CortX itself writes (`storage.set_suppress_watcher`). An alias saved
 * from the main window's Shell Config therefore reaches a Terminal window's
 * store by no event whatsoever. Polling on a stale read is what closes that,
 * and it costs one in-process command every twenty seconds of typing.
 */
const ALIAS_TTL = 20_000;
const SPEC_TTL = 60 * 60 * 1000;
const GIT_TTL = 15_000;
const NPM_TTL = 30_000;
const PATHS_TTL = 4_000;

const historyCache = new AsyncCache<CommandSuggestion[]>(HISTORY_TTL, (key) => {
  const [cwd, projectId] = key.split('\u0000');
  return api.suggestHistory(cwd || undefined, projectId || undefined, 400);
});

const specCache = new AsyncCache<CommandSpec | null>(SPEC_TTL, (command) =>
  api.getCommandSpec(command)
);

/**
 * CortX's own alias registry (#38). One key, one entry: the registry is global,
 * not per-directory.
 *
 * The filtering and the resolution are done **here, once per load**, not on
 * every keystroke: `aliasCandidates` drops what could never be a first token
 * and follows each alias to the program whose spec describes its flags.
 */
const aliasCache = new AsyncCache<AliasEntry[]>(
  ALIAS_TTL,
  async () => aliasCandidates(await api.getAllAliases()),
  1
);

const gitRefsCache = new AsyncCache<string[]>(GIT_TTL, (cwd) => api.completeGitRefs(cwd));

const npmScriptsCache = new AsyncCache<SpecItem[]>(NPM_TTL, (cwd) => api.completeNpmScripts(cwd));

const pathsCache = new AsyncCache<PathCompletion[]>(PATHS_TTL, (key) => {
  const [cwd, fragment] = key.split('\u0000');
  return api.completePaths(cwd, fragment ?? '', 60);
});

/** Everything is discarded when a setting that gates a source changes. */
export function resetCompletionData() {
  historyCache.clear();
  aliasCache.clear();
  specCache.clear();
  gitRefsCache.clear();
  npmScriptsCache.clear();
  pathsCache.clear();
}

function specsEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.completionSpecs !== false;
}

function contextEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.completionContext !== false;
}

/** The directory part of the word being completed, for the path source. */
function pathFragment(word: string): string {
  const i = Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\'));
  return i >= 0 ? word.slice(0, i + 1) : '';
}

export interface CompletionScope {
  cwd: string | null;
  projectId: string | null;
}

/**
 * Gather, synchronously, everything currently known for `line` in `scope`.
 * Missing pieces come back later through {@link onCompletionData}.
 */
export function peek(line: string, scope: CompletionScope): CompletionData {
  const req: CompletionRequest = analyseLine(line);
  const aliases = peekAliases();
  const data: CompletionData = {
    history: historyCache.peek(historyKey(scope.cwd, scope.projectId)) ?? [],
    aliases,
  };
  if (req.needsSpec && req.command && specsEnabled()) {
    // The whole point of owning the registry: on `cc --`, ask for the spec of
    // whatever `cc` really runs, so the flags of `claude` come back. When the
    // alias is not expandable (`resolveAlias` refused) `target` is null and
    // this falls through to the plain lookup, exactly as before.
    const alias = aliasFor(req.command, aliases);
    data.spec = specCache.peek(alias?.target ?? req.command) ?? null;
    if (alias?.target) data.specShift = alias.targetShift;
  }
  if (scope.cwd && contextEnabled()) {
    if (req.needsGitRefs) data.gitRefs = gitRefsCache.peek(scope.cwd) ?? [];
    if (req.needsNpmScripts) data.npmScripts = npmScriptsCache.peek(scope.cwd) ?? [];
    if (req.needsPaths) {
      // Keyed on the *directory* being listed, not on the whole word: typing
      // `src/comp` reuses the single listing of `src/`.
      const dir = pathFragment(req.word);
      const listed = pathsCache.peek(`${scope.cwd}\u0000${dir}`) ?? [];
      data.paths = listed;
    }
  }
  return data;
}

/**
 * History alone — what the ghost text needs and nothing more, so the common
 * case costs one map lookup.
 */
export function peekHistory(scope: CompletionScope): CommandSuggestion[] {
  return historyCache.peek(historyKey(scope.cwd, scope.projectId)) ?? [];
}

/**
 * The alias registry alone — what the expansion hint needs, and what a surface
 * holding its own line can ask for without going through {@link peek}.
 */
export function peekAliases(): AliasEntry[] {
  return aliasCache.peek('') ?? [];
}
