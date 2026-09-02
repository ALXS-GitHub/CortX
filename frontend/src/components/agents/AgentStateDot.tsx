import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { AgentState } from '@/types';
import { STATE_LABEL } from './agentUtils';

const DOT_CLASS: Record<AgentState, string> = {
  running: 'bg-emerald-500',
  waiting: 'bg-amber-500',
  stopped: 'bg-muted-foreground/40',
  unknown: 'bg-transparent border border-muted-foreground/50',
};

interface AgentStateDotProps {
  state: AgentState;
  /** Show the label next to the dot (detail view). */
  withLabel?: boolean;
  className?: string;
}

export function AgentStateDot({ state, withLabel = false, className }: AgentStateDotProps) {
  const dot = (
    <span className={cn('relative inline-flex size-2.5 shrink-0', className)} aria-label={STATE_LABEL[state]}>
      {state === 'running' && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
      )}
      <span className={cn('relative inline-flex size-2.5 rounded-full', DOT_CLASS[state])} />
    </span>
  );

  if (withLabel) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        {dot}
        <span className={cn(
          state === 'running' && 'text-emerald-600 dark:text-emerald-400',
          state === 'waiting' && 'text-amber-600 dark:text-amber-400',
          (state === 'stopped' || state === 'unknown') && 'text-muted-foreground',
        )}>
          {STATE_LABEL[state]}
        </span>
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{dot}</TooltipTrigger>
      <TooltipContent>{STATE_LABEL[state]}</TooltipContent>
    </Tooltip>
  );
}
