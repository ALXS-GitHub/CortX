/**
 * Fetching side of the history view (#39).
 *
 * Every filter is sent to Rust and nothing is filtered here: the file behind
 * this is capped at 10 MB, and `get_command_history` answers a page, the match
 * count and the values the dropdowns offer in one streamed pass. So the view
 * holds a screenful and a bit, never the history it is searching.
 *
 * Typing is debounced (a keystroke must not cost a file pass) and every reply
 * carries the sequence number of the request that asked for it, so a slow page
 * that lands after a newer one is dropped instead of overwriting it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCommandHistoryPage, type HistoryFacet, type HistoryRecord } from '@/lib/tauri';
import { buildQuery, HISTORY_PAGE_SIZE, type HistoryFilters } from './historyModel';

/** How long the search box waits before it costs a pass over the file. */
const DEBOUNCE_MS = 180;

export interface HistoryPageState {
  records: HistoryRecord[];
  /** Records matching the filters, of which `records` is the first page(s). */
  total: number;
  hasMore: boolean;
  /** Lines the file held — what "10 MB of history" actually means today. */
  scanned: number;
  projects: HistoryFacet[];
  cwds: HistoryFacet[];
  /** A first page is on its way (the list is stale, not empty). */
  loading: boolean;
  /** A further page is on its way. */
  loadingMore: boolean;
  error: string | null;
}

const EMPTY: HistoryPageState = {
  records: [],
  total: 0,
  hasMore: false,
  scanned: 0,
  projects: [],
  cwds: [],
  loading: false,
  loadingMore: false,
  error: null,
};

/**
 * One filtered slice of the history, refetched whenever `filters` change and
 * extended by `loadMore`. Does nothing at all while `open` is false, so a
 * mounted-but-closed view costs nothing.
 */
export function useHistoryPage(open: boolean, filters: HistoryFilters) {
  const [state, setState] = useState<HistoryPageState>(EMPTY);
  const seq = useRef(0);
  const page = useRef(0);

  const fetchPage = useCallback(
    async (next: number, append: boolean, current: HistoryFilters) => {
      const id = ++seq.current;
      setState((s) => ({ ...s, loading: !append, loadingMore: append, error: null }));
      try {
        const result = await getCommandHistoryPage(buildQuery(current, next, HISTORY_PAGE_SIZE));
        // A newer request has been fired since: this answer is stale.
        if (id !== seq.current) return;
        page.current = next;
        setState((s) => ({
          records: append ? [...s.records, ...result.records] : result.records,
          total: result.total,
          hasMore: result.hasMore,
          scanned: result.scanned,
          projects: result.projects,
          cwds: result.cwds,
          loading: false,
          loadingMore: false,
          error: null,
        }));
      } catch (error) {
        if (id !== seq.current) return;
        setState((s) => ({ ...s, loading: false, loadingMore: false, error: String(error) }));
      }
    },
    []
  );

  // Filters (and opening) restart at page 0. The search box is debounced; the
  // other filters are clicks, and waiting on a click feels broken.
  const search = filters.search;
  const rest = JSON.stringify({
    projectId: filters.projectId,
    cwd: filters.cwd,
    failuresOnly: filters.failuresOnly,
    slowOnly: filters.slowOnly,
    slowSeconds: filters.slowSeconds,
  });
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    if (!open) {
      seq.current++;
      setState(EMPTY);
      page.current = 0;
      return;
    }
    const run = () => void fetchPage(0, false, filtersRef.current);
    if (!search.trim()) {
      run();
      return;
    }
    const timer = setTimeout(run, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, search, rest, fetchPage]);

  const loadMore = useCallback(() => {
    if (!state.hasMore || state.loading || state.loadingMore) return;
    void fetchPage(page.current + 1, true, filtersRef.current);
  }, [fetchPage, state.hasMore, state.loading, state.loadingMore]);

  const reload = useCallback(() => {
    void fetchPage(0, false, filtersRef.current);
  }, [fetchPage]);

  return { state, loadMore, reload };
}
