import { useCallback, useMemo, type CSSProperties } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { useDetachDrag } from './useDetachDrag';
import { Pin, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TerminalTypeIcon } from '@/components/layout/terminal-dnd/TerminalTypeIcon';
import { AgentProviderIcon } from '@/components/agents/AgentProviderIcon';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { collectLeaves, isAgentsScope, type TerminalTab } from '@/lib/terminalLayout';
import { comboLabelFor, tabShortcutNumber } from '@/lib/keybindings';
import { cn } from '@/lib/utils';
import { TerminalStatusGlyph } from './TerminalStatusGlyph';
import { closeTabAndRelease, openNewTerminal } from './actions';
import { CloseConfirmDialog } from './CloseConfirmDialog';
import {
  describeItem,
  projectColor,
  sortTabs,
  tabItem,
  tabLiveState,
  tabProject,
  tabTitle,
  useItemMap,
  useScopedTabs,
  useTabDisplay,
  type ItemMap,
  type ResolvedTabDisplay,
} from './model';
import { TabContextMenu, TabRenameInput } from './tabMenu';
import { PaneGroupChips } from './PaneTabs';
import { groupCardClass, groupHeadline, usePaneEntries, useSelectPane } from './paneModel';
import { useTabContextMenu, useTabRename } from './useTabMenu';
import type { Project } from '@/types';

interface WindowTabProps {
  tab: TerminalTab;
  items: ItemMap;
  projects: Project[];
  isActive: boolean;
  /** 1-based position in the strip. */
  index: number;
  /** How many tabs the strip holds — Ctrl+9 means "the last one" of them. */
  total: number;
  /** Show the project chip (scopes that mix projects). */
  showProject: boolean;
  display: ResolvedTabDisplay;
  onSelect: () => void;
  onClose: () => void;
}

/**
 * One tab of the strip: sortable, renamable on double-click, closable with
 * the X or a middle click, with a right-click menu anchored at the pointer.
 *
 * A tab holding a split renders as a **group**: the tab itself becomes a
 * small inset card holding its own name, a hairline, then one chip per pane
 * (`PaneGroupChips`) — the rail's nested card laid on its side, since a 36 px
 * row has nowhere to indent. Clicking a chip makes that pane current. The
 * card *is* the tab element, so the group stays a single sortable unit —
 * reorder and detach still act on the tab, which is what the layout document
 * knows.
 */
function WindowTab({ tab, items, projects, isActive, index, total, showProject, display, onSelect, onClose }: WindowTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };

  const item = tabItem(tab, items);
  const live = tabLiveState(tab, items);
  const agent = display.agent ? live.agent : undefined;
  const title = tabTitle(tab, items, display.agent);
  const project = tabProject(tab, projects);

  const rename = useTabRename(tab, title);
  const menu = useTabContextMenu();
  const panes = usePaneEntries(tab, items, display.agent);
  const selectPane = useSelectPane();
  const grouped = panes.length > 1;
  // A group header names the tab; a path would be cut mid-word here.
  const headline = grouped ? groupHeadline(title) : title;

  const accent = tab.color ?? undefined;
  // Only the tabs a Ctrl+N actually reaches get a number (ticket #34): 1…8,
  // then 9 on the last one, which is where Ctrl+9 goes.
  const shortcutNumber = tabShortcutNumber(index, total);
  const showIndex = display.index !== 'never' && shortcutNumber !== null && !rename.editing;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group/tab relative flex min-w-0 cursor-grab select-none items-center text-xs transition-colors',
        grouped
          ? cn(
              // Inset so the card reads as one object floating in the strip,
              // rather than a stretch of it fenced off by dividers.
              'my-1 ml-1 h-7 max-w-[540px] gap-1.5 self-center px-1.5',
              groupCardClass(isActive, 'horizontal'),
              isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )
          : cn(
              'h-9 max-w-[240px] gap-2 border-r border-border px-3',
              isActive ? 'bg-terminal text-foreground' : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
            ),
        isDragging && 'z-10 opacity-50'
      )}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        rename.start();
      }}
      onMouseDown={(e) => {
        // Middle click: keep the browser from starting auto-scroll.
        if (e.button === 1) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      onContextMenu={menu.onContextMenu}
      {...attributes}
      {...listeners}
    >
      {isActive && (
        <span
          className={cn(
            'pointer-events-none absolute bg-primary',
            // Inside the rounded card the bar has to stay off the corners.
            grouped ? 'inset-x-2 top-[2px] h-[2px] rounded-full' : 'inset-x-0 top-0 h-0.5 rounded-b-full'
          )}
          style={accent ? { backgroundColor: accent } : undefined}
        />
      )}
      {agent ? (
        <AgentProviderIcon provider={agent.provider} plain className="pointer-events-none size-3.5 shrink-0" />
      ) : (
        <TerminalTypeIcon
          type={item?.type ?? 'shell'}
          className="pointer-events-none size-3.5 shrink-0 text-faint"
        />
      )}
      {tab.pinned && <Pin className="pointer-events-none size-2.5 shrink-0 text-faint" aria-label="Pinned" />}
      {/* Grouped: each chip carries its own status, the tab-wide one would
          only repeat whichever pane happened to be loudest. */}
      {display.status && !grouped && <TerminalStatusGlyph live={live} className="pointer-events-none" />}
      {rename.editing ? (
        <TabRenameInput value={rename.draft} onChange={rename.setDraft} onCommit={rename.commit} onCancel={rename.cancel} className="w-32" />
      ) : (
        <span
          className={cn('pointer-events-none truncate', grouped && 'max-w-[128px] shrink-0 font-medium')}
          style={accent && !isActive ? { color: accent } : undefined}
          title={item ? describeItem(item) : title}
        >
          {headline}
        </span>
      )}
      {grouped && !rename.editing && (
        <>
          <span className="tt-divider" aria-hidden />
          <PaneGroupChips
            tab={tab}
            panes={panes}
            tabActive={isActive}
            display={display}
            onSelect={(leafId) => selectPane(tab, leafId)}
          />
        </>
      )}
      {showProject && project && (
        <span className="pointer-events-none flex min-w-0 shrink items-center gap-1 rounded-full bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground">
          <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: projectColor(project.id) }} aria-hidden />
          <span className="truncate">{project.name}</span>
        </span>
      )}
      {showIndex && (
        <span
          className={cn(
            'pointer-events-none ml-auto shrink-0 font-mono text-[10px] tabular-nums text-faint transition-opacity',
            display.index === 'always' ? 'opacity-100' : 'opacity-0 [html[data-ctrl-held]_&]:opacity-100'
          )}
          aria-hidden
        >
          {shortcutNumber}
        </span>
      )}
      <button
        type="button"
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-[6px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/tab:opacity-100',
          showIndex ? '' : 'ml-auto'
        )}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
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
 * Horizontal tab strip of the Terminal window: the tabs of the current
 * scope, pinned first, reorderable by drag, with a "+" for a new terminal.
 */
export function WindowTabStrip() {
  const items = useItemMap();
  const projects = useAppStore((s) => s.projects);
  const keybindings = useAppStore((s) => s.settings?.terminal.keybindings);
  const win = useTerminalLayoutStore((s) => s.doc.window);
  const setActiveTab = useTerminalLayoutStore((s) => s.setActiveTab);
  const reorderTabs = useTerminalLayoutStore((s) => s.reorderTabs);

  const scoped = useScopedTabs(win);
  const display = useTabDisplay();
  const tabs = useMemo(() => sortTabs(scoped), [scoped]);
  const ids = useMemo(() => tabs.map((t) => t.id), [tabs]);
  const newCombo = comboLabelFor('tab.new', keybindings);

  // A small distance threshold keeps plain clicks (select, rename, close)
  // from being swallowed by the drag sensor.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Dragging a tab past the edge of the window detaches it (ticket #20).
  // `describe` is what the destination window draws under the cursor once
  // the pointer is out of this one.
  const detach = useDetachDrag({
    describe: (tabId) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return { title: 'Terminal', panes: 1, color: null };
      return {
        title: tabTitle(tab, items, display.agent),
        panes: collectLeaves(tab.layout).length,
        color: tab.color,
      };
    },
  });

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      // Dropped outside: the tab left for another window, nothing to reorder.
      if (detach.finish(String(active.id))) return;
      if (!over || active.id === over.id) return;
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from === -1 || to === -1) return;
      reorderTabs(arrayMove(ids, from, to));
    },
    [ids, reorderTabs, detach]
  );

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-background/70">
      <div className="no-scrollbar flex min-w-0 flex-1 items-stretch overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragStart={detach.start}
          onDragCancel={detach.cancel}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab, i) => (
              <WindowTab
                key={tab.id}
                tab={tab}
                items={items}
                projects={projects}
                isActive={tab.id === win.activeTabId}
                index={i + 1}
                total={tabs.length}
                showProject={win.scope === 'global' || isAgentsScope(win.scope)}
                display={display}
                onSelect={() => setActiveTab(tab.id)}
                onClose={() => closeTabAndRelease(tab.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
        <div className="flex shrink-0 items-center px-1">
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-7 rounded-[var(--rad-xs)]"
            onClick={() => void openNewTerminal()}
            title={newCombo ? `New terminal (${newCombo})` : 'New terminal'}
            aria-label="New terminal"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* "Something is still running" prompt (tab-strip layout of the window). */}
      <CloseConfirmDialog />
    </div>
  );
}
