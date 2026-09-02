import { EyeOff, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime, formatRelativeTime } from '@/lib/time';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { AgentStateDot } from './AgentStateDot';
import { AgentProviderIcon } from './AgentProviderIcon';
import { AgentActionsMenu } from './AgentActionsMenu';
import type { AgentItemProps } from './agentUtils';

/** Compact mode: dot, provider, title, project · branch, time. */
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
        'group flex items-center gap-2 h-8 px-2.5 rounded-md border cursor-pointer transition-colors',
        'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'border-primary/60 bg-muted/40',
        hidden && 'opacity-60',
      )}
    >
      <AgentStateDot state={session.state} className="size-2" />
      <AgentProviderIcon provider={session.provider} className="size-3" />
      {pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
      {hidden && <EyeOff className="size-3 shrink-0 text-muted-foreground" />}
      <TruncatedText className="text-sm flex-1 min-w-0">{session.title}</TruncatedText>
      <span className="hidden sm:block max-w-48 truncate text-xs text-muted-foreground" title={session.cwd}>
        <span className={cn(!project.isProject && 'italic')}>{project.name}</span>
        {session.gitBranch && ` · ${session.gitBranch}`}
      </span>
      <span
        className="w-14 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums whitespace-nowrap"
        title={formatDateTime(session.lastActivityAt)}
      >
        {formatRelativeTime(session.lastActivityAt, now)}
      </span>
      <AgentActionsMenu
        session={session}
        actions={actions}
        compact
        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
      />
    </div>
  );
}
