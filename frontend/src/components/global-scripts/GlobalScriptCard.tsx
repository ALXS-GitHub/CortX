import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Play, Square, MoreVertical, FileCode, Circle, Pencil, Trash2 } from 'lucide-react';
import { cn, formatCommandDisplay } from '@/lib/utils';
import type { GlobalScript, ScriptStatus } from '@/types';

interface GlobalScriptCardProps {
  script: GlobalScript;
  status: ScriptStatus;
  onRun: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}

function StatusBadge({ status }: { status: ScriptStatus }) {
  switch (status) {
    case 'running':
      return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs">Running</Badge>;
    case 'completed':
      return <Badge variant="secondary" className="bg-green-500/10 text-green-600 dark:text-green-400 text-xs">Done</Badge>;
    case 'failed':
      return <Badge variant="secondary" className="bg-red-500/10 text-red-600 dark:text-red-400 text-xs">Failed</Badge>;
    default:
      return null;
  }
}

export function GlobalScriptCard({
  script,
  status,
  onRun,
  onStop,
  onEdit,
  onDelete,
  onClick,
}: GlobalScriptCardProps) {
  const isRunning = status === 'running';

  return (
    <Card className="group cursor-pointer hover:border-primary/50 transition-colors" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className="mt-1 flex-shrink-0 relative">
            <FileCode className="size-5" style={{ color: script.color || '#6b7280' }} />
            {isRunning && (
              <Circle className="absolute -top-1 -right-1 size-2 fill-blue-500 text-blue-500 animate-pulse" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium truncate">{script.name}</h3>
              <StatusBadge status={status} />
            </div>
            {script.description && (
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{script.description}</p>
            )}
            <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground font-mono">
              <p className="truncate">{formatCommandDisplay(script.command, script.scriptPath)}</p>
            </div>
            {script.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-2">
                {script.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs py-0">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className={cn('flex items-center gap-1', 'opacity-0 group-hover:opacity-100 transition-opacity')} onClick={(e) => e.stopPropagation()}>
            {isRunning ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" className="size-7" onClick={onStop}>
                    <Square className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Stop</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" className="size-7" onClick={onRun}>
                    <Play className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Run</TooltipContent>
              </Tooltip>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <MoreVertical className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="size-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="size-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
