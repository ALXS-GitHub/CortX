import { Button } from '@/components/ui/button';
import { TagBadge } from '@/components/ui/TagBadge';
import { StatusDot } from '@/components/ui/StatusDot';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { useAppStore } from '@/stores/appStore';
import type { Project } from '@/types';
import { Play, Square } from 'lucide-react';
import { ProjectMenu } from './ProjectCard';
import { useProjectActions } from './useProjectActions';

interface ProjectCardProps {
  project: Project;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}

/** One-line row; rendered inside a bordered list container by the Dashboard. */
export function ProjectCompactItem({ project, onEdit, onDelete, onToggleFavorite }: ProjectCardProps) {
  const { selectProject, tagDefinitions } = useAppStore();
  const { runningCount, startAll, stopAll } = useProjectActions(project);
  const total = project.services.length;
  const allRunning = total > 0 && runningCount === total;

  return (
    <div
      className="group flex h-10 cursor-pointer items-center gap-2 border-b border-border px-3 transition-colors last:border-b-0 hover:bg-accent/50"
      onClick={() => selectProject(project.id)}
    >
      <StatusDot tone={runningCount > 0 ? 'running' : 'idle'} size={7} className="shrink-0" />

      <TruncatedText className="min-w-0 text-sm font-medium">{project.name}</TruncatedText>

      {project.tags.length > 0 && (
        <TagBadge tag={project.tags[0]} tagDefinitions={tagDefinitions} className="shrink-0" />
      )}

      <span className="hidden min-w-0 flex-1 truncate font-mono text-[11px] text-faint md:block" title={project.rootPath}>
        {project.rootPath}
      </span>
      <span className="flex-1 md:hidden" />

      {total > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {runningCount > 0 ? `${runningCount}/${total} running` : `${total} service${total !== 1 ? 's' : ''}`}
        </span>
      )}

      <FavoriteButton favorite={project.favorite} onToggle={onToggleFavorite} size="sm" />

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {allRunning ? (
          <Button variant="ghost" size="icon-sm" onClick={stopAll} title="Stop all" className="text-destructive hover:text-destructive">
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon-sm" onClick={startAll} disabled={total === 0} title="Start all">
            <Play className="size-3.5" />
          </Button>
        )}
        <ProjectMenu project={project} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}
