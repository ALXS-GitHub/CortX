import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TagBadge } from '@/components/ui/TagBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { StatusDot } from '@/components/ui/StatusDot';
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

export function ProjectListItem({ project, onEdit, onDelete, onToggleFavorite }: ProjectCardProps) {
  const { selectProject, serviceRuntimes, tagDefinitions } = useAppStore();
  const { runningCount, startAll, stopAll } = useProjectActions(project);
  const total = project.services.length;
  const allRunning = total > 0 && runningCount === total;

  return (
    <Card
      interactive
      size="sm"
      className="group py-3"
      onClick={() => selectProject(project.id)}
    >
      <div className="flex items-center gap-4 px-4">
        {/* Left: name + description */}
        <div className="w-60 min-w-0 shrink-0">
          <div className="flex items-center gap-2">
            {runningCount > 0 && <StatusDot tone="running" size={8} />}
            <h3 className="truncate font-display text-[15px] font-semibold tracking-tight">{project.name}</h3>
            <StatusBadge status={project.status} className="shrink-0" />
          </div>
          {project.description && (
            <p className="line-clamp-1 text-xs text-muted-foreground">{project.description}</p>
          )}
          {project.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {project.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
              ))}
            </div>
          )}
        </div>

        {/* Middle: root path + service pills */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="truncate font-mono text-[11px] text-faint" title={project.rootPath}>{project.rootPath}</p>
          {total > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {project.services.map((service) => {
                const status = serviceRuntimes.get(service.id)?.status || 'stopped';
                return (
                  <span
                    key={service.id}
                    className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-background/60 px-2 text-[11px] font-medium text-muted-foreground"
                  >
                    <StatusDot status={status} size={7} />
                    {service.name}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          <FavoriteButton favorite={project.favorite} onToggle={onToggleFavorite} />
          {allRunning ? (
            <Button size="sm" variant="outline" onClick={stopAll} className="text-destructive hover:text-destructive">
              <Square className="size-3.5" />
              Stop all
            </Button>
          ) : (
            <Button size="sm" variant={runningCount > 0 ? 'outline' : 'default'} onClick={startAll} disabled={total === 0}>
              <Play className="size-3.5" />
              {runningCount > 0 ? `${runningCount}/${total}` : 'Start all'}
            </Button>
          )}
          <ProjectMenu project={project} onEdit={onEdit} onDelete={onDelete} className="opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>
    </Card>
  );
}
