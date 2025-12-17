import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Service } from '@/types';
import {
  Play,
  Square,
  Copy,
  ExternalLink,
  MoreVertical,
  Terminal,
  ChevronDown,
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
  const activeMode = runtime?.activeMode;
  const activeArgPreset = runtime?.activeArgPreset;
  const hasModes = service.modes && Object.keys(service.modes).length > 0;
  const modeNames = hasModes ? Object.keys(service.modes!) : [];
  const hasPresets = service.argPresets && Object.keys(service.argPresets).length > 0;
  const presetNames = hasPresets ? Object.keys(service.argPresets!) : [];

  // State for mode/preset selection (used when hasModes or hasPresets)
  // undefined = use default, null = explicitly none, string = use that value
  const [selectedMode, setSelectedMode] = useState<string | undefined>(service.defaultMode);
  const [selectedPreset, setSelectedPreset] = useState<string | null | undefined>(service.defaultArgPreset);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Reset selections when service changes
  useEffect(() => {
    setSelectedMode(service.defaultMode);
    setSelectedPreset(service.defaultArgPreset);
  }, [service.id, service.defaultMode, service.defaultArgPreset]);

  const handleStart = async (mode?: string, argPreset?: string) => {
    try {
      await startService(service.id, mode, argPreset);
      const labels = [mode, argPreset].filter(Boolean);
      const labelStr = labels.length > 0 ? ` (${labels.join(' + ')})` : '';
      toast.success(`Started ${service.name}${labelStr}`);
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
    : `${projectPath}/${service.workingDir.replace(/^\.\//, '')}`.replace(/\\/g, '/');

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
              <StatusBadge status={status} activeMode={activeMode} activeArgPreset={activeArgPreset} />
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
            ) : (hasModes || hasPresets) ? (
              // Has modes and/or presets - popover modal selector
              <div className="flex items-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="default"
                      size="icon-sm"
                      className="rounded-r-none border-r-0"
                      onClick={() => handleStart()}
                    >
                      <Play className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Start with defaults</TooltipContent>
                </Tooltip>
                <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="default"
                      size="icon-sm"
                      className="rounded-l-none px-1.5"
                    >
                      <ChevronDown className="size-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-56 p-3">
                    <div className="space-y-3">
                      {hasModes && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Mode</Label>
                          <Select
                            value={selectedMode || '_default'}
                            onValueChange={(v) => setSelectedMode(v === '_default' ? undefined : v)}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Select mode" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_default">Default</SelectItem>
                              {modeNames.map((name) => (
                                <SelectItem key={name} value={name}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {hasPresets && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Preset</Label>
                          <Select
                            value={selectedPreset === null ? '_none' : selectedPreset || '_default'}
                            onValueChange={(v) => setSelectedPreset(v === '_default' ? undefined : v === '_none' ? null : v)}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Select preset" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_default">Default</SelectItem>
                              <SelectItem value="_none">None</SelectItem>
                              {presetNames.map((name) => (
                                <SelectItem key={name} value={name}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          // null means "None" (pass empty string to skip default), undefined means "Default"
                          handleStart(selectedMode, selectedPreset === null ? '' : selectedPreset);
                          setPopoverOpen(false);
                        }}
                      >
                        <Play className="size-3.5 mr-2" />
                        Start
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            ) : (
              // Simple play button when no modes and no presets
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="default"
                    size="icon-sm"
                    onClick={() => handleStart()}
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

function StatusBadge({ status, activeMode, activeArgPreset }: { status: string; activeMode?: string; activeArgPreset?: string }) {
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

  const label = labels[status as keyof typeof labels] || 'Unknown';
  // Build label from mode and preset
  const activeLabels = [activeMode, activeArgPreset].filter(Boolean);
  const activeLabel = activeLabels.length > 0 && (status === 'running' || status === 'starting')
    ? ` (${activeLabels.join(' + ')})`
    : '';

  return (
    <span
      className={cn(
        'text-xs px-1.5 py-0.5 rounded',
        styles[status as keyof typeof styles] || styles.stopped
      )}
    >
      {label}{activeLabel}
    </span>
  );
}
