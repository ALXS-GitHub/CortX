import { useMemo } from 'react';
import { ACCENT_PRESETS } from '@/lib/theme';
import { basename, formatDuration } from '@/lib/terminalNames';
import { collectLeaves, findLeaf, projectIdOfWorkspace, type LeafNode, type TerminalTab } from '@/lib/terminalLayout';
import { useTerminalItems } from '@/hooks/useTerminalItems';
import type { TerminalItem } from '@/components/layout/terminal-dnd/types';
import type { TerminalAttention } from '@/stores/appStore';
import type { Project } from '@/types';

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

/** Manual title, else the active leaf's terminal name. */
export function tabTitle(tab: TerminalTab, items: ItemMap): string {
  return tab.title ?? tabItem(tab, items)?.name ?? 'Terminal';
}

export interface TabLiveState {
  /** A command is running in one of the leaves. */
  running: boolean;
  /** A command finished out of view in one of the leaves. */
  attention?: TerminalAttention;
  /** Runtime status of the active leaf, for the status dot. */
  status?: string;
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
  return { running, attention, status: tabItem(tab, items)?.status };
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

/** Native tooltip text: cwd + activity. */
export function describeItem(item: TerminalItem): string | undefined {
  const lines: string[] = [];
  const cwd = itemCwd(item);
  if (cwd) lines.push(cwd);
  const activity = describeActivity(item);
  if (activity) lines.push(activity);
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

/** `cwd` shortened to its last segment, or nothing. */
export function cwdLabel(item: TerminalItem | undefined): string | undefined {
  const cwd = itemCwd(item);
  return cwd ? basename(cwd) : undefined;
}
