/**
 * A split shown as **two normal tabs held together** (DEV-13; ticket #22,
 * Alexis' feedback of 2026-09-07).
 *
 * The first answer put a chip per pane in a hairline bracket; the second drew
 * the whole split as one card with a header of its own and pane chips indented
 * under a guide line. Both invented a second kind of tab, and the card grew to
 * 540 px in a strip whose tabs are 240 px — "notre gros bloc moche".
 *
 * What Warp does, and what this file now does, is not draw a new object at
 * all:
 *
 *     zsh in LMEP · 2 panes            ← the tab, as a quiet group label
 *     ┌───────────────────────────┐
 *     │ ▣  pwsh · LMEP            │    ← a tab row: icon, name,
 *     │    ~/Desktop/LMEP         │      second line, status
 *     │ ▣  pwsh · LMEP            │
 *     │    ~/Desktop/LMEP         │
 *     └───────────────────────────┘
 *
 * The rows are the rail's rows: same 40 px height, same 3.5 icon, same
 * 12.5 px / 10.5 px pair, same rules for what the second line says
 * (`paneSecondary`). The only thing the group adds is the faintly tinted box
 * that says "these two belong to one tab", tinted like `.tt-cluster` —
 * a weak mix of the tab's own colour into `--card`, never the accent.
 *
 * The two surfaces do not have the same room:
 *
 * - **Rail** (a 180–360 px column): the box above, verbatim.
 * - **Tab strip** (one row, `h-9`): the same box laid on its side, holding
 *   one-line rows — a strip cell has no room for a second line, and a tab
 *   without its second line is still an ordinary tab.
 *
 * The current pane is marked the way the current tab is marked in either
 * surface: a plate under the row, not a tick and not a fill of another hue.
 *
 * A tab with a single leaf renders exactly as before; grouping only ever
 * shows up where there is something to group.
 */
import { type MouseEvent } from 'react';
import { AgentProviderIcon } from '@/components/agents/AgentProviderIcon';
import { TerminalTypeIcon } from '@/components/layout/terminal-dnd/TerminalTypeIcon';
import { type TerminalTab } from '@/lib/terminalLayout';
import { cn } from '@/lib/utils';
import '@/styles/terminal-tabs.css';
import { TerminalStatusGlyph } from './TerminalStatusGlyph';
import { closeLeaf } from './actions';
import { describeItem, type ResolvedTabDisplay } from './model';
import { paneSecondary, type PaneEntry } from './paneModel';

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
 * one before either.)
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
 * The tab strip's group: one row per pane inside the tinted box, after the
 * tab's own name. Single line — a 36 px cell has no room for a second one —
 * but the same height, icon and type size a lone tab has.
 */
export function PaneGroupChips({ tab, panes, tabActive, display, onSelect }: PaneListProps) {
  return (
    <div
      className="tt-panebox tt-panebox-h flex min-w-0 shrink items-center gap-1 self-center"
      role="group"
      aria-label={`${panes.length} panes`}
    >
      {panes.map((pane) => {
        const current = tab.activeLeafId === pane.leaf.id;
        return (
          <button
            key={pane.leaf.id}
            {...paneButtonProps(pane, () => onSelect(pane.leaf.id))}
            aria-pressed={current}
            data-current={current ? 'true' : 'false'}
            className={cn(
              'tt-leaf flex h-[26px] min-w-0 max-w-[132px] shrink items-center gap-1.5 rounded-[var(--rad-xs)] px-1.5 text-xs transition-colors',
              current ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              !tabActive && !current && 'opacity-80'
            )}
          >
            <PaneIcon pane={pane} display={display} />
            <span className="pointer-events-none truncate">{pane.label}</span>
            {display.status && (
              <TerminalStatusGlyph live={pane.live} className="pointer-events-none shrink-0 scale-90" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The rail's group: the tab's panes as rail rows, inside the tinted box that
 * ties them to the label above. Everything below is `SessionRow`'s own
 * geometry — 40 px, `gap-2 px-2`, a 12.5 px name over a 10.5 px second line —
 * so a split reads as two sessions that happen to share a tab.
 */
export function PaneGroupBranch({ tab, panes, tabActive, display, onSelect }: PaneListProps) {
  return (
    <div className="tt-panebox tt-panebox-v flex flex-col gap-px" role="group" aria-label={`${panes.length} panes`}>
      {panes.map((pane) => {
        const current = tab.activeLeafId === pane.leaf.id;
        const secondary = paneSecondary(pane, display);
        return (
          <button
            key={pane.leaf.id}
            {...paneButtonProps(pane, () => onSelect(pane.leaf.id))}
            aria-pressed={current}
            data-current={current ? 'true' : 'false'}
            className={cn(
              'tt-leaf flex h-10 w-full min-w-0 items-center gap-2 rounded-[var(--rad-nav)] px-2 text-left transition-colors',
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
          </button>
        );
      })}
    </div>
  );
}
