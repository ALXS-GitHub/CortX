import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ListFilter, Maximize2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { useTerminalGridStore, type TerminalGridSort } from '@/stores/terminalGridStore';
import { AgentProviderIcon } from '@/components/agents/AgentProviderIcon';
import { TerminalTypeIcon } from '@/components/layout/terminal-dnd/TerminalTypeIcon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { comboLabelFor } from '@/lib/keybindings';
import { collectLeaves, FREE_WORKSPACE_ID, type TerminalTab } from '@/lib/terminalLayout';
import { cn } from '@/lib/utils';
import type { GridTileInfo, TerminalAgentInfo } from '@/types';
import { SplitTree } from './SplitTree';
import { AgentPhaseDot, TerminalStatusGlyph } from './TerminalStatusGlyph';
import { arrangeGrid, gridShape, MIN_TILE_HEIGHT, type GridTabFacts } from './gridLayout';
import { GRID_TILE_INFO_OPTIONS, resolveGridTileInfo } from './gridTileInfo';
import { useTerminalAgentsStore } from './agentsStore';
import { patchTerminalSettings } from './settings/useTerminalSettings';
import { focusTerminal } from '@/lib/terminalSessions';
import { agentPhase, type AgentPhase } from './agentPhase';
import {
  activeLeafOf,
  NO_PROJECT_GROUP_NAME,
  tabItem,
  tabLiveState,
  tabProject,
  tabSecondary,
  tabTitle,
  projectColor,
  useTabDisplay,
  type ItemMap,
} from './model';

/**
 * The grid of agent mode (ticket #55): every tab of the window's scope as a
 * live tile, so several agents can be watched at once — pick a project in the
 * scope switcher for that project's grid, Global for all of them. Clicking a
 * tile opens it full size (`zoomed`, see `ZoomedBar`); the bar above it, or
 * the grid shortcut, comes back.
 *
 * The tiles are the real sessions, not pictures of them: each one mounts the
 * tab's split tree exactly as the usual view does (the xterm instances
 * outlive any component, see `XtermView`), so output keeps streaming in. The
 * pane is resized to its tile like any pane, which is what lets an agent's
 * interface reflow to it.
 *
 * Whether a tile takes the keyboard and the mouse is a setting,
 * `terminal.gridTilesInteractive` (on by default). On, a tile is a working
 * terminal — click into it to type, select or scroll — and its header opens
 * it. Off, a transparent layer over the whole tile turns every click into
 * "open this one", so a stray click can never reach an agent you are only
 * watching.
 *
 * What is shown, in which order and how grouped is the View menu's business
 * (`GridViewMenu`, in the title bar; `terminalGridStore.view`, per window):
 * nothing of it takes room in the grid.
 *
 * By default a tile does not resize its session (`terminal.gridTilesKeepSize`):
 * the panes are laid out at the size they have full page — the size of this
 * very area, less the bar an opened tile has above it — and the tile shows
 * them scaled down. A program redrawn at a narrow width can keep that width
 * for good (Claude Code does), so entering the grid must not narrow anyone.
 */
export function TerminalGrid({ tabs, items, showProject }: { tabs: TerminalTab[]; items: ItemMap; showProject: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const area = useElementSize(rootRef);
  const keepSize = useAppStore((s) => s.settings?.terminal.gridTilesKeepSize ?? true);
  // What a pane measures full page: this area, less the bar above an opened tile.
  const stage = keepSize && area.width > 0 && area.height > ZOOMED_BAR_HEIGHT
    ? { width: area.width, height: area.height - ZOOMED_BAR_HEIGHT }
    : null;
  const activeTabId = useTerminalLayoutStore((s) => s.doc.window.activeTabId);
  const interactive = useAppStore((s) => s.settings?.terminal.gridTilesInteractive ?? true);
  const projects = useAppStore((s) => s.projects);
  const view = useTerminalGridStore((s) => s.view);
  const agents = useTerminalAgentsStore((s) => s.agents);
  const unseen = useTerminalAgentsStore((s) => s.unseen);

  const groups = useMemo(() => {
    const facts: GridTabFacts<TerminalTab>[] = tabs.map((tab, railIndex) => {
      const project = tabProject(tab, projects);
      const { phase, agent } = loudestAgent(tab, agents, unseen);
      return {
        tab,
        groupKey: tab.workspaceId,
        groupName: project?.name ?? (tab.workspaceId === FREE_WORKSPACE_ID ? NO_PROJECT_GROUP_NAME : 'Unknown project'),
        railIndex,
        phase,
        lastActivity: agent?.lastActivity ?? 0,
      };
    });
    return arrangeGrid(facts, view);
  }, [tabs, projects, view, agents, unseen]);

  const total = groups.reduce((n, g) => n + g.tabs.length, 0);
  const grouped = view.groupByProject;
  const HEADER = 26;
  const GAP = 8;
  const usable = Math.max(0, size.height - (grouped ? groups.length * HEADER : 0));
  const { columns } = gridShape(total, size.width, usable);
  const rows = groups.reduce((n, g) => n + Math.ceil(g.tabs.length / columns), 0);
  const rowHeight = Math.max(MIN_TILE_HEIGHT, rows > 0 ? (usable - GAP * Math.max(rows - 1, 0)) / rows : MIN_TILE_HEIGHT);

  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={ref} className="min-h-0 min-w-0 flex-1 overflow-y-auto p-2">
        {total === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-faint">
            Nothing to show with these filters.
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.key} className="mb-2 last:mb-0">
              {group.name && (
                <h3 className="flex h-[26px] items-center gap-1.5 px-0.5 text-[11px] font-medium text-muted-foreground">
                  {group.key !== FREE_WORKSPACE_ID && (
                    <span
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: projectColor(group.key.replace(/^project:/, '')) }}
                      aria-hidden
                    />
                  )}
                  {group.name}
                  <span className="text-faint">· {group.tabs.length}</span>
                </h3>
              )}
              <div
                className="grid min-h-0 gap-2"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: `${Math.floor(rowHeight)}px` }}
              >
                {group.tabs.map((tab) => (
                  <GridTile
                    key={tab.id}
                    tab={tab}
                    items={items}
                    current={tab.id === activeTabId}
                    showProject={showProject && !grouped}
                    interactive={interactive}
                    stage={stage}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/** The loudest agent of a tab (a split can hold several): needs you > done > working > idle. */
function loudestAgent(
  tab: TerminalTab,
  agents: ReadonlyMap<string, TerminalAgentInfo>,
  unseen: ReadonlySet<string>
): { phase: AgentPhase | null; agent: TerminalAgentInfo | undefined } {
  const RANK: Record<AgentPhase, number> = { 'needs-you': 0, done: 1, working: 2, idle: 3, unknown: 4 };
  let best: { phase: AgentPhase; agent: TerminalAgentInfo } | null = null;
  for (const leaf of collectLeaves(tab.layout)) {
    const agent = agents.get(leaf.terminalId);
    if (!agent) continue;
    const phase = agentPhase(agent, unseen.has(leaf.terminalId));
    if (!best || RANK[phase] < RANK[best.phase]) best = { phase, agent };
  }
  return { phase: best?.phase ?? null, agent: best?.agent };
}

const SORT_LABEL: Record<TerminalGridSort, string> = {
  rail: 'Rail order',
  attention: 'Needs you first',
  recent: 'Latest activity first',
};

/**
 * The grid's View menu, in the title bar beside the grid button: what is
 * shown, in which order, how grouped, what a tile's header says. One icon;
 * it lights up while a filter hides something.
 */
export function GridViewMenu() {
  const view = useTerminalGridStore((s) => s.view);
  const setView = useTerminalGridStore((s) => s.setView);
  const terminal = useAppStore((s) => s.settings?.terminal);
  const info = resolveGridTileInfo(terminal);
  const toggleInfo = (value: GridTileInfo, on: boolean) => {
    const next = on ? [...info, value] : info.filter((v) => v !== value);
    patchTerminalSettings({ gridTileInfo: GRID_TILE_INFO_OPTIONS.map((o) => o.value).filter((v) => next.includes(v)) });
  };
  const filtered = view.agentsOnly || view.hideIdle;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={cn(filtered && 'text-[color:var(--agent-working)]')}
          title={filtered ? 'Grid view (a filter is on)' : 'Grid view: sort, filter, group'}
          aria-label="Grid view options"
        >
          <ListFilter />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Sort · {SORT_LABEL[view.sort]}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={view.sort} onValueChange={(v) => setView({ sort: v as TerminalGridSort })}>
              {(Object.keys(SORT_LABEL) as TerminalGridSort[]).map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  {SORT_LABEL[s]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Filter{filtered ? ' · on' : ''}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuCheckboxItem checked={view.agentsOnly} onCheckedChange={(v) => setView({ agentsOnly: !!v })}>
              Agents only
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={view.hideIdle} onCheckedChange={(v) => setView({ hideIdle: !!v })}>
              Hide idle agents
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal text-faint">A project: the scope switcher, at the top.</DropdownMenuLabel>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Tile header</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {GRID_TILE_INFO_OPTIONS.map((o) => (
              <DropdownMenuCheckboxItem
                key={o.value}
                checked={info.includes(o.value)}
                onCheckedChange={(v) => toggleInfo(o.value, !!v)}
                onSelect={(e) => e.preventDefault()}
              >
                {o.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={view.groupByProject} onCheckedChange={(v) => setView({ groupByProject: !!v })}>
          Group by project
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Height of the bar above an opened tile (`ZoomedBar`, `h-8`). */
const ZOOMED_BAR_HEIGHT = 32;

/** An element's content box, followed as it changes. */
function useElementSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * A tile's panes at their full-page size, scaled down to the tile. Layout
 * ignores a transform, so the panes measure — and their PTYs keep — exactly
 * the size they have when the tile is opened: nothing is resized, nothing is
 * redrawn narrow.
 *
 * xterm does not map the mouse through a transform, so the scaled panes take
 * no pointer events: a click (interactive tiles) focuses the tab's active
 * pane, and the keyboard goes to it; selecting text is for the opened tile.
 */
function ScaledBody({
  tab,
  items,
  stage,
  interactive,
}: {
  tab: TerminalTab;
  items: ItemMap;
  stage: { width: number; height: number };
  interactive: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useElementSize(ref);
  const scale = box.width > 0 && box.height > 0 ? Math.min(box.width / stage.width, box.height / stage.height, 1) : 0;
  const focus = () => {
    if (!interactive) return;
    const leaf = activeLeafOf(tab);
    useTerminalLayoutStore.getState().setActiveLeaf(tab.id, leaf.id);
    useAppStore.getState().markTerminalSeen(leaf.terminalId);
    // After the click's own focus handling, or the tile would take it back.
    window.setTimeout(() => focusTerminal(leaf.terminalId), 0);
  };
  return (
    <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden" onMouseDown={focus}>
      <div
        className="pointer-events-none absolute left-0 top-0 flex origin-top-left"
        style={{
          width: stage.width,
          height: stage.height,
          transform: `scale(${scale || 0.0001})`,
          visibility: scale > 0 ? 'visible' : 'hidden',
        }}
      >
        <SplitTree tab={tab} items={items} isActiveTab={false} />
      </div>
    </div>
  );
}

/** Open one tile: it becomes the active tab, shown full size. */
function openTile(tabId: string) {
  useTerminalLayoutStore.getState().setActiveTab(tabId);
  useTerminalGridStore.getState().zoom();
}

/** "Running Bash", "Asks you something"…: what the header's activity slot says. */
function activityOf(agent: TerminalAgentInfo | undefined, phase: AgentPhase | null): string | null {
  if (!agent || !phase) return null;
  if (phase === 'needs-you') return agent.needsInput === 'question' ? 'Asks you something' : 'Needs your permission';
  if (phase === 'working') return agent.pendingTool ? `Running ${agent.pendingTool}` : 'Working';
  if (phase === 'done') return 'Done';
  return null;
}

function GridTile({
  tab,
  items,
  current,
  showProject,
  interactive,
  stage,
}: {
  tab: TerminalTab;
  items: ItemMap;
  current: boolean;
  showProject: boolean;
  /** The tile takes the keyboard and the mouse; only its header opens it. */
  interactive: boolean;
  /** Full-page size to lay the panes out at, shown scaled; null = fit the tile. */
  stage: { width: number; height: number } | null;
}) {
  const projects = useAppStore((s) => s.projects);
  const terminal = useAppStore((s) => s.settings?.terminal);
  const display = useTabDisplay();
  const markTerminalSeen = useAppStore((s) => s.markTerminalSeen);
  const agents = useTerminalAgentsStore((s) => s.agents);
  const unseen = useTerminalAgentsStore((s) => s.unseen);
  const info = resolveGridTileInfo(terminal);
  const item = tabItem(tab, items);
  const live = tabLiveState(tab, items);
  const title = tabTitle(tab, items);
  const { phase, agent } = loudestAgent(tab, agents, unseen);
  const project = showProject && info.includes('project') ? tabProject(tab, projects) : undefined;
  // Activity: the agent's own words when one runs here, else the shell's
  // (the command running, or the directory).
  const activity = info.includes('activity') ? (agent ? activityOf(agent, phase) : tabSecondary(item, live, display)?.text ?? null) : null;
  const needsYou = phase === 'needs-you';
  const lines = [
    info.includes('lastPrompt') && agent?.lastPrompt ? { key: 'p', label: 'You', text: agent.lastPrompt } : null,
    info.includes('lastReply') && agent?.lastReply ? { key: 'r', label: 'Agent', text: agent.lastReply } : null,
  ].filter((l): l is { key: string; label: string; text: string } => l !== null);

  const open = () => {
    markTerminalSeen(activeLeafOf(tab).terminalId);
    openTile(tab.id);
  };

  return (
    <div
      className={cn(
        'group/tile relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--rad-sm)] border bg-card transition-colors',
        current ? 'border-primary/50' : 'border-border hover:border-border-strong',
        // An agent asking for you is what the grid is for: it has to stand out.
        needsYou && 'border-[color:var(--agent-needs-you)] ring-1 ring-[color:color-mix(in_srgb,var(--agent-needs-you)_40%,transparent)]'
      )}
    >
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-2 text-[12px]">
        {agent ? (
          <AgentProviderIcon provider={agent.provider} plain className="size-3.5 shrink-0" />
        ) : (
          <TerminalTypeIcon type={item?.type ?? 'shell'} className="size-3.5 shrink-0 text-faint" />
        )}
        <span className={cn('truncate', current && 'font-medium')}>{title}</span>
        {project && (
          <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-faint">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: projectColor(project.id) }} aria-hidden />
            {project.name}
          </span>
        )}
        {activity && (
          <span
            className={cn(
              'min-w-0 truncate text-[10.5px]',
              needsYou ? 'text-[color:var(--agent-needs-you)]' : agent ? 'text-muted-foreground' : 'font-mono text-faint'
            )}
          >
            {activity}
          </span>
        )}
        {info.includes('branch') && agent?.gitBranch && (
          <span className="shrink-0 truncate font-mono text-[10px] text-faint">{agent.gitBranch}</span>
        )}
        {info.includes('model') && agent?.model && (
          <span className="shrink-0 truncate text-[10px] text-faint">{shortModel(agent.model)}</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {agent && phase ? <AgentPhaseDot phase={phase} needsInput={agent.needsInput} provider={agent.provider} /> : <TerminalStatusGlyph live={live} />}
          <Maximize2 className="size-3 text-faint opacity-0 transition-opacity group-hover/tile:opacity-100" aria-hidden />
        </span>
      </div>
      {lines.length > 0 && (
        <div className="shrink-0 space-y-0.5 border-b border-border px-2 py-1 text-[10.5px] leading-tight">
          {lines.map((l) => (
            <div key={l.key} className="flex min-w-0 gap-1.5">
              <span className="shrink-0 text-faint">{l.label}</span>
              <span className="truncate text-muted-foreground">{l.text}</span>
            </div>
          ))}
        </div>
      )}
      {stage ? (
        <ScaledBody tab={tab} items={items} stage={stage} interactive={interactive} />
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <SplitTree tab={tab} items={items} isActiveTab={false} />
        </div>
      )}
      {/* Interactive tiles: over the header only, so the terminal below takes
          its clicks and keys and the header opens the tile. Watch-only tiles:
          over the whole tile — one click opens it, whatever it lands on, and
          nothing underneath ever gets the event. */}
      <button
        type="button"
        onClick={open}
        aria-label={`Open ${title}`}
        title={`Open ${title}`}
        className={cn(
          'absolute inset-x-0 top-0 z-30 cursor-zoom-in bg-transparent transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
          interactive ? 'h-7 rounded-t-[var(--rad-sm)]' : 'bottom-0 rounded-[var(--rad-sm)]'
        )}
      />
    </div>
  );
}

/** `claude-opus-4-1-20250805` → `opus-4-1`: the family and version, not the date. */
function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

/**
 * Above an opened tile: the way back to the grid, and what is open. The rail
 * on the left already lists every session (with what each agent is at, see
 * `tabDisplay.agentActivity`), so nothing here repeats it. The tab underneath is the plain active tab — every shortcut,
 * the split buttons and the rail work on it as usual.
 */
export function ZoomedBar({ tab, items, count }: { tab: TerminalTab | null; items: ItemMap; count: number }) {
  const backToGrid = useTerminalGridStore((s) => s.backToGrid);
  const keybindings = useAppStore((s) => s.settings?.terminal.keybindings);
  const combo = comboLabelFor('window.grid', keybindings);
  const live = useMemo(() => (tab ? tabLiveState(tab, items) : null), [tab, items]);
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2 text-[12px]">
      <button
        type="button"
        onClick={backToGrid}
        className="flex h-6 items-center gap-1.5 rounded-[var(--rad-xs)] px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title={combo ? `Back to the grid (${combo})` : 'Back to the grid'}
      >
        <ArrowLeft className="size-3.5" />
        Grid
        {count > 1 && <span className="text-faint">· {count}</span>}
      </button>
      {tab && (
        <>
          <span className="truncate font-medium">{tabTitle(tab, items)}</span>
          {live && <TerminalStatusGlyph live={live} />}
        </>
      )}
    </div>
  );
}
