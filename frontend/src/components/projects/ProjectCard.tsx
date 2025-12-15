import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

export function ProjectCard({ project, onEdit, onDelete }: ProjectCardProps) {
  const { selectProject, serviceRuntimes, startService } = useAppStore();

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
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{project.name}</CardTitle>
            {project.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {project.description}
              </p>
            )}
          </div>
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
      </CardHeader>

      <CardContent className="pb-2">
        <p className="text-xs text-muted-foreground truncate font-mono">
          {project.rootPath}
        </p>

        {project.services.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
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
      </CardContent>

      <CardFooter className="pt-2">
        <Button
          size="sm"
          className="w-full gap-2"
          onClick={handleStartAll}
          disabled={project.services.length === 0}
        >
          <Play className="size-3.5" />
          {runningCount > 0
            ? `Running (${runningCount}/${project.services.length})`
            : 'Start All'}
        </Button>
      </CardFooter>
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
