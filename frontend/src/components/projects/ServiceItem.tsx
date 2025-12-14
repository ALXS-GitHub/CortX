import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Service } from '@/types';
import {
  Play,
  Square,
  Copy,
  ExternalLink,
  MoreVertical,
  Terminal,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { toast } from 'sonner';

interface ServiceItemProps {
  service: Service;
  projectPath: string;
  onEdit: () => void;
  onDelete: () => void;
}

export function ServiceItem({ service, projectPath, onEdit, onDelete }: ServiceItemProps) {
  const {
    serviceRuntimes,
    startService,
    stopService,
    copyLaunchCommand,
    launchExternal,
    setActiveTerminalServiceId,
    toggleTerminalPanel,
    terminalPanelOpen,
  } = useAppStore();

  const runtime = serviceRuntimes.get(service.id);
  const status = runtime?.status || 'stopped';
  const isRunning = status === 'running';
  const isStarting = status === 'starting';

  const handleStart = async () => {
    try {
      await startService(service.id);
      toast.success(`Started ${service.name}`);
    } catch (error) {
      toast.error(`Failed to start ${service.name}: ${error}`);
    }
  };

  const handleStop = async () => {
    try {
      await stopService(service.id);
      toast.success(`Stopped ${service.name}`);
    } catch (error) {
      toast.error(`Failed to stop ${service.name}: ${error}`);
    }
  };

  const handleCopy = async () => {
    try {
      const command = await copyLaunchCommand(service.id);
      await writeText(command);
      toast.success('Copied to clipboard');
    } catch (error) {
      toast.error(`Failed to copy: ${error}`);
    }
  };

  const handleExternal = async () => {
    try {
      await launchExternal(service.id);
      toast.success(`Opened ${service.name} in external terminal`);
    } catch (error) {
      toast.error(`Failed to launch: ${error}`);
    }
  };

  const handleViewLogs = () => {
    setActiveTerminalServiceId(service.id);
    if (!terminalPanelOpen) {
      toggleTerminalPanel();
    }
  };

  const fullPath = service.workingDir === '.' || !service.workingDir
    ? projectPath
    : `${projectPath}/${service.workingDir}`.replace(/\\/g, '/');

  return (
    <Card className="group">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Status indicator */}
          <div
            className="mt-1.5 size-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: service.color || '#6b7280' }}
          >
            <StatusOverlay status={status} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">{service.name}</h3>
              <StatusBadge status={status} />
            </div>
            <div className="mt-1 space-y-0.5 text-xs text-muted-foreground font-mono">
              <p className="truncate">Path: {fullPath}</p>
              <p className="truncate">Command: {service.command}</p>
              {service.port && <p>Port: {service.port}</p>}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={handleCopy}
                >
                  <Copy className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy launch command</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={handleExternal}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open in external terminal</TooltipContent>
            </Tooltip>

            {isRunning || isStarting ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={handleViewLogs}
                    >
                      <Terminal className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>View logs</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      onClick={handleStop}
                      disabled={isStarting}
                    >
                      <Square className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Stop service</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="default"
                    size="icon-sm"
                    onClick={handleStart}
                  >
                    <Play className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Start service</TooltipContent>
              </Tooltip>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  Edit Service
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  Delete Service
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusOverlay({ status }: { status: string }) {
  if (status === 'running') {
    return (
      <div className="size-full rounded-full animate-pulse bg-green-500/50" />
    );
  }
  if (status === 'starting') {
    return (
      <div className="size-full rounded-full animate-pulse bg-yellow-500/50" />
    );
  }
  return null;
}

function StatusBadge({ status }: { status: string }) {
  const styles = {
    stopped: 'bg-muted text-muted-foreground',
    starting: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
    running: 'bg-green-500/10 text-green-600 dark:text-green-400',
    error: 'bg-red-500/10 text-red-600 dark:text-red-400',
  };

  const labels = {
    stopped: 'Stopped',
    starting: 'Starting',
    running: 'Running',
    error: 'Error',
  };

  return (
    <span
      className={cn(
        'text-xs px-1.5 py-0.5 rounded',
        styles[status as keyof typeof styles] || styles.stopped
      )}
    >
      {labels[status as keyof typeof labels] || 'Unknown'}
    </span>
  );
}
