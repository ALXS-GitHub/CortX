import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Script, Service, ScriptStatus } from '@/types';
import {
  Play,
  Square,
  MoreVertical,
  FileCode,
  Link2,
  Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ScriptItemProps {
  script: Script;
  services: Service[];
  onEdit: () => void;
  onDelete: () => void;
}

export function ScriptItem({ script, services, onEdit, onDelete }: ScriptItemProps) {
  const {
    scriptRuntimes,
    runScript,
    stopScript,
    setActiveTerminalScriptId,
    toggleTerminalPanel,
    terminalPanelOpen,
  } = useAppStore();

  const runtime = scriptRuntimes.get(script.id);
  const status: ScriptStatus = runtime?.status || 'idle';
  const isRunning = status === 'running';
  const hasLogs = runtime?.logs && runtime.logs.length > 0;

  const linkedServices = services.filter((s) => script.linkedServiceIds.includes(s.id));

  const handleRun = async () => {
    try {
      await runScript(script.id);
      toast.success(`Running ${script.name}`);
    } catch (error) {
      toast.error(`Failed to run ${script.name}: ${error}`);
    }
  };

  const handleStop = async () => {
    try {
      await stopScript(script.id);
      toast.success(`Stopped ${script.name}`);
    } catch (error) {
      toast.error(`Failed to stop ${script.name}: ${error}`);
    }
  };

  const handleViewLogs = () => {
    setActiveTerminalScriptId(script.id);
    if (!terminalPanelOpen) {
      toggleTerminalPanel();
    }
  };

  return (
    <Card className="group">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Icon with status indicator */}
          <div className="mt-1 flex-shrink-0 relative">
            <FileCode
              className="size-5"
              style={{ color: script.color || '#6b7280' }}
            />
            <StatusDot status={status} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">{script.name}</h3>
              <ScriptStatusBadge status={status} />
            </div>
            {script.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{script.description}</p>
            )}
            <div className="mt-1 space-y-0.5 text-xs text-muted-foreground font-mono">
              <p className="truncate">$ {script.command}</p>
              {script.scriptPath && (
                <p className="truncate">Path: {script.scriptPath}</p>
              )}
            </div>
            {linkedServices.length > 0 && (
              <div className="flex items-center gap-1 mt-2">
                <Link2 className="size-3 text-muted-foreground" />
                <div className="flex gap-1 flex-wrap">
                  {linkedServices.map((service) => (
                    <Badge key={service.id} variant="secondary" className="text-xs">
                      {service.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            {hasLogs && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" className="size-8" onClick={handleViewLogs}>
                    <Terminal className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>View output</TooltipContent>
              </Tooltip>
            )}

            {isRunning ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="destructive" size="icon" className="size-8" onClick={handleStop}>
                    <Square className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Stop script</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="default" size="icon" className="size-8" onClick={handleRun}>
                    <Play className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Run script</TooltipContent>
              </Tooltip>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 opacity-0 group-hover:opacity-100">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>Edit Script</DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  Delete Script
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusDot({ status }: { status: ScriptStatus }) {
  const colors = {
    idle: 'bg-gray-400',
    running: 'bg-blue-500 animate-pulse',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
  };

  return (
    <span
      className={cn(
        'absolute -top-0.5 -right-0.5 size-2 rounded-full',
        colors[status]
      )}
    />
  );
}

function ScriptStatusBadge({ status }: { status: ScriptStatus }) {
  const styles = {
    idle: 'bg-muted text-muted-foreground',
    running: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    completed: 'bg-green-500/10 text-green-600 dark:text-green-400',
    failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
  };

  const labels = {
    idle: 'Idle',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
  };

  return (
    <span className={cn('text-xs px-1.5 py-0.5 rounded', styles[status])}>
      {labels[status]}
    </span>
  );
}
