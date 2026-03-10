import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Play, Square, MoreVertical, FileCode, Circle, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { TagBadge } from '@/components/ui/TagBadge';
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

export function GlobalScriptCardView({
  script,
  status,
  onRun,
  onStop,
  onEdit,
  onDelete,
  onClick,
}: GlobalScriptCardProps) {
  const { tagDefinitions } = useAppStore();
  const isRunning = status === 'running';

  return (
    <Card className="group cursor-pointer hover:border-primary/50 transition-colors h-full flex flex-col" onClick={onClick}>
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative flex-shrink-0">
              <FileCode className="size-5" style={{ color: script.color || '#6b7280' }} />
              {isRunning && (
                <Circle className="absolute -top-1 -right-1 size-2 fill-blue-500 text-blue-500 animate-pulse" />
              )}
            </div>
            <h3 className="font-medium truncate">{script.name}</h3>
          </div>
          <div
            className={cn('opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0')}
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <MoreVertical className="size-3.5" />
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
      </CardHeader>

      <CardContent className="px-4 pb-2 pt-0 flex-1 flex flex-col">
        {script.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{script.description}</p>
        )}
        <div className="mt-2 text-xs text-muted-foreground font-mono truncate">
          {script.command}
        </div>
        {script.tags.length > 0 && (
          <div className="mt-auto pt-3 flex items-center gap-1.5 flex-wrap">
            {script.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} className="text-xs py-0" />
            ))}
          </div>
        )}
      </CardContent>

      <CardFooter className="px-4 pb-4 pt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {isRunning ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="w-full" onClick={onStop}>
                <Square className="size-3.5 mr-1.5" />
                Stop
              </Button>
            </TooltipTrigger>
            <TooltipContent>Stop script</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="w-full" onClick={onRun}>
                <Play className="size-3.5 mr-1.5" />
                Run
              </Button>
            </TooltipTrigger>
            <TooltipContent>Run script</TooltipContent>
          </Tooltip>
        )}
        <StatusBadge status={status} />
      </CardFooter>
    </Card>
  );
}
