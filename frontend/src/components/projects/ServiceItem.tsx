import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { TruncatedText } from '@/components/ui/TruncatedText';
import { StatusDot } from '@/components/ui/StatusDot';
import type { Service } from '@/types';
import {
  Play,
  Square,
  Copy,
  ExternalLink,
  MoreVertical,
  Terminal,
  ChevronDown,
  Pencil,
  Trash2,
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
    openTerminal,
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

  // Reset the selections when the service — or the defaults it offers —
  // changes. Adjusted **during the render** rather than from an effect: an
  // effect paints the previous service's choice first and corrects it on a
  // second pass, which is one cascading render per row of the list.
  const [defaults, setDefaults] = useState({
    id: service.id,
    mode: service.defaultMode,
    preset: service.defaultArgPreset,
  });
  if (
    defaults.id !== service.id ||
    defaults.mode !== service.defaultMode ||
    defaults.preset !== service.defaultArgPreset
  ) {
    setDefaults({ id: service.id, mode: service.defaultMode, preset: service.defaultArgPreset });
    setSelectedMode(service.defaultMode);
    setSelectedPreset(service.defaultArgPreset);
  }

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
    openTerminal('service', service.id);
  };

  const fullPath = service.workingDir === '.' || !service.workingDir
    ? projectPath
    : `${projectPath}/${service.workingDir.replace(/^\.\//, '')}`.replace(/\\/g, '/');

  const ports = runtime && runtime.detectedPorts.length > 0
    ? runtime.detectedPorts
    : service.port
      ? [service.port]
      : [];

  return (
    <Card size="sm" className={cn('group py-0', isRunning && 'border-accent-border')}>
      <div className="flex items-center gap-4 px-4 py-3">
        {/* Colour swatch + live state */}
        <div className="relative shrink-0">
          <span
            className="block size-9 rounded-[var(--rad-sm)] shadow-soft"
            style={{ backgroundColor: service.color || 'var(--text-faint)' }}
          />
          <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-card">
            <StatusDot status={status} size={9} />
          </span>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <TruncatedText as="h3" className="font-display text-[15px] font-semibold tracking-tight">{service.name}</TruncatedText>
            <RunBadge status={status} activeMode={activeMode} activeArgPreset={activeArgPreset} />
            {ports.length > 0 && (
              <span className="shrink-0 rounded-full bg-primary/12 px-2 font-mono text-[11px] leading-5 text-primary" title="Listening ports">
                {ports.map((p) => `:${p}`).join(' ')}
              </span>
            )}
          </div>
          <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
            <span className="text-faint">cmd</span>
            <TruncatedText className="min-w-0 text-foreground/80">{service.command}</TruncatedText>
            <span className="text-faint">cwd</span>
            <TruncatedText className="min-w-0">{fullPath}</TruncatedText>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={handleCopy} aria-label="Copy launch command">
                <Copy className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy launch command</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={handleExternal} aria-label="Open in external terminal">
                <ExternalLink className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open in external terminal</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={handleViewLogs} aria-label="Show terminal">
                <Terminal className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Show terminal</TooltipContent>
          </Tooltip>

          {isRunning || isStarting ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={handleStop} disabled={isStarting} className="ml-1 text-destructive hover:text-destructive">
                  <Square className="size-3.5" />
                  Stop
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop service (Ctrl+C, then kill)</TooltipContent>
            </Tooltip>
          ) : (hasModes || hasPresets) ? (
            // Has modes and/or presets - popover selector
            <div className="ml-1 flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" className="rounded-r-none" onClick={() => handleStart()}>
                    <Play className="size-3.5" />
                    Start
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Start with defaults</TooltipContent>
              </Tooltip>
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" className="rounded-l-none border-l border-l-primary-foreground/25 px-1.5" aria-label="Start with options">
                    <ChevronDown className="size-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60 gap-3 p-3">
                  {hasModes && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Mode</Label>
                      <Select
                        value={selectedMode || '_default'}
                        onValueChange={(v) => setSelectedMode(v === '_default' ? undefined : v)}
                      >
                        <SelectTrigger className="h-8 w-full">
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
                        <SelectTrigger className="h-8 w-full">
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
                    <Play className="size-3.5" />
                    Start
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
          ) : (
            <Button size="sm" className="ml-1" onClick={() => handleStart()}>
              <Play className="size-3.5" />
              Start
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Service actions">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil />
                Edit service
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                Delete service
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Card>
  );
}

function RunBadge({ status, activeMode, activeArgPreset }: { status: string; activeMode?: string; activeArgPreset?: string }) {
  const variant = status === 'running' ? 'success' : status === 'starting' ? 'warning' : status === 'error' ? 'destructive' : 'secondary';
  const labels: Record<string, string> = {
    stopped: 'Stopped',
    starting: 'Starting',
    running: 'Running',
    error: 'Error',
  };
  const label = labels[status] || 'Unknown';
  const activeLabels = [activeMode, activeArgPreset].filter(Boolean);
  const activeLabel = activeLabels.length > 0 && (status === 'running' || status === 'starting')
    ? ` · ${activeLabels.join(' + ')}`
    : '';

  return (
    <Badge variant={variant} className="shrink-0">
      {label}{activeLabel}
    </Badge>
  );
}
