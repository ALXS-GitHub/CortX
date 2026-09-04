import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type Ref } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pin, Plus, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TerminalTypeIcon } from '@/components/layout/terminal-dnd/TerminalTypeIcon';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { RAIL_WIDTH_COLLAPSED, useTerminalWindowPrefsStore } from '@/stores/terminalWindowPrefsStore';
import { tabsInScope, type TerminalTab } from '@/lib/terminalLayout';
import { comboLabelFor } from '@/lib/keybindings';
import { cn } from '@/lib/utils';
import { TerminalStatusGlyph } from './TerminalStatusGlyph';
import { closeTabAndRelease, closeWorkspaceTabs, openNewTerminal } from './actions';
import { CloseConfirmDialog } from './CloseConfirmDialog';
import {
  cwdLabel,
  describeItem,
  groupTabsByWorkspace,
  tabItem,
  tabLiveState,
  tabTitle,
  useItemMap,
  type ItemMap,
  type WorkspaceGroup,
} from './model';
import { TabContextMenu, TabRenameInput } from './tabMenu';
import { useTabContextMenu, useTabRename } from './useTabMenu';

/**
 * Icon button with a tooltip. Extra props (and the ref) land on the button so
 * it can also be the `asChild` trigger of a menu.
 */
function RailIconButton({
  label,
  onClick,
  children,
  className,
  ...rest
}: { label: string; onClick?: () => void; children: ReactNode; className?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children' | 'className'> & {
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          {...rest}
          onClick={onClick}
          aria-label={label}
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-[var(--rad-nav)] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground',
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

/**
 * One session row (expanded rail): sortable within its group, renamable on
 * double-click, with the tab's colour as a left accent bar (and a faint tint
 * when active) and a right-click menu. The second line is the live cwd, or
 * the command while one runs — the only place this is shown now. `index` is
 * the tab's position for Ctrl+N, shown faintly on hover / while Ctrl is held.
 */
function SessionRow({
  tab,
  items,
  active,
  index,
  onSelect,
  onClose,
}: {
  tab: TerminalTab;
  items: ItemMap;
  active: boolean;
  index: number;
  onSelect: () => void;
  onClose: () => void;
}) {
  const item = tabItem(tab, items);
  const live = tabLiveState(tab, items);
  const title = tabTitle(tab, items);
  const cwd = cwdLabel(item);
  const running = item?.shell?.phase === 'running';
  const secondary = running ? (item?.shell?.command ?? '(command)') : cwd;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  const rename = useTabRename(tab, title);
  const menu = useTabContextMenu();

  const color = tab.color;
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Active + coloured: a tint of the tab colour instead of the neutral accent.
    ...(active && color ? { backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)` } : {}),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.stopPropagation();
        rename.start();
      }}
      onKeyDown={(e) => {
        if (rename.editing) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        } else if (e.key === 'F2') {
          e.preventDefault();
          rename.start();
        }
      }}
      onContextMenu={menu.onContextMenu}
      title={!rename.editing && item ? describeItem(item) : undefined}
      className={cn(
        'group relative flex h-10 w-full cursor-default select-none items-center gap-2 rounded-[var(--rad-nav)] px-2 text-left transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        active && !color && 'bg-accent',
        isDragging && 'z-10 opacity-60'
      )}
      {...attributes}
      {...listeners}
    >
      {color && (
        <span
          className="pointer-events-none absolute inset-y-2 left-0 w-[3px] rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      <TerminalTypeIcon
        type={item?.type ?? 'shell'}
        className="pointer-events-none size-3.5 shrink-0 text-faint"
      />
      {rename.editing ? (
        <TabRenameInput
          value={rename.draft}
          onChange={rename.setDraft}
          onCommit={rename.commit}
          onCancel={rename.cancel}
          className="min-w-0 flex-1"
        />
      ) : (
        <span className="pointer-events-none flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[12.5px]">{title}</span>
          {secondary && (
            <span className={cn('truncate font-mono text-[10.5px]', running ? 'text-primary' : 'text-faint')}>{secondary}</span>
          )}
        </span>
      )}
      {tab.pinned && <Pin className="pointer-events-none size-2.5 shrink-0 text-faint" aria-label="Pinned" />}
      {index <= 9 && !rename.editing && (
        <span
          className="pointer-events-none shrink-0 font-mono text-[10px] tabular-nums text-faint opacity-0 transition-opacity group-hover:opacity-100 [html[data-ctrl-held]_&]:opacity-100"
          aria-hidden
        >
          {index}
        </span>
      )}
      <TerminalStatusGlyph live={live} className="pointer-events-none" />
      <button
        type="button"
        className="grid size-5 shrink-0 place-items-center rounded-[6px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        title="Close tab"
        aria-label="Close tab"
      >
        <X className="pointer-events-none size-3" />
      </button>

      <TabContextMenu tab={tab} open={menu.open} onOpenChange={menu.setOpen} pos={menu.pos} onRename={rename.start} onClose={onClose} />
    </div>
  );
}

/**
 * The rows of one workspace group, reorderable by drag within the group.
 * Each group is its own drag context so a row cannot land in another
 * workspace.
 */
function SessionGroupRows({
  group,
  items,
  activeTabId,
  firstIndex,
  onSelect,
  onReorder,
}: {
  group: WorkspaceGroup;
  items: ItemMap;
  activeTabId: string | null;
  /** Position of the group's first tab in the whole rail (Ctrl+N numbering). */
  firstIndex: number;
  onSelect: (tabId: string) => void;
  onReorder: (workspaceId: string, orderedIds: string[]) => void;
}) {
  const ids = useMemo(() => group.tabs.map((t) => t.id), [group.tabs]);
  // A small distance threshold keeps plain clicks (select, rename, close)
  // from being swallowed by the drag sensor.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from === -1 || to === -1) return;
      onReorder(group.workspaceId, arrayMove(ids, from, to));
    },
    [ids, group.workspaceId, onReorder]
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-0.5">
          {group.tabs.map((tab, i) => (
            <SessionRow
              key={tab.id}
              tab={tab}
              items={items}
              active={tab.id === activeTabId}
              index={firstIndex + i}
              onSelect={() => onSelect(tab.id)}
              onClose={() => closeTabAndRelease(tab.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

/**
 * Header of a workspace group (expanded rail): the project's dot and name,
 * the tab count, and a menu that acts on the whole section — right-click
 * anywhere on the row, or the "…" button that appears on hover.
 */
function SessionGroupHeader({ group }: { group: WorkspaceGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="eyebrow group/gh flex items-center gap-1.5 px-2 pb-1 pt-1.5"
      onContextMenu={(e) => {
        e.preventDefault();
        setOpen(true);
      }}
    >
      {group.color && <span className="size-1.5 rounded-full" style={{ backgroundColor: group.color }} aria-hidden />}
      <span className="truncate">{group.name}</span>
      <span className="ml-auto tabular-nums">{group.tabs.length}</span>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${group.name} actions`}
            title={`${group.name} actions`}
            className="grid size-4 shrink-0 place-items-center rounded-[4px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/gh:opacity-100 aria-expanded:opacity-100"
          >
            <MoreHorizontal className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          <DropdownMenuLabel className="truncate">{group.name}</DropdownMenuLabel>
          <DropdownMenuItem variant="destructive" onClick={() => void closeWorkspaceTabs(group.workspaceId, group.name)}>
            <XCircle />
            Close all
            <span className="ml-auto text-xs tabular-nums opacity-70">{group.tabs.length}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
  const keybindings = useAppStore((s) => s.settings?.terminal.keybindings);
  // Selectors must return stable references: derive the scoped list here.
  const win = useTerminalLayoutStore((s) => s.doc.window);
  const scopedTabs = useMemo(() => tabsInScope(win, win.scope), [win]);
  const activeTabId = win.activeTabId;
  const setActiveTab = useTerminalLayoutStore((s) => s.setActiveTab);
  const reorderTabs = useTerminalLayoutStore((s) => s.reorderTabs);
  const { railCollapsed, toggleRail, railWidth, setRailWidth } = useTerminalWindowPrefsStore();

  const groups = useMemo(() => groupTabsByWorkspace(scopedTabs, projects), [scopedTabs, projects]);
  // Where each group's numbering starts (Ctrl+N counts across groups).
  const groupOffsets = useMemo(() => {
    const out: number[] = [];
    let n = 1;
    for (const g of groups) {
      out.push(n);
      n += g.tabs.length;
    }
    return out;
  }, [groups]);
  const newCombo = comboLabelFor('tab.new', keybindings);
  const railCombo = comboLabelFor('window.rail', keybindings);

  // A drop reorders one group; the other groups keep their relative order in
  // the full list the store expects.
  const reorderGroup = useCallback(
    (workspaceId: string, orderedIds: string[]) => {
      reorderTabs(groups.flatMap((g) => (g.workspaceId === workspaceId ? orderedIds : g.tabs.map((t) => t.id))));
    },
    [groups, reorderTabs]
  );

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
        <RailIconButton
          label={`${collapsed ? 'Expand sessions' : 'Collapse sessions'}${railCombo ? ` (${railCombo})` : ''}`}
          onClick={toggleRail}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </RailIconButton>
      </div>

      {/* Sessions */}
      <nav className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1', collapsed ? 'px-1.5' : 'px-2')}>
        {groups.length === 0 && !collapsed && (
          <p className="px-2 py-3 text-xs text-faint">No terminal in this scope.</p>
        )}
        {groups.map((g, gi) => (
          <div key={g.workspaceId} className="mb-2">
            {collapsed ? (
              <div className="mx-auto mb-1.5 h-px w-5 bg-border first:hidden" />
            ) : (
              <SessionGroupHeader group={g} />
            )}
            {collapsed ? (
              <div className="flex flex-col items-center gap-1">
                {g.tabs.map((tab) => (
                  <SessionIcon key={tab.id} tab={tab} items={items} active={tab.id === activeTabId} onSelect={() => setActiveTab(tab.id)} />
                ))}
              </div>
            ) : (
              <SessionGroupRows
                group={g}
                items={items}
                activeTabId={activeTabId}
                firstIndex={groupOffsets[gi] ?? 1}
                onSelect={setActiveTab}
                onReorder={reorderGroup}
              />
            )}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className={cn('flex shrink-0 items-center border-t border-border', collapsed ? 'flex-col justify-center gap-1 py-2' : 'gap-1.5 p-2')}>
        {collapsed ? (
          <RailIconButton label={newCombo ? `New terminal (${newCombo})` : 'New terminal'} onClick={() => void openNewTerminal()}>
            <Plus className="size-4" />
          </RailIconButton>
        ) : (
          <Button variant="outline" size="sm" className="min-w-0 flex-1" onClick={() => void openNewTerminal()} title={newCombo ?? undefined}>
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

      {/* "Something is still running" prompt of the Terminal window. */}
      <CloseConfirmDialog />
    </aside>
  );
}
