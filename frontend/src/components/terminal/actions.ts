import { create } from 'zustand';
import { toast } from 'sonner';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { emit } from '@tauri-apps/api/event';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore, TERMINAL_WINDOW_ID } from '@/stores/terminalLayoutStore';
import { useTerminalWindowPrefsStore } from '@/stores/terminalWindowPrefsStore';
import { adjustTerminalZoom, clearTerminal, focusTerminal, resetTerminalZoom } from '@/lib/terminalSessions';
import { jumpToBlock } from '@/lib/terminalBlocks';
import { openInExplorer, showMainWindow, writeTerminal } from '@/lib/tauri';
import { basename } from '@/lib/terminalNames';
import type { KeybindingActionId } from '@/lib/keybindings';
import { finishTabCycle, stepTabCycle, tabCycleTarget, type TabCycleState } from '@/lib/tabCycle';
import type { TerminalCtrlTabBehavior } from '@/types';
import { activeLeafOf, splitPathTo, visibleTabOrder } from './model';
import {
  collectLeaves,
  mapLeaves,
  newLayoutId,
  nextTerminalWindowLabel,
  projectIdOfWorkspace,
  removeLeaf,
  tabContainingTerminal,
  terminalWindowIdOf,
  terminalWindowIds,
  terminalWindowName,
  type LayoutNode,
  type SplitDirection,
  type TerminalTab,
} from '@/lib/terminalLayout';
import { openTerminalWindow } from './terminalWindows';
import { openCommandHistory } from './history/openHistory';

/**
 * Imperative actions of the Terminal window. They read the stores at call
 * time (no stale closures) so every entry point — rail footer, "+" button,
 * empty state, leaf header, keyboard shortcuts, palette, context menus —
 * shares one implementation. `runAction` maps a keybinding action id to
 * the matching function.
 */

/** Custom DOM events the window components listen to (no store needed). */
export const TERMINAL_EVENTS = {
  /** Toggle the command palette (`detail` unused). */
  palette: 'cortx:terminal-palette',
  /** Start renaming a tab inline: `detail: { tabId, handled }` — the row that owns it sets `handled`. */
  renameTab: 'cortx:terminal-rename-tab',
} as const;

export interface RenameTabEventDetail {
  tabId: string;
  handled: boolean;
}

/** Live cwd of a terminal (shell integration), else the cwd its shell opened in. */
export function terminalCwd(terminalId: string): string | undefined {
  const app = useAppStore.getState();
  const live = app.terminalStates.get(terminalId)?.cwd;
  if (live) return live;
  if (terminalId.startsWith('shell:')) return app.shellRuntimes.get(terminalId.slice('shell:'.length))?.cwd;
  return undefined;
}

/** Where a brand-new shell starts: after the current leaf, else the scoped project, else home. */
function resolveSpawnTarget(tab: TerminalTab | null, leafTerminalId?: string) {
  const { doc } = useTerminalLayoutStore.getState();
  const { projects } = useAppStore.getState();
  const scope = doc.window.scope;
  const scopedProjectId = scope === 'global' ? undefined : scope.projectId;
  const tabProjectId = tab ? projectIdOfWorkspace(tab.workspaceId) ?? undefined : undefined;
  const projectId = scopedProjectId ?? tabProjectId;
  const fromLeaf = leafTerminalId ?? (tab ? activeLeafOf(tab).terminalId : undefined);
  const cwd =
    (fromLeaf ? terminalCwd(fromLeaf) : undefined) ??
    (projectId ? projects.find((p) => p.id === projectId)?.rootPath : undefined);
  return { projectId, cwd };
}

/** Open a new shell in a new tab of the current scope. */
export async function openNewTerminal(): Promise<void> {
  const layout = useTerminalLayoutStore.getState();
  const { projectId, cwd } = resolveSpawnTarget(layout.activeTab());
  try {
    const shellId = await useAppStore.getState().openShell({ projectId, cwd, surface: 'window' });
    useTerminalLayoutStore.getState().addTerminalToWindow(`shell:${shellId}`, { projectId });
  } catch (error) {
    console.error('Failed to open a terminal:', error);
    toast.error(`Failed to open terminal: ${String(error)}`);
  }
}

/**
 * Open a new shell next to a leaf. `horizontal` puts it to the right,
 * `vertical` below (see `SplitDirection`).
 */
export async function splitLeaf(tabId: string, leafId: string, direction: SplitDirection): Promise<void> {
  const layout = useTerminalLayoutStore.getState();
  const tab = layout.doc.window.tabs.find((t) => t.id === tabId) ?? null;
  const leafTerminalId = tab ? collectLeaves(tab.layout).find((l) => l.id === leafId)?.terminalId : undefined;
  const { projectId, cwd } = resolveSpawnTarget(tab, leafTerminalId);
  try {
    const shellId = await useAppStore.getState().openShell({ projectId, cwd, surface: 'window' });
    const store = useTerminalLayoutStore.getState();
    // A split while maximized would be invisible: restore the layout first.
    if (tab?.maximizedLeafId) store.toggleMaximizeLeaf(tabId, null);
    store.addTerminalToWindow(`shell:${shellId}`, {
      projectId,
      splitFrom: { tabId, leafId, direction },
    });
  } catch (error) {
    console.error('Failed to split the terminal:', error);
    toast.error(`Failed to open terminal: ${String(error)}`);
  }
}

/**
 * Shells die with their leaf; services and scripts keep running in the
 * backend (the main window can still find them), the window just stops
 * showing them.
 */
function releaseTerminal(terminalId: string) {
  if (!terminalId.startsWith('shell:')) return;
  const app = useAppStore.getState();
  // `closeTerminal` only kills shells it knows; a shell spawned by the other
  // window may not be registered here yet, so make sure the process goes.
  if (!app.terminals.has(terminalId)) {
    app.killShell(terminalId.slice('shell:'.length)).catch(() => {});
  }
  app.closeTerminal(terminalId);
}

// ---------------------------------------------------------------------------
// "Something is still running" confirmation
// ---------------------------------------------------------------------------

/** One command a close is about to kill, as shown in the dialog. */
export interface RunningCommand {
  terminalId: string;
  /** Tab title, else the directory the shell sits in. */
  where: string;
  /** The command line the shell reported, when it did. */
  command: string | null;
  /** Epoch ms the command started at. */
  startedAt: number | null;
}

interface CloseConfirmRequest {
  question: string;
  running: RunningCommand[];
  /** Quit prompts warn about the whole app, not just a tab. */
  quitting: boolean;
  /** When the dialog opened: the durations it shows must not tick while read. */
  askedAt: number;
  decide: (confirmed: boolean) => void;
}

interface CloseConfirmState {
  request: CloseConfirmRequest | null;
  ask: (request: Omit<CloseConfirmRequest, 'askedAt'>) => void;
  answer: (confirmed: boolean) => void;
}

/**
 * The single pending confirmation of this window (see `CloseConfirmDialog`).
 * A second request while one is open answers the first with "no": whatever
 * the user is now looking at is the one they mean.
 */
export const useCloseConfirmStore = create<CloseConfirmState>((set, get) => ({
  request: null,
  ask: (request) => {
    get().request?.decide(false);
    set({ request: { ...request, askedAt: Date.now() } });
  },
  answer: (confirmed) => {
    const current = get().request;
    if (!current) return;
    set({ request: null });
    current.decide(confirmed);
  },
}));

/** Where a terminal lives, for the confirmation list: tab title, else its cwd. */
export function describeTerminalLocation(terminalId: string): string {
  const tab = tabContainingTerminal(useTerminalLayoutStore.getState().doc.window, terminalId);
  if (tab?.title) return tab.title;
  const cwd = terminalCwd(terminalId);
  if (cwd) return basename(cwd);
  return 'Terminal';
}

/** The terminals of `terminalIds` whose shell says a command is running. */
export function runningAmong(terminalIds: string[]): RunningCommand[] {
  const states = useAppStore.getState().terminalStates;
  const out: RunningCommand[] = [];
  for (const terminalId of new Set(terminalIds)) {
    const state = states.get(terminalId);
    if (state?.phase !== 'running') continue;
    out.push({
      terminalId,
      where: describeTerminalLocation(terminalId),
      command: state.command ?? null,
      startedAt: state.startedAt ?? null,
    });
  }
  return out;
}

/** The `confirmCloseRunning` setting (on unless the user turned it off). */
export function confirmCloseRunningEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.confirmCloseRunning ?? true;
}

/**
 * Ask before killing terminals that are in the middle of something, the way
 * Warp does — the dialog names the commands. Resolves `true` straight away
 * when nothing is running (or the setting is off): an idle tab must never
 * cost the user a click.
 */
export function confirmCloseTerminals(terminalIds: string[], question: string): Promise<boolean> {
  if (!confirmCloseRunningEnabled()) return Promise.resolve(true);
  const running = runningAmong(terminalIds);
  if (running.length === 0) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    useCloseConfirmStore.getState().ask({ question, running, quitting: false, decide: resolve });
  });
}

/**
 * Same prompt for the app quit: the backend hands us what is running (its
 * `running_terminals`) and waits for the answer on `app-quit-decision`.
 * Called by `CloseConfirmDialog` in the main window.
 */
export function confirmQuit(running: RunningCommand[]): Promise<boolean> {
  if (!confirmCloseRunningEnabled() || running.length === 0) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    useCloseConfirmStore.getState().ask({
      question: 'Quit CortX?',
      running,
      quitting: true,
      decide: resolve,
    });
  });
}

/** Remove one leaf from the window and, for shells, kill the process. */
function closeLeafNow(terminalId: string): void {
  useTerminalLayoutStore.getState().removeTerminalFromWindow(terminalId, null);
  releaseTerminal(terminalId);
}

/** Close whole tabs: every leaf leaves the window, shells are killed. */
function closeTabsNow(tabIds: string[]): void {
  const layout = useTerminalLayoutStore.getState();
  for (const tabId of tabIds) {
    for (const id of layout.closeTab(tabId)) releaseTerminal(id);
  }
}

/**
 * Close one pane. Confirms first when a command is running in it (see
 * `confirmCloseTerminals`); the caller does not wait for the answer.
 */
export function closeLeaf(terminalId: string): void {
  void confirmCloseTerminals([terminalId], 'Close this pane?').then((ok) => {
    if (ok) closeLeafNow(terminalId);
  });
}

/** Close a tab (and its panes), asking first if something is running in it. */
export function closeTabAndRelease(tabId: string): void {
  void closeTabs([tabId]);
}

/**
 * Close several tabs at once behind a single confirmation listing every
 * command that is about to be killed — closing a project's whole group must
 * not ask once per tab.
 */
export async function closeTabs(tabIds: string[], question?: string): Promise<boolean> {
  if (tabIds.length === 0) return true;
  const win = useTerminalLayoutStore.getState().doc.window;
  const terminalIds = win.tabs
    .filter((t) => tabIds.includes(t.id))
    .flatMap((t) => collectLeaves(t.layout).map((l) => l.terminalId));
  const ok = await confirmCloseTerminals(
    terminalIds,
    question ?? (tabIds.length === 1 ? 'Close this terminal?' : `Close these ${tabIds.length} terminals?`)
  );
  if (ok) closeTabsNow(tabIds);
  return ok;
}

/** The scoped tabs of one workspace, in the order the rail shows them. */
export function tabsOfWorkspace(workspaceId: string): TerminalTab[] {
  return orderedTabs().filter((t) => t.workspaceId === workspaceId);
}

/** Close every tab of one workspace group (rail group header / tab menu). */
export function closeWorkspaceTabs(workspaceId: string, groupName?: string): Promise<boolean> {
  const tabs = tabsOfWorkspace(workspaceId);
  return closeTabs(
    tabs.map((t) => t.id),
    groupName ? `Close the ${tabs.length} terminals of ${groupName}?` : undefined
  );
}

/**
 * Close every tab of the current scope except `tabId`. Pinned tabs stay:
 * pinning is exactly the "keep this one around" gesture.
 */
export function closeOtherTabs(tabId: string): Promise<boolean> {
  const others = otherClosableTabs(tabId);
  return closeTabs(
    others.map((t) => t.id),
    `Close the ${others.length} other terminals?`
  );
}

/** What "Close others" would actually close (used for the menu's count too). */
export function otherClosableTabs(tabId: string): TerminalTab[] {
  return orderedTabs().filter((t) => t.id !== tabId && !t.pinned);
}

/** Hand a terminal back to the main window's dock. */
export function sendLeafToDock(terminalId: string): void {
  useTerminalLayoutStore.getState().sendToDock(terminalId);
}

// ---------------------------------------------------------------------------
// Several Terminal windows (ticket #20)
// ---------------------------------------------------------------------------

/**
 * Moving a tab between windows never touches the shell. The PTY lives in the
 * app process, keyed by terminal id; what a window owns is an xterm instance.
 * So the document is told which window shows the tab, the window that had it
 * disposes its session (`releaseMovedSessions` in the layout store) and the
 * window that gets it attaches and replays the scrollback from `TerminalHub`
 * — the very path a tab already takes when it comes back from being hidden.
 */

/** The other Terminal windows a tab could be moved to, in menu order. */
export function otherTerminalWindows(): Array<{ id: string; name: string; tabs: number }> {
  const { doc } = useTerminalLayoutStore.getState();
  return terminalWindowIds(doc)
    .filter((id) => id !== TERMINAL_WINDOW_ID)
    .map((id) => ({
      id,
      name: terminalWindowName(id),
      tabs: doc.window.tabs.filter((t) => terminalWindowIdOf(t) === id).length,
    }));
}

/** Where a detached window should appear, from a drop point in screen pixels. */
export interface DetachPosition {
  x: number;
  y: number;
}

/** Move a tab to an existing Terminal window and raise it. */
export async function moveTabToWindow(tabId: string, windowId: string): Promise<void> {
  useTerminalLayoutStore.getState().moveTabToWindow(tabId, windowId);
  try {
    await openTerminalWindow(windowId);
  } catch (error) {
    toast.error('Could not open that terminal window', { description: String(error) });
  }
}

/** Move a tab into a brand-new Terminal window (menu, or a drop outside). */
export async function moveTabToNewWindow(tabId: string, position?: DetachPosition | null): Promise<string | null> {
  const store = useTerminalLayoutStore.getState();
  const label = nextTerminalWindowLabel(store.doc);
  store.moveTabToWindow(tabId, label);
  try {
    await openTerminalWindow(label, { position });
    return label;
  } catch (error) {
    // The window could not be created: put the tab back where it was rather
    // than leaving it in a window that does not exist.
    useTerminalLayoutStore.getState().moveTabToWindow(tabId, TERMINAL_WINDOW_ID);
    toast.error('Could not open a new terminal window', { description: String(error) });
    return null;
  }
}

/** Same, for one pane of a split: it leaves as a tab of its own. */
export async function moveLeafToNewWindow(terminalId: string, position?: DetachPosition | null): Promise<string | null> {
  const store = useTerminalLayoutStore.getState();
  const label = nextTerminalWindowLabel(store.doc);
  store.moveLeafToWindow(terminalId, label);
  try {
    await openTerminalWindow(label, { position });
    return label;
  } catch (error) {
    useTerminalLayoutStore.getState().moveLeafToWindow(terminalId, TERMINAL_WINDOW_ID);
    toast.error('Could not open a new terminal window', { description: String(error) });
    return null;
  }
}

/** Move one pane to an existing Terminal window and raise it. */
export async function moveLeafToWindow(terminalId: string, windowId: string): Promise<void> {
  useTerminalLayoutStore.getState().moveLeafToWindow(terminalId, windowId);
  try {
    await openTerminalWindow(windowId);
  } catch (error) {
    toast.error('Could not open that terminal window', { description: String(error) });
  }
}

/** Move the active tab of this window out into a new one (palette entry). */
export function moveActiveTabToNewWindow(): boolean {
  const tab = useTerminalLayoutStore.getState().activeTab();
  if (!tab) return false;
  void moveTabToNewWindow(tab.id);
  return true;
}

/** Close the active leaf of the active tab (Ctrl+Shift+W). */
export function closeActiveLeaf(): void {
  const tab = useTerminalLayoutStore.getState().activeTab();
  if (!tab) return;
  closeLeaf(activeLeafOf(tab).terminalId);
}

/** Split the active leaf of the active tab (Ctrl+Shift+D / E). */
export function splitActiveLeaf(direction: SplitDirection): Promise<void> {
  const tab = useTerminalLayoutStore.getState().activeTab();
  if (!tab) return openNewTerminal();
  return splitLeaf(tab.id, activeLeafOf(tab).id, direction);
}

/**
 * The cycle Ctrl+Tab is walking right now, or null when no modifier is down.
 *
 * Module-level, like every other piece of state in this file, because the
 * gesture spans several events in several components: the presses come through
 * `runAction`, the release through `endTabCycle` (called by the Ctrl-held
 * detector in `useTerminalWindowShortcuts`). Only ever non-null between a
 * first Ctrl+Tab and the moment Ctrl comes up.
 */
let tabCycle: TabCycleState | null = null;

/** What Ctrl+Tab does, as configured. The default has never moved. */
function ctrlTabBehavior(): TerminalCtrlTabBehavior {
  return useAppStore.getState().settings?.terminal.ctrlTabBehavior ?? 'sequential';
}

/** Jump to the next / previous tab **in the tab list** (the default Ctrl+Tab). */
function cycleTabSequential(delta: 1 | -1): void {
  const layout = useTerminalLayoutStore.getState();
  const tabs = layout.scopedTabs();
  if (tabs.length < 2) return;
  const current = tabs.findIndex((t) => t.id === layout.doc.window.activeTabId);
  const next = tabs[(current + delta + tabs.length) % tabs.length];
  layout.setActiveTab(next.id);
}

/**
 * Ctrl+Tab as Alt+Tab (`ctrlTabBehavior = 'recentlyUsed'`, issue 45b): walk
 * the recently-used order, snapshotted at the first press and **not read
 * again** until Ctrl comes up. Re-reading it would be the ping-pong bug — the
 * store moves the tab we just switched to in front of the one we came from, so
 * the second press would walk right back. `stepTabCycle` owns that rule;
 * everything here does is read the store and hand it the result.
 */
function cycleTabRecentlyUsed(delta: 1 | -1): void {
  const layout = useTerminalLayoutStore.getState();
  const next = stepTabCycle({
    state: tabCycle,
    order: layout.recentTabs().map((t) => t.id),
    currentId: layout.doc.window.activeTabId,
    alive: new Set(layout.scopedTabs().map((t) => t.id)),
    delta,
  });
  tabCycle = next;
  if (next) layout.setActiveTab(tabCycleTarget(next));
  // A binding without Ctrl in it (the user is free to rebind "Next tab") gets
  // no release edge, so the gesture is over the moment it began: commit now
  // rather than leave a snapshot behind for the next press to walk. Reading
  // the attribute is reading the window's one Ctrl-held detector — see
  // `setCtrlHeld` in `useTerminalWindowShortcuts`.
  if (!document.documentElement.hasAttribute('data-ctrl-held')) endTabCycle();
}

/** Jump to the next / previous tab of the current scope (Ctrl+Tab). */
export function cycleTab(delta: 1 | -1): void {
  if (ctrlTabBehavior() === 'recentlyUsed') cycleTabRecentlyUsed(delta);
  else cycleTabSequential(delta);
}

/**
 * Ctrl came up (or the window stopped being able to see that it did): commit
 * the cycle and forget the snapshot.
 *
 * Called from the one Ctrl-held detector the window has
 * (`useTerminalWindowShortcuts`), which re-derives the modifier from every
 * keyboard and pointer event and clears it on blur — so this also runs when
 * the window loses the keyboard mid-gesture, which is exactly what must
 * happen: an abandoned cycle is validated where it stands rather than left
 * holding a snapshot of a screen the user has walked away from.
 *
 * Committing means putting the recently-used stack back the way the snapshot
 * had it, with the tab we landed on at its head — the tabs merely flashed past
 * keep their old places, so the next Ctrl+Tab goes where the last gesture
 * started from. Harmless and cheap when no cycle is running.
 */
export function endTabCycle(): void {
  const state = tabCycle;
  if (!state) return;
  tabCycle = null;
  useTerminalLayoutStore.getState().setTabMruOrder(finishTabCycle(state));
}

/** The tabs in the order the user sees them (rail groups, or strip order). */
export function orderedTabs(): TerminalTab[] {
  const { doc } = useTerminalLayoutStore.getState();
  const app = useAppStore.getState();
  return visibleTabOrder(doc.window, app.projects, app.settings?.terminal.tabsPlacement ?? 'sidebar');
}

/** Ctrl+1…9: the Nth visible tab; 9 (or anything past the end) is the last one. */
export function gotoTab(n: number): boolean {
  const tabs = orderedTabs();
  if (tabs.length === 0) return false;
  const target = n >= 9 || n > tabs.length ? tabs[tabs.length - 1] : tabs[n - 1];
  if (!target) return false;
  useTerminalLayoutStore.getState().setActiveTab(target.id);
  return true;
}

/**
 * Move the active leaf of the active tab in visual order (Alt+Arrow).
 * Returns false when there is nothing to move to, so the key can fall
 * through to the shell.
 */
export function cycleLeaf(delta: 1 | -1): boolean {
  const layout = useTerminalLayoutStore.getState();
  const tab = layout.activeTab();
  if (!tab) return false;
  const leaves = collectLeaves(tab.layout);
  if (leaves.length < 2) return false;
  const current = leaves.findIndex((l) => l.id === tab.activeLeafId);
  const next = leaves[(current + delta + leaves.length) % leaves.length];
  layout.setActiveLeaf(tab.id, next.id);
  useAppStore.getState().markTerminalSeen(next.terminalId);
  return true;
}

export type PaneDirection = 'left' | 'right' | 'up' | 'down';

function leafElement(leafId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-leaf-id="${CSS.escape(leafId)}"]`);
}

/**
 * Focus the pane in a direction (Ctrl+Alt+Arrow), judged on the panes' real
 * rectangles on screen. Returns false when there is no pane that way.
 */
export function focusLeafInDirection(direction: PaneDirection): boolean {
  const layout = useTerminalLayoutStore.getState();
  const tab = layout.activeTab();
  if (!tab || tab.maximizedLeafId) return false;
  const leaves = collectLeaves(tab.layout);
  if (leaves.length < 2) return false;
  const from = leafElement(tab.activeLeafId)?.getBoundingClientRect();
  if (!from) return cycleLeaf(direction === 'right' || direction === 'down' ? 1 : -1);
  const fromCx = (from.left + from.right) / 2;
  const fromCy = (from.top + from.bottom) / 2;

  let best: { id: string; terminalId: string; score: number } | null = null;
  for (const leaf of leaves) {
    if (leaf.id === tab.activeLeafId) continue;
    const r = leafElement(leaf.id)?.getBoundingClientRect();
    if (!r || r.width === 0) continue;
    let gap: number;
    let offAxis: number;
    switch (direction) {
      case 'left':
        gap = from.left - r.right;
        offAxis = Math.abs((r.top + r.bottom) / 2 - fromCy);
        break;
      case 'right':
        gap = r.left - from.right;
        offAxis = Math.abs((r.top + r.bottom) / 2 - fromCy);
        break;
      case 'up':
        gap = from.top - r.bottom;
        offAxis = Math.abs((r.left + r.right) / 2 - fromCx);
        break;
      case 'down':
        gap = r.top - from.bottom;
        offAxis = Math.abs((r.left + r.right) / 2 - fromCx);
        break;
    }
    if (gap < -2) continue; // not on that side
    // Panes that share an edge with us come first, then the closest sideways.
    const overlaps =
      direction === 'left' || direction === 'right'
        ? r.bottom > from.top && r.top < from.bottom
        : r.right > from.left && r.left < from.right;
    const score = gap * 10 + (overlaps ? 0 : 100_000) + offAxis;
    if (!best || score < best.score) best = { id: leaf.id, terminalId: leaf.terminalId, score };
  }
  if (!best) return false;
  layout.setActiveLeaf(tab.id, best.id);
  useAppStore.getState().markTerminalSeen(best.terminalId);
  return true;
}

const RESIZE_STEP = 0.05;
const MIN_FRACTION = 0.1;

/**
 * Move the active pane's divider by 5 % (Ctrl+Alt+Shift+Arrow): "right"
 * pushes its right edge right — or, for the last child, its left edge — in
 * the nearest split of that orientation.
 */
export function resizeActiveLeaf(direction: PaneDirection): boolean {
  const layout = useTerminalLayoutStore.getState();
  const tab = layout.activeTab();
  if (!tab || tab.maximizedLeafId) return false;
  const path = splitPathTo(tab.layout, tab.activeLeafId);
  if (!path) return false;
  const wanted: SplitDirection = direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical';
  const step = [...path].reverse().find((p) => p.split.direction === wanted);
  if (!step) return false;
  const { split, index } = step;
  const sizes = split.sizes.slice();
  const positive = direction === 'right' || direction === 'down';
  // The divider we move: after the child when growing towards the end and
  // there is a neighbour there, otherwise the one before it.
  let a: number;
  let b: number;
  let delta: number;
  if (positive) {
    if (index < sizes.length - 1) {
      a = index;
      b = index + 1;
      delta = RESIZE_STEP;
    } else if (index > 0) {
      a = index - 1;
      b = index;
      delta = RESIZE_STEP;
    } else return false;
  } else if (index > 0) {
    a = index - 1;
    b = index;
    delta = -RESIZE_STEP;
  } else if (index < sizes.length - 1) {
    a = index;
    b = index + 1;
    delta = -RESIZE_STEP;
  } else return false;
  const clamped = Math.max(MIN_FRACTION - sizes[a], Math.min(sizes[b] - MIN_FRACTION, delta));
  if (Math.abs(clamped) < 1e-4) return true;
  sizes[a] += clamped;
  sizes[b] -= clamped;
  layout.setSplitSizes(tab.id, split.id, sizes);
  return true;
}

/** Ctrl+Shift+Enter: the active leaf alone in its tab, or the split back. */
export function toggleMaximizeActiveLeaf(): boolean {
  const layout = useTerminalLayoutStore.getState();
  const tab = layout.activeTab();
  if (!tab) return false;
  if (tab.maximizedLeafId) {
    layout.toggleMaximizeLeaf(tab.id, null);
    return true;
  }
  if (collectLeaves(tab.layout).length < 2) return false;
  layout.toggleMaximizeLeaf(tab.id, activeLeafOf(tab).id);
  return true;
}

/** Ask the rail / strip row of a tab to start its inline rename. */
export function renameTabInline(tabId: string): boolean {
  const detail: RenameTabEventDetail = { tabId, handled: false };
  window.dispatchEvent(new CustomEvent<RenameTabEventDetail>(TERMINAL_EVENTS.renameTab, { detail }));
  if (!detail.handled) {
    toast.message('Expand the sessions rail to rename this tab', { description: 'Or right-click it in the tab strip.' });
  }
  return true;
}

/** Duplicate a tab: a new shell in the active leaf's cwd, same workspace, colour and title. */
export async function duplicateTab(tabId: string): Promise<void> {
  const layout = useTerminalLayoutStore.getState();
  const tab = layout.doc.window.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const projectId = projectIdOfWorkspace(tab.workspaceId) ?? undefined;
  const cwd = terminalCwd(activeLeafOf(tab).terminalId) ?? activeLeafOf(tab).cwd ?? undefined;
  try {
    const shellId = await useAppStore.getState().openShell({ projectId, cwd, surface: 'window' });
    const terminalId = `shell:${shellId}`;
    const store = useTerminalLayoutStore.getState();
    store.addTerminalToWindow(terminalId, { projectId });
    const created = tabContainingTerminal(useTerminalLayoutStore.getState().doc.window, terminalId);
    if (!created) return;
    if (tab.color) store.setTabColor(created.id, tab.color);
    if (tab.title) store.renameTab(created.id, tab.title);
  } catch (error) {
    console.error('Failed to duplicate the tab:', error);
    toast.error(`Failed to open terminal: ${String(error)}`);
  }
}

/**
 * Bring the most recently closed tab back: same workspace, title, colour
 * and split shape, with fresh shells in the leaves' last directories.
 * Nothing is re-run; service / script leaves are dropped.
 */
export async function reopenClosedTab(): Promise<boolean> {
  const layout = useTerminalLayoutStore.getState();
  const closed = layout.popClosedTab();
  if (!closed) {
    toast.message('No closed tab to reopen');
    return false;
  }
  const projectId = projectIdOfWorkspace(closed.workspaceId) ?? undefined;
  const app = useAppStore.getState();
  // Shells only: everything else cannot be brought back by reopening.
  let shape: LayoutNode | null = closed.layout;
  for (const leaf of collectLeaves(closed.layout)) {
    if (!leaf.terminalId.startsWith('shell:')) shape = shape ? removeLeaf(shape, leaf.id) : null;
  }
  if (!shape) return false;
  const mapping = new Map<string, string>();
  try {
    for (const leaf of collectLeaves(shape)) {
      const shellId = await app.openShell({ projectId, cwd: leaf.cwd ?? undefined, surface: 'window' });
      mapping.set(leaf.id, `shell:${shellId}`);
    }
  } catch (error) {
    console.error('Failed to reopen the tab:', error);
    toast.error(`Failed to reopen tab: ${String(error)}`);
    // Whatever was spawned is placed anyway so nothing leaks.
  }
  let tree = mapLeaves(shape, (leaf) => {
    const terminalId = mapping.get(leaf.id);
    return terminalId ? { ...leaf, id: newLayoutId(), terminalId, shell: null } : leaf;
  });
  // Leaves whose shell could not start are dropped from the tree.
  for (const leaf of collectLeaves(shape)) {
    if (mapping.has(leaf.id)) continue;
    const next = removeLeaf(tree, leaf.id);
    if (!next) return false;
    tree = next;
  }
  const leaves = collectLeaves(tree);
  useTerminalLayoutStore.getState().addLaunchTabs(
    [
      {
        id: newLayoutId(),
        workspaceId: closed.workspaceId,
        title: closed.title,
        color: closed.color,
        pinned: false,
        order: 0,
        layout: tree,
        activeLeafId: leaves[0].id,
      },
    ],
    projectId ?? null
  );
  return true;
}

/** The terminal of the active leaf of the active tab, if any. */
export function activeTerminalId(): string | null {
  const tab = useTerminalLayoutStore.getState().activeTab();
  return tab ? activeLeafOf(tab).terminalId : null;
}

/** Copy a terminal's working directory to the clipboard. */
export async function copyTerminalCwd(terminalId: string): Promise<boolean> {
  const cwd = terminalCwd(terminalId);
  if (!cwd) {
    toast.message('No working directory known for this terminal');
    return false;
  }
  try {
    await writeText(cwd);
    toast.success('Path copied', { description: cwd });
  } catch (error) {
    toast.error(`Failed to copy: ${String(error)}`);
  }
  return true;
}

/** Open a terminal's working directory in the OS file explorer. */
export async function openTerminalCwd(terminalId: string): Promise<boolean> {
  const cwd = terminalCwd(terminalId);
  if (!cwd) {
    toast.message('No working directory known for this terminal');
    return false;
  }
  try {
    await openInExplorer(cwd);
  } catch (error) {
    toast.error(`Failed to open ${cwd}`, { description: String(error) });
  }
  return true;
}

/** Quote a path for the shell when it needs it. */
export function quotePath(path: string): string {
  if (!/[\s"'()&;|<>$`]/.test(path)) return path;
  return `"${path.replace(/"/g, '\\"')}"`;
}

/**
 * A file dropped on a pane (Tauri drag-drop event): its path(s) are typed
 * into the terminal under the pointer. `position` is in physical pixels.
 */
export function pasteDroppedPaths(paths: string[], position: { x: number; y: number }): boolean {
  if (paths.length === 0) return false;
  const ratio = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(position.x / ratio, position.y / ratio);
  const pane = el?.closest<HTMLElement>('[data-terminal-id]');
  const terminalId = pane?.dataset.terminalId;
  if (!terminalId) return false;
  const tab = tabContainingTerminal(useTerminalLayoutStore.getState().doc.window, terminalId);
  const leaf = tab ? collectLeaves(tab.layout).find((l) => l.terminalId === terminalId) : undefined;
  if (tab && leaf) useTerminalLayoutStore.getState().setActiveLeaf(tab.id, leaf.id);
  writeTerminal(terminalId, paths.map(quotePath).join(' ')).catch((error) => {
    toast.error(`Failed to paste the path: ${String(error)}`);
  });
  focusTerminal(terminalId);
  return true;
}

/** Toggle the command palette of the window. */
export function togglePalette(): boolean {
  window.dispatchEvent(new CustomEvent(TERMINAL_EVENTS.palette));
  return true;
}

/** Bring the main window up on its Settings page. */
export async function openTerminalSettings(): Promise<void> {
  await showMainWindow();
  // Another webview: a DOM event would stay in this window. Tauri events
  // reach every window; the main one navigates to Settings.
  await emit('cortx-open-settings', { section: 'terminal' }).catch(() => {});
}

/** Ask the theme picker (owned by the terminal theme feature) to open. */
export function openThemePicker(): void {
  window.dispatchEvent(new CustomEvent('cortx:open-theme-picker'));
}

// ---------------------------------------------------------------------------
// Find in terminal
// ---------------------------------------------------------------------------

interface FindState {
  open: boolean;
  /** The terminal being searched (the active leaf when the bar opened). */
  terminalId: string | null;
  openFind: (terminalId: string) => void;
  closeFind: () => void;
}

/** State of the floating find bar (see `FindBar.tsx`). */
export const useFindStore = create<FindState>((set) => ({
  open: false,
  terminalId: null,
  openFind: (terminalId) => set({ open: true, terminalId }),
  closeFind: () => set({ open: false }),
}));

/** Ctrl+Shift+F: the find bar over the active pane (re-focuses it when already open). */
export function openFindInActiveTerminal(): boolean {
  const terminalId = activeTerminalId();
  if (!terminalId) return false;
  useFindStore.getState().openFind(terminalId);
  return true;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Run a keybinding action. Returns false when there was nothing to do (no
 * pane that way, single tab…) so the key can fall through to the shell.
 */
export function runAction(id: KeybindingActionId): boolean {
  switch (id) {
    case 'tab.new':
      void openNewTerminal();
      return true;
    case 'tab.close':
      closeActiveLeaf();
      return true;
    case 'tab.next':
      cycleTab(1);
      return true;
    case 'tab.prev':
      cycleTab(-1);
      return true;
    case 'tab.goto1':
    case 'tab.goto2':
    case 'tab.goto3':
    case 'tab.goto4':
    case 'tab.goto5':
    case 'tab.goto6':
    case 'tab.goto7':
    case 'tab.goto8':
    case 'tab.goto9':
      return gotoTab(Number(id.slice('tab.goto'.length)));
    case 'tab.rename': {
      const tab = useTerminalLayoutStore.getState().activeTab();
      return tab ? renameTabInline(tab.id) : false;
    }
    case 'tab.duplicate': {
      const tab = useTerminalLayoutStore.getState().activeTab();
      if (!tab) return false;
      void duplicateTab(tab.id);
      return true;
    }
    case 'tab.reopen':
      void reopenClosedTab();
      return true;
    case 'pane.splitRight':
      void splitActiveLeaf('horizontal');
      return true;
    case 'pane.splitDown':
      void splitActiveLeaf('vertical');
      return true;
    case 'pane.focusLeft':
      return focusLeafInDirection('left');
    case 'pane.focusRight':
      return focusLeafInDirection('right');
    case 'pane.focusUp':
      return focusLeafInDirection('up');
    case 'pane.focusDown':
      return focusLeafInDirection('down');
    case 'pane.resizeLeft':
      return resizeActiveLeaf('left');
    case 'pane.resizeRight':
      return resizeActiveLeaf('right');
    case 'pane.resizeUp':
      return resizeActiveLeaf('up');
    case 'pane.resizeDown':
      return resizeActiveLeaf('down');
    case 'pane.maximize':
      return toggleMaximizeActiveLeaf();
    // Prompt-to-prompt navigation (ticket #7). Returns false when there is no
    // block that way, so the key reaches the program instead — which is what
    // keeps Ctrl+arrow usable inside Claude Code and the like.
    case 'block.previous':
    case 'block.next': {
      const terminalId = activeTerminalId();
      if (!terminalId) return false;
      return jumpToBlock(terminalId, id === 'block.previous' ? 'previous' : 'next');
    }
    case 'terminal.find':
      return openFindInActiveTerminal();
    case 'terminal.clear': {
      const terminalId = activeTerminalId();
      if (!terminalId) return false;
      clearTerminal(terminalId);
      return true;
    }
    case 'terminal.zoomIn':
      adjustTerminalZoom(1);
      return true;
    case 'terminal.zoomOut':
      adjustTerminalZoom(-1);
      return true;
    case 'terminal.zoomReset':
      resetTerminalZoom();
      return true;
    case 'terminal.copyCwd': {
      const terminalId = activeTerminalId();
      if (!terminalId) return false;
      void copyTerminalCwd(terminalId);
      return true;
    }
    case 'terminal.openCwd': {
      const terminalId = activeTerminalId();
      if (!terminalId) return false;
      void openTerminalCwd(terminalId);
      return true;
    }
    case 'window.palette':
      return togglePalette();
    // The history view (#39) owns its own state; like the palette, it is
    // asked to open by a DOM event so nothing here has to know about it.
    case 'window.history':
      return openCommandHistory();
    case 'window.rail':
      useTerminalWindowPrefsStore.getState().toggleRail();
      return true;
    case 'window.scopeGlobal':
      useTerminalLayoutStore.getState().setScope('global');
      return true;
  }
}
