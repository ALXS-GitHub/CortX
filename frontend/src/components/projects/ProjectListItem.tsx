import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TagBadge } from '@/components/ui/TagBadge';
import { useAppStore } from '@/stores/appStore';
import type { Project } from '@/types';
import { Play, FolderOpen, MoreVertical, Circle, Code } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { openInExplorer, openInVscode } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ProjectCardProps {
  project: Project;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProjectListItem({ project, onEdit, onDelete }: ProjectCardProps) {
  const { selectProject, serviceRuntimes, startService, tagDefinitions } = useAppStore();

  const handleStartAll = async (e: React.MouseEvent) => {
    e.stopPropagation();
    for (const service of project.services) {
      const runtime = serviceRuntimes.get(service.id);
      if (!runtime || runtime.status === 'stopped') {
        try {
          await startService(service.id);
        } catch (error) {
          console.error(`Failed to start ${service.name}:`, error);
        }
      }
    }
  };

  const handleOpenFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    openInExplorer(project.rootPath).catch(console.error);
  };

  const handleOpenInVscode = (e: React.MouseEvent) => {
    e.stopPropagation();
    openInVscode(project.rootPath).catch((error) => {
      toast.error('Failed to open VSCode', {
        description: String(error),
      });
    });
  };

  const runningCount = project.services.filter((s) => {
    const runtime = serviceRuntimes.get(s.id);
    return runtime?.status === 'running';
  }).length;

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors group"
      onClick={() => selectProject(project.id)}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          {/* Left: name + description */}
          <div className="flex-shrink-0 w-56 min-w-0">
            <h3 className="font-medium truncate">{project.name}</h3>
            {project.description && (
              <p className="text-sm text-muted-foreground line-clamp-1">
                {project.description}
              </p>
            )}
            {project.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {project.tags.map((tag) => (
                  <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} className="text-xs py-0" />
                ))}
              </div>
            )}
          </div>

          {/* Middle: root path + service badges */}
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground truncate font-mono">
              {project.rootPath}
            </p>
            {project.services.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {project.services.map((service) => {
                  const runtime = serviceRuntimes.get(service.id);
                  const status = runtime?.status || 'stopped';
                  return (
                    <Badge
                      key={service.id}
                      variant="secondary"
                      className="text-xs gap-1 py-0"
                    >
                      <ServiceStatusDot status={status} />
                      {service.name}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: start button + dropdown */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              size="sm"
              className="gap-1.5"
              onClick={handleStartAll}
              disabled={project.services.length === 0}
            >
              <Play className="size-3.5" />
              {runningCount > 0
                ? `${runningCount}/${project.services.length}`
                : 'Start All'}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleOpenInVscode}>
                  <Code className="size-4 mr-2" />
                  Open in VSCode
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleOpenFolder}>
                  <FolderOpen className="size-4 mr-2" />
                  Open Folder
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                  Edit Project
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="text-destructive"
                >
                  Delete Project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ServiceStatusDot({ status }: { status: string }) {
  const colors = {
    stopped: 'text-muted-foreground',
    starting: 'text-yellow-500',
    running: 'text-green-500',
    error: 'text-red-500',
  };

  return (
    <Circle
      className={cn(
        'size-1.5 fill-current',
        colors[status as keyof typeof colors] || colors.stopped
      )}
    />
  );
}
