/**
 * The panes of a tab, seen as a group of sub-tabs (DEV-13, Alexis' feedback
 * of 2026-09-04). Pure helpers and hooks shared by the tab strip and the
 * sessions rail; the two renderings live in `PaneTabs.tsx`.
 */
import { useMemo } from 'react';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { collectLeaves, type LeafNode, type TerminalTab } from '@/lib/terminalLayout';
import { cwdLabel, type ItemMap, type TabLiveState } from './model';
import type { TerminalItem } from '@/components/layout/terminal-dnd/types';

/** One pane of a tab, with everything the two renderings need. */
export interface PaneEntry {
  leaf: LeafNode;
  item: TerminalItem | undefined;
  live: TabLiveState;
  label: string;
  /** Position in the tab, 1-based (the fallback label, and the tooltip). */
  number: number;
}

/**
 * Live state of a single pane. `tabLiveState` folds every leaf into one
 * answer for the tab as a whole; a pane chip wants its own.
 */
export function leafLiveState(item: TerminalItem | undefined): TabLiveState {
  return {
    running: item?.shell?.phase === 'running',
    attention: item?.attention,
    status: item?.status,
    agent: item?.agent,
  };
}

/**
 * Short name of a pane. `item.name` for a shell is "pwsh · CortX", far too
 * long for a chip, so a shell is named after its directory — which is what
 * tells two panes of the same split apart — and an agent after its session.
 */
export function leafLabel(item: TerminalItem | undefined, number: number, useAgentName: boolean): string {
  if (useAgentName) {
    const agent = item?.agent?.name?.trim();
    if (agent) return agent;
  }
  if (!item) return `Pane ${number}`;
  if (item.type === 'shell') return cwdLabel(item) ?? item.name;
  return item.name;
}

/** The panes of a tab, in visual order. */
export function usePaneEntries(tab: TerminalTab, items: ItemMap, useAgentName: boolean): PaneEntry[] {
  return useMemo(
    () =>
      collectLeaves(tab.layout).map((leaf, i) => {
        const item = items.get(leaf.terminalId);
        return { leaf, item, live: leafLiveState(item), label: leafLabel(item, i + 1, useAgentName), number: i + 1 };
      }),
    [tab.layout, items, useAgentName]
  );
}

/**
 * Select a pane: the tab becomes current and the pane becomes its active
 * leaf. When the tab is showing one pane maximised, the maximisation moves
 * to the pane that was clicked — otherwise the click would change nothing
 * on screen.
 */
export function useSelectPane(): (tab: TerminalTab, leafId: string) => void {
  const setActiveLeaf = useTerminalLayoutStore((s) => s.setActiveLeaf);
  const toggleMaximizeLeaf = useTerminalLayoutStore((s) => s.toggleMaximizeLeaf);
  return (tab, leafId) => {
    setActiveLeaf(tab.id, leafId);
    if (tab.maximizedLeafId && tab.maximizedLeafId !== leafId) toggleMaximizeLeaf(tab.id, leafId);
  };
}

