import { useCallback, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type Ref } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { ChevronRight, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pin, Plus, X, XCircle } from 'lucide-react';
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
import { AgentProviderIcon } from '@/components/agents/AgentProviderIcon';
import { useAppStore } from '@/stores/appStore';
import { TERMINAL_WINDOW_ID, useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { RAIL_WIDTH_COLLAPSED, useTerminalWindowPrefsStore } from '@/stores/terminalWindowPrefsStore';
import { collectLeaves, type TerminalTab } from '@/lib/terminalLayout';
import { comboLabelFor, tabShortcutNumber } from '@/lib/keybindings';
import { cn } from '@/lib/utils';
import { TerminalStatusGlyph } from './TerminalStatusGlyph';
import { closeTabAndRelease, closeWorkspaceTabs, openNewTerminal, tabsElsewhere, tabsOfWorkspace } from './actions';
import { describeCloseReach } from '@/lib/closeReach';
import { CloseConfirmDialog } from './CloseConfirmDialog';
import {
  describeItem,
  groupTabsByWorkspace,
  tabSecondary,
  tabItem,
  tabLiveState,
  tabTitle,
  tintStyle,
  useItemMap,
  useScopedTabs,
  useTabDisplay,
  type ItemMap,
  type ResolvedTabDisplay,
  type TabLiveState,
  type WorkspaceGroup,
} from './model';
import {
  groupToReveal,
  isFolded,
  loudestLive,
  toggleSection,
  unfoldSection,
  type ActiveTabRef,
} from './sectionFold';
import { TabContextMenu, TabRenameInput } from './tabMenu';
import { TabRowBody } from './TabRow';
import { PaneGroupBranch } from './PaneTabs';
import { groupCardClass, groupHeadline, paneCountLabel, usePaneEntries, useSelectPane } from './paneModel';
import { useTabContextMenu, useTabRename } from './useTabMenu';
import { useDetachDrag } from './useDetachDrag';

/**
 * Which project sections this rail keeps folded (ticket #40).
 *
 * **Why not the layout document.** `terminalLayoutStore` is the one place a
 * Terminal window can write something and have it survive a restart — but it
 * is also broadcast to every other window and to the main window's dock, and
 * that is exactly what a fold must not do. Folding "CortX" in the window on
 * the left is a statement about *that rail's* viewport: the window on the
 * right may be working in CortX and would find its sections shut for reasons
 * it cannot see. Layout is shared; what a viewport shows of it is not, which
 * is the same line `railCollapsed` and `railWidth` already sit on.
 *
 * **Why persist it anyway.** A fold is a disposition, not a session state: the
 * user hides the three projects they are not on today and expects them still
 * hidden tomorrow. Re-folding six sections at every launch is the whole reason
 * the ticket exists.
 *
 * **Per window, by key.** Every Terminal webview shares one origin, so one
 * `localStorage` — hence a key per window id rather than one document holding
 * every window's set: two windows then never write over each other's entry,
 * and a fold in one is invisible to the other until each is asked itself.
 *
 * The value is a set of **workspace ids** (`project:<id>`, or the free
 * workspace), never indices: a fold follows its project through a reorder, a
 * close and a rename, and an id whose project is gone simply never matches
 * again.
 */
interface RailFoldState {
  folded: string[];
  toggle: (workspaceId: string) => void;
  reveal: (workspaceId: string) => void;
}

const useRailFoldStore = create<RailFoldState>()(
  persist(
    (set) => ({
      folded: [],
      toggle: (workspaceId) => set((s) => ({ folded: toggleSection(s.folded, workspaceId) })),
      reveal: (workspaceId) => set((s) => ({ folded: unfoldSection(s.folded, workspaceId) })),
    }),
    { name: `cortx-terminal-rail-folds:${TERMINAL_WINDOW_ID}` }
  )
);

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
 * double-click, tinted with the tab's colour, with a right-click menu. What it
 * shows — second line, status, agent, Ctrl+N number — follows
 * `terminal.tabDisplay`.
 *
 * Ticket #22: the colour used to be a 3 px bar at the left edge plus a wash
 * you only saw once the row was current. It now tints the whole row, at rest,
 * exactly as in the strip (`.tt-tint`); the bar survives behind
 * `tabDisplay.colorBar`, off by default.
 *
 * A tab holding a split becomes a **group**: one box (`PaneGroupBranch`) whose
 * first row is the tab's own label and whose other rows are its panes — the
 * label inside the box it names, not floating above it. Each pane row is a
 * session in its own right: its own X, its own menu, its own status. The box
 * only says that they share a tab.
 *
 * The sortable node is the wrapper *outside* the box, so the whole group
 * travels with its tab while it is dragged — the layout document reorders and
 * detaches tabs, not leaves.
 */
function SessionRow({
  tab,
  items,
  active,
  index,
  total,
  display,
  onSelect,
  onClose,
}: {
  tab: TerminalTab;
  items: ItemMap;
  active: boolean;
  /** 1-based position across the whole rail. */
  index: number;
  /** How many tabs the rail holds — Ctrl+9 means "the last one" of them. */
  total: number;
  display: ResolvedTabDisplay;
  onSelect: () => void;
  onClose: () => void;
}) {
  const item = tabItem(tab, items);
  const live = tabLiveState(tab, items);
  // Also decides the row's icon, below.
  const agent = display.agent ? live.agent : undefined;
  const title = tabTitle(tab, items, display.agent);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  const rename = useTabRename(tab, title);
  const menu = useTabContextMenu();
  const panes = usePaneEntries(tab, items, display.agent);
  const selectPane = useSelectPane();
  const grouped = panes.length > 1;
  const shortcutNumber = tabShortcutNumber(index, total);
  // A group header names the tab; a path would be cut mid-word here.
  const headline = grouped ? groupHeadline(title) : title;
  // Under a group header, the active pane's directory only repeats a row
  // right below it — how many panes there are is what the header can add.
  const secondary = tabSecondary(item, live, display, grouped ? paneCountLabel(panes.length) : undefined);

  const color = tab.color;
  const tinted = Boolean(color);
  // `CSS.Translate`, **not** `CSS.Transform`: a sorting strategy also hands
  // back a scale — the ratio between the dragged row and the one it is over —
  // and the rail's rows are not the same height (a tab holding a split is
  // ~117 px, a plain one 40). Rendering that scale is what stretched a tab
  // out of shape mid-drag ("des fois certains tabs s'étendent visuellement").
  // Only the translation is wanted; the row keeps its own size.
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  // The colour travels as a custom property; every mix is in the stylesheet,
  // over the window's own surface. Whichever box is the tab's own surface
  // wears it: the card when the tab holds a split, the row otherwise.
  const tint = tintStyle(color);

  // The glyph in front of the name. Held in a variable because the rename
  // input replaces the text block beside it, never the icon itself.
  const icon = agent ? (
    <AgentProviderIcon provider={agent.provider} plain className="pointer-events-none size-3.5 shrink-0" />
  ) : (
    <TerminalTypeIcon type={item?.type ?? 'shell'} className="pointer-events-none size-3.5 shrink-0 text-faint" />
  );

  // The tab's own row. Standalone it *is* the tab; inside a group it is the
  // group's label — the first row of the box, so the title sits in the thing
  // it names (Alexis, 2026-09-09), and still the drag handle of the whole tab.
  const row = (
    <div
      style={grouped ? undefined : tint}
      data-current={grouped ? undefined : active ? 'true' : 'false'}
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
      title={
        rename.editing
          ? undefined
          : // The headline is shortened; the tooltip keeps the whole name.
            [grouped ? title : null, item ? describeItem(item) : null].filter(Boolean).join('\n') || undefined
      }
      className={cn(
        'group relative flex h-10 w-full cursor-default select-none items-center gap-2 rounded-[var(--rad-nav)] px-2 text-left transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        // Standalone row: it is its own surface. Group label: the box it
        // now lives in is, so it only gets a hover cue of its own. The
        // geometry below used to be a `.tt-group-v > .tt-head` block in
        // `terminal-tabs.css` — a seam left there when this file was
        // off-limits; it belongs on the element it describes.
        grouped
          ? 'tt-head mb-0.5 h-6 gap-[5px] rounded-[var(--rad-xs)] px-[5px] [&>svg]:size-3'
          : tinted
            ? 'tt-tint tt-tint-ring'
            : cn(!active && 'hover:bg-accent/60', active && 'bg-accent')
      )}
      {...attributes}
      {...listeners}
    >
      {display.colorBar && color && (
        <span
          className="pointer-events-none absolute inset-y-2 left-0 w-[3px] rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      {rename.editing ? (
        <>
          {icon}
          <TabRenameInput
            value={rename.draft}
            onChange={rename.setDraft}
            onCommit={rename.commit}
            onCancel={rename.cancel}
            className="min-w-0 flex-1"
          />
        </>
      ) : (
        // Grouped, this row is the group's label: one line, the name and the
        // pane count sharing it (`dense`).
        <TabRowBody icon={icon} title={headline} secondary={secondary} dense={grouped} />
      )}
      {tab.pinned && <Pin className="pointer-events-none size-2.5 shrink-0 text-faint" aria-label="Pinned" />}
      {/* Only the rows a Ctrl+N actually reaches get a number (ticket
          #34): 1…8, then 9 on the last one, where Ctrl+9 goes. */}
      {display.index !== 'never' && shortcutNumber !== null && !rename.editing && (
        <span
          className={cn(
            'pointer-events-none shrink-0 font-mono text-[10px] tabular-nums text-faint transition-opacity',
            display.index === 'always' ? 'opacity-100' : 'opacity-0 [html[data-ctrl-held]_&]:opacity-100'
          )}
          aria-hidden
        >
          {shortcutNumber}
        </span>
      )}
      {/* Grouped: every pane row carries its own status; the tab-wide one
          here would only repeat whichever pane happened to be loudest. */}
      {display.status && !grouped && <TerminalStatusGlyph live={live} className="pointer-events-none" />}
      {/* Grouped, this X closes the **whole tab** — every pane in the box
          — so it must not look like the X of a pane. It keeps a ring
          (`XCircle`, the same glyph "Close all" wears in the project
          header) and says how many panes it takes with it; the plain X on
          each pane row closes that pane alone. */}
      <button
        type="button"
        className="grid size-5 shrink-0 place-items-center rounded-[6px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        title={grouped ? `Close tab and its ${panes.length} panes` : 'Close tab'}
        aria-label={grouped ? `Close tab and its ${panes.length} panes` : 'Close tab'}
      >
        {grouped ? (
          <XCircle className="pointer-events-none size-3" />
        ) : (
          <X className="pointer-events-none size-3" />
        )}
      </button>

      <TabContextMenu tab={tab} open={menu.open} onOpenChange={menu.setOpen} pos={menu.pos} onRename={rename.start} onClose={onClose} />
    </div>
  );

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'z-10 opacity-60')}>
      {grouped ? (
        <div
          className={cn(groupCardClass(active, 'vertical'), tinted && 'tt-tint')}
          style={tint}
          data-current={active ? 'true' : 'false'}
        >
          <PaneGroupBranch
            tab={tab}
            panes={panes}
            tabActive={active}
            display={display}
            onSelect={(leafId) => selectPane(tab, leafId)}
          >
            {row}
          </PaneGroupBranch>
        </div>
      ) : (
        row
      )}
    </div>
  );
}

/**
 * The rows of one workspace group, reorderable by drag within the group.
 * Each group is its own drag context so a row cannot land in another
 * workspace.
 *
 * A project's rows are **individual rows under the project's name**, and
 * nothing else. They briefly shared one tinted box (an over-reading of ticket
 * #22): sharing a project is not sharing a tab, and the box said the second
 * thing. The only box left in the rail is the one around a real split, which
 * is the one thing that *is* one object — see `PaneGroupBranch`.
 */
function SessionGroupRows({
  group,
  items,
  activeTabId,
  firstIndex,
  total,
  display,
  onSelect,
  onReorder,
}: {
  group: WorkspaceGroup;
  items: ItemMap;
  activeTabId: string | null;
  /** Position of the group's first tab in the whole rail (Ctrl+N numbering). */
  firstIndex: number;
  /** Tabs in the whole rail, so the last one can wear the 9. */
  total: number;
  display: ResolvedTabDisplay;
  onSelect: (tabId: string) => void;
  onReorder: (workspaceId: string, orderedIds: string[]) => void;
}) {
  const ids = useMemo(() => group.tabs.map((t) => t.id), [group.tabs]);
  // A small distance threshold keeps plain clicks (select, rename, close)
  // from being swallowed by the drag sensor.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Dragging a row past the edge of the window detaches the tab (ticket #20).
  // The row itself stays inside (the modifiers below); `DetachDropHint` is
  // what tells the user what releasing will do — and, when the pointer is
  // over another Terminal window, that window draws the tab it describes.
  const detach = useDetachDrag({
    describe: (tabId) => {
      const tab = group.tabs.find((t) => t.id === tabId);
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
      if (detach.finish(String(active.id))) return;
      if (!over || active.id === over.id) return;
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from === -1 || to === -1) return;
      onReorder(group.workspaceId, arrayMove(ids, from, to));
    },
    [ids, group.workspaceId, onReorder, detach]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragStart={detach.start}
      onDragCancel={detach.cancel}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-0.5">
          {group.tabs.map((tab, i) => (
            <SessionRow
              key={tab.id}
              tab={tab}
              items={items}
              active={tab.id === activeTabId}
              index={firstIndex + i}
              total={total}
              display={display}
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
 *
 * Since ticket #40 it is also the section's **fold control**, which is why the
 * name, the dot, the chevron and the count live inside a real `<button>`: a
 * thing you click to open and shut is a button, it must be reachable by Tab,
 * and it owes a screen reader an `aria-expanded` and the rows it controls
 * (`aria-controls`, matched by a `role="group"` box carrying the section's
 * name around the rows).
 *
 * Three things already lived on this row and none of them may be stolen:
 *
 * - the **right-click menu** stays on the wrapper, so right-clicking anywhere
 *   — the button included — still opens it and never folds;
 * - the **"…" button** is a *sibling* of the fold button, not a child: a
 *   button inside a button is invalid HTML and, in practice, one click doing
 *   two things;
 * - `onContextMenu` calls `preventDefault`, so the fold button's own
 *   activation (click, Enter, Space) is the only thing that folds.
 *
 * Folded, the header is all that is left of the section, so it says more:
 * the count it always carried, the glyph of whatever inside is asking for you
 * (`loudestLive` — an agent waiting, a command that failed), and, when the
 * current tab is one of the rows it hides, the same plate the current row
 * wears. That last one is the answer to "where did my tab go": it did not
 * move, it is in here.
 */
function SessionGroupHeader({
  group,
  folded,
  onToggle,
  contentId,
  holdsActive,
  signal,
}: {
  group: WorkspaceGroup;
  folded: boolean;
  onToggle: () => void;
  /** The rows this header opens and shuts. */
  contentId: string;
  /** The tab the window is on is one of this section's — worth saying once folded. */
  holdsActive: boolean;
  /** Live state of the loudest tab inside, when folding would hide it. */
  signal: TabLiveState | null;
}) {
  const [open, setOpen] = useState(false);
  // What "Close all" is really about to take. Since ticket #37 it reaches
  // every Terminal window, so the rail's own list is no longer the answer: a
  // badge saying 3 over a click that closes 7 is worse than the bug it came
  // from. Counted at the moment the menu opens, off the very list the action
  // closes, and the line under the entry names the windows the rest are in —
  // the same two sentences the tab menu shows (`ReachNote`, `tabMenu.tsx`,
  // which is not ours to export from).
  const closing = open ? tabsOfWorkspace(group.workspaceId) : [];
  const reach = open ? describeCloseReach(tabsElsewhere(closing)) : null;
  const tabs = group.tabs.length;
  // The count says tabs, because that is what the rows below it are — a split
  // is one row. Folded, how many *sessions* went away is the other honest
  // number, so it goes in the tooltip rather than swapping the badge: a
  // number that changes value when you fold the thing it describes is worse
  // than no number.
  const panes = group.tabs.reduce((n, tab) => n + collectLeaves(tab.layout).length, 0);
  const summary = [
    `${tabs} tab${tabs > 1 ? 's' : ''}`,
    panes > tabs ? `${panes} panes` : null,
    folded && holdsActive ? 'holds the current session' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div
      className="group/gh flex items-center gap-1 pb-1 pl-1 pr-2 pt-1.5"
      onContextMenu={(e) => {
        e.preventDefault();
        setOpen(true);
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!folded}
        aria-controls={contentId}
        aria-label={`${group.name} — ${summary}`}
        title={`${group.name}\n${summary}`}
        className={cn(
          'eyebrow flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--rad-xs)] px-1 py-0.5 text-left transition-colors hover:text-foreground',
          // Folded over the tab you are on, the header stands in for the row
          // it is hiding, so it borrows the row's plate rather than inventing
          // a second dot beside the project's own.
          folded && holdsActive ? 'bg-accent text-foreground' : 'hover:bg-accent/60'
        )}
      >
        <ChevronRight
          className={cn('tt-caret size-3 shrink-0 text-faint', !folded && 'rotate-90')}
          aria-hidden
        />
        {group.color && (
          <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} aria-hidden />
        )}
        <span className="truncate">{group.name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {/* Folded, the rows that were shouting are gone; the loudest one
              lends the header its glyph so a waiting agent or a failed
              command is not hidden by a fold. */}
          {folded && signal && <TerminalStatusGlyph live={signal} className="pointer-events-none" />}
          <span className="tabular-nums">{tabs}</span>
        </span>
      </button>
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
            <span className="ml-auto text-xs tabular-nums opacity-70">{closing.length}</span>
          </DropdownMenuItem>
          {reach && (
            <p className="truncate px-2 pb-1 pl-8 text-[10.5px] leading-snug text-faint">including {reach}</p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** One session (collapsed rail): the type icon with the status in its corner. */
function SessionIcon({
  tab,
  items,
  active,
  display,
  onSelect,
}: {
  tab: TerminalTab;
  items: ItemMap;
  active: boolean;
  display: ResolvedTabDisplay;
  onSelect: () => void;
}) {
  const item = tabItem(tab, items);
  const live = tabLiveState(tab, items);
  const agent = display.agent ? live.agent : undefined;
  const title = tabTitle(tab, items, display.agent);
  // No room for a group of chips here; the number of panes is what a
  // collapsed rail can honestly say about a split.
  const paneCount = collectLeaves(tab.layout).length;
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
          {agent ? (
            <AgentProviderIcon provider={agent.provider} plain className="size-4" />
          ) : (
            <TerminalTypeIcon type={item?.type ?? 'shell'} className="size-4" />
          )}
          {display.status && (
            <span className="absolute -right-0.5 -top-0.5 grid place-items-center">
              <TerminalStatusGlyph live={live} className="scale-90" />
            </span>
          )}
          {paneCount > 1 && (
            <span
              // Same family as the expanded rail's group card; `--tab-active-bg`
              // is an accent wash, which goes muddy over a wallpaper theme.
              className="tt-badge absolute -bottom-0.5 -right-0.5 grid h-3 min-w-3 place-items-center rounded-full px-0.5 font-mono text-[8.5px] leading-none tabular-nums text-foreground"
              aria-hidden
            >
              {paneCount}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {title}
        {item?.projectName ? ` · ${item.projectName}` : ''}
        {paneCount > 1 ? ` · ${paneCount} panes` : ''}
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
  const scopedTabs = useScopedTabs(win);
  const display = useTabDisplay();
  const activeTabId = win.activeTabId;
  const setActiveTab = useTerminalLayoutStore((s) => s.setActiveTab);
  const reorderTabs = useTerminalLayoutStore((s) => s.reorderTabs);
  const { railCollapsed, toggleRail, railWidth, setRailWidth } = useTerminalWindowPrefsStore();
  const folded = useRailFoldStore((s) => s.folded);
  const toggleFold = useRailFoldStore((s) => s.toggle);
  const revealFold = useRailFoldStore((s) => s.reveal);
  // One id per rail, so a header can name the list of rows it opens.
  const railId = useId();

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

  // A folded section must never be able to hide the tab you are on *because
  // you navigated to it*: Ctrl+N, the palette, Ctrl+Tab, a new terminal and
  // `cortx terminal --project` all end in `setActiveTab`, so watching the
  // current tab covers every one of them without any of them knowing the rail
  // exists. Folding the section you are already in is left alone — see
  // `groupToReveal`, and the plate the header wears for it.
  const activeWorkspaceId = useMemo(
    () => (activeTabId ? scopedTabs.find((t) => t.id === activeTabId)?.workspaceId ?? null : null),
    [scopedTabs, activeTabId]
  );
  // `undefined` until the first pass: what the rail boots into is what the
  // user left folded, and revealing there would undo it.
  const seenActive = useRef<ActiveTabRef | null | undefined>(undefined);
  useEffect(() => {
    const current: ActiveTabRef | null =
      activeTabId && activeWorkspaceId ? { tabId: activeTabId, workspaceId: activeWorkspaceId } : null;
    // Read the set at call time: this effect answers "the current tab moved",
    // and folding a section must not re-run it.
    const target = groupToReveal(seenActive.current, current, useRailFoldStore.getState().folded);
    seenActive.current = current;
    if (target) revealFold(target);
  }, [activeTabId, activeWorkspaceId, revealFold]);

  // "3 running" used to count agent tabs too — `claude` keeps a command
  // running from start to finish, so every agent inflated the number.
  const counts = useMemo(() => {
    let running = 0;
    let agents = 0;
    for (const tab of scopedTabs) {
      const live = tabLiveState(tab, items);
      if (live.agent) agents += 1;
      else if (live.running) running += 1;
    }
    return { running, agents };
  }, [scopedTabs, items]);

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
                : [
                    String(scopedTabs.length),
                    counts.agents > 0 ? `${counts.agents} agent${counts.agents > 1 ? 's' : ''}` : null,
                    counts.running > 0 ? `${counts.running} running` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
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
        {groups.map((g, gi) => {
          // Folding is an expanded-rail affair: the icon strip has no header
          // to click, and a hairline between two runs of icons is already all
          // the section it can show.
          const shut = !collapsed && isFolded(folded, g.workspaceId);
          const contentId = `${railId}-${gi}`;
          return (
            <div key={g.workspaceId} className="mb-2">
              {collapsed ? (
                <div className="mx-auto mb-1.5 h-px w-5 bg-border first:hidden" />
              ) : (
                <SessionGroupHeader
                  group={g}
                  folded={shut}
                  onToggle={() => toggleFold(g.workspaceId)}
                  contentId={contentId}
                  holdsActive={g.tabs.some((t) => t.id === activeTabId)}
                  signal={
                    shut && display.status ? loudestLive(g.tabs.map((t) => tabLiveState(t, items))) : null
                  }
                />
              )}
              {collapsed ? (
                <div className="flex flex-col items-center gap-1">
                  {g.tabs.map((tab) => (
                    <SessionIcon
                      key={tab.id}
                      tab={tab}
                      items={items}
                      active={tab.id === activeTabId}
                      display={display}
                      onSelect={() => setActiveTab(tab.id)}
                    />
                  ))}
                </div>
              ) : (
                // The rows are unmounted while folded rather than hidden: a
                // fold is meant to buy back the space *and* the work — a
                // hidden `DndContext` still measures, and dnd-kit measuring a
                // `display:none` list is how a drop lands in the wrong place.
                // The box itself stays, so `aria-controls` always points at
                // something and the group keeps its name.
                <div id={contentId} role="group" aria-label={g.name} hidden={shut}>
                  {!shut && (
                    <SessionGroupRows
                      group={g}
                      items={items}
                      activeTabId={activeTabId}
                      firstIndex={groupOffsets[gi] ?? 1}
                      total={scopedTabs.length}
                      display={display}
                      onSelect={setActiveTab}
                      onReorder={reorderGroup}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
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
