import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, Regex, WholeWord, X } from 'lucide-react';
import type { ISearchOptions } from '@xterm/addon-search';
import { focusTerminal, getTerminalSession, hasTerminalSession } from '@/lib/terminalSessions';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { collectLeaves, tabsInScope } from '@/lib/terminalLayout';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFindStore } from './actions';

/**
 * A theme token as `#rrggbb` (xterm's search decorations accept nothing
 * else). Goes through a canvas so any colour syntax the skin uses resolves.
 */
function tokenHex(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx || !raw) return fallback;
    ctx.fillStyle = raw;
    const out = ctx.fillStyle;
    return /^#[0-9a-f]{6}$/i.test(out) ? out : fallback;
  } catch {
    return fallback;
  }
}

/** The three match modifiers, as the bar holds them. */
interface FindModes {
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
}

function searchOptions(modes: FindModes, incremental: boolean): ISearchOptions {
  const match = tokenHex('--warning', '#f0a517');
  const active = tokenHex('--primary', '#0d9488');
  return {
    caseSensitive: modes.caseSensitive,
    regex: modes.regex,
    wholeWord: modes.wholeWord,
    incremental,
    decorations: {
      matchBackground: match,
      matchOverviewRuler: match,
      activeMatchBackground: active,
      activeMatchColorOverviewRuler: active,
    },
  };
}

/**
 * A half-typed pattern is a normal state, not an error: `foo(` is what
 * `foo(bar)` looks like three keystrokes in. The addon compiles the term with
 * `new RegExp`, which throws on it, so the search is simply not run — the bar
 * keeps the text, the highlights and the focus, and says the pattern is not
 * finished yet.
 */
function patternIsUsable(query: string, regex: boolean): boolean {
  if (!regex) return true;
  try {
    new RegExp(query);
    return true;
  } catch {
    return false;
  }
}

/**
 * Below this, an incremental search is not worth its cost: one character over
 * a scrollback of tens of thousands of lines matches most of the buffer and
 * tells the user nothing (issue 41). Enter / next / previous ignore the floor
 * — searching for a single `$` on purpose is a deliberate act.
 */
const MIN_INCREMENTAL_LENGTH = 2;

/**
 * How long the field must be still before the buffer is searched. The search
 * is synchronous over the whole scrollback, on the main thread; running it on
 * every keystroke is what made the window stutter while typing (issue 41).
 * Long enough to swallow a burst of typing, short enough that the result feels
 * immediate once the fingers stop.
 */
const INCREMENTAL_DEBOUNCE_MS = 180;

function BarButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          className={cn(
            'grid size-6 place-items-center rounded-[var(--rad-xs)] transition-colors hover:bg-accent hover:text-foreground',
            active ? 'bg-accent text-primary' : 'text-muted-foreground'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Find in terminal (Ctrl+Shift+F): a floating glass bar pinned to the
 * top-right of the pane being searched. Typing searches as you go, Enter /
 * Shift+Enter step through the matches, Esc closes and gives the terminal its
 * focus back. Mount once in the window; it follows the pane on its own.
 *
 * Three modifiers, the same three every editor has: match case, regular
 * expression, whole word. They are `ISearchOptions` fields, so the addon does
 * the work.
 *
 * Searching as you type is *deferred* (see `INCREMENTAL_DEBOUNCE_MS`), never
 * skipped: the addon walks the whole scrollback synchronously, and doing that
 * on every keystroke is what froze the window on a big buffer. Toggling a
 * modifier, pressing Enter and the two arrows are all immediate — a click and
 * a keypress are not typing.
 */
export function FindBar() {
  const open = useFindStore((s) => s.open);
  const terminalId = useFindStore((s) => s.terminalId);
  const closeFind = useFindStore((s) => s.closeFind);
  const layoutRevision = useTerminalLayoutStore((s) => s.doc);
  const [query, setQuery] = useState('');
  // What the search actually runs on: `query`, once the typing has settled.
  const [settledQuery, setSettledQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  // The count is stamped with the text it counted, so the bar never shows a
  // number that belongs to what was in the field two keystrokes ago.
  const [result, setResult] = useState<{ index: number; count: number; query: string } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef('');
  /** Key of the last search actually handed to the addon (see `runKey`). */
  const lastRun = useRef('');
  const modes: FindModes = { caseSensitive, regex, wholeWord };
  const runKey = (text: string) => `${caseSensitive ? 'c' : ''}${regex ? 'r' : ''}${wholeWord ? 'w' : ''}:${text}`;

  const session = open && terminalId && hasTerminalSession(terminalId) ? getTerminalSession(terminalId) : null;
  const search = session?.search ?? null;

  // The pane must be on screen: the active tab's, and not hidden by a maximized sibling.
  const paneVisible = (() => {
    if (!open || !terminalId) return false;
    const win = layoutRevision.window;
    const scoped = tabsInScope(win, win.scope);
    const tab = scoped.find((t) => t.id === win.activeTabId) ?? scoped[0];
    if (!tab) return false;
    if (tab.maximizedLeafId) return collectLeaves(tab.layout).find((l) => l.id === tab.maximizedLeafId)?.terminalId === terminalId;
    return collectLeaves(tab.layout).some((l) => l.terminalId === terminalId);
  })();
  useEffect(() => {
    if (open && !paneVisible) closeFind();
  }, [open, paneVisible, closeFind]);

  // Pin the bar to its pane and keep it there while the layout moves.
  useLayoutEffect(() => {
    if (!open || !terminalId) return;
    const bar = barRef.current;
    if (!bar) return;
    const pane = document.querySelector<HTMLElement>(`[data-terminal-id="${CSS.escape(terminalId)}"]`);
    if (!pane) return;
    const place = () => {
      // Below the pane's floating action cluster (which sits at top 8 px).
      const r = pane.getBoundingClientRect();
      bar.style.top = `${Math.round(r.top + 40)}px`;
      bar.style.right = `${Math.round(window.innerWidth - r.right + 12)}px`;
      bar.style.maxWidth = `${Math.max(160, Math.round(r.width - 24))}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(pane);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [open, terminalId, layoutRevision]);

  // Focus the field whenever the bar is (re)opened, keeping the selection.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.select());
    return () => cancelAnimationFrame(frame);
  }, [open, terminalId]);

  // What the addon is looking at, so a result that arrives can be stamped
  // with it. A ref, not state: nothing renders from it.
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  // A different pane — or the bar closing, which drops the highlights — means
  // nothing has been searched *there* yet, whatever the field still says.
  // Declared before the search effect so it runs first.
  useEffect(() => {
    lastRun.current = '';
  }, [search]);

  // Match counter, from the addon.
  useEffect(() => {
    if (!search) return;
    const sub = search.onDidChangeResults((e) => {
      const q = queryRef.current;
      setResult(e.resultCount > 0 ? { index: e.resultIndex, count: e.resultCount, query: q } : { index: -1, count: 0, query: q });
    });
    return () => sub.dispose();
  }, [search]);

  // Typing only moves `query`; `settledQuery` follows it once the field has
  // been still for `INCREMENTAL_DEBOUNCE_MS`, and only from the length the
  // incremental search starts at. Going back below that length — emptying the
  // field included — is handled in the field's own `onChange`, so the
  // highlights drop the moment the text stops saying what they mean.
  useEffect(() => {
    if (query.length < MIN_INCREMENTAL_LENGTH || query === settledQuery) return;
    const timer = window.setTimeout(() => setSettledQuery(query), INCREMENTAL_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, settledQuery]);

  // Search the settled text. Also the path a modifier takes, which is why it
  // fires the moment one is toggled: a click is not typing and waits for
  // nothing. `lastRun` keeps it from repeating a search Enter has just done —
  // a second, *incremental* `findNext` right after a `findPrevious` would
  // walk back the step the user asked for.
  useEffect(() => {
    if (!search) return;
    if (!settledQuery) {
      search.clearDecorations();
      lastRun.current = '';
      return;
    }
    // Half-typed pattern: keep what is on screen and wait for the rest.
    if (!patternIsUsable(settledQuery, regex)) return;
    const key = runKey(settledQuery);
    if (key === lastRun.current) return;
    lastRun.current = key;
    try {
      search.findNext(settledQuery, searchOptions({ caseSensitive, regex, wholeWord }, true));
    } catch {
      // The addon compiles the term itself; a pattern `RegExp` accepts and it
      // does not must not take the bar down with it.
    }
    // `runKey` is derived from the three modifiers, which are in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, settledQuery, caseSensitive, regex, wholeWord]);

  // Closing (or the pane going away) drops the highlights.
  useEffect(() => {
    if (open && terminalId && hasTerminalSession(terminalId)) return;
    if (terminalId && hasTerminalSession(terminalId)) getTerminalSession(terminalId).search.clearDecorations();
  }, [open, terminalId]);

  if (!open || !terminalId) return null;

  // Enter, Shift+Enter and the two arrows are deliberate: no debounce, and no
  // minimum length either — looking for a single `$` is a decision, not a
  // half-typed word.
  const step = (forward: boolean) => {
    if (!search || !query || !patternIsUsable(query, regex)) return;
    lastRun.current = runKey(query);
    setSettledQuery(query);
    try {
      if (forward) search.findNext(query, searchOptions(modes, false));
      else search.findPrevious(query, searchOptions(modes, false));
    } catch {
      // Same guard as the incremental path: never take the bar down.
    }
  };

  const close = () => {
    closeFind();
    focusTerminal(terminalId);
  };

  /**
   * Nothing at all until something has actually been searched: a one-letter
   * query nobody pressed Enter on was never run, and "No match" would be a
   * lie. `Incomplete` is the half-typed regex — faint, never the red of a
   * failed search, because `foo(` is on its way to `foo(bar)`.
   */
  const counter = (() => {
    if (!query) return null;
    if (!patternIsUsable(query, regex)) return 'Incomplete';
    if (!result || result.query !== query) return null;
    return result.count > 0 ? `${result.index + 1}/${result.count}` : 'No match';
  })();

  return (
    <div
      ref={barRef}
      role="search"
      className="glass-strong fixed z-40 flex items-center gap-1 rounded-[var(--rad-sm)] border border-border-strong p-1 pl-2 shadow-pop"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          step(!e.shiftKey);
        }
      }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          // Back below the floor (emptying the field included): there is
          // nothing left to search, so drop the highlights now rather than
          // leaving the previous word lit under a field that no longer says
          // it. Enter still searches whatever is in there.
          if (next.length < MIN_INCREMENTAL_LENGTH) setSettledQuery('');
        }}
        placeholder="Find…"
        aria-label="Find in terminal"
        spellCheck={false}
        autoComplete="off"
        className="h-6 w-44 min-w-0 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-faint"
      />
      <span
        className={cn(
          'min-w-12 shrink-0 text-right text-[10.5px] tabular-nums',
          counter === 'No match' ? 'text-st-blocked' : 'text-faint'
        )}
        aria-live="polite"
      >
        {counter}
      </span>
      <BarButton label="Match case" active={caseSensitive} onClick={() => setCaseSensitive((v) => !v)}>
        <CaseSensitive className="size-3.5" />
      </BarButton>
      <BarButton label="Whole word" active={wholeWord} onClick={() => setWholeWord((v) => !v)}>
        <WholeWord className="size-3.5" />
      </BarButton>
      <BarButton label="Regular expression" active={regex} onClick={() => setRegex((v) => !v)}>
        <Regex className="size-3.5" />
      </BarButton>
      <BarButton label="Previous match (Shift+Enter)" onClick={() => step(false)}>
        <ChevronUp className="size-3.5" />
      </BarButton>
      <BarButton label="Next match (Enter)" onClick={() => step(true)}>
        <ChevronDown className="size-3.5" />
      </BarButton>
      <BarButton label="Close (Esc)" onClick={close}>
        <X className="size-3.5" />
      </BarButton>
    </div>
  );
}
