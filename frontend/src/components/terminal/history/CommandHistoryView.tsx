/**
 * The command history, on screen at last (#39).
 *
 * `runtime/command-history.jsonl` has recorded when, where, in which project,
 * on which branch, with which exit code and for how long every command ran
 * since the shell integration landed — and nothing ever showed it. This is the
 * view: one row per command, the six columns the data already had, filters
 * that finally use the stored fields, and the block toolbar's own actions on
 * every row (`historyActions.ts`).
 *
 * **Opened** by `openCommandHistory` — the palette entry, the `window.history`
 * keybinding (Ctrl+Shift+H), and later the input editor.
 *
 * **Ctrl+R (epic U2.d) — wired.** The view takes a `pick` callback
 * (`OpenHistoryDetail.pick`): given one, rows stop writing to any PTY and
 * simply hand the chosen command back, Enter picks, and the footer says so.
 * That is what the universal input editor's Ctrl+R opens — it calls
 * `openCommandHistory({ search: <the line so far>, projectId, pick })` and
 * replaces its buffer with what comes back. Nothing in this file had to
 * change for it.
 *
 * The editor passes no `cwd`: that filter is an exact directory match
 * (`terminal::history`), so a terminal sitting in any subdirectory of a
 * project would open on an empty list. The facets in the filter bar are how a
 * directory gets picked.
 *
 * **Where it is mounted still limits it.** Only `TerminalPalette` renders this
 * view, and only `windows/TerminalWindow.tsx` renders that — so in the main
 * window (the dock) `openCommandHistory` returns false and the editor falls
 * back to the shell's own reverse search. The same gap makes the
 * `window.history` keybinding (Ctrl+Shift+H) a no-op there.
 *
 * **Colours.** This is a modal dialog — an opaque chrome surface over the
 * terminal, not a layer among its cells — so it uses the app's tokens, exactly
 * like the theme picker and the terminal settings dialog already do inside
 * this window. See the header of `styles/terminal-history.css`.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Copy,
  CornerDownLeft,
  FolderOpen,
  GitBranch,
  History,
  Loader2,
  RefreshCw,
  Search,
  Timer,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import type { HistoryRecord } from '@/lib/tauri';
import {
  commandLine,
  historyActionSpecs,
  runHistoryAction,
  useHistoryTarget,
  type HistoryActionSpec,
  type HistoryTarget,
} from './historyActions';
import {
  EMPTY_HISTORY_FILTERS,
  HISTORY_SLOW_SECONDS,
  exitLabel,
  exitTone,
  filtersAreEmpty,
  formatAge,
  formatDuration,
  historyCommandLabel,
  historyRowKey,
  shortDir,
  type HistoryActionId,
  type HistoryFilters,
  type HistorySlowSeconds,
} from './historyModel';
import { HISTORY_EVENT, type OpenHistoryDetail } from './openHistory';
import { useHistoryPage } from './useHistoryPage';
import '@/styles/terminal-history.css';

/** Radix refuses an empty `value`, so "every project" needs a name of its own. */
const ANY = '__any__';
/** Ages on screen go stale; twice a minute is plenty to keep them honest. */
const CLOCK_MS = 30_000;

const ACTION_ICONS: Record<HistoryActionId, typeof Copy> = {
  rerun: RefreshCw,
  reinput: CornerDownLeft,
  copyCommand: Copy,
  copyCwd: Copy,
  openCwd: FolderOpen,
};

/**
 * The action Enter runs: the first of "put it back at the prompt", "run it
 * again", "copy it" that is actually available. Putting it back leads, because
 * it is the only one of the three you can still change your mind about.
 */
function primaryActionId(specs: HistoryActionSpec[]): HistoryActionId | null {
  for (const id of ['reinput', 'rerun', 'copyCommand'] as const) {
    if (specs.some((s) => s.id === id && !s.disabled)) return id;
  }
  return null;
}

interface RowProps {
  record: HistoryRecord;
  index: number;
  selected: boolean;
  now: number;
  projectName: string;
  target: HistoryTarget;
  pickMode: boolean;
  onSelect: (index: number) => void;
  onActivate: (record: HistoryRecord) => void;
  onAction: (id: HistoryActionId, record: HistoryRecord) => void;
}

function HistoryRow({
  record,
  index,
  selected,
  now,
  projectName,
  target,
  pickMode,
  onSelect,
  onActivate,
  onAction,
}: RowProps) {
  const specs = historyActionSpecs(record, target);
  const tone = exitTone(record.exitCode);
  const command = historyCommandLabel(record.command);
  // In pick mode nothing may reach a PTY: only the harmless actions stay.
  const bar = pickMode ? specs.filter((s) => s.id === 'copyCommand' || s.id === 'openCwd') : specs;

  return (
    <div
      role="option"
      aria-selected={selected}
      data-selected={selected}
      data-index={index}
      onMouseDown={(e) => {
        // Keep the focus in the search box, so the arrow keys stay live.
        e.preventDefault();
        onSelect(index);
      }}
      onDoubleClick={() => onActivate(record)}
      className={cn(
        'cortx-history-row cortx-history-grid cursor-default rounded-sm px-3 py-2',
        selected ? 'bg-muted' : 'hover:bg-muted/60'
      )}
    >
      <span
        className={cn('truncate font-mono text-[12.5px]', command ? 'text-foreground' : 'text-faint italic')}
        title={record.command ?? undefined}
      >
        {command || 'no command recorded'}
      </span>

      <span className="cortx-history-dir truncate font-mono text-[11px] text-faint" title={record.cwd ?? undefined}>
        {shortDir(record.cwd)}
      </span>

      <span className="cortx-history-project truncate text-[11px] text-muted-foreground">{projectName}</span>

      <span
        className="cortx-history-branch flex min-w-0 items-center gap-1 text-[11px] text-faint"
        title={record.gitHead ? `Ran on ${record.gitHead}` : undefined}
      >
        {record.gitHead && (
          <>
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate font-mono">{record.gitHead}</span>
          </>
        )}
      </span>

      <span className="cortx-history-num text-[11px] text-muted-foreground">{formatDuration(record.durationMs)}</span>

      <span
        className={cn(
          'cortx-history-num font-mono text-[11px]',
          tone === 'failed' ? 'text-st-blocked' : tone === 'ok' ? 'text-st-done' : 'text-faint'
        )}
      >
        {exitLabel(record.exitCode)}
      </span>

      <span className="cortx-history-num text-[11px] text-faint">{formatAge(record.ts, now)}</span>

      <div className="cortx-history-actions">
        {bar.map((spec) => {
          const Icon = ACTION_ICONS[spec.id];
          return (
            <button
              key={spec.id}
              type="button"
              disabled={spec.disabled}
              title={spec.hint ? `${spec.label} (${spec.hint})` : spec.label}
              aria-label={spec.label}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onAction(spec.id, record);
              }}
              className="grid size-6 place-items-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
            >
              <Icon className="size-3.5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Mount once per window — the Terminal window does it through
 * `TerminalPalette`. Renders nothing until something opens it.
 */
export function CommandHistoryView() {
  const [open, setOpen] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_HISTORY_FILTERS);
  const [rawSelected, setSelected] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const pick = useRef<((command: string) => void) | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const projects = useAppStore((s) => s.projects);
  const target = useHistoryTarget(open);
  const { state, loadMore } = useHistoryPage(open, filters);
  const records = state.records;

  const projectName = (id: string | undefined) =>
    id ? (projects.find((p) => p.id === id)?.name ?? id) : '';

  // Opened from the palette, the keybinding, or (later) the input editor.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenHistoryDetail>).detail ?? {};
      detail.handled = true;
      pick.current = detail.pick ?? null;
      setPickMode(Boolean(detail.pick));
      setFilters({
        ...EMPTY_HISTORY_FILTERS,
        search: detail.search ?? '',
        projectId: detail.projectId ?? '',
        cwd: detail.cwd ?? '',
      });
      setSelected(0);
      setNow(Date.now());
      setOpen(true);
    };
    window.addEventListener(HISTORY_EVENT, onOpen);
    return () => window.removeEventListener(HISTORY_EVENT, onOpen);
  }, []);

  // Ages are relative; keep recomputing them while the view is up.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, [open]);

  // A shorter list must never leave the selection past its end. Clamped as it
  // is read rather than corrected in an effect: filtering the list down and
  // then re-rendering it with a stale index is exactly the cascading render
  // the effect would cause.
  const selected = records.length === 0 ? 0 : Math.min(rawSelected, records.length - 1);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected, open, records.length]);

  const close = () => {
    setOpen(false);
    setPickMode(false);
    pick.current = null;
  };

  const onOpenChange = (next: boolean) => {
    if (next) setOpen(true);
    else close();
  };

  const doAction = (id: HistoryActionId, record: HistoryRecord) => {
    void runHistoryAction(id, record, target).then((done) => {
      // Running a command, or dropping it on the prompt, is the end of the
      // errand: get out of the way so the terminal is visible. Copying is not.
      if (done && (id === 'rerun' || id === 'reinput')) close();
    });
  };

  /** Enter on a row: hand it back in pick mode, else its primary action. */
  const activate = (record: HistoryRecord) => {
    const chosen = pick.current;
    if (chosen) {
      const command = commandLine(record);
      if (!command) return;
      close();
      chosen(command);
      return;
    }
    const id = primaryActionId(historyActionSpecs(record, target));
    if (id) doAction(id, record);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(Math.min(selected + 1, Math.max(0, records.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(Math.max(0, selected - 1));
    } else if (e.key === 'Enter') {
      const record = records[selected];
      if (!record) return;
      e.preventDefault();
      // Ctrl / Shift force the other one: run it now rather than edit it first.
      if (!pickMode && (e.ctrlKey || e.metaKey || e.shiftKey)) doAction('rerun', record);
      else activate(record);
    }
  };

  const set = <K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) => {
    setSelected(0);
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const clean = filtersAreEmpty(filters);
  const shown = records.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cortx-history-dialog top-[7%] max-h-[84vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <div className="flex flex-col gap-3 border-b border-border px-5 pt-5 pb-3">
          <div className="pr-8">
            <DialogTitle className="flex items-center gap-2">
              <History className="size-4 text-faint" />
              Command history
            </DialogTitle>
            <DialogDescription className="mt-1">
              {pickMode
                ? 'Pick a command to put back on the line.'
                : 'Every command your CortX terminals have finished — where it ran, on which branch, and how it went.'}
            </DialogDescription>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <Input
              autoFocus
              value={filters.search}
              onChange={(e) => set('search', e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search commands… every word has to appear"
              aria-label="Search commands"
              className="h-9 pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={filters.projectId || ANY} onValueChange={(v) => set('projectId', v === ANY ? '' : v)}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue placeholder="Every project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Every project</SelectItem>
                {state.projects.map((facet) => (
                  <SelectItem key={facet.value} value={facet.value}>
                    {projectName(facet.value)} · {facet.count}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.cwd || ANY} onValueChange={(v) => set('cwd', v === ANY ? '' : v)}>
              <SelectTrigger size="sm" className="w-56">
                <SelectValue placeholder="Every directory" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Every directory</SelectItem>
                {state.cwds.map((facet) => (
                  <SelectItem key={facet.value} value={facet.value}>
                    {shortDir(facet.value, 3)} · {facet.count}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              size="xs"
              variant={filters.failuresOnly ? 'default' : 'outline'}
              aria-pressed={filters.failuresOnly}
              onClick={() => set('failuresOnly', !filters.failuresOnly)}
            >
              <TriangleAlert />
              Failures only
            </Button>

            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant={filters.slowOnly ? 'default' : 'outline'}
                aria-pressed={filters.slowOnly}
                onClick={() => set('slowOnly', !filters.slowOnly)}
              >
                <Timer />
                Longer than
              </Button>
              {filters.slowOnly && (
                <Select
                  value={String(filters.slowSeconds)}
                  onValueChange={(v) => set('slowSeconds', Number(v) as HistorySlowSeconds)}
                >
                  <SelectTrigger size="sm" className="w-[5.5rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HISTORY_SLOW_SECONDS.map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {s} s
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {!clean && (
              <Button size="xs" variant="ghost" onClick={() => setFilters(EMPTY_HISTORY_FILTERS)}>
                <X />
                Clear
              </Button>
            )}
          </div>

          {/*
            The header's tracks line up with the rows' because both sit 20 px
            from the dialog edge: `px-5` here, `px-2` on the list plus `px-3`
            on the row. Change one and the other has to follow.
          */}
          <div className="cortx-history-grid text-[10.5px] tracking-wide text-faint uppercase">
            <span>Command</span>
            <span className="cortx-history-dir">Directory</span>
            <span className="cortx-history-project">Project</span>
            <span className="cortx-history-branch">Branch</span>
            <span className="cortx-history-num">Took</span>
            <span className="cortx-history-num">Exit</span>
            <span className="cortx-history-num">When</span>
          </div>
        </div>

        <div
          ref={listRef}
          role="listbox"
          aria-label="Command history"
          className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
        >
          {state.error ? (
            <EmptyState compact icon={TriangleAlert} title="Could not read the history" description={state.error} />
          ) : state.loading && shown === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-faint">
              <Loader2 className="size-3.5 animate-spin" />
              Reading the history…
            </div>
          ) : shown === 0 ? (
            <EmptyState
              compact
              icon={History}
              title={clean ? 'Nothing recorded yet' : 'Nothing matches these filters'}
              description={
                clean
                  ? 'Commands are recorded as your shell reports them finishing. A shell that has not run `cortx init` reports nothing.'
                  : 'Loosen a filter, or clear them all.'
              }
              action={
                clean ? undefined : (
                  <Button size="sm" variant="outline" onClick={() => setFilters(EMPTY_HISTORY_FILTERS)}>
                    Clear filters
                  </Button>
                )
              }
            />
          ) : (
            <>
              {records.map((record, i) => (
                <HistoryRow
                  key={historyRowKey(record, i)}
                  record={record}
                  index={i}
                  selected={i === selected}
                  now={now}
                  projectName={projectName(record.projectId)}
                  target={target}
                  pickMode={pickMode}
                  onSelect={setSelected}
                  onActivate={activate}
                  onAction={doAction}
                />
              ))}
              {state.hasMore && (
                <div className="grid place-items-center py-3">
                  <Button size="xs" variant="outline" onClick={loadMore} disabled={state.loadingMore}>
                    {state.loadingMore && <Loader2 className="animate-spin" />}
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--footer-border)] bg-[var(--footer-bg)] px-5 py-2.5 text-[11px] text-faint">
          <span className="tabular-nums">
            {shown === state.total ? `${state.total} commands` : `${shown} of ${state.total} commands`}
            {state.scanned > state.total ? ` · ${state.scanned} recorded` : ''}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="kbd">↑↓</span>
            move
            <span className="kbd">↵</span>
            {pickMode ? 'pick' : 'put at the prompt'}
            {!pickMode && (
              <>
                <span className="kbd">Ctrl ↵</span>
                run
              </>
            )}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
