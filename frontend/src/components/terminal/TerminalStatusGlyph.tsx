import { Check, Loader2 } from 'lucide-react';
import { StatusDot } from '@/components/ui/StatusDot';
import { AGENT_DOT_TONE, PROVIDER_LABEL, STATE_LABEL } from '@/components/agents/agentUtils';
import type { TerminalItem, TerminalType } from '@/components/layout/terminal-dnd/types';
import { formatDuration } from '@/lib/terminalNames';
import { cn } from '@/lib/utils';
import type { TerminalAgentInfo } from '@/types';
import type { TabLiveState } from './model';

/**
 * What an agent tab shows instead of the plain "a command is running"
 * spinner: `claude` keeps a command running from the moment it starts, so the
 * spinner said nothing about the agent.
 *
 * The grammar is the Agents section's (DEV-11, `AGENT_DOT_TONE`), not a new
 * one: pulsing violet = working, solid amber = waiting for you, faint = at
 * rest or — for Codex, which publishes no live status — unknown.
 */
export function TerminalAgentGlyph({ agent, className }: { agent: TerminalAgentInfo; className?: string }) {
  return (
    <StatusDot
      tone={AGENT_DOT_TONE[agent.state]}
      size={7}
      title={`${PROVIDER_LABEL[agent.provider]} · ${STATE_LABEL[agent.state]}`}
      className={cn(agent.state === 'unknown' && 'opacity-50', className)}
    />
  );
}

/** Tooltip of a terminal's runtime dot, per status. */
const RUNTIME_LABEL: Record<string, string> = {
  running: 'Running',
  starting: 'Starting',
  completed: 'Exited',
  failed: 'Exited with an error',
  error: 'Error',
  stopped: 'Stopped',
  idle: 'Idle',
};

/**
 * The dot of a terminal nothing is happening in: no agent, no command running.
 *
 * A shell whose process is alive is `running`, and used to draw the green
 * pulse of a running service — the very dot an agent at work drew, so an idle
 * prompt and a busy agent looked the same (ticket #48). A shell at its prompt
 * is at rest: a solid grey dot, no motion. Services and scripts keep the
 * runtime dot (`running` still pulses green: a dev server *is* doing
 * something).
 */
export function TerminalRuntimeDot({
  type,
  status,
  size = 7,
  className,
}: {
  type?: TerminalType;
  status?: string | null;
  size?: number;
  className?: string;
}) {
  if (type === 'shell' && status === 'running') {
    return <StatusDot tone="ready" size={size} title="Ready · no command running" className={className} />;
  }
  return (
    <StatusDot status={status ?? null} size={size} title={status ? RUNTIME_LABEL[status] : undefined} className={className} />
  );
}

/**
 * One terminal's dot where no spinner or result pill is drawn (the dock's
 * drag ghost, its hidden-terminals menu): the agent's own state when one runs
 * in it, else the runtime dot.
 */
export function TerminalItemDot({ item, className }: { item: TerminalItem; className?: string }) {
  if (item.agent) return <TerminalAgentGlyph agent={item.agent} className={className} />;
  return <TerminalRuntimeDot type={item.type} status={item.status} className={className} />;
}

/**
 * The dock's status language, in one place: the agent's own state when one
 * runs in the tab, else a spinner while a command runs, a green check /
 * red `✕ code` pill when one finished out of view, else the runtime dot
 * (quiet grey for a shell at its prompt).
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
  return <TerminalRuntimeDot type={live.type} status={live.status} className={className} />;
}
