import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import {
  FolderKanban,
  Settings,
  FolderOpen,
  Play,
  X,
  Square,
  ScrollText,
  Wrench,
  SquareTerminal,
  AppWindow,
  Wand2,
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
  Terminal,
  Sun,
  Moon,
  MonitorCog,
  FileCode,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useViewPrefsStore } from '@/stores/viewPrefsStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { StatusDot } from '@/components/ui/StatusDot';
import { BetaBadge } from '@/components/ui/BetaBadge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ShellNoteBanner } from '@/components/terminal/ShellNoteBanner';
import { cn } from '@/lib/utils';
import { applyThemeMode, type ThemeMode } from '@/lib/theme';
import { describeCloseReach, type WindowShare } from '@/lib/closeReach';
import {
  collectLeaves,
  terminalWindowIdOf,
  terminalWindowName,
  terminalWindowNumber,
  type TerminalTab,
} from '@/lib/terminalLayout';
import type { View } from '@/types';

const RAIL_WIDTH = 56;

interface NavItem {
  view: View;
  /** Views that keep this item highlighted (detail pages). */
  matches: View[];
  label: string;
  icon: ComponentType<{ className?: string }>;
  group: string;
  beta?: boolean;
}

const NAV: NavItem[] = [
  { view: 'dashboard', matches: ['dashboard', 'project'], label: 'Projects', icon: FolderKanban, group: 'Workspace' },
  { view: 'scripts', matches: ['scripts', 'script-detail'], label: 'Scripts', icon: ScrollText, group: 'Workspace' },
  { view: 'agents', matches: ['agents'], label: 'Agents', icon: Bot, group: 'Workspace', beta: true },
  { view: 'tools', matches: ['tools', 'tool-detail'], label: 'Tools', icon: Wrench, group: 'Library' },
  { view: 'apps', matches: ['apps', 'app-detail'], label: 'Apps', icon: AppWindow, group: 'Library' },
  { view: 'aliases', matches: ['aliases', 'alias-detail'], label: 'Shell Config', icon: SquareTerminal, group: 'Library' },
  { view: 'utilities', matches: ['utilities'], label: 'Utilities', icon: Wand2, group: 'Library' },
];

type RunKind = 'service' | 'script' | 'global-script';

interface ActivityRow {
  id: string;
  kind: RunKind;
  key: string;
  name: string;
  status: string;
  hidden: boolean;
}

interface ActivityGroup {
  id: string;
  name: string;
  rows: ActivityRow[];
}

/**
 * Which Terminal windows hold `terminalIds`, and how many each holds — the
 * shape `describeCloseReach` turns into "2 in Terminal 2" (ticket #37).
 *
 * The layout document is shared between the windows, so the main window can
 * name them without asking anyone.
 */
function windowShares(tabs: TerminalTab[], terminalIds: string[]): WindowShare[] {
  if (terminalIds.length === 0) return [];
  const wanted = new Set(terminalIds);
  const counts = new Map<string, number>();
  for (const tab of tabs) {
    for (const leaf of collectLeaves(tab.layout)) {
      if (!wanted.has(leaf.terminalId)) continue;
      const windowId = terminalWindowIdOf(tab);
      counts.set(windowId, (counts.get(windowId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => terminalWindowNumber(a[0]) - terminalWindowNumber(b[0]))
    .map(([windowId, count]) => ({ name: terminalWindowName(windowId), count }));
}

/**
 * Left navigation (frosted glass). Two halves: the section nav on top and, when
 * something runs or has output, an "Activity" tree of the live services and
 * scripts (grouped by project) with start / stop / close actions on hover.
 * Collapses to an icon rail (Ctrl+B); the expanded width is drag-resizable.
 */
export function AppSidebar() {
  const {
    currentView,
    setCurrentView,
    projects,
    selectProject,
    serviceRuntimes,
    scriptRuntimes,
    terminals,
    terminalSurfaces,
    openTerminal,
    closeTerminal,
    startService,
    stopService,
    runScript,
    stopScript,
    globalScripts,
    globalScriptRuntimes,
    stopGlobalScript,
    openRunScriptDialog,
    terminalPanelOpen,
    toggleTerminalPanel,
    settings,
    updateSettings,
  } = useAppStore();
  const { sidebarCollapsed, toggleSidebar, sidebarWidth, setSidebarWidth } = useViewPrefsStore();

  // Ctrl/Cmd+B toggles the rail.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  // Drag-resize (expanded only).
  const [resizing, setResizing] = useState(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startX.current = e.clientX;
      startW.current = sidebarWidth;
      setResizing(true);
    },
    [sidebarWidth]
  );
  useEffect(() => {
    if (!resizing) return;
    const move = (e: MouseEvent) => setSidebarWidth(startW.current + (e.clientX - startX.current));
    const up = () => setResizing(false);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizing, setSidebarWidth]);

  const navigate = (view: View) => {
    setCurrentView(view);
    if (view === 'dashboard') selectProject(null);
  };

  const visibilityOf = (kind: RunKind, key: string) => terminals.get(`${kind}:${key}`)?.visibility;

  // ---- Activity: live services / scripts grouped by project ----
  const { serviceGroups, scriptGroups, globalRows, runningTotal } = useMemo(() => {
    const services = new Map<string, ActivityGroup>();
    const scripts = new Map<string, ActivityGroup>();
    const globals: ActivityRow[] = [];
    let running = 0;

    for (const [serviceId, runtime] of serviceRuntimes.entries()) {
      if (visibilityOf('service', serviceId) === 'closed') continue;
      if (runtime.logs.length === 0 && runtime.status === 'stopped') continue;
      for (const project of projects) {
        const service = project.services.find((s) => s.id === serviceId);
        if (!service) continue;
        const row: ActivityRow = {
          id: `service:${serviceId}`,
          kind: 'service',
          key: serviceId,
          name: service.name,
          status: runtime.status,
          hidden: visibilityOf('service', serviceId) === 'hidden',
        };
        if (runtime.status === 'running') running++;
        const g = services.get(project.id) ?? { id: project.id, name: project.name, rows: [] };
        g.rows.push(row);
        services.set(project.id, g);
        break;
      }
    }

    for (const [scriptId, runtime] of scriptRuntimes.entries()) {
      if (visibilityOf('script', scriptId) === 'closed') continue;
      if (runtime.logs.length === 0 && runtime.status === 'idle') continue;
      for (const project of projects) {
        const script = project.scripts?.find((s) => s.id === scriptId);
        if (!script) continue;
        const row: ActivityRow = {
          id: `script:${scriptId}`,
          kind: 'script',
          key: scriptId,
          name: script.name,
          status: runtime.status,
          hidden: visibilityOf('script', scriptId) === 'hidden',
        };
        if (runtime.status === 'running') running++;
        const g = scripts.get(project.id) ?? { id: project.id, name: project.name, rows: [] };
        g.rows.push(row);
        scripts.set(project.id, g);
        break;
      }
    }

    for (const [scriptId, runtime] of globalScriptRuntimes.entries()) {
      if (visibilityOf('global-script', scriptId) === 'closed') continue;
      if (runtime.logs.length === 0 && runtime.status === 'idle') continue;
      const script = globalScripts.find((s) => s.id === scriptId);
      if (runtime.status === 'running') running++;
      globals.push({
        id: `global-script:${scriptId}`,
        kind: 'global-script',
        key: scriptId,
        name: script?.name || 'Unknown script',
        status: runtime.status,
        hidden: visibilityOf('global-script', scriptId) === 'hidden',
      });
    }

    return {
      serviceGroups: Array.from(services.values()),
      scriptGroups: Array.from(scripts.values()),
      globalRows: globals,
      runningTotal: running,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceRuntimes, scriptRuntimes, globalScriptRuntimes, projects, globalScripts, terminals]);

  const hasActivity = serviceGroups.length + scriptGroups.length + globalRows.length > 0;

  // ---- Theme mode toggle (persisted in the app settings) ----
  const themeMode: ThemeMode = settings?.appearance.theme ?? 'system';
  const cycleTheme = async () => {
    if (!settings) return;
    const next: ThemeMode = themeMode === 'light' ? 'dark' : themeMode === 'dark' ? 'system' : 'light';
    applyThemeMode(next);
    await updateSettings({ ...settings, appearance: { ...settings.appearance, theme: next } });
  };
  const ThemeIcon = themeMode === 'light' ? Sun : themeMode === 'dark' ? Moon : MonitorCog;
  const themeLabel = themeMode === 'light' ? 'Light theme' : themeMode === 'dark' ? 'Dark theme' : 'Theme follows the system';

  // ---- Row actions ----
  const startRow = (row: ActivityRow) => {
    if (row.kind === 'service') startService(row.key);
    else if (row.kind === 'script') runScript(row.key);
    else {
      const gs = globalScripts.find((s) => s.id === row.key);
      if (gs) openRunScriptDialog(gs);
    }
  };
  const stopRow = (row: ActivityRow) => {
    if (row.kind === 'service') stopService(row.key);
    else if (row.kind === 'script') stopScript(row.key);
    else stopGlobalScript(row.key);
  };

  /**
   * The row's own X: one terminal, named by the user, closed wherever it lives
   * — unlike the group's "close all", which stays in this window (see
   * `CloseAllAction`). An aimed gesture may cross the surface; an unaimed one
   * may not.
   *
   * Crossing it properly takes both halves, which is what the Terminal window
   * does for its own panes (`closeLeafNow`): the leaf has to leave the shared
   * layout document, or the window keeps showing a pane whose session has just
   * been killed.
   */
  const closeRow = (row: ActivityRow) => {
    if (terminalSurfaces[row.id] === 'window') {
      useTerminalLayoutStore.getState().removeTerminalFromWindow(row.id, null);
    }
    closeTerminal(row.id);
  };

  const collapsed = sidebarCollapsed;
  const groups = useMemo(() => {
    const out: { name: string; items: NavItem[] }[] = [];
    for (const item of NAV) {
      let g = out.find((x) => x.name === item.group);
      if (!g) {
        g = { name: item.group, items: [] };
        out.push(g);
      }
      g.items.push(item);
    }
    return out;
  }, []);

  return (
    <aside
      className={cn(
        'glass relative z-30 flex h-full shrink-0 flex-col border-r border-border',
        !resizing && 'transition-[width] duration-200 ease-out'
      )}
      style={{ width: collapsed ? RAIL_WIDTH : sidebarWidth }}
    >
      {/* Header: collapse toggle only (the app name lives in the title bar) */}
      <div className={cn('flex h-10 shrink-0 items-center', collapsed ? 'justify-center' : 'justify-end px-3')}>
        {collapsed ? (
          <RailButton label="Expand sidebar (Ctrl+B)" onClick={toggleSidebar} className="size-8">
            <PanelLeftOpen className="size-4" />
          </RailButton>
        ) : (
          <RailButton label="Collapse sidebar (Ctrl+B)" onClick={toggleSidebar} className="size-8">
            <PanelLeftClose className="size-4" />
          </RailButton>
        )}
      </div>

      {/* Navigation + activity */}
      <nav className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1', collapsed ? 'px-2' : 'px-3')}>
        {groups.map((g) => (
          <div key={g.name} className="mb-3">
            {!collapsed && <div className="eyebrow px-2 pb-1.5 pt-1">{g.name}</div>}
            {collapsed && <div className="mx-auto mb-1.5 h-px w-6 bg-border first:hidden" />}
            {g.items.map((item) => {
              const Icon = item.icon;
              const active = item.matches.includes(currentView);
              return (
                <NavButton
                  key={item.view}
                  active={active}
                  collapsed={collapsed}
                  label={item.label}
                  onClick={() => navigate(item.view)}
                >
                  <Icon className={cn('size-[18px] shrink-0', active ? 'text-primary' : 'text-faint')} />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate text-left">{item.label}</span>
                      {item.beta && <BetaBadge />}
                    </>
                  )}
                </NavButton>
              );
            })}
          </div>
        ))}

        {hasActivity && collapsed && (
          <div className="mb-3">
            <div className="mx-auto mb-1.5 h-px w-6 bg-border" />
            <NavButton
              active={terminalPanelOpen}
              collapsed
              label={`Terminal — ${runningTotal} running`}
              onClick={toggleTerminalPanel}
            >
              <span className="relative">
                <Terminal className={cn('size-[18px]', terminalPanelOpen ? 'text-primary' : 'text-faint')} />
                {runningTotal > 0 && (
                  <StatusDot tone="running" size={7} className="absolute -right-1 -top-1" />
                )}
              </span>
            </NavButton>
          </div>
        )}

        {hasActivity && !collapsed && (
          <div className="mb-3">
            <div className="flex items-center gap-2 px-2 pb-1.5 pt-1">
              <span className="eyebrow">Activity</span>
              {runningTotal > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-st-done/14 px-1.5 text-[10px] font-semibold leading-4 text-st-done">
                  <StatusDot tone="running" size={6} />
                  {runningTotal} running
                </span>
              )}
            </div>

            {serviceGroups.map((group) => {
              const running = group.rows.filter((r) => r.status === 'running');
              const stopped = group.rows.filter((r) => r.status !== 'running');
              return (
                <ActivityGroupBlock
                  key={`svc-${group.id}`}
                  icon={FolderOpen}
                  name={group.name}
                  count={group.rows.length}
                  onOpen={() => selectProject(group.id)}
                  actions={
                    <>
                      {stopped.length > 0 && (
                        <RowAction tone="start" title="Start all services" onClick={() => stopped.forEach((r) => startService(r.key))}>
                          <Play className="size-3" />
                        </RowAction>
                      )}
                      {running.length > 0 && (
                        <RowAction tone="stop" title="Stop all services" onClick={() => running.forEach((r) => stopService(r.key))}>
                          <Square className="size-3" />
                        </RowAction>
                      )}
                      {running.length === 0 && <CloseAllAction rows={group.rows} subject="Close all terminals" />}
                    </>
                  }
                >
                  {group.rows.map((row) => (
                    <ActivityRowItem
                      key={row.id}
                      row={row}
                      icon={Terminal}
                      onOpen={() => openTerminal(row.kind, row.key)}
                      onStart={() => startRow(row)}
                      onStop={() => stopRow(row)}
                      onClose={() => closeRow(row)}
                    />
                  ))}
                </ActivityGroupBlock>
              );
            })}

            {scriptGroups.map((group) => {
              const running = group.rows.filter((r) => r.status === 'running');
              return (
                <ActivityGroupBlock
                  key={`scr-${group.id}`}
                  icon={FileCode}
                  name={group.name}
                  count={group.rows.length}
                  onOpen={() => selectProject(group.id)}
                  actions={
                    <>
                      {running.length > 0 && (
                        <RowAction tone="stop" title="Stop all scripts" onClick={() => running.forEach((r) => stopScript(r.key))}>
                          <Square className="size-3" />
                        </RowAction>
                      )}
                      {running.length === 0 && (
                        <CloseAllAction rows={group.rows} subject="Close all script terminals" />
                      )}
                    </>
                  }
                >
                  {group.rows.map((row) => (
                    <ActivityRowItem
                      key={row.id}
                      row={row}
                      icon={FileCode}
                      onOpen={() => openTerminal(row.kind, row.key)}
                      onStart={() => startRow(row)}
                      onStop={() => stopRow(row)}
                      onClose={() => closeRow(row)}
                    />
                  ))}
                </ActivityGroupBlock>
              );
            })}

            {globalRows.length > 0 && (
              <ActivityGroupBlock
                icon={ScrollText}
                name="Global scripts"
                count={globalRows.length}
                onOpen={() => navigate('scripts')}
                actions={
                  globalRows.some((r) => r.status === 'running') ? (
                    <RowAction tone="stop" title="Stop all" onClick={() => globalRows.filter((r) => r.status === 'running').forEach((r) => stopGlobalScript(r.key))}>
                      <Square className="size-3" />
                    </RowAction>
                  ) : (
                    <CloseAllAction rows={globalRows} subject="Close all" />
                  )
                }
              >
                {globalRows.map((row) => (
                  <ActivityRowItem
                    key={row.id}
                    row={row}
                    icon={ScrollText}
                    onOpen={() => openTerminal(row.kind, row.key)}
                    onStart={() => startRow(row)}
                    onStop={() => stopRow(row)}
                    onClose={() => closeRow(row)}
                  />
                ))}
              </ActivityGroupBlock>
            )}
          </div>
        )}
      </nav>

      {/* Footer: settings + theme */}
      <div className={cn('flex shrink-0 items-center gap-1 border-t border-border', collapsed ? 'flex-col px-2 py-2' : 'px-3 py-2')}>
        <NavButton
          active={currentView === 'settings'}
          collapsed={collapsed}
          label="Settings"
          onClick={() => navigate('settings')}
          className={collapsed ? undefined : 'flex-1'}
        >
          <Settings className={cn('size-[18px] shrink-0', currentView === 'settings' ? 'text-primary' : 'text-faint')} />
          {!collapsed && <span className="flex-1 truncate text-left">Settings</span>}
        </NavButton>
        <RailButton label={`${themeLabel} — click to change`} onClick={cycleTheme} className="size-8">
          <ThemeIcon className="size-4" />
        </RailButton>
      </div>

      {/*
        "CortX has no shell integration for <shell>" (issue #54), for the
        shells of *this* dock. It is drawn through a portal at the bottom of
        the window, over the dock it is about, and only while the dock is open
        — a note about a terminal nobody can see explains nothing.

        Mounted from the sidebar because it is the one piece of permanent main
        window chrome this change owns; its natural home is `TerminalPanel`,
        next to where the Terminal window mounts its own copy (see
        `SubshellBanner`). Moving it there is a one-line change and nothing
        here depends on the sidebar.
      */}
      {terminalPanelOpen && <ShellNoteBanner surface="dock" anchor="fixed" />}

      {/* Resize handle */}
      {!collapsed && (
        <div
          className="absolute inset-y-0 -right-1 z-40 w-2 cursor-ew-resize"
          onMouseDown={onResizeStart}
        >
          <div className={cn('mx-auto h-full w-px transition-colors', resizing ? 'bg-primary' : 'bg-transparent hover:bg-accent-border')} />
        </div>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */

function NavButton({
  active,
  collapsed,
  label,
  onClick,
  children,
  className,
}: {
  active: boolean;
  collapsed: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  const button = (
    <button
      type="button"
      data-slot="nav-item"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        'flex items-center rounded-[var(--rad-nav)] text-sm transition-colors',
        collapsed ? 'mx-auto size-10 justify-center' : 'w-full gap-2.5 px-2.5 py-2',
        active
          ? 'bg-accent font-[550] text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        className
      )}
    >
      {children}
    </button>
  );
  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function RailButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-slot="rail-button"
          onClick={onClick}
          aria-label={label}
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-[var(--rad-nav)] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
            className
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function RowAction({
  tone,
  title,
  onClick,
  disabled,
  children,
}: {
  tone: 'start' | 'stop' | 'close';
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'grid size-5 place-items-center rounded-[6px] text-muted-foreground transition-colors',
        disabled && 'cursor-default opacity-40',
        !disabled && tone === 'start' && 'hover:bg-st-done/18 hover:text-st-done',
        !disabled && tone === 'stop' && 'hover:bg-destructive/15 hover:text-destructive',
        !disabled && tone === 'close' && 'hover:bg-accent hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

/**
 * "Close all terminals" for one Activity group — and it stops at this window's
 * dock (ticket #37).
 *
 * The rule the rest of the app follows is that a bulk close belongs to the
 * surface it was pressed in: the dock's own "Close all" has consulted
 * `terminalSurfaces` since `f026107`, and the Terminal windows treat
 * themselves as one set. This family was the one left outside, and it is the
 * least defensible place to reach across: it is an unlabelled hover button in
 * the *main* window's chrome, it asks nothing before it fires, and what it
 * calls — `closeTerminal` — is a dock action. On a terminal that lives in a
 * Terminal window it kills the PTY and removes the backend session but leaves
 * the tab standing in the layout document, so the reach is not even a clean
 * close: it is a dead pane in a window the user may well be looking at.
 *
 * There is a real argument the other way — these actions close *a project's*
 * terminals, by identity, so one could say they should find them wherever they
 * are. That argument is honoured one row down: the per-row X still reaches
 * into the Terminal window, because it is aimed at exactly one terminal the
 * user picked out. It is the unaimed gesture that stays home.
 *
 * And when the scope is cut, the button says so: the tooltip names what stays
 * open, in the words `closeReach` gives the Terminal windows.
 */
function CloseAllAction({ rows, subject }: { rows: ActivityRow[]; subject: string }) {
  const closeTerminal = useAppStore((s) => s.closeTerminal);
  const surfaces = useAppStore((s) => s.terminalSurfaces);
  const tabs = useTerminalLayoutStore((s) => s.doc.window.tabs);

  const { here, title } = useMemo(() => {
    const inDock = rows.filter((r) => surfaces[r.id] !== 'window').map((r) => r.id);
    const inWindows = rows.filter((r) => surfaces[r.id] === 'window').map((r) => r.id);
    const reach = describeCloseReach(windowShares(tabs, inWindows));
    if (inDock.length === 0) {
      return {
        here: inDock,
        // The reach names the window, which is also where the close has to be
        // pressed instead — so the sentence says where without saying "them",
        // which would have to know whether it is one terminal or five.
        title: reach
          ? `Nothing to close in this window — ${reach}`
          : 'Nothing to close in this window',
      };
    }
    return {
      here: inDock,
      title: reach ? `${subject} in this window — leaves ${reach}` : subject,
    };
  }, [rows, surfaces, tabs, subject]);

  return (
    <RowAction
      tone="close"
      title={title}
      disabled={here.length === 0}
      onClick={() => here.forEach((id) => closeTerminal(id))}
    >
      <X className="size-3" />
    </RowAction>
  );
}

function ActivityGroupBlock({
  icon: Icon,
  name,
  count,
  onOpen,
  actions,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  name: string;
  count: number;
  onOpen: () => void;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-1">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        className="group/project flex w-full items-center gap-2 rounded-[var(--rad-nav)] px-2.5 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/60"
      >
        <Icon className="size-4 shrink-0 text-faint" />
        <span className="flex-1 truncate text-left">{name}</span>
        <span className="text-xs tabular-nums text-faint group-hover/project:hidden">{count}</span>
        <div className="hidden items-center gap-0.5 group-hover/project:flex">{actions}</div>
      </div>
      <div className="ml-[15px] border-l border-border pl-2">{children}</div>
    </div>
  );
}

function ActivityRowItem({
  row,
  icon: Icon,
  onOpen,
  onStart,
  onStop,
  onClose,
}: {
  row: ActivityRow;
  icon: ComponentType<{ className?: string }>;
  onOpen: () => void;
  onStart: () => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const running = row.status === 'running';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      title={row.hidden ? `${row.name} — hidden from the terminal panel` : row.name}
      className="group/row flex w-full items-center gap-2 rounded-[var(--rad-xs)] py-1 pl-2 pr-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
    >
      <Icon className="size-3.5 shrink-0 text-faint" />
      <span className={cn('flex-1 truncate text-left', row.hidden && 'opacity-60')}>{row.name}</span>
      <StatusDot status={row.status} size={7} className="group-hover/row:hidden" />
      <div className="hidden items-center gap-0.5 group-hover/row:flex">
        {running ? (
          <RowAction tone="stop" title="Stop" onClick={onStop}>
            <Square className="size-3" />
          </RowAction>
        ) : (
          <>
            <RowAction tone="start" title={row.kind === 'service' ? 'Start' : 'Run'} onClick={onStart}>
              <Play className="size-3" />
            </RowAction>
            <RowAction tone="close" title="Close terminal" onClick={onClose}>
              <X className="size-3" />
            </RowAction>
          </>
        )}
      </div>
    </div>
  );
}
