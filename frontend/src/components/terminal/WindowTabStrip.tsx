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
import { Pin, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TerminalTypeIcon } from '@/components/layout/terminal-dnd/TerminalTypeIcon';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { tabsInScope, type TerminalTab } from '@/lib/terminalLayout';
import { comboLabelFor } from '@/lib/keybindings';
import { cn } from '@/lib/utils';
import { TerminalStatusGlyph } from './TerminalStatusGlyph';
import { closeTabAndRelease, openNewTerminal } from './actions';
import { describeItem, projectColor, sortTabs, tabItem, tabLiveState, tabProject, tabTitle, useItemMap, type ItemMap } from './model';
import { TabContextMenu, TabRenameInput } from './tabMenu';
import { useTabContextMenu, useTabRename } from './useTabMenu';
import type { Project } from '@/types';

interface WindowTabProps {
  tab: TerminalTab;
  items: ItemMap;
  projects: Project[];
  isActive: boolean;
  /** 1-based position in the strip (Ctrl+N jumps there); shown faintly on hover / while Ctrl is held. */
  index: number;
  /** Show the project chip (global scope). */
  showProject: boolean;
  onSelect: () => void;
  onClose: () => void;
}

/**
 * One tab of the strip: sortable, renamable on double-click, closable with
 * the X or a middle click, with a right-click menu anchored at the pointer.
 */
function WindowTab({ tab, items, projects, isActive, index, showProject, onSelect, onClose }: WindowTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };

  const item = tabItem(tab, items);
  const live = tabLiveState(tab, items);
  const title = tabTitle(tab, items);
  const project = tabProject(tab, projects);

  const rename = useTabRename(tab, title);
  const menu = useTabContextMenu();

  const accent = tab.color ?? undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group/tab relative flex h-9 min-w-0 max-w-[240px] cursor-grab select-none items-center gap-2 border-r border-border px-3 text-xs transition-colors',
        isActive ? 'bg-terminal text-foreground' : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
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
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 rounded-b-full bg-primary"
          style={accent ? { backgroundColor: accent } : undefined}
        />
      )}
      <TerminalTypeIcon
        type={item?.type ?? 'shell'}
        className="pointer-events-none size-3.5 shrink-0 text-faint"
      />
      {tab.pinned && <Pin className="pointer-events-none size-2.5 shrink-0 text-faint" aria-label="Pinned" />}
      <TerminalStatusGlyph live={live} className="pointer-events-none" />
      {rename.editing ? (
        <TabRenameInput value={rename.draft} onChange={rename.setDraft} onCommit={rename.commit} onCancel={rename.cancel} className="w-32" />
      ) : (
        <span
          className="pointer-events-none truncate"
          style={accent && !isActive ? { color: accent } : undefined}
          title={item ? describeItem(item) : undefined}
        >
          {title}
        </span>
      )}
      {showProject && project && (
        <span className="pointer-events-none flex min-w-0 shrink items-center gap-1 rounded-full bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground">
          <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: projectColor(project.id) }} aria-hidden />
          <span className="truncate">{project.name}</span>
        </span>
      )}
      {index <= 9 && !rename.editing && (
        <span
          className="pointer-events-none ml-auto shrink-0 font-mono text-[10px] tabular-nums text-faint opacity-0 transition-opacity group-hover/tab:opacity-100 [html[data-ctrl-held]_&]:opacity-100"
          aria-hidden
        >
          {index}
        </span>
      )}
      <button
        type="button"
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-[6px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/tab:opacity-100',
          index > 9 || rename.editing ? 'ml-auto' : ''
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

  const tabs = useMemo(() => sortTabs(tabsInScope(win, win.scope)), [win]);
  const ids = useMemo(() => tabs.map((t) => t.id), [tabs]);
  const newCombo = comboLabelFor('tab.new', keybindings);

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
      reorderTabs(arrayMove(ids, from, to));
    },
    [ids, reorderTabs]
  );

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-background/70">
      <div className="no-scrollbar flex min-w-0 flex-1 items-stretch overflow-x-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToHorizontalAxis]} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab, i) => (
              <WindowTab
                key={tab.id}
                tab={tab}
                items={items}
                projects={projects}
                isActive={tab.id === win.activeTabId}
                index={i + 1}
                showProject={win.scope === 'global'}
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
    </div>
  );
}
