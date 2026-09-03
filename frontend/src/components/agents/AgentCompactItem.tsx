import { EyeOff, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime, formatRelativeTime } from '@/lib/time';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { AgentStateDot } from './AgentStateDot';
import { AgentProviderIcon } from './AgentProviderIcon';
import { AgentActionsMenu } from './AgentActionsMenu';
import type { AgentItemProps } from './agentUtils';

/** Compact mode: dot, provider, title, project · branch, time. Rendered inside a bordered list container. */
export function AgentCompactItem({ session, project, selected, onSelect, actions, now }: AgentItemProps) {
  const { pinned, hidden } = session.annotations;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      aria-pressed={selected}
      className={cn(
        'group flex h-10 cursor-pointer items-center gap-2 border-b border-border px-3 transition-colors last:border-b-0',
        'outline-none hover:bg-accent/50 focus-visible:bg-accent/50',
        selected && 'bg-accent/60',
        hidden && 'opacity-60',
      )}
    >
      <AgentStateDot state={session.state} size={7} />
      <AgentProviderIcon provider={session.provider} className="size-3" />
      {pinned && <Pin className="size-3 shrink-0 text-warning" />}
      {hidden && <EyeOff className="size-3 shrink-0 text-faint" />}
      <TruncatedText className="min-w-0 flex-1 text-sm font-medium">{session.title}</TruncatedText>
      <span className="hidden max-w-48 truncate text-xs text-muted-foreground sm:block" title={session.cwd}>
        <span className={cn(!project.isProject && 'italic')}>{project.name}</span>
        {session.gitBranch && <span className="font-mono text-[11px] text-faint"> · {session.gitBranch}</span>}
      </span>
      <span
        className="w-14 shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-faint"
        title={formatDateTime(session.lastActivityAt)}
      >
        {formatRelativeTime(session.lastActivityAt, now)}
      </span>
      <AgentActionsMenu
        session={session}
        actions={actions}
        compact
        className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      />
    </div>
  );
}
