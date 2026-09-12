import { useMemo, useRef } from 'react';
import {
  AppWindow,
  Check,
  Columns2,
  Copy,
  CopyPlus,
  ExternalLink,
  FolderMinus,
  FolderOpen,
  FolderTree,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Plug,
  Sparkles,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import type { LeafNode, TerminalTab } from '@/lib/terminalLayout';
import { comboLabelFor } from '@/lib/keybindings';
import { ACCENT_PRESETS } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { FREE_WORKSPACE_ID } from '@/lib/terminalLayout';
import {
  closeOtherTabs,
  closeWorkspaceTabs,
  copyTerminalCwd,
  duplicateTab,
  moveTabToNewWindow,
  moveTabToWindow,
  openTerminalCwd,
  otherClosableTabs,
  otherTerminalWindows,
  tabsElsewhere,
  tabsOfWorkspace,
  terminalCwd,
} from './actions';
import { describeCloseReach } from '@/lib/closeReach';
import { NO_PROJECT_GROUP_NAME, activeLeafOf, tabAgent, useItemMap } from './model';
import { detectSubshell, warpifySubshell, type SubshellShell } from './subshell';
import { revealAgentSession } from '@/lib/tauri';

/**
 * The pieces a terminal tab shares between the tab strip and the sessions
 * rail: the rename field, the colour swatches and the right-click menu
 * (rename / pin / duplicate / path / colour / close). The hooks live in
 * `useTabMenu.ts`.
 */

/** Colour swatches of the context menu (theme accent presets, or none). */
export function ColorRow({ current, onPick }: { current: string | null; onPick: (color: string | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => onPick(null)}
        title="No colour"
        aria-label="No colour"
        className={cn(
          'grid size-4 place-items-center rounded-full border border-border-strong text-faint transition-colors hover:border-foreground',
          current === null && 'ring-2 ring-ring/60 ring-offset-1 ring-offset-background'
        )}
      >
        <X className="size-2.5" />
      </button>
      {ACCENT_PRESETS.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onPick(c.value)}
          title={c.name}
          aria-label={c.name}
          className={cn(
            'size-4 rounded-full transition-transform hover:scale-110',
            current === c.value && 'ring-2 ring-ring/60 ring-offset-1 ring-offset-background'
          )}
          style={{ backgroundColor: c.value }}
        />
      ))}
    </div>
  );
}

/**
 * The rename field. Enter commits, Escape cancels, leaving the field commits.
 * Pointer events stop here so the surrounding tab neither selects nor starts
 * a drag while typing; a `done` flag keeps the blur that follows Escape from
 * committing anyway.
 */
export function TabRenameInput({
  value,
  onChange,
  onCommit,
  onCancel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit();
    else onCancel();
  };
  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
        e.stopPropagation();
      }}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      className={cn('h-6 rounded-[var(--rad-xs)] px-1.5 text-xs shadow-none', className)}
      aria-label="Tab title"
    />
  );
}

/** Shells the "Shell integration here" submenu can target (ticket #16). */
const SUBSHELL_CHOICES: Array<{ id: SubshellShell; label: string }> = [
  { id: 'bash', label: 'bash' },
  { id: 'zsh', label: 'zsh' },
  { id: 'fish', label: 'fish' },
  { id: 'powershell', label: 'PowerShell' },
];

/**
 * The line under a bulk close saying which other Terminal windows it reaches
 * into (ticket #37). It sits outside the entry rather than inside it so the
 * row keeps its single-line shape and the note is not swallowed by the item's
 * hover highlight — the same treatment the cwd line already gets.
 */
function ReachNote({ reach }: { reach: string }) {
  return <p className="truncate px-2 pb-1 pl-8 text-[10.5px] leading-snug text-faint">including {reach}</p>;
}

/** The one pane a menu acts on, when it is not the whole tab's menu. */
export interface PaneMenuTarget {
  leaf: LeafNode;
  /** What the menu writes at the top, so it is obvious which pane it acts on. */
  label: string;
}

interface TabContextMenuProps {
  tab: TerminalTab;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pointer position relative to the (positioned) tab element. */
  pos: { x: number; y: number };
  onRename?: () => void;
  onClose: () => void;
  /**
   * Set on the rows of a split: the menu then acts on **that pane** rather
   * than on the tab (ticket #22 follow-up — "ils sont censés se comporter
   * individuellement, mais juste regroupés dans le split").
   */
  pane?: PaneMenuTarget;
}

/**
 * Right-click menu of a tab — or of **one pane** of it, when `pane` is set.
 * Render it inside the tab (or pane) element, which must be `relative`: the
 * trigger never receives pointer events, so it cannot fight the drag sensor,
 * and events from the portaled content are stopped so they do not bubble back
 * into the row (select, rename, drag).
 *
 * One component for both, rather than a second menu that would drift: a pane
 * is a terminal, so everything addressed to *a terminal* (its path, its
 * Explorer, shell integration in it, its agent, closing it) is simply pointed
 * at that pane's leaf, and only what belongs to the *tab* as an object — its
 * name, its pin, its colour, duplicating it, moving it to another window,
 * bulk closes — is left out.
 */
export function TabContextMenu({ tab, open, onOpenChange, pos, onRename, onClose, pane }: TabContextMenuProps) {
  const togglePinTab = useTerminalLayoutStore((s) => s.togglePinTab);
  const setTabColor = useTerminalLayoutStore((s) => s.setTabColor);
  const setTabProject = useTerminalLayoutStore((s) => s.setTabProject);
  const keybindings = useAppStore((s) => s.settings?.terminal.keybindings);
  const projects = useAppStore((s) => s.projects);
  const leaf = pane?.leaf ?? activeLeafOf(tab);
  const terminalId = leaf.terminalId;
  // Read at open time only: the cwd is live state, the menu a snapshot.
  const cwd = open ? terminalCwd(terminalId) ?? leaf.cwd ?? null : null;
  // A Claude Code / Codex session detected here: offer to open it in the
  // Agents section, where the transcript and the annotations live. For a pane
  // that is the pane's own agent, not "any agent somewhere in the tab".
  const items = useItemMap();
  const tabWideAgent = tabAgent(tab, items);
  const agent = pane ? items.get(terminalId)?.agent : tabWideAgent;
  // Bulk closes (ticket "close a whole section of tabs"), counted at open time.
  //
  // Counted on the very list the action will close — every Terminal window,
  // never the dock (ticket #37). The count and the deed come from one call, so
  // a menu that says 7 cannot close 3, and the line under each entry names the
  // windows those tabs are in when they are not all here.
  const wholeTab = open && !pane;
  const otherTabs = wholeTab ? otherClosableTabs(tab.id) : [];
  const groupTabs = wholeTab ? tabsOfWorkspace(tab.workspaceId) : [];
  const otherCount = otherTabs.length;
  const groupCount = groupTabs.length;
  const otherReach = describeCloseReach(tabsElsewhere(otherTabs));
  const groupReach = describeCloseReach(tabsElsewhere(groupTabs));
  // Terminal windows this tab could move to (ticket #20), read at open time.
  const otherWindows = useMemo(() => (wholeTab ? otherTerminalWindows() : []), [wholeTab]);
  // A sub-shell running in this pane, for "Enable shell integration here"
  // (ticket #16). The entry is always there — detection only preselects the
  // shell — because CortX cannot be sure what a program really is.
  const running = useAppStore((s) => s.terminalStates.get(terminalId));
  const subshell = open && running?.phase === 'running' ? detectSubshell(running.command) : null;
  const enableIn = (shell: SubshellShell) =>
    void warpifySubshell(terminalId, shell, { remote: subshell?.remote ?? false });
  const groupName =
    tab.workspaceId === FREE_WORKSPACE_ID
      ? NO_PROJECT_GROUP_NAME
      : projects.find((p) => `project:${p.id}` === tab.workspaceId)?.name ?? 'this project';
  const shortcut = (label: string | null) => (label ? <DropdownMenuShortcut>{label}</DropdownMenuShortcut> : null);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <span className="pointer-events-none absolute size-0" style={{ left: pos.x, top: pos.y }} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        // The max width is what makes the `truncate` below it work. A menu
        // sizes to its content, and `truncate` sets `white-space: nowrap`, so
        // a long line contributes its *whole* width to that measurement and
        // the ellipsis never appears — the cwd of a deep checkout was widening
        // the entire menu to fit a path nobody reads in full. 18rem holds the
        // longest entry ("Shell integration here") with room to spare.
        className="min-w-52 max-w-72"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {pane && (
          <DropdownMenuLabel className="flex items-center gap-2 truncate">
            <Columns2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{pane.label}</span>
          </DropdownMenuLabel>
        )}
        {!pane && (
          <>
            <DropdownMenuItem onClick={onRename}>
              <Pencil />
              Rename
              {shortcut(comboLabelFor('tab.rename', keybindings))}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => togglePinTab(tab.id)}>
              {tab.pinned ? <PinOff /> : <Pin />}
              {tab.pinned ? 'Unpin' : 'Pin'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void duplicateTab(tab.id)}>
              <CopyPlus />
              Duplicate tab
              {shortcut(comboLabelFor('tab.duplicate', keybindings))}
            </DropdownMenuItem>
          </>
        )}
        {agent?.sessionId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void revealAgentSession(agent.sessionId!)}>
              <Sparkles />
              Open in Agents
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        {/* Ticket #16: a shell started inside this one (ssh, docker, a plain
            `bash`) has no CortX integration unless its own rc file sets it up.
            One click types the block into it — explicitly, because a terminal
            cannot tell a shell from any other interactive program. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Plug />
            Shell integration here
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-52">
            <DropdownMenuLabel className="font-normal text-[11px] leading-snug text-faint">
              {subshell
                ? `${subshell.what} is running here. Wait for its prompt, then pick its shell.`
                : 'Type the CortX integration into the shell running in this pane. Only do this at a shell prompt.'}
            </DropdownMenuLabel>
            {SUBSHELL_CHOICES.map((s) => (
              <DropdownMenuItem key={s.id} onClick={() => enableIn(s.id)}>
                {s.label}
                {subshell?.shell === s.id && <span className="ml-auto text-[10px] text-faint">detected</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {/* Which group of the rail the tab sits in. A tab normally follows its
            own shells (`terminal.followProjectOnCd`); picking a project here
            says otherwise and pins it, and "Automatic" hands it back. */}
        {!pane && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderTree />
                Project
                <span className="ml-auto max-w-28 truncate pl-2 text-xs opacity-70">{groupName}</span>
              </DropdownMenuSubTrigger>
              {/* Same reason as the parent: a project named at length would
                  otherwise stretch the list rather than ellipsise inside it. */}
              <DropdownMenuSubContent className="max-h-80 min-w-52 max-w-64 overflow-y-auto">
                <DropdownMenuItem onClick={() => setTabProject(tab.id, undefined)}>
                  <Wand2 />
                  Automatic
                  {!tab.workspacePinned && <Check className="ml-auto size-3.5" />}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTabProject(tab.id, null)}>
                  <FolderMinus />
                  <span className="truncate">{NO_PROJECT_GROUP_NAME}</span>
                  {tab.workspacePinned && tab.workspaceId === FREE_WORKSPACE_ID && (
                    <Check className="ml-auto size-3.5" />
                  )}
                </DropdownMenuItem>
                {projects.map((p) => (
                  <DropdownMenuItem key={p.id} onClick={() => setTabProject(tab.id, p.id)}>
                    <FolderOpen />
                    <span className="truncate">{p.name}</span>
                    {tab.workspacePinned && tab.workspaceId === `project:${p.id}` && (
                      <Check className="ml-auto size-3.5" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
        {/* Several Terminal windows (ticket #20): the shell keeps running,
            the tab is simply redrawn in the window it lands in. A *pane* has
            no such move — the layout document moves tabs, not leaves. */}
        {!pane && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void moveTabToNewWindow(tab.id)}>
              <ExternalLink />
              Move to new window
            </DropdownMenuItem>
            {otherWindows.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <AppWindow />
                  Move to window
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-44 max-w-64">
                  {otherWindows.map((w) => (
                    <DropdownMenuItem key={w.id} onClick={() => void moveTabToWindow(tab.id, w.id)}>
                      <AppWindow />
                      <span className="truncate">{w.name}</span>
                      <span className="ml-auto text-xs tabular-nums opacity-70">{w.tabs}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!cwd} onClick={() => void copyTerminalCwd(terminalId)}>
          <Copy />
          Copy path
          {shortcut(comboLabelFor('terminal.copyCwd', keybindings))}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!cwd} onClick={() => void openTerminalCwd(terminalId)}>
          <FolderOpen />
          Open in Explorer
          {shortcut(comboLabelFor('terminal.openCwd', keybindings))}
        </DropdownMenuItem>
        {cwd && <p className="truncate px-2 pb-1 font-mono text-[10.5px] text-faint">{cwd}</p>}
        {/* The colour belongs to the tab, and a split shares one tab: offering
            it on a pane would let two rows of the same box disagree. */}
        {!pane && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2">
              <Palette className="size-3.5 text-muted-foreground" />
              Colour
            </DropdownMenuLabel>
            <ColorRow
              current={tab.color}
              onPick={(color) => {
                setTabColor(tab.id, color);
                onOpenChange(false);
              }}
            />
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onClose}>
          <X />
          {pane ? 'Close pane' : 'Close'}
        </DropdownMenuItem>
        {!pane && (
          <>
            <DropdownMenuItem
              variant="destructive"
              disabled={otherCount < 1}
              onClick={() => void closeOtherTabs(tab.id)}
            >
              <X />
              Close others
              {otherCount > 0 && <span className="ml-auto text-xs tabular-nums opacity-70">{otherCount}</span>}
            </DropdownMenuItem>
            {otherCount > 0 && otherReach && <ReachNote reach={otherReach} />}
            <DropdownMenuItem
              variant="destructive"
              disabled={groupCount < 2}
              onClick={() => void closeWorkspaceTabs(tab.workspaceId, groupName)}
            >
              <XCircle />
              <span className="truncate">Close all in {groupName}</span>
              {groupCount > 1 && <span className="ml-auto text-xs tabular-nums opacity-70">{groupCount}</span>}
            </DropdownMenuItem>
            {groupCount > 1 && groupReach && <ReachNote reach={groupReach} />}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
