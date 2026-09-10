/**
 * The panes of a tab, seen as a small group of **normal tabs** (DEV-13,
 * revised by ticket #22 on 2026-09-07). Pure helpers and hooks shared by the
 * tab strip and the sessions rail; the two renderings live in `PaneTabs.tsx`.
 *
 * The previous answer drew the whole split as one card with a header and a
 * row of pane chips of its own design — "notre gros bloc moche". What replaces
 * it is what Warp shows: a quiet group label, a faintly tinted box, and inside
 * it **rows that are ordinary tabs** — same height, same icon, same title, same
 * second line. Nothing here invents a second kind of tab; it only supplies the
 * per-pane values (`name`, `cwd`, `paneSecondary`) that a tab row already
 * shows, computed for one leaf instead of for the whole tab.
 */
import { useMemo } from 'react';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { collectLeaves, type LeafNode, type TerminalTab } from '@/lib/terminalLayout';
import { basename } from '@/lib/terminalNames';
import { cn } from '@/lib/utils';
import { cwdLabel, tabSecondary, type ItemMap, type ResolvedTabDisplay, type TabLiveState, type TabSecondary } from './model';
import type { TerminalItem } from '@/components/layout/terminal-dnd/types';

/** One pane of a tab, with everything the two renderings need. */
export interface PaneEntry {
  leaf: LeafNode;
  item: TerminalItem | undefined;
  live: TabLiveState;
  /** Short name, for the one line the tab strip has room for. */
  label: string;
  /** Full name — the first line of a tab row, exactly as a lone tab shows it. */
  name: string;
  /** Last segment of the pane's cwd — the second line of a tab row. */
  cwd: string | undefined;
  /** Position in the tab, 1-based (the fallback label, and the tooltip). */
  number: number;
}

/**
 * Live state of a single pane. `tabLiveState` folds every leaf into one
 * answer for the tab as a whole; a pane row wants its own.
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
 * Short name of a pane, for the tab strip. `item.name` for a shell is
 * "pwsh · CortX", too long for a row that shares a 36 px cell with the tab's
 * own name, so a shell is named after its directory — which is what tells two
 * panes of the same split apart — and an agent after its session.
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

/**
 * Full name of a pane — what the rail's row writes on its first line. It is
 * `tabTitle`'s rule applied to one leaf: the agent's session name if the
 * display asks for it, else the terminal's own name. A rail row has the width
 * for it, and it is what makes a pane row read as a tab rather than as a chip.
 */
export function leafName(item: TerminalItem | undefined, number: number, useAgentName: boolean): string {
  if (useAgentName) {
    const agent = item?.agent?.name?.trim();
    if (agent) return agent;
  }
  return item?.name ?? `Pane ${number}`;
}

/**
 * The second line of a pane row. A pane row and a tab row write the same
 * thing by the same rules, so this is `TabSecondary` under the name the pane
 * code already used.
 */
export type PaneSecondary = TabSecondary;

/**
 * The second line of a pane row, decided exactly as `SessionRow` decides its
 * own: an agent waiting on you is worth a word, a running command replaces the
 * directory, otherwise the directory. `claude` is never shown as "the running
 * command" — it runs for the whole session and would hide the path forever.
 */
export function paneSecondary(pane: PaneEntry, display: ResolvedTabDisplay): PaneSecondary | undefined {
  // `pane.cwd` is `cwdLabel(pane.item)`, which is what `tabSecondary` reads,
  // so this is the same answer the rail's own rows get — by construction now,
  // rather than by two copies of the rule agreeing.
  return tabSecondary(pane.item, pane.live, display);
}

/**
 * Headline of a group's label — a name, never a path cut in half.
 *
 * A tab named after a directory (`~\Desktop\Programmes\Important Projects`,
 * whether the user renamed it or the terminal is named that way) came out of
 * the header as `~\Desktop\Programmes\Important Proje`: the one part that
 * identifies it is the part that gets cut. The rest of the app names a
 * terminal by `basename`, so a group headline does the same — on each `·`
 * segment, so `pwsh · C:\src\CortX` reads `pwsh · CortX` and a plain name is
 * left alone. The full text stays in the row's tooltip.
 */
export function groupHeadline(title: string): string {
  const text = title.trim();
  if (!/[\\/]/.test(text)) return text;
  return text
    .split(' · ')
    .map((part) => (/[\\/]/.test(part) ? basename(part) : part))
    .join(' · ');
}

/** `2 panes`, `3 panes` — what a group label says after the tab's name. */
export function paneCountLabel(count: number): string {
  return `${count} panes`;
}

/**
 * The element that holds a group. It is **not** a card any more: the box the
 * user sees is the one around the panes (`.tt-panebox`), and this only carries
 * the layout, the "this tab is the one on screen" flag, and — in the strip —
 * the surface a plain tab would have had.
 *
 * A class helper rather than a wrapper component, because the tab strip puts
 * these classes on the tab element itself — the one carrying the sortable ref
 * and the drag listeners — so the group stays the single draggable unit it
 * was. The rail, which has a wrapper to spare, puts them on that.
 *
 * `tt-group-current` is what the stylesheet reads to light the pane box and
 * the current pane; the tints themselves are in `@/styles/terminal-tabs.css`.
 */
export function groupCardClass(active: boolean, orientation: 'vertical' | 'horizontal'): string {
  return cn(
    'tt-group',
    active && 'tt-group-current',
    orientation === 'vertical'
      ? 'tt-group-v flex flex-col rounded-[var(--rad-md)]'
      : // A grouped tab is a tab: same cell, same surface as any other — its
        // geometry is written with the strip's other cells, in
        // `WindowTabStrip.tsx`, so there is nothing left here but the surface.
        // The tint of a coloured tab still wins over it
        // (`.tt-tint[data-current]` outranks a single-class utility).
        active
        ? 'bg-terminal'
        : 'hover:bg-accent/40'
  );
}

/** The panes of a tab, in visual order. */
export function usePaneEntries(tab: TerminalTab, items: ItemMap, useAgentName: boolean): PaneEntry[] {
  return useMemo(
    () =>
      collectLeaves(tab.layout).map((leaf, i) => {
        const item = items.get(leaf.terminalId);
        return {
          leaf,
          item,
          live: leafLiveState(item),
          label: leafLabel(item, i + 1, useAgentName),
          name: leafName(item, i + 1, useAgentName),
          cwd: cwdLabel(item),
          number: i + 1,
        };
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
