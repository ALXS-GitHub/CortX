import type { ReactNode } from 'react';
import { ChevronRight, FolderPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AgentGroupData } from './agentUtils';

interface AgentGroupProps {
  group: AgentGroupData;
  collapsed: boolean;
  onToggle: () => void;
  /** "No project" buckets get a create-project button. */
  onCreateProject?: (sessionId: string) => void;
  creatingProject?: boolean;
  children: ReactNode;
}

/** Collapsible group header: name, count, running mini-count, optional actions. */
export function AgentGroup({ group, collapsed, onToggle, onCreateProject, creatingProject, children }: AgentGroupProps) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm py-1 text-left text-foreground/80 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-expanded={!collapsed}
        >
          <ChevronRight className={cn('size-4 shrink-0 text-faint transition-transform', !collapsed && 'rotate-90')} />
          <span className="truncate font-display text-sm font-semibold tracking-tight">{group.name}</span>
          <Badge variant="secondary" className="tabular-nums">{group.sessions.length}</Badge>
          {group.runningCount > 0 && (
            <Badge variant="success" className="whitespace-nowrap">{group.runningCount} running</Badge>
          )}
          {group.subtitle && (
            <span className="hidden min-w-0 truncate font-mono text-[11px] font-normal text-faint lg:inline" title={group.subtitle}>
              {group.subtitle}
            </span>
          )}
        </button>
        {onCreateProject && group.createFromSessionId && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={creatingProject}
            onClick={() => onCreateProject(group.createFromSessionId!)}
            title="Create a CortX project rooted at this folder (git root if any)"
          >
            <FolderPlus />
            Create project from this folder
          </Button>
        )}
      </div>
      {!collapsed && <div className="pl-3">{children}</div>}
    </section>
  );
}
