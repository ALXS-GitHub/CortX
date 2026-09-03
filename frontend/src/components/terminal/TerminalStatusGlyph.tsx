import { Check, Loader2 } from 'lucide-react';
import { StatusDot } from '@/components/ui/StatusDot';
import { formatDuration } from '@/lib/terminalNames';
import { cn } from '@/lib/utils';
import type { TabLiveState } from './model';

/**
 * The dock's status language, in one place: a spinner while a command runs,
 * a green check / red `✕ code` pill when one finished out of view, else the
 * runtime status dot.
 */
export function TerminalStatusGlyph({ live, className }: { live: TabLiveState; className?: string }) {
  if (live.running) {
    return (
      <Loader2 className={cn('size-3 shrink-0 animate-spin text-primary', className)} aria-label="Command running" />
    );
  }
  const attention = live.attention;
  if (attention) {
    const ok = attention.exitCode == null || attention.exitCode === 0;
    return (
      <span
        className={cn(
          'flex shrink-0 items-center gap-0.5 rounded-full px-1.5 font-mono text-[10px] leading-4',
          ok ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive',
          className
        )}
        title={
          attention.command
            ? `${attention.command} finished (${ok ? 'ok' : `exit ${attention.exitCode}`}) in ${formatDuration(attention.durationMs)}`
            : undefined
        }
      >
        {ok ? <Check className="size-2.5" /> : `✕ ${attention.exitCode ?? '?'}`}
      </span>
    );
  }
  return <StatusDot status={live.status} size={7} className={className} />;
}
