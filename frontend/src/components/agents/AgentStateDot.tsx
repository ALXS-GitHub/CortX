import { StatusDot, type DotTone } from '@/components/ui/StatusDot';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { AgentState } from '@/types';
import { STATE_LABEL } from './agentUtils';

/** running pulses green, waiting is a solid amber dot, stopped / unknown are outlined. */
const TONE: Record<AgentState, DotTone> = {
  running: 'running',
  waiting: 'warning',
  stopped: 'idle',
  unknown: 'idle',
};

const LABEL_CLASS: Record<AgentState, string> = {
  running: 'text-st-done',
  waiting: 'text-st-progress',
  stopped: 'text-muted-foreground',
  unknown: 'text-muted-foreground',
};

interface AgentStateDotProps {
  state: AgentState;
  /** Show the label next to the dot (detail view). */
  withLabel?: boolean;
  size?: number;
  className?: string;
}

export function AgentStateDot({ state, withLabel = false, size = 9, className }: AgentStateDotProps) {
  const dot = (
    <StatusDot
      tone={TONE[state]}
      size={size}
      title={STATE_LABEL[state]}
      className={cn(state === 'unknown' && 'opacity-50', className)}
    />
  );

  if (withLabel) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        {dot}
        <span className={LABEL_CLASS[state]}>{STATE_LABEL[state]}</span>
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0">{dot}</span>
      </TooltipTrigger>
      <TooltipContent>{STATE_LABEL[state]}</TooltipContent>
    </Tooltip>
  );
}
