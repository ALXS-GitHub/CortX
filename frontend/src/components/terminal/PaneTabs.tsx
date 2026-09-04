/**
 * A split shown as a **group of tabs** (DEV-13, Alexis' feedback of
 * 2026-09-04, revised the same day).
 *
 * Until now a tab was one entry in the strip whatever it contained: split a
 * pane in three and the bar still said "one tab". The first answer put a chip
 * per pane in a hairline bracket; Alexis compared it to Warp's vertical-tabs
 * panel and rejected it — the chips carried a fill of their own (an accent
 * wash that goes muddy over a wallpaper), the header showed a path cut in the
 * middle of a word, and nothing said the chips belonged to the row above them.
 *
 * What Warp does, and what this file now does, is draw the whole thing as
 * **one card**:
 *
 *     ┌───────────────────────────────┐
 *     │ ▣  CortX            3 panes   │   ← the tab: icon, short name, count
 *     │    │ ▪ frontend           ●   │   ← the panes, indented under a guide,
 *     │    │ ▪ src                ●   │     each with its status on the right
 *     │    │ ▪ tauri              ●   │
 *     └───────────────────────────────┘
 *
 * One surface, one border, one radius, so it reads as a single object; the
 * hierarchy comes from the indent and the guide, not from a second colour.
 * The current pane is marked on the guide and in the text weight — never with
 * a fill, which would break the card back into pieces.
 *
 * The two surfaces do not get the same treatment, because they do not have
 * the same room:
 *
 * - **Rail** (a 180–360 px column): the card above, verbatim.
 * - **Tab strip** (one row, `h-9`): the same card laid on its side — the tab
 *   itself becomes the card, the panes follow the name after a hairline, and
 *   the current one is underlined instead of ticked. Indenting is not an
 *   option there, so it is not attempted.
 *
 * The tints are in `@/styles/terminal-tabs.css`, which explains why they come
 * from `--card` and `--foreground` rather than from the accent.
 *
 * A tab with a single leaf renders exactly as before; grouping only ever
 * shows up where there is something to group.
 */
import { Fragment, type MouseEvent } from 'react';
import { AgentProviderIcon } from '@/components/agents/AgentProviderIcon';
import { TerminalTypeIcon } from '@/components/layout/terminal-dnd/TerminalTypeIcon';
import { type TerminalTab } from '@/lib/terminalLayout';
import { cn } from '@/lib/utils';
import '@/styles/terminal-tabs.css';
import { TerminalStatusGlyph } from './TerminalStatusGlyph';
import { closeLeaf } from './actions';
import { describeItem, type ResolvedTabDisplay } from './model';
import type { PaneEntry } from './paneModel';

function paneTitle(pane: PaneEntry): string {
  const head = `Pane ${pane.number}`;
  const body = pane.item ? describeItem(pane.item) : undefined;
  return [body ? `${head} · ${body}` : head, 'Middle-click to close this pane'].join('\n');
}

/**
 * The framed square in front of a pane's name. Small, and the same in both
 * surfaces, so the rows line up whatever they hold (a shell, an agent).
 */
function PaneIcon({ pane, display }: { pane: PaneEntry; display: ResolvedTabDisplay }) {
  const agent = display.agent ? pane.live.agent : undefined;
  return (
    <span className="tt-icon pointer-events-none grid size-[17px] shrink-0 place-items-center rounded-[4px]" aria-hidden>
      {agent ? (
        <AgentProviderIcon provider={agent.provider} plain className="size-3" />
      ) : (
        <TerminalTypeIcon type={pane.item?.type ?? 'shell'} className="size-3 text-faint" />
      )}
    </span>
  );
}

/**
 * What every pane row and chip answers to. Deliberately **no**
 * `onPointerDown` guard: the drag sensor must still see the press, so
 * dragging by a pane drags the whole tab (reorder and detach act on the tab,
 * which is what the layout document knows).
 */
function paneButtonProps(pane: PaneEntry, onSelect: () => void) {
  return {
    type: 'button' as const,
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

interface PaneListProps {
  tab: TerminalTab;
  panes: PaneEntry[];
  /** The tab this group belongs to is the one on screen. */
  tabActive: boolean;
  display: ResolvedTabDisplay;
  onSelect: (leafId: string) => void;
}

/**
 * The panes of the tab strip's group: after the tab's name, past a hairline,
 * one chip each. They share the tab's card — a chip has no surface of its own
 * until you hover it — and the current one is underlined.
 */
export function PaneGroupChips({ tab, panes, tabActive, display, onSelect }: PaneListProps) {
  return (
    <div
      className="flex min-w-0 shrink items-stretch gap-0.5 self-stretch"
      role="group"
      aria-label={`${panes.length} panes`}
    >
      {panes.map((pane, i) => {
        const current = tab.activeLeafId === pane.leaf.id;
        return (
          <Fragment key={pane.leaf.id}>
            {i > 0 && <span className="tt-divider" aria-hidden />}
            <button
              {...paneButtonProps(pane, () => onSelect(pane.leaf.id))}
              aria-pressed={current}
              data-current={current}
              className={cn(
                'tt-chip my-0.5 flex min-w-0 max-w-[124px] shrink items-center gap-1.5 rounded-[6px] px-1.5 text-[11px] transition-colors',
                current ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                !tabActive && 'opacity-70'
              )}
            >
              <PaneIcon pane={pane} display={display} />
              <span className="pointer-events-none truncate">{pane.label}</span>
              {display.status && <TerminalStatusGlyph live={pane.live} className="pointer-events-none shrink-0 scale-90" />}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * The panes of the rail's group: indented rows under the tab's own, tied to
 * it by the guide line, each with its status on the right. The current one is
 * marked on the guide and in the text — the card is already the highlight.
 */
export function PaneGroupBranch({ tab, panes, tabActive, display, onSelect }: PaneListProps) {
  return (
    <div className="tt-branch mt-0.5 flex flex-col gap-px" role="group" aria-label={`${panes.length} panes`}>
      {panes.map((pane) => {
        const current = tab.activeLeafId === pane.leaf.id;
        return (
          <button
            key={pane.leaf.id}
            {...paneButtonProps(pane, () => onSelect(pane.leaf.id))}
            aria-pressed={current}
            data-current={current}
            className={cn(
              'tt-leaf flex h-[26px] w-full min-w-0 items-center gap-1.5 rounded-[var(--rad-nav)] px-1.5 text-left text-[11.5px] transition-colors',
              current ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              !tabActive && !current && 'opacity-90'
            )}
          >
            <PaneIcon pane={pane} display={display} />
            <span className="pointer-events-none min-w-0 flex-1 truncate">{pane.label}</span>
            {display.status && <TerminalStatusGlyph live={pane.live} className="pointer-events-none shrink-0 scale-90" />}
          </button>
        );
      })}
    </div>
  );
}
