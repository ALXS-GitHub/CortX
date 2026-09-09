/**
 * A split shown as **two normal tabs held together** (DEV-13; ticket #22,
 * Alexis' feedback of 2026-09-07, then of 2026-09-09).
 *
 * The first answer put a chip per pane in a hairline bracket; the second drew
 * the whole split as one card with a header of its own and pane chips indented
 * under a guide line. Both invented a second kind of tab, and the card grew to
 * 540 px in a strip whose tabs are 240 px — "notre gros bloc moche".
 *
 * What Warp does, and what this file now does, is not draw a new object at
 * all:
 *
 *     ┌───────────────────────────┐
 *     │ zsh in LMEP · 2 panes   ⊗ │    ← the tab, as a quiet group label,
 *     │ ▣  pwsh · LMEP        ×   │      inside the box it labels
 *     │    ~/Desktop/LMEP         │    ← a tab row: icon, name,
 *     │ ▣  pwsh · LMEP        ×   │      second line, status, its own X
 *     │    ~/Desktop/LMEP         │
 *     └───────────────────────────┘
 *
 * The rows are the rail's rows: same 40 px height, same 3.5 icon, same
 * 12.5 px / 10.5 px pair, same rules for what the second line says
 * (`paneSecondary`) — and, since 2026-09-09, the same per-row X and the same
 * right-click menu, pointed at that pane's terminal. A pane behaves like a
 * tab; the box only says the two share one.
 *
 * The two surfaces do not have the same room:
 *
 * - **Rail** (a 180–360 px column): the box above, verbatim.
 * - **Tab strip** (one row, `h-9`): the same box laid on its side, holding
 *   one-line rows — a strip cell has no room for a second line, nor for a
 *   per-chip X, so there the pane's menu and the middle click are what close
 *   one pane.
 *
 * The current pane is marked the way the current tab is marked in either
 * surface: a plate under the row, not a tick and not a fill of another hue.
 *
 * A tab with a single leaf renders exactly as before; grouping only ever
 * shows up where there is something to group.
 */
import { type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { AgentProviderIcon } from '@/components/agents/AgentProviderIcon';
import { TerminalTypeIcon } from '@/components/layout/terminal-dnd/TerminalTypeIcon';
import { type TerminalTab } from '@/lib/terminalLayout';
import { cn } from '@/lib/utils';
import '@/styles/terminal-tabs.css';
import { TerminalStatusGlyph } from './TerminalStatusGlyph';
import { closeLeaf } from './actions';
import { describeItem, type ResolvedTabDisplay } from './model';
import { paneSecondary, type PaneEntry } from './paneModel';
import { TabContextMenu } from './tabMenu';
import { useTabContextMenu } from './useTabMenu';

function paneTitle(pane: PaneEntry): string {
  const head = `Pane ${pane.number}`;
  const body = pane.item ? describeItem(pane.item) : undefined;
  return [body ? `${head} · ${body}` : head, 'Middle-click to close this pane'].join('\n');
}

/**
 * The icon in front of a pane's name — the tab icon, at the tab's size and in
 * the tab's colour. It used to sit in a framed square of its own, which is
 * precisely what made a pane look like something other than a tab.
 */
function PaneIcon({ pane, display }: { pane: PaneEntry; display: ResolvedTabDisplay }) {
  const agent = display.agent ? pane.live.agent : undefined;
  return agent ? (
    <AgentProviderIcon provider={agent.provider} plain className="pointer-events-none size-3.5 shrink-0" />
  ) : (
    <TerminalTypeIcon type={pane.item?.type ?? 'shell'} className="pointer-events-none size-3.5 shrink-0 text-faint" />
  );
}

/**
 * What every pane row answers to: click selects the pane, middle-click closes
 * it, double-click is swallowed so it cannot rename the tab underneath.
 *
 * Deliberately **no** `onPointerDown` guard: in the strip the drag listeners
 * sit on the tab cell that holds these rows, so the sensor must still see the
 * press — dragging by a pane drags the whole tab, which is what the layout
 * document knows how to reorder and detach. (In the rail the listeners are on
 * the group's label row, so the box is not a drag handle there — it was not
 * one before either.) The one thing that does stop the pointer is the pane's
 * own X, exactly as a tab's X stops it.
 */
function paneButtonProps(pane: PaneEntry, onSelect: () => void) {
  return {
    title: paneTitle(pane),
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      onSelect();
    },
    onDoubleClick: (e: MouseEvent) => e.stopPropagation(),
    onMouseDown: (e: MouseEvent) => {
      // Middle click: keep the browser from starting auto-scroll.
      if (e.button === 1) e.preventDefault();
    },
    onAuxClick: (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      closeLeaf(pane.leaf.terminalId);
    },
  };
}

/**
 * The X of one pane. It closes **that pane**, never the tab: a split is a
 * couple of terminals that share a tab, and the only X in the group used to
 * be the tab's, which took both down at once.
 */
function PaneCloseButton({ pane }: { pane: PaneEntry }) {
  return (
    <button
      type="button"
      className="grid size-5 shrink-0 place-items-center rounded-[6px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/pane:opacity-100"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        closeLeaf(pane.leaf.terminalId);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      title="Close this pane"
      aria-label={`Close pane ${pane.number}`}
    >
      <X className="pointer-events-none size-3" />
    </button>
  );
}

interface PaneItemProps {
  tab: TerminalTab;
  pane: PaneEntry;
  /** This pane is the tab's active leaf. */
  current: boolean;
  /** The tab this group belongs to is the one on screen. */
  tabActive: boolean;
  display: ResolvedTabDisplay;
  onSelect: () => void;
}

/**
 * One pane, as a row of the rail: an ordinary tab row that happens to live in
 * a group — its own name, its own second line, its own status, its own X and
 * its own right-click menu (`TabContextMenu`, pointed at this leaf).
 *
 * A `div` rather than a `button` because it now holds a button of its own; the
 * role and the Enter / Space handler keep it operable from the keyboard.
 */
function PaneRow({ tab, pane, current, tabActive, display, onSelect }: PaneItemProps) {
  const menu = useTabContextMenu();
  const secondary = paneSecondary(pane, display);
  return (
    <div
      role="button"
      tabIndex={0}
      {...paneButtonProps(pane, onSelect)}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onSelect();
      }}
      onContextMenu={menu.onContextMenu}
      aria-pressed={current}
      data-current={current ? 'true' : 'false'}
      className={cn(
        'tt-leaf group/pane relative flex h-10 w-full min-w-0 cursor-default select-none items-center gap-2 rounded-[var(--rad-nav)] px-2 text-left transition-colors',
        current ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        !tabActive && !current && 'opacity-90'
      )}
    >
      <PaneIcon pane={pane} display={display} />
      <span className="pointer-events-none flex min-w-0 flex-1 flex-col leading-tight">
        <span className={cn('truncate text-[12.5px]', current && 'font-medium')}>{pane.name}</span>
        {secondary && (
          <span
            className={cn(
              'truncate text-[10.5px]',
              secondary.tone !== 'waiting' && 'font-mono',
              secondary.tone === 'waiting'
                ? 'text-st-progress'
                : secondary.tone === 'command'
                  ? 'text-primary'
                  : 'text-faint'
            )}
          >
            {secondary.text}
          </span>
        )}
      </span>
      {display.status && <TerminalStatusGlyph live={pane.live} className="pointer-events-none shrink-0" />}
      <PaneCloseButton pane={pane} />
      <TabContextMenu
        tab={tab}
        open={menu.open}
        onOpenChange={menu.setOpen}
        pos={menu.pos}
        onClose={() => closeLeaf(pane.leaf.terminalId)}
        pane={{ leaf: pane.leaf, label: pane.name }}
      />
    </div>
  );
}

/**
 * One pane, as a chip of the tab strip. The same object as `PaneRow` minus
 * what a 36 px cell has no room for: the second line and the X. Right-click
 * opens the pane's own menu ("Close pane" is in it) and the middle click
 * still closes it.
 */
function PaneChip({ tab, pane, current, tabActive, display, onSelect }: PaneItemProps) {
  const menu = useTabContextMenu();
  return (
    <button
      type="button"
      {...paneButtonProps(pane, onSelect)}
      onContextMenu={menu.onContextMenu}
      aria-pressed={current}
      data-current={current ? 'true' : 'false'}
      className={cn(
        'tt-leaf relative flex h-[26px] min-w-0 max-w-[132px] shrink items-center gap-1.5 rounded-[var(--rad-xs)] px-1.5 text-xs transition-colors',
        current ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
        !tabActive && !current && 'opacity-80'
      )}
    >
      <PaneIcon pane={pane} display={display} />
      <span className="pointer-events-none truncate">{pane.label}</span>
      {display.status && <TerminalStatusGlyph live={pane.live} className="pointer-events-none shrink-0 scale-90" />}
      <TabContextMenu
        tab={tab}
        open={menu.open}
        onOpenChange={menu.setOpen}
        pos={menu.pos}
        onClose={() => closeLeaf(pane.leaf.terminalId)}
        pane={{ leaf: pane.leaf, label: pane.name }}
      />
    </button>
  );
}

interface PaneListProps {
  tab: TerminalTab;
  panes: PaneEntry[];
  /** The tab this group belongs to is the one on screen. */
  tabActive: boolean;
  display: ResolvedTabDisplay;
  onSelect: (leafId: string) => void;
}

/**
 * The tab strip's group: one chip per pane inside the tinted box, after the
 * tab's own name. Single line — a 36 px cell has no room for a second one —
 * but the same icon and type size a lone tab has.
 */
export function PaneGroupChips({ tab, panes, tabActive, display, onSelect }: PaneListProps) {
  return (
    <div
      className="tt-panebox tt-panebox-h flex min-w-0 shrink items-center gap-1 self-center"
      role="group"
      aria-label={`${panes.length} panes`}
    >
      {panes.map((pane) => (
        <PaneChip
          key={pane.leaf.id}
          tab={tab}
          pane={pane}
          current={tab.activeLeafId === pane.leaf.id}
          tabActive={tabActive}
          display={display}
          onSelect={() => onSelect(pane.leaf.id)}
        />
      ))}
    </div>
  );
}

/**
 * The rail's group: **the whole group, box included** — the tab's own label
 * row (handed in as `children`) and then one rail row per pane, all on the
 * one tinted surface.
 *
 * The label used to sit above the box, where it read as a title for something
 * else: "le titre de regroupement doit être dans le groupement visuel".
 */
export function PaneGroupBranch({
  tab,
  panes,
  tabActive,
  display,
  onSelect,
  children,
}: PaneListProps & { children?: ReactNode }) {
  return (
    <div className="tt-panebox tt-panebox-v flex flex-col gap-px" role="group" aria-label={`${panes.length} panes`}>
      {children}
      {panes.map((pane) => (
        <PaneRow
          key={pane.leaf.id}
          tab={tab}
          pane={pane}
          current={tab.activeLeafId === pane.leaf.id}
          tabActive={tabActive}
          display={display}
          onSelect={() => onSelect(pane.leaf.id)}
        />
      ))}
    </div>
  );
}
