import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Maximize2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { useTerminalGridStore } from '@/stores/terminalGridStore';
import { AgentProviderIcon } from '@/components/agents/AgentProviderIcon';
import { TerminalTypeIcon } from '@/components/layout/terminal-dnd/TerminalTypeIcon';
import { comboLabelFor } from '@/lib/keybindings';
import type { TerminalTab } from '@/lib/terminalLayout';
import { cn } from '@/lib/utils';
import { SplitTree } from './SplitTree';
import { TerminalStatusGlyph } from './TerminalStatusGlyph';
import { gridShape } from './gridLayout';
import {
  activeLeafOf,
  tabItem,
  tabLiveState,
  tabProject,
  tabSecondary,
  tabTitle,
  projectColor,
  useTabDisplay,
  type ItemMap,
} from './model';

/**
 * The grid view of a Terminal window (ticket #55): every tab of the window's
 * scope as a live tile, so several agents can be watched at once — pick a
 * project in the scope switcher for that project's grid, Global for all of
 * them. Clicking a tile opens it full size (`zoomed`, see `ZoomedBar`); the
 * bar above it, or the grid shortcut, comes back.
 *
 * The tiles are the real sessions, not pictures of them: each one mounts the
 * tab's split tree exactly as the usual view does (the xterm instances
 * outlive any component, see `XtermView`), so output keeps streaming in. The
 * pane is resized to its tile like any pane, which is what lets an agent's
 * interface reflow to it.
 *
 * Whether a tile takes the keyboard and the mouse is a setting,
 * `terminal.gridTilesInteractive` (on by default). On, a tile is a working
 * terminal — click into it to type, select or scroll — and its header opens
 * it. Off, a transparent layer over the whole tile turns every click into
 * "open this one", so a stray click can never reach an agent you are only
 * watching.
 */
export function TerminalGrid({ tabs, items, showProject }: { tabs: TerminalTab[]; items: ItemMap; showProject: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const { columns, rows } = gridShape(tabs.length, size.width, size.height);
  const activeTabId = useTerminalLayoutStore((s) => s.doc.window.activeTabId);
  const interactive = useAppStore((s) => s.settings?.terminal.gridTilesInteractive ?? true);

  return (
    <div ref={ref} className="min-h-0 min-w-0 flex-1 overflow-y-auto p-2">
      <div
        className="grid h-full min-h-0 gap-2"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${Math.max(rows, 1)}, minmax(180px, 1fr))`,
        }}
      >
        {tabs.map((tab) => (
          <GridTile
            key={tab.id}
            tab={tab}
            items={items}
            current={tab.id === activeTabId}
            showProject={showProject}
            interactive={interactive}
          />
        ))}
      </div>
    </div>
  );
}

/** Open one tile: it becomes the active tab, shown full size. */
function openTile(tabId: string) {
  useTerminalLayoutStore.getState().setActiveTab(tabId);
  useTerminalGridStore.getState().zoom();
}

function GridTile({
  tab,
  items,
  current,
  showProject,
  interactive,
}: {
  tab: TerminalTab;
  items: ItemMap;
  current: boolean;
  showProject: boolean;
  /** The tile takes the keyboard and the mouse; only its header opens it. */
  interactive: boolean;
}) {
  const projects = useAppStore((s) => s.projects);
  const display = useTabDisplay();
  const markTerminalSeen = useAppStore((s) => s.markTerminalSeen);
  const item = tabItem(tab, items);
  const live = tabLiveState(tab, items);
  const title = tabTitle(tab, items);
  const secondary = tabSecondary(item, live, display);
  const project = showProject ? tabProject(tab, projects) : undefined;
  const agent = live.agent;
  const waiting = agent?.state === 'waiting';

  const open = () => {
    markTerminalSeen(activeLeafOf(tab).terminalId);
    openTile(tab.id);
  };

  return (
    <div
      className={cn(
        'group/tile relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--rad-sm)] border bg-card transition-colors',
        current ? 'border-primary/50' : 'border-border hover:border-border-strong',
        // An agent asking for you is what the grid is for: it has to stand out.
        waiting && 'border-st-progress/70 ring-1 ring-st-progress/40'
      )}
    >
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-2 text-[12px]">
        {agent ? (
          <AgentProviderIcon provider={agent.provider} plain className="size-3.5 shrink-0" />
        ) : (
          <TerminalTypeIcon type={item?.type ?? 'shell'} className="size-3.5 shrink-0 text-faint" />
        )}
        <span className={cn('truncate', current && 'font-medium')}>{title}</span>
        {project && (
          <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-faint">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: projectColor(project.id) }} aria-hidden />
            {project.name}
          </span>
        )}
        {secondary && (
          <span
            className={cn(
              'min-w-0 truncate text-[10.5px]',
              (secondary.tone === 'command' || secondary.tone === 'path') && 'font-mono',
              secondary.tone === 'waiting' ? 'text-st-progress' : secondary.tone === 'command' ? 'text-primary' : 'text-faint'
            )}
          >
            {secondary.text}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <TerminalStatusGlyph live={live} />
          <Maximize2 className="size-3 text-faint opacity-0 transition-opacity group-hover/tile:opacity-100" aria-hidden />
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <SplitTree tab={tab} items={items} isActiveTab={false} />
      </div>
      {/* Interactive tiles: over the header only, so the terminal below takes
          its clicks and keys and the header opens the tile. Watch-only tiles:
          over the whole tile — one click opens it, whatever it lands on, and
          nothing underneath ever gets the event. */}
      <button
        type="button"
        onClick={open}
        aria-label={`Open ${title}`}
        title={`Open ${title}`}
        className={cn(
          'absolute inset-x-0 top-0 z-30 cursor-zoom-in bg-transparent transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
          interactive ? 'h-7 rounded-t-[var(--rad-sm)]' : 'bottom-0 rounded-[var(--rad-sm)]'
        )}
      />
    </div>
  );
}

/**
 * Above an opened tile: the way back to the grid, and what is open. The tab
 * underneath is the plain active tab — every shortcut, the split buttons and
 * the rail work on it as usual.
 */
export function ZoomedBar({ tab, items, count }: { tab: TerminalTab | null; items: ItemMap; count: number }) {
  const backToGrid = useTerminalGridStore((s) => s.backToGrid);
  const keybindings = useAppStore((s) => s.settings?.terminal.keybindings);
  const combo = comboLabelFor('window.grid', keybindings);
  const live = useMemo(() => (tab ? tabLiveState(tab, items) : null), [tab, items]);
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2 text-[12px]">
      <button
        type="button"
        onClick={backToGrid}
        className="flex h-6 items-center gap-1.5 rounded-[var(--rad-xs)] px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title={combo ? `Back to the grid (${combo})` : 'Back to the grid'}
      >
        <ArrowLeft className="size-3.5" />
        Grid
        {count > 1 && <span className="text-faint">· {count}</span>}
      </button>
      {tab && (
        <>
          <span className="truncate font-medium">{tabTitle(tab, items)}</span>
          {live && <TerminalStatusGlyph live={live} />}
        </>
      )}
    </div>
  );
}
