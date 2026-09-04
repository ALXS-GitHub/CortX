import { Check, Loader2 } from 'lucide-react';
import { StatusDot, type DotTone } from '@/components/ui/StatusDot';
import { PROVIDER_LABEL, STATE_LABEL } from '@/components/agents/agentUtils';
import { formatDuration } from '@/lib/terminalNames';
import { cn } from '@/lib/utils';
import type { AgentState, TerminalAgentInfo } from '@/types';
import type { TabLiveState } from './model';

/** Same mapping as the Agents section's `AgentStateDot` (DEV-11). */
const AGENT_TONE: Record<AgentState, DotTone> = {
  running: 'running',
  waiting: 'warning',
  stopped: 'idle',
  unknown: 'idle',
};

/**
 * What an agent tab shows instead of the plain "a command is running"
 * spinner: `claude` keeps a command running from the moment it starts, so the
 * spinner said nothing about the agent.
 *
 * The grammar is the Agents section's (DEV-11), not a new one:
 * pulsing green = working, solid amber = waiting for you, faint = at rest or
 * — for Codex, which publishes no live status — unknown.
 */
export function TerminalAgentGlyph({ agent, className }: { agent: TerminalAgentInfo; className?: string }) {
  return (
    <StatusDot
      tone={AGENT_TONE[agent.state]}
      size={7}
      title={`${PROVIDER_LABEL[agent.provider]} · ${STATE_LABEL[agent.state]}`}
      className={cn(agent.state === 'unknown' && 'opacity-50', className)}
    />
  );
}

/**
 * The dock's status language, in one place: the agent's own state when one
 * runs in the tab, else a spinner while a command runs, a green check /
 * red `✕ code` pill when one finished out of view, else the runtime dot.
 */
export function TerminalStatusGlyph({ live, className }: { live: TabLiveState; className?: string }) {
  if (live.agent) {
    return <TerminalAgentGlyph agent={live.agent} className={className} />;
  }
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
