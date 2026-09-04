/**
 * A split shown as a **group of tabs** (DEV-13, Alexis' feedback of
 * 2026-09-04).
 *
 * Until now a tab was one entry in the strip whatever it contained: split a
 * pane in three and the bar still said "one tab", so the only way to know
 * what was in there was to look at the panes. Warp answers this with tab
 * *groups* — several tabs held together in one tinted bracket, one of them
 * current. The model here already has the shape: a `TerminalTab` owns a tree
 * whose leaves are the panes, so a group is simply "the leaves of this tab",
 * and the current one is `tab.activeLeafId`.
 *
 * This file holds the two renderings — a row of chips for the tab strip,
 * indented rows for the sessions rail. What they share (the per-leaf live
 * state, the label, the selection) is in `paneModel.ts`.
 *
 * A tab with a single leaf renders exactly as before; grouping only ever
 * shows up where there is something to group.
 */
import { AgentProviderIcon } from '@/components/agents/AgentProviderIcon';
import { TerminalTypeIcon } from '@/components/layout/terminal-dnd/TerminalTypeIcon';
import { type TerminalTab } from '@/lib/terminalLayout';
import { cn } from '@/lib/utils';
import { TerminalStatusGlyph } from './TerminalStatusGlyph';
import { closeLeaf } from './actions';
import { describeItem, type ResolvedTabDisplay } from './model';
import type { PaneEntry } from './paneModel';

function paneTitle(pane: PaneEntry): string {
  const head = `Pane ${pane.number}`;
  const body = pane.item ? describeItem(pane.item) : undefined;
  return [body ? `${head} · ${body}` : head, 'Middle-click to close this pane'].join('\n');
}

interface PaneChipProps {
  pane: PaneEntry;
  current: boolean;
  /** The tab this pane belongs to is the one on screen. */
  tabActive: boolean;
  display: ResolvedTabDisplay;
  onSelect: () => void;
}

/** One pane inside the strip's group bracket. */
function PaneChip({ pane, current, tabActive, display, onSelect }: PaneChipProps) {
  const agent = display.agent ? pane.live.agent : undefined;
  return (
    <button
      type="button"
      aria-pressed={current}
      title={paneTitle(pane)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        closeLeaf(pane.leaf.terminalId);
      }}
      className={cn(
        'flex h-[22px] min-w-0 max-w-[104px] shrink items-center gap-1 rounded-[5px] px-1.5 text-[10.5px] transition-colors',
        current
          ? 'bg-[var(--tab-active-bg)] text-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        !tabActive && 'opacity-70'
      )}
    >
      {agent ? (
        <AgentProviderIcon provider={agent.provider} plain className="pointer-events-none size-3 shrink-0" />
      ) : (
        <TerminalTypeIcon type={pane.item?.type ?? 'shell'} className="pointer-events-none size-3 shrink-0 text-faint" />
      )}
      <span className="pointer-events-none truncate">{pane.label}</span>
      {display.status && <TerminalStatusGlyph live={pane.live} className="pointer-events-none scale-90" />}
    </button>
  );
}

/**
 * The group bracket of the tab strip: one chip per pane inside a hairline
 * frame, so a split reads as "these tabs belong together" at a glance
 * instead of hiding behind a single entry.
 */
export function PaneChipRow({
  tab,
  panes,
  tabActive,
  display,
  onSelect,
}: {
  tab: TerminalTab;
  panes: PaneEntry[];
  tabActive: boolean;
  display: ResolvedTabDisplay;
  onSelect: (leafId: string) => void;
}) {
  return (
    <div
      className="flex min-w-0 shrink items-center gap-px rounded-[var(--rad-xs)] border border-border p-px"
      role="group"
      aria-label={`${panes.length} panes`}
    >
      {panes.map((pane) => (
        <PaneChip
          key={pane.leaf.id}
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
 * The same group in the sessions rail: indented rows under their tab, held
 * by a guide line. One row per pane, the current one marked.
 */
export function PaneRailRows({
  tab,
  panes,
  tabActive,
  display,
  onSelect,
}: {
  tab: TerminalTab;
  panes: PaneEntry[];
  tabActive: boolean;
  display: ResolvedTabDisplay;
  onSelect: (leafId: string) => void;
}) {
  return (
    <div className="relative ml-4 flex flex-col gap-px pl-2.5" role="group" aria-label={`${panes.length} panes`}>
      <span className="pointer-events-none absolute inset-y-1 left-0 w-px bg-border" aria-hidden />
      {panes.map((pane) => {
        const current = tab.activeLeafId === pane.leaf.id;
        const agent = display.agent ? pane.live.agent : undefined;
        return (
          <button
            key={pane.leaf.id}
            type="button"
            aria-pressed={current}
            title={paneTitle(pane)}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(pane.leaf.id);
            }}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              closeLeaf(pane.leaf.terminalId);
            }}
            className={cn(
              'flex h-6 w-full min-w-0 items-center gap-1.5 rounded-[var(--rad-nav)] px-1.5 text-left text-[11px] transition-colors',
              current && tabActive
                ? 'bg-[var(--tab-active-bg)] text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              current && !tabActive && 'text-foreground'
            )}
          >
            {agent ? (
              <AgentProviderIcon provider={agent.provider} plain className="pointer-events-none size-3 shrink-0" />
            ) : (
              <TerminalTypeIcon
                type={pane.item?.type ?? 'shell'}
                className="pointer-events-none size-3 shrink-0 text-faint"
              />
            )}
            <span className="pointer-events-none min-w-0 flex-1 truncate">{pane.label}</span>
            {display.status && <TerminalStatusGlyph live={pane.live} className="pointer-events-none scale-90" />}
          </button>
        );
      })}
    </div>
  );
}
