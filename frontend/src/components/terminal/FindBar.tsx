import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, X } from 'lucide-react';
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

function searchOptions(caseSensitive: boolean, incremental: boolean): ISearchOptions {
  const match = tokenHex('--warning', '#f0a517');
  const active = tokenHex('--primary', '#0d9488');
  return {
    caseSensitive,
    incremental,
    decorations: {
      matchBackground: match,
      matchOverviewRuler: match,
      activeMatchBackground: active,
      activeMatchColorOverviewRuler: active,
    },
  };
}

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
 */
export function FindBar() {
  const open = useFindStore((s) => s.open);
  const terminalId = useFindStore((s) => s.terminalId);
  const closeFind = useFindStore((s) => s.closeFind);
  const layoutRevision = useTerminalLayoutStore((s) => s.doc);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<{ index: number; count: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Match counter, from the addon.
  useEffect(() => {
    if (!search) return;
    const sub = search.onDidChangeResults((e) => {
      setResult(e.resultCount > 0 ? { index: e.resultIndex, count: e.resultCount } : { index: -1, count: 0 });
    });
    return () => sub.dispose();
  }, [search]);

  // Search as you type; clearing the field clears the highlights.
  useEffect(() => {
    if (!search) return;
    if (!query) {
      search.clearDecorations();
      return;
    }
    search.findNext(query, searchOptions(caseSensitive, true));
  }, [search, query, caseSensitive]);

  // Closing (or the pane going away) drops the highlights.
  useEffect(() => {
    if (open && terminalId && hasTerminalSession(terminalId)) return;
    if (terminalId && hasTerminalSession(terminalId)) getTerminalSession(terminalId).search.clearDecorations();
  }, [open, terminalId]);

  if (!open || !terminalId) return null;

  const step = (forward: boolean) => {
    if (!search || !query) return;
    if (forward) search.findNext(query, searchOptions(caseSensitive, false));
    else search.findPrevious(query, searchOptions(caseSensitive, false));
  };

  const close = () => {
    closeFind();
    focusTerminal(terminalId);
  };

  const counter = !query ? null : result && result.count > 0 ? `${result.index + 1}/${result.count}` : 'No match';

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
        onChange={(e) => setQuery(e.target.value)}
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
