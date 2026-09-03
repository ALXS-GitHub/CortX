import { Activity, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/time';
import type { AgentsHealth } from '@/types';
import { PROVIDER_LABEL } from './agentUtils';

interface AgentHealthPopoverProps {
  health: AgentsHealth | null;
}

/** Provider detection status: detected / root path / counts, plus the indexing hint. */
export function AgentHealthPopover({ health }: AgentHealthPopoverProps) {
  const indexing = health?.indexing ?? false;
  const anyProblem = health?.providers.some((p) => p.enabled && !p.detected) ?? false;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" title="Provider status">
          {indexing ? <Loader2 className="animate-spin" /> : <Activity className={cn(anyProblem && 'text-warning')} />}
          {indexing ? 'Indexing…' : 'Status'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3 text-xs">
        {!health && <p className="text-muted-foreground">Status not available yet.</p>}
        {health?.providers.map((p) => (
          <div key={p.provider} className="space-y-1">
            <div className="flex items-center gap-2">
              {p.detected
                ? <CheckCircle2 className="size-3.5 text-st-done" />
                : <XCircle className={cn('size-3.5', p.enabled ? 'text-warning' : 'text-faint')} />}
              <span className="font-medium">{PROVIDER_LABEL[p.provider]}</span>
              {p.version && <span className="font-mono text-[11px] text-faint">v{p.version}</span>}
              {!p.enabled && <span className="text-faint">(disabled)</span>}
            </div>
            <p className="break-all pl-5 font-mono text-[11px] text-faint" title={p.rootPath}>{p.rootPath}</p>
            <p className="pl-5 text-muted-foreground">
              {p.detected
                ? <>
                    {p.sessionCount} session{p.sessionCount === 1 ? '' : 's'}
                    {p.liveSupported ? ` · ${p.liveCount} live` : ' · live detection is a time heuristic'}
                    {p.unreadableCount > 0 && ` · ${p.unreadableCount} unreadable`}
                  </>
                : 'Not detected — check the path in Settings.'}
            </p>
          </div>
        ))}
        {health && (
          <p className="border-t border-border pt-2 text-faint">
            {health.indexing ? 'Indexing transcripts in the background…' : health.lastScanAt ? `Last scan ${formatRelativeTime(health.lastScanAt)}` : 'No scan yet'}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
