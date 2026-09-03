import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TerminalTypeIcon } from '@/components/layout/terminal-dnd/TerminalTypeIcon';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { RAIL_WIDTH_COLLAPSED, useTerminalWindowPrefsStore } from '@/stores/terminalWindowPrefsStore';
import { FREE_WORKSPACE_ID, projectIdOfWorkspace, tabsInScope, type TerminalTab } from '@/lib/terminalLayout';
import { cn } from '@/lib/utils';
import { TerminalStatusGlyph } from './TerminalStatusGlyph';
import { closeTabAndRelease, openNewTerminal } from './actions';
import { cwdLabel, projectColor, tabItem, tabLiveState, tabTitle, useItemMap, type ItemMap } from './model';

interface RailGroup {
  workspaceId: string;
  name: string;
  color: string | null;
  tabs: TerminalTab[];
}

function RailIconButton({ label, onClick, children, className }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-[var(--rad-nav)] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
            className
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** One session row (expanded rail). */
function SessionRow({ tab, items, active, onSelect, onClose }: { tab: TerminalTab; items: ItemMap; active: boolean; onSelect: () => void; onClose: () => void }) {
  const item = tabItem(tab, items);
  const live = tabLiveState(tab, items);
  const title = tabTitle(tab, items);
  const cwd = cwdLabel(item);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group flex h-10 w-full cursor-default items-center gap-2 rounded-[var(--rad-nav)] px-2 text-left transition-colors',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      <TerminalTypeIcon
        type={item?.type ?? 'shell'}
        className="size-3.5 shrink-0 text-faint"
      />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[12.5px]" style={tab.color ? { color: tab.color } : undefined}>
          {title}
        </span>
        {cwd && <span className="truncate font-mono text-[10.5px] text-faint">{cwd}</span>}
      </span>
      <TerminalStatusGlyph live={live} />
      <button
        type="button"
        className="grid size-5 shrink-0 place-items-center rounded-[6px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="Close tab"
        aria-label="Close tab"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

/** One session (collapsed rail): the type icon with the status in its corner. */
function SessionIcon({ tab, items, active, onSelect }: { tab: TerminalTab; items: ItemMap; active: boolean; onSelect: () => void }) {
  const item = tabItem(tab, items);
  const live = tabLiveState(tab, items);
  const title = tabTitle(tab, items);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          aria-label={title}
          className={cn(
            'relative grid size-8 shrink-0 place-items-center rounded-[var(--rad-nav)] transition-colors',
            active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
          )}
        >
          <TerminalTypeIcon type={item?.type ?? 'shell'} className="size-4" />
          <span className="absolute -right-0.5 -top-0.5 grid place-items-center">
            <TerminalStatusGlyph live={live} className="scale-90" />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {title}
        {item?.projectName ? ` · ${item.projectName}` : ''}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Left rail of the Terminal window: every tab of the current scope, grouped
 * by workspace (project or "Free"), with the dock's status language.
 * Collapsible to an icon strip (Ctrl+B), drag-resizable when expanded.
 */
export function SessionRail() {
  const items = useItemMap();
  const projects = useAppStore((s) => s.projects);
  // Selectors must return stable references: derive the scoped list here.
  const win = useTerminalLayoutStore((s) => s.doc.window);
  const scopedTabs = useMemo(() => tabsInScope(win, win.scope), [win]);
  const activeTabId = win.activeTabId;
  const setActiveTab = useTerminalLayoutStore((s) => s.setActiveTab);
  const { railCollapsed, toggleRail, railWidth, setRailWidth } = useTerminalWindowPrefsStore();

  const groups = useMemo<RailGroup[]>(() => {
    const byWorkspace = new Map<string, TerminalTab[]>();
    for (const tab of scopedTabs) {
      const list = byWorkspace.get(tab.workspaceId) ?? [];
      list.push(tab);
      byWorkspace.set(tab.workspaceId, list);
    }
    const out: RailGroup[] = [];
    for (const [workspaceId, tabs] of byWorkspace) {
      const projectId = projectIdOfWorkspace(workspaceId);
      const project = projectId ? projects.find((p) => p.id === projectId) : undefined;
      out.push({
        workspaceId,
        name: workspaceId === FREE_WORKSPACE_ID ? 'Free' : project?.name ?? 'Unknown project',
        color: projectId ? projectColor(projectId) : null,
        tabs: tabs.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order),
      });
    }
    // Free shells last; projects in their sidebar order.
    return out.sort((a, b) => {
      if (a.workspaceId === FREE_WORKSPACE_ID) return 1;
      if (b.workspaceId === FREE_WORKSPACE_ID) return -1;
      return projects.findIndex((p) => `project:${p.id}` === a.workspaceId) - projects.findIndex((p) => `project:${p.id}` === b.workspaceId);
    });
  }, [scopedTabs, projects]);

  const runningCount = useMemo(
    () => scopedTabs.filter((t) => tabLiveState(t, items).running).length,
    [scopedTabs, items]
  );

  // Drag-resize (expanded only), same mechanics as the main sidebar.
  const [resizing, setResizing] = useState(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startX.current = e.clientX;
      startW.current = railWidth;
      setResizing(true);
    },
    [railWidth]
  );
  useEffect(() => {
    if (!resizing) return;
    const move = (e: MouseEvent) => setRailWidth(startW.current + (e.clientX - startX.current));
    const up = () => setResizing(false);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizing, setRailWidth]);

  const collapsed = railCollapsed;

  return (
    <aside
      className={cn(
        'glass relative z-30 flex h-full shrink-0 flex-col border-r border-border',
        !resizing && 'transition-[width] duration-200 ease-out'
      )}
      style={{ width: collapsed ? RAIL_WIDTH_COLLAPSED : railWidth }}
    >
      {/* Header */}
      <div className={cn('flex h-10 shrink-0 items-center', collapsed ? 'justify-center' : 'gap-2 pl-3 pr-1.5')}>
        {!collapsed && (
          <>
            <span className="font-display text-xs font-semibold tracking-tight">Sessions</span>
            <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-faint">
              {scopedTabs.length === 0
                ? 'none'
                : `${scopedTabs.length}${runningCount > 0 ? ` · ${runningCount} running` : ''}`}
            </span>
          </>
        )}
        <RailIconButton label={collapsed ? 'Expand sessions (Ctrl+B)' : 'Collapse sessions (Ctrl+B)'} onClick={toggleRail}>
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </RailIconButton>
      </div>

      {/* Sessions */}
      <nav className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1', collapsed ? 'px-1.5' : 'px-2')}>
        {groups.length === 0 && !collapsed && (
          <p className="px-2 py-3 text-xs text-faint">No terminal in this scope.</p>
        )}
        {groups.map((g) => (
          <div key={g.workspaceId} className="mb-2">
            {collapsed ? (
              <div className="mx-auto mb-1.5 h-px w-5 bg-border first:hidden" />
            ) : (
              <div className="eyebrow flex items-center gap-1.5 px-2 pb-1 pt-1.5">
                {g.color && <span className="size-1.5 rounded-full" style={{ backgroundColor: g.color }} aria-hidden />}
                <span className="truncate">{g.name}</span>
                <span className="ml-auto tabular-nums">{g.tabs.length}</span>
              </div>
            )}
            <div className={cn('flex flex-col', collapsed ? 'items-center gap-1' : 'gap-0.5')}>
              {g.tabs.map((tab) =>
                collapsed ? (
                  <SessionIcon key={tab.id} tab={tab} items={items} active={tab.id === activeTabId} onSelect={() => setActiveTab(tab.id)} />
                ) : (
                  <SessionRow
                    key={tab.id}
                    tab={tab}
                    items={items}
                    active={tab.id === activeTabId}
                    onSelect={() => setActiveTab(tab.id)}
                    onClose={() => closeTabAndRelease(tab.id)}
                  />
                )
              )}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className={cn('flex shrink-0 items-center border-t border-border', collapsed ? 'justify-center py-2' : 'p-2')}>
        {collapsed ? (
          <RailIconButton label="New terminal (Ctrl+Shift+T)" onClick={() => void openNewTerminal()}>
            <Plus className="size-4" />
          </RailIconButton>
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => void openNewTerminal()} title="Ctrl+Shift+T">
            <Plus />
            New terminal
          </Button>
        )}
      </div>

      {/* Resize handle */}
      {!collapsed && (
        <div className="absolute -right-1 top-0 z-40 h-full w-2 cursor-ew-resize" onMouseDown={onResizeStart}>
          <div className={cn('mx-auto h-full w-px transition-colors', resizing ? 'bg-primary' : 'bg-transparent hover:bg-accent-border')} />
        </div>
      )}
    </aside>
  );
}
