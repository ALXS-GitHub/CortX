import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusDot } from '@/components/ui/StatusDot';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TruncatedText } from '@/components/ui/TruncatedText';
import type { Script, Service, ScriptStatus } from '@/types';
import {
  Play,
  Square,
  MoreVertical,
  FileCode,
  Link2,
  Terminal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
    openTerminal,
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
    openTerminal('script', script.id);
  };

  const color = script.color || 'var(--text-faint)';

  return (
    <Card size="sm" className={cn('group py-0', isRunning && 'border-accent-border')}>
      <div className="flex items-center gap-4 px-4 py-3">
        {/* Colour tile + live state */}
        <div className="relative shrink-0">
          <span
            className="grid size-9 place-items-center rounded-[var(--rad-sm)]"
            style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
          >
            <FileCode className="size-4" />
          </span>
          <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-card">
            <StatusDot status={status} size={9} />
          </span>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <TruncatedText as="h3" className="font-display text-[15px] font-semibold tracking-tight">{script.name}</TruncatedText>
            <ScriptStatusBadge status={status} />
            {linkedServices.length > 0 && (
              <span className="flex min-w-0 items-center gap-1" title="Linked services">
                <Link2 className="size-3 shrink-0 text-faint" />
                {linkedServices.map((service) => (
                  <Badge key={service.id} variant="secondary">
                    {service.name}
                  </Badge>
                ))}
              </span>
            )}
          </div>
          {script.description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{script.description}</p>
          )}
          <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
            <span className="text-faint">cmd</span>
            <TruncatedText className="min-w-0 text-foreground/80">{script.command}</TruncatedText>
            {script.scriptPath && (
              <>
                <span className="text-faint">file</span>
                <TruncatedText className="min-w-0">{script.scriptPath}</TruncatedText>
              </>
            )}
            {script.workingDir && script.workingDir !== '.' && (
              <>
                <span className="text-faint">cwd</span>
                <TruncatedText className="min-w-0">{script.workingDir}</TruncatedText>
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          {hasLogs && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={handleViewLogs} aria-label="View output">
                  <Terminal className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>View output</TooltipContent>
            </Tooltip>
          )}

          {isRunning ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={handleStop} className="ml-1 text-destructive hover:text-destructive">
                  <Square className="size-3.5" />
                  Stop
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop script</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" className="ml-1" onClick={handleRun}>
                  <Play className="size-3.5" />
                  Run
                </Button>
              </TooltipTrigger>
              <TooltipContent>Run script</TooltipContent>
            </Tooltip>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Script actions">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil />
                Edit script
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                Delete script
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Card>
  );
}

function ScriptStatusBadge({ status }: { status: ScriptStatus }) {
  switch (status) {
    case 'running':
      return <Badge variant="info" className="shrink-0">Running</Badge>;
    case 'completed':
      return <Badge variant="success" className="shrink-0">Completed</Badge>;
    case 'failed':
      return <Badge variant="destructive" className="shrink-0">Failed</Badge>;
    default:
      return null;
  }
}
