import { useMemo, type CSSProperties } from 'react';
import { ACCENT_PRESETS } from '@/lib/theme';
import { basename, formatDuration } from '@/lib/terminalNames';
import {
  FREE_WORKSPACE_ID,
  collectLeaves,
  findLeaf,
  isAgentsScope,
  projectIdOfWorkspace,
  tabsInScope,
  AGENTS_SCOPE,
  type LayoutNode,
  type LeafNode,
  type SplitNode,
  type TerminalTab,
  type TerminalWindowLayout,
} from '@/lib/terminalLayout';
import { useTerminalItems } from '@/hooks/useTerminalItems';
import { useTerminalAgentsStore } from './agentsStore';
import { PROVIDER_LABEL, STATE_LABEL } from '@/components/agents/agentUtils';
import { useAppStore } from '@/stores/appStore';
import type { TerminalItem } from '@/components/layout/terminal-dnd/types';
import type { TerminalAttention } from '@/stores/appStore';
import type { Project, TerminalAgentInfo, TerminalTabDisplay } from '@/types';

/**
 * Small read-only helpers shared by the Terminal window components: how a
 * tab, a leaf and its terminal item are turned into a title, a status and a
 * colour. Pure functions apart from `useItemMap`.
 */

export type ItemMap = Map<string, TerminalItem>;

/** Every known terminal, keyed by canonical id. */
export function useItemMap(): ItemMap {
  const items = useTerminalItems();
  return useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
}

/** The leaf the tab shows as current (falls back to the first leaf). */
export function activeLeafOf(tab: TerminalTab): LeafNode {
  return findLeaf(tab.layout, tab.activeLeafId) ?? collectLeaves(tab.layout)[0];
}

/** Terminal item behind the tab's active leaf. */
export function tabItem(tab: TerminalTab, items: ItemMap): TerminalItem | undefined {
  return items.get(activeLeafOf(tab).terminalId);
}

/**
 * The agent running in the tab: the active leaf's, else the first leaf that
 * has one — a split where only one pane runs `claude` is still an agent tab.
 */
export function tabAgent(tab: TerminalTab, items: ItemMap): TerminalAgentInfo | undefined {
  const active = tabItem(tab, items)?.agent;
  if (active) return active;
  for (const leaf of collectLeaves(tab.layout)) {
    const agent = items.get(leaf.terminalId)?.agent;
    if (agent) return agent;
  }
  return undefined;
}

/**
 * Manual title, else the title the agent gave itself, else the terminal name.
 *
 * An agent tab is named after its session ("Fix the drop targeting"), not
 * after the process that runs it — `claude` on every tab tells you nothing.
 * Pass `useAgentName = false` to get the plain terminal name.
 */
export function tabTitle(tab: TerminalTab, items: ItemMap, useAgentName = true): string {
  if (tab.title) return tab.title;
  if (useAgentName) {
    const name = tabAgent(tab, items)?.name?.trim();
    if (name) return name;
  }
  return tabItem(tab, items)?.name ?? 'Terminal';
}

export interface TabLiveState {
  /** A command is running in one of the leaves. */
  running: boolean;
  /** A command finished out of view in one of the leaves. */
  attention?: TerminalAttention;
  /** Runtime status of the active leaf, for the status dot. */
  status?: string;
  /** Agent running in the tab, with its own state (working / waiting). */
  agent?: TerminalAgentInfo;
}

/** Aggregate the live state of every leaf so the tab reflects all of them. */
export function tabLiveState(tab: TerminalTab, items: ItemMap): TabLiveState {
  let running = false;
  let attention: TerminalAttention | undefined;
  for (const leaf of collectLeaves(tab.layout)) {
    const item = items.get(leaf.terminalId);
    if (!item) continue;
    if (item.shell?.phase === 'running') running = true;
    if (!attention && item.attention) attention = item.attention;
  }
  return { running, attention, status: tabItem(tab, items)?.status, agent: tabAgent(tab, items) };
}

// ---------------------------------------------------------------------------
// What a tab shows (`terminal.tabDisplay`)
// ---------------------------------------------------------------------------

export type ResolvedTabDisplay = Required<TerminalTabDisplay>;

/**
 * Defaults: the title, a second line, the status, the agent — and no number
 * unless Ctrl is held, since that is the only moment it means anything.
 */
export const DEFAULT_TAB_DISPLAY: ResolvedTabDisplay = {
  cwd: true,
  command: true,
  status: true,
  agent: true,
  index: 'ctrl',
  colorBar: false,
};

export function resolveTabDisplay(config?: TerminalTabDisplay | null): ResolvedTabDisplay {
  if (!config) return DEFAULT_TAB_DISPLAY;
  return { ...DEFAULT_TAB_DISPLAY, ...config };
}

/** `terminal.tabDisplay` from the settings, with the defaults filled in. */
export function useTabDisplay(): ResolvedTabDisplay {
  const config = useAppStore((s) => s.settings?.terminal.tabDisplay);
  return useMemo(() => resolveTabDisplay(config), [config]);
}

/** Working directory to display: the live one, else the one the shell opened in. */
export function itemCwd(item: TerminalItem | undefined): string | undefined {
  return item?.shell?.cwd || item?.cwd || undefined;
}

/** The process behind the terminal is gone (nothing more will be printed). */
export function hasEnded(item: TerminalItem): boolean {
  switch (item.status) {
    case 'completed':
    case 'failed':
    case 'error':
    case 'stopped':
      return true;
    default:
      return false;
  }
}

/** One-line summary of what the shell is doing, for headers and tooltips. */
export function describeActivity(item: TerminalItem): string | null {
  const shell = item.shell;
  if (!shell) return null;
  if (shell.phase === 'running') return `Running: ${shell.command ?? '(command)'}`;
  if (shell.lastCommand) {
    const code = shell.lastExitCode;
    const status = code == null ? 'ended' : code === 0 ? 'ok' : `exit ${code}`;
    const dur = shell.lastDurationMs != null ? ` · ${formatDuration(shell.lastDurationMs)}` : '';
    return `Last: ${shell.lastCommand} → ${status}${dur}`;
  }
  return null;
}

/** Native tooltip text: agent + cwd + activity. */
export function describeItem(item: TerminalItem): string | undefined {
  const lines: string[] = [];
  if (item.agent) {
    lines.push(
      [PROVIDER_LABEL[item.agent.provider], item.agent.name, STATE_LABEL[item.agent.state]]
        .filter(Boolean)
        .join(' · ')
    );
  }
  const cwd = itemCwd(item);
  if (cwd) lines.push(cwd);
  const activity = describeActivity(item);
  // `claude` as "the running command" says nothing the agent line has not.
  if (activity && !item.agent) lines.push(activity);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

/** Project of a tab's workspace, if any. */
export function tabProject(tab: TerminalTab, projects: Project[]): Project | undefined {
  const id = projectIdOfWorkspace(tab.workspaceId);
  return id ? projects.find((p) => p.id === id) : undefined;
}

/**
 * Projects carry no colour of their own; pick a stable one from the theme's
 * accent presets so a project keeps the same dot everywhere in the window.
 */
export function projectColor(projectId: string): string {
  let h = 0;
  for (let i = 0; i < projectId.length; i++) h = (h * 31 + projectId.charCodeAt(i)) >>> 0;
  return ACCENT_PRESETS[h % ACCENT_PRESETS.length].value;
}

// ---------------------------------------------------------------------------
// Tab colour (ticket #22)
// ---------------------------------------------------------------------------

/**
 * Hand a colour to the stylesheet. Everything the colour is *used* for — the
 * wash at rest, the stronger one on hover, the plate of the current tab, the
 * hairline — is mixed in `styles/terminal-tabs.css`, on top of `--card` (the
 * window's own surface, which follows the terminal theme). The colour itself
 * is the only thing that has to travel through React, because it is a value
 * the user picked, not a token.
 *
 * Note what does *not* happen here: no mixing with `--accent` or `--primary`.
 * A terminal theme is free to make its accent a near-black, and a wallpaper
 * theme puts a photograph behind the window; a tint derived from either goes
 * muddy (see `plans/warp_reference.md`).
 */
export function tintStyle(color: string | null | undefined): CSSProperties | undefined {
  return color ? ({ '--tt-color': color } as CSSProperties) : undefined;
}

/**
 * Ticket #22: the tab colour used to show up as a 3 px bar down the left edge
 * of a rail row, which you could only really see once you hovered it. It is
 * now a wash over the whole tab, as in Warp, and the bar is off by default.
 *
 * It is kept — behind `tabDisplay.colorBar` — because the two say different
 * things: the wash says "this tab is green", the bar says "this tab is green"
 * *while leaving the surface alone*, which is what someone running a very busy
 * wallpaper theme may prefer.
 */

/** `cwd` shortened to its last segment, or nothing. */
export function cwdLabel(item: TerminalItem | undefined): string | undefined {
  const cwd = itemCwd(item);
  return cwd ? basename(cwd) : undefined;
}

// ---------------------------------------------------------------------------
// The second line of a tab row
// ---------------------------------------------------------------------------

/** The second line of a tab row, and what it is saying. */
export interface TabSecondary {
  text: string;
  /**
   * `waiting` an agent wants you, `command` something runs, `path` the working
   * directory, `count` how many panes a group holds.
   */
  tone: 'waiting' | 'command' | 'path' | 'count';
}

/**
 * What a tab row writes under its name.
 *
 * One function for the two things that ask: a tab (its active leaf's item and
 * the state folded over all its leaves) and a single pane (that leaf's item and
 * its own state). They used to be `SessionRow`'s inline chain and
 * `paneModel.paneSecondary`, written twice because the rail could not be
 * touched when the pane rows were added.
 *
 * The rule: an agent waiting on you is worth a word, a running command replaces
 * the directory, otherwise the directory. `claude` is never shown as "the
 * running command" — it runs for the whole session and would hide the path
 * forever.
 *
 * `count` is what a **group label** writes where a lone tab writes its
 * directory: under a group header the active pane's directory only repeats the
 * row right below it, so how many panes there are is what the header can add.
 */
export function tabSecondary(
  item: TerminalItem | undefined,
  live: TabLiveState,
  display: ResolvedTabDisplay,
  count?: string
): TabSecondary | undefined {
  const agent = display.agent ? live.agent : undefined;
  if (agent?.state === 'waiting') return { text: STATE_LABEL.waiting, tone: 'waiting' };
  if (!agent && display.command && item?.shell?.phase === 'running') {
    return { text: item.shell.command ?? '(command)', tone: 'command' };
  }
  if (count !== undefined) return { text: count, tone: 'count' };
  const cwd = display.cwd ? cwdLabel(item) : undefined;
  return cwd ? { text: cwd, tone: 'path' } : undefined;
}

/** Pinned tabs first, then the user's order. */
export function sortTabs(tabs: TerminalTab[]): TerminalTab[] {
  return tabs.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order);
}

/**
 * Header of the group holding the tabs that belong to no project. It is a
 * section like any other — a plain description of what is in it, not a badge
 * ("Free" read like a tier label).
 */
export const NO_PROJECT_GROUP_NAME = 'No project';

export interface WorkspaceGroup {
  workspaceId: string;
  name: string;
  color: string | null;
  tabs: TerminalTab[];
}

/**
 * The scoped tabs grouped by workspace the way the sessions rail shows them:
 * projects in sidebar order, the project-less group last, pinned tabs first
 * in each group.
 */
export function groupTabsByWorkspace(scopedTabs: TerminalTab[], projects: Project[]): WorkspaceGroup[] {
  const byWorkspace = new Map<string, TerminalTab[]>();
  for (const tab of scopedTabs) {
    const list = byWorkspace.get(tab.workspaceId) ?? [];
    list.push(tab);
    byWorkspace.set(tab.workspaceId, list);
  }
  const out: WorkspaceGroup[] = [];
  for (const [workspaceId, tabs] of byWorkspace) {
    const projectId = projectIdOfWorkspace(workspaceId);
    const project = projectId ? projects.find((p) => p.id === projectId) : undefined;
    out.push({
      workspaceId,
      name: workspaceId === FREE_WORKSPACE_ID ? NO_PROJECT_GROUP_NAME : project?.name ?? 'Unknown project',
      color: projectId ? projectColor(projectId) : null,
      tabs: sortTabs(tabs),
    });
  }
  return out.sort((a, b) => {
    if (a.workspaceId === FREE_WORKSPACE_ID) return 1;
    if (b.workspaceId === FREE_WORKSPACE_ID) return -1;
    return (
      projects.findIndex((p) => `project:${p.id}` === a.workspaceId) -
      projects.findIndex((p) => `project:${p.id}` === b.workspaceId)
    );
  });
}

/**
 * The tabs of the current scope, for display.
 *
 * `tabsInScope` already answers for the `agents` scope (it reads the registry
 * of terminals hosting an agent), but its result changes without the layout
 * changing — hence the extra dependency on the agents store. The tab on
 * screen is always kept in the list: an agent exiting must not make the rail
 * disagree with the pane it is showing.
 */
export function useScopedTabs(win: TerminalWindowLayout): TerminalTab[] {
  const revision = useTerminalAgentsStore((s) => s.revision);
  return useMemo(() => {
    const scoped = tabsInScope(win, win.scope);
    if (!isAgentsScope(win.scope) || !win.activeTabId) return scoped;
    if (scoped.some((t) => t.id === win.activeTabId)) return scoped;
    const active = win.tabs.find((t) => t.id === win.activeTabId);
    return active ? [...scoped, active].sort((a, b) => a.order - b.order) : scoped;
    // `revision` is what makes the agent scope live; the layout alone is not enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, revision]);
}

/** How many tabs currently host an agent (drives the Agents scope pill). */
export function useAgentTabCount(win: TerminalWindowLayout): number {
  const revision = useTerminalAgentsStore((s) => s.revision);
  return useMemo(
    () => tabsInScope(win, AGENTS_SCOPE).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [win, revision]
  );
}

/**
 * The tabs in the order the user sees them — the rail groups by workspace,
 * the tab strip does not — so "go to tab N" and the faint numbers agree.
 */
export function visibleTabOrder(win: TerminalWindowLayout, projects: Project[], placement: 'sidebar' | 'top'): TerminalTab[] {
  const scoped = tabsInScope(win, win.scope);
  if (placement === 'top') return sortTabs(scoped);
  return groupTabsByWorkspace(scoped, projects).flatMap((g) => g.tabs);
}

/** The splits above a leaf, root first, with the index of the branch that leads to it. */
export function splitPathTo(node: LayoutNode, leafId: string): Array<{ split: SplitNode; index: number }> | null {
  if (node.kind === 'leaf') return node.id === leafId ? [] : null;
  for (let i = 0; i < node.children.length; i++) {
    const below = splitPathTo(node.children[i], leafId);
    if (below) return [{ split: node, index: i }, ...below];
  }
  return null;
}
