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
        <Button variant="ghost" size="sm" className="text-muted-foreground" title="Provider status">
          {indexing ? <Loader2 className="size-4 animate-spin" /> : <Activity className={cn('size-4', anyProblem && 'text-amber-500')} />}
          {indexing ? 'Indexing…' : 'Status'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3 space-y-3 text-xs">
        {!health && <p className="text-muted-foreground">Status not available yet.</p>}
        {health?.providers.map((p) => (
          <div key={p.provider} className="space-y-1">
            <div className="flex items-center gap-2">
              {p.detected
                ? <CheckCircle2 className="size-3.5 text-emerald-500" />
                : <XCircle className={cn('size-3.5', p.enabled ? 'text-amber-500' : 'text-muted-foreground')} />}
              <span className="font-medium">{PROVIDER_LABEL[p.provider]}</span>
              {p.version && <span className="text-muted-foreground">v{p.version}</span>}
              {!p.enabled && <span className="text-muted-foreground">(disabled)</span>}
            </div>
            <p className="font-mono text-[11px] text-muted-foreground break-all pl-5" title={p.rootPath}>{p.rootPath}</p>
            <p className="text-muted-foreground pl-5">
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
          <p className="text-muted-foreground border-t pt-2">
            {health.indexing ? 'Indexing transcripts in the background…' : health.lastScanAt ? `Last scan ${formatRelativeTime(health.lastScanAt)}` : 'No scan yet'}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
