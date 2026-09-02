import { EyeOff, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime, formatRelativeTime } from '@/lib/time';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { AgentStateDot } from './AgentStateDot';
import { AgentProviderIcon } from './AgentProviderIcon';
import { AgentTicketChips } from './AgentTicketChips';
import { AgentLastExchange } from './AgentLastExchange';
import { AgentActionsMenu } from './AgentActionsMenu';
import type { AgentItemProps } from './agentUtils';

/** List mode: one ~44px line, six facts max. */
export function AgentRow({ session, project, selected, onSelect, actions, now }: AgentItemProps) {
  const { pinned, hidden } = session.annotations;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      aria-pressed={selected}
      className={cn(
        'group flex items-center gap-3 h-11 px-3 rounded-md border cursor-pointer transition-colors',
        'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'border-primary/60 bg-muted/40',
        hidden && 'opacity-60',
      )}
    >
      <AgentStateDot state={session.state} />
      <AgentProviderIcon provider={session.provider} />

      {/* Title + ticket chips */}
      <div className="flex items-center gap-1.5 min-w-0 basis-0 flex-[1.4]">
        {pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
        {hidden && <EyeOff className="size-3 shrink-0 text-muted-foreground" />}
        <TruncatedText className="text-sm font-medium">{session.title}</TruncatedText>
        <AgentTicketChips refs={session.ticketRefs} />
      </div>

      {/* Project · branch */}
      <div className="hidden sm:block min-w-0 w-44 shrink-0 text-xs text-muted-foreground truncate" title={session.cwd}>
        <span className={cn(!project.isProject && 'italic')}>{project.name}</span>
        {session.gitBranch && <span> · {session.gitBranch}</span>}
      </div>

      {/* Last exchange */}
      <div className="hidden md:flex min-w-0 basis-0 flex-1 items-center">
        <AgentLastExchange session={session} className="max-w-full" />
      </div>

      {/* Time */}
      <div
        className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums whitespace-nowrap"
        title={formatDateTime(session.lastActivityAt)}
      >
        {formatRelativeTime(session.lastActivityAt, now)}
      </div>

      <AgentActionsMenu
        session={session}
        actions={actions}
        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
      />
    </div>
  );
}
