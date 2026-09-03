import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TagBadge } from '@/components/ui/TagBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { StatusDot } from '@/components/ui/StatusDot';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { useAppStore } from '@/stores/appStore';
import type { Project } from '@/types';
import { Play, FolderOpen, MoreVertical, Code, Pencil, Trash2, Square } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProjectActions } from './useProjectActions';

interface ProjectCardProps {
  project: Project;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}

/** The "…" menu shared by the project list items. */
export function ProjectMenu({
  project,
  onEdit,
  onDelete,
  className,
}: {
  project: Project;
  onEdit: () => void;
  onDelete: () => void;
  className?: string;
}) {
  const { openFolder, openEditor } = useProjectActions(project);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon-sm" className={className} aria-label="Project actions">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={openEditor}>
          <Code />
          Open in VSCode
        </DropdownMenuItem>
        <DropdownMenuItem onClick={openFolder}>
          <FolderOpen />
          Open folder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
          <Pencil />
          Edit project
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 />
          Delete project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectCard({ project, onEdit, onDelete, onToggleFavorite }: ProjectCardProps) {
  const { selectProject, serviceRuntimes, tagDefinitions } = useAppStore();
  const { runningCount, startAll, stopAll } = useProjectActions(project);
  const total = project.services.length;
  const allRunning = total > 0 && runningCount === total;

  return (
    <Card
      interactive
      size="sm"
      className="group gap-3"
      onClick={() => selectProject(project.id)}
    >
      <div className="flex items-start gap-2 px-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {runningCount > 0 && <StatusDot tone="running" size={8} title={`${runningCount} running`} />}
            <h3 className="truncate font-display text-[15px] font-semibold tracking-tight">{project.name}</h3>
            <StatusBadge status={project.status} className="shrink-0" />
          </div>
          {project.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{project.description}</p>
          ) : (
            <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{project.rootPath}</p>
          )}
        </div>
        <FavoriteButton favorite={project.favorite} onToggle={onToggleFavorite} />
        <ProjectMenu project={project} onEdit={onEdit} onDelete={onDelete} className="opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      {(project.tags.length > 0 || total > 0) && (
        <div className="flex flex-col gap-2 px-4">
          {project.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {project.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
              ))}
            </div>
          )}
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
      )}

      <div className="mt-auto flex items-center gap-2 border-t border-border px-4 pt-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint" title={project.rootPath}>
          {total === 0 ? 'No service configured' : runningCount > 0 ? `${runningCount}/${total} running` : `${total} service${total !== 1 ? 's' : ''}`}
        </span>
        {allRunning ? (
          <Button size="sm" variant="outline" onClick={stopAll} className="text-destructive hover:text-destructive">
            <Square className="size-3.5" />
            Stop all
          </Button>
        ) : (
          <Button size="sm" onClick={startAll} disabled={total === 0} variant={runningCount > 0 ? 'outline' : 'default'}>
            <Play className="size-3.5" />
            {runningCount > 0 ? 'Start rest' : 'Start all'}
          </Button>
        )}
      </div>
    </Card>
  );
}
