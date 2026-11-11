import { AgentPhaseDot } from '@/components/terminal/TerminalStatusGlyph';
import type { AgentPhase } from '@/components/terminal/agentPhase';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AgentState } from '@/types';
import { STATE_LABEL } from './agentUtils';

/**
 * A session's state drawn in the agents' own colours (`agentColors.ts`),
 * like its terminal tab. The registry's `waiting` is a turn that ended — the
 * agent waits for your next prompt — so it is the idle ring, not an alarm:
 * "needs you" is kept for a question or a permission prompt, which only the
 * terminal side can see.
 */
const PHASE: Record<AgentState, AgentPhase> = {
  running: 'working',
  waiting: 'idle',
  stopped: 'unknown',
  unknown: 'unknown',
};

const LABEL_CLASS: Record<AgentState, string> = {
  running: 'text-[color:var(--agent-working)]',
  waiting: 'text-muted-foreground',
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
    <AgentPhaseDot phase={PHASE[state]} size={size} className={className} />
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
