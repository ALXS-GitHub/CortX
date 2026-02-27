import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Play, Square, MoreVertical, FileCode, Circle, Pencil, Trash2, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
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

export function GlobalScriptCompactItem({
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
    <div
      className="group flex items-center h-9 border rounded-md px-3 py-1.5 cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={onClick}
    >
      {/* Icon with running indicator */}
      <div className="relative flex-shrink-0 mr-2">
        <FileCode className="size-3.5" style={{ color: script.color || '#6b7280' }} />
        {isRunning && (
          <Circle className="absolute -top-1 -right-1 size-1.5 fill-blue-500 text-blue-500 animate-pulse" />
        )}
      </div>

      {/* Name */}
      <span className="font-medium text-sm truncate mr-2">{script.name}</span>

      {/* Status badge */}
      <StatusBadge status={status} />

      {/* Tags count */}
      {script.tags.length > 0 && (
        <div className="flex items-center gap-0.5 text-xs text-muted-foreground ml-1.5 flex-shrink-0">
          <Tag className="size-3" />
          <span>{script.tags.length}</span>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side: run/stop + dropdown (hover visible) */}
      <div
        className={cn('flex items-center gap-1 flex-shrink-0', 'opacity-0 group-hover:opacity-100 transition-opacity')}
        onClick={(e) => e.stopPropagation()}
      >
        {isRunning ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6" onClick={onStop}>
                <Square className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Stop</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6" onClick={onRun}>
                <Play className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Run</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-6">
              <MoreVertical className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4 mr-2" />Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="size-4 mr-2" />Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
