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

export function ProjectCompactItem({ project, onEdit, onDelete }: ProjectCardProps) {
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
    <div
      className="flex items-center h-9 border rounded-md px-3 cursor-pointer hover:bg-muted/50 transition-colors group"
      onClick={() => selectProject(project.id)}
    >
      {/* Running indicator dot */}
      {runningCount > 0 && (
        <Circle className="size-2 fill-current text-green-500 mr-2 flex-shrink-0" />
      )}

      {/* Name */}
      <span className="font-medium truncate text-sm">{project.name}</span>

      {/* Service count badge */}
      {project.services.length > 0 && (
        <Badge variant="secondary" className="text-xs py-0 ml-2 flex-shrink-0">
          {project.services.length} service{project.services.length !== 1 ? 's' : ''}
        </Badge>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side: start button + dropdown (hover visible) */}
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleStartAll}
          disabled={project.services.length === 0}
        >
          <Play className="size-3.5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon-sm">
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
  );
}
