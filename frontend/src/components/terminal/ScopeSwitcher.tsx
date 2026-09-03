import { useMemo } from 'react';
import { Check, Ellipsis, Globe } from 'lucide-react';
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
import { projectIdOfWorkspace } from '@/lib/terminalLayout';
import { cn } from '@/lib/utils';
import { projectColor } from './model';

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
 * Title-bar pill: "Global" + one entry per project that currently owns tabs,
 * and a "…" menu listing every project so a scope can be picked before it
 * has any terminal.
 */
export function ScopeSwitcher() {
  const scope = useTerminalLayoutStore((s) => s.doc.window.scope);
  const tabs = useTerminalLayoutStore((s) => s.doc.window.tabs);
  const setScope = useTerminalLayoutStore((s) => s.setScope);
  const projects = useAppStore((s) => s.projects);

  const currentId = scope === 'global' ? null : scope.projectId;

  // Projects with at least one tab, in project order.
  const withTabs = useMemo(() => {
    const ids = new Set(tabs.map((t) => projectIdOfWorkspace(t.workspaceId)).filter((id): id is string => !!id));
    return projects.filter((p) => ids.has(p.id));
  }, [tabs, projects]);

  // A scoped project without tabs still deserves its pill while selected.
  const pills = useMemo(() => {
    if (currentId && !withTabs.some((p) => p.id === currentId)) {
      const current = projects.find((p) => p.id === currentId);
      return current ? [...withTabs, current] : withTabs;
    }
    return withTabs;
  }, [withTabs, currentId, projects]);

  const pillClass = (active: boolean) =>
    cn(
      'flex h-5 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium transition-colors',
      active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
    );

  return (
    <div className="flex h-6 max-w-[60vw] items-center gap-0.5 rounded-full border border-border bg-card/50 p-0.5">
      <button type="button" className={pillClass(scope === 'global')} onClick={() => setScope('global')} title="Every terminal">
        <Globe className="size-3" />
        Global
      </button>
      {pills.map((p) => (
        <button
          key={p.id}
          type="button"
          className={cn(pillClass(currentId === p.id), 'max-w-[160px]')}
          onClick={() => setScope({ projectId: p.id })}
          title={p.rootPath}
        >
          <ProjectDot projectId={p.id} />
          <span className="truncate">{p.name}</span>
        </button>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="grid size-5 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none aria-expanded:bg-accent aria-expanded:text-foreground"
          aria-label="Scope to a project"
          title="Scope to a project"
        >
          <Ellipsis className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-52">
          <DropdownMenuLabel>Scope</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setScope('global')}>
            <Globe />
            Global
            {scope === 'global' && <Check className="ml-auto size-3.5 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
