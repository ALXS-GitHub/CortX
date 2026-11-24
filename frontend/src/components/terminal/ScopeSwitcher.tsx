import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, Ellipsis, Globe } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { AGENTS_SCOPE, isAgentsScope, projectIdOfWorkspace } from '@/lib/terminalLayout';
import { cn } from '@/lib/utils';
import { projectColor, useAgentTabCount } from './model';

function ProjectDot({ projectId, className }: { projectId: string; className?: string }) {
  return (
    <span
      className={cn('size-1.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: projectColor(projectId) }}
      aria-hidden
    />
  );
}

/**
 * How many project pills the title bar shows at most. With many projects
 * active the row used to eat the whole title bar; past this, they wait in
 * the "…" menu (the current one is always among the visible ones).
 */
const MAX_PROJECT_PILLS = 4;

/**
 * Title-bar pill: "Global", "Agents" while agents are running, one entry per
 * project that currently owns tabs — at most `MAX_PROJECT_PILLS`, the rest in
 * the "…" menu — and that menu listing every project so a scope can be
 * picked before it has any terminal.
 *
 * The Agents scope is a filter over the very same sessions (managing agents
 * is the Agents section's job, DEV-11). Its pill only exists while at least
 * one agent runs: an empty scope makes the window open a shell to fill
 * itself, which would make no sense here.
 */
export function ScopeSwitcher() {
  const scope = useTerminalLayoutStore((s) => s.doc.window.scope);
  const win = useTerminalLayoutStore((s) => s.doc.window);
  const tabs = win.tabs;
  const setScope = useTerminalLayoutStore((s) => s.setScope);
  const projects = useAppStore((s) => s.projects);
  const agentCount = useAgentTabCount(win);

  // Last agent gone: fall back to Global rather than leave the window on a
  // scope that can no longer hold anything.
  useEffect(() => {
    if (isAgentsScope(scope) && agentCount === 0) setScope('global');
  }, [scope, agentCount, setScope]);

  const currentId = typeof scope === 'string' ? null : scope.projectId;

  // Projects with at least one tab, in project order.
  const withTabs = useMemo(() => {
    const ids = new Set(tabs.map((t) => projectIdOfWorkspace(t.workspaceId)).filter((id): id is string => !!id));
    return projects.filter((p) => ids.has(p.id));
  }, [tabs, projects]);

  // A scoped project without tabs still deserves its pill while selected.
  const active = useMemo(() => {
    if (currentId && !withTabs.some((p) => p.id === currentId)) {
      const current = projects.find((p) => p.id === currentId);
      return current ? [...withTabs, current] : withTabs;
    }
    return withTabs;
  }, [withTabs, currentId, projects]);

  // Tabs per project, for the menu.
  const tabCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tabs) {
      const id = projectIdOfWorkspace(t.workspaceId);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [tabs]);

  // At most MAX_PROJECT_PILLS on the bar, in project order, the current one
  // always among them (it takes the last seat when it would be out of sight).
  const pills = useMemo(() => {
    if (active.length <= MAX_PROJECT_PILLS) return active;
    const shown = active.slice(0, MAX_PROJECT_PILLS);
    if (currentId && !shown.some((p) => p.id === currentId)) {
      const current = active.find((p) => p.id === currentId);
      if (current) shown[MAX_PROJECT_PILLS - 1] = current;
    }
    return shown;
  }, [active, currentId]);

  const pillClass = (active: boolean) =>
    cn(
      'flex h-5 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium transition-colors',
      active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
    );

  // The project pills that do not fit: the row wraps them onto a second line,
  // clipped, and they are reached through the "…" menu (which lists every
  // project anyway). Measured, so the menu can say how many are out of sight
  // and light up when the current scope is one of them.
  const rowRef = useRef<HTMLDivElement>(null);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      const items = Array.from(row.children) as HTMLElement[];
      const top = items[0]?.offsetTop ?? 0;
      const next = items.filter((el) => el.offsetTop > top).map((el) => el.dataset.projectId ?? '');
      setHiddenIds((prev) => (prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [pills]);
  const currentHidden = !!currentId && hiddenIds.includes(currentId);
  // Active projects without a visible pill: over the cap, or squeezed out by
  // a narrow window.
  const overflow = useMemo(
    () => active.filter((p) => !pills.some((q) => q.id === p.id) || hiddenIds.includes(p.id)),
    [active, pills, hiddenIds]
  );

  return (
    <div className="flex h-6 min-w-0 max-w-[min(100%,560px)] items-center gap-0.5 rounded-full border border-border bg-card/50 p-0.5">
      <button type="button" className={cn(pillClass(scope === 'global'), 'shrink-0')} onClick={() => setScope('global')} title="Every terminal">
        <Globe className="size-3" />
        Global
      </button>
      {(agentCount > 0 || isAgentsScope(scope)) && (
        <button
          type="button"
          className={cn(pillClass(isAgentsScope(scope)), 'shrink-0')}
          onClick={() => setScope(AGENTS_SCOPE)}
          title="Only the sessions an agent is running in"
        >
          <Bot className="size-3" />
          Agents
          <span className="tabular-nums opacity-60">{agentCount}</span>
        </button>
      )}
      {pills.length > 0 && (
        <div ref={rowRef} className="flex h-5 min-w-0 shrink flex-wrap items-center gap-0.5 overflow-hidden">
          {pills.map((p) => (
            <button
              key={p.id}
              type="button"
              data-project-id={p.id}
              className={cn(pillClass(currentId === p.id), 'max-w-[120px] shrink-0')}
              onClick={() => setScope({ projectId: p.id })}
              title={p.rootPath}
              tabIndex={hiddenIds.includes(p.id) ? -1 : undefined}
            >
              <ProjectDot projectId={p.id} />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'flex h-5 min-w-5 shrink-0 items-center justify-center gap-0.5 rounded-full px-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none aria-expanded:bg-accent aria-expanded:text-foreground',
            currentHidden && 'bg-accent text-foreground'
          )}
          aria-label={overflow.length > 0 ? `Scope to a project (${overflow.length} more active)` : 'Scope to a project'}
          title={
            overflow.length > 0
              ? `${overflow.length} more active project${overflow.length === 1 ? '' : 's'}: ${overflow.map((p) => p.name).join(', ')}`
              : 'Scope to a project'
          }
        >
          <Ellipsis className="size-3.5" />
          {overflow.length > 0 && <span className="text-[10px] tabular-nums">+{overflow.length}</span>}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="max-h-[70vh] min-w-52 overflow-y-auto">
          <DropdownMenuLabel>Scope</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setScope('global')}>
            <Globe />
            Global
            {scope === 'global' && <Check className="ml-auto size-3.5 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={agentCount === 0} onClick={() => setScope(AGENTS_SCOPE)}>
            <Bot />
            Agents
            <span className="ml-auto flex items-center gap-2">
              <span className="text-xs tabular-nums opacity-70">{agentCount}</span>
              {isAgentsScope(scope) && <Check className="size-3.5 text-primary" />}
            </span>
          </DropdownMenuItem>
          {overflow.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>More active</DropdownMenuLabel>
              {overflow.map((p) => (
                <DropdownMenuItem key={`active-${p.id}`} onClick={() => setScope({ projectId: p.id })}>
                  <ProjectDot projectId={p.id} className="ml-1 mr-1" />
                  <span className="truncate">{p.name}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-xs tabular-nums opacity-70">{tabCounts.get(p.id) ?? 0}</span>
                    {currentId === p.id && <Check className="size-3.5 text-primary" />}
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>All projects</DropdownMenuLabel>
          {projects.length === 0 && <div className="px-2.5 py-2 text-xs text-faint">No project yet</div>}
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => setScope({ projectId: p.id })}>
              <ProjectDot projectId={p.id} className="ml-1 mr-1" />
              <span className="truncate">{p.name}</span>
              {currentId === p.id && <Check className="ml-auto size-3.5 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
