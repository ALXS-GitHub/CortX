import type { ReactNode } from 'react';
import { ChevronRight, FolderPlus } from 'lucide-react';
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
    <section className="space-y-1.5">
      <div className="flex items-center gap-2 pl-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 min-w-0 flex-1 text-left rounded-md py-1 hover:text-foreground text-foreground/80 cursor-pointer"
          aria-expanded={!collapsed}
        >
          <ChevronRight className={cn('size-4 shrink-0 transition-transform', !collapsed && 'rotate-90')} />
          <span className="font-medium text-sm truncate">{group.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{group.sessions.length}</span>
          {group.runningCount > 0 && (
            <span className="text-[11px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full whitespace-nowrap">
              {group.runningCount} running
            </span>
          )}
          {group.subtitle && (
            <span className="hidden lg:inline text-xs text-muted-foreground/70 truncate font-normal" title={group.subtitle}>
              {group.subtitle}
            </span>
          )}
        </button>
        {onCreateProject && group.createFromSessionId && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs shrink-0"
            disabled={creatingProject}
            onClick={() => onCreateProject(group.createFromSessionId!)}
            title="Create a CortX project rooted at this folder (git root if any)"
          >
            <FolderPlus className="size-3.5 mr-1.5" />
            Create project from this folder
          </Button>
        )}
      </div>
      {!collapsed && <div className="pl-3">{children}</div>}
    </section>
  );
}
