import { EyeOff, Pin } from 'lucide-react';
import { Card } from '@/components/ui/card';
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
    <Card
      interactive
      size="sm"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      aria-pressed={selected}
      className={cn(
        'group py-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        selected && 'border-accent-border bg-accent/40',
        hidden && 'opacity-60',
      )}
    >
      <div className="flex h-11 items-center gap-3 px-4">
        <AgentStateDot state={session.state} />
        <AgentProviderIcon provider={session.provider} />

        {/* Title + ticket chips */}
        <div className="flex min-w-0 basis-0 flex-[1.4] items-center gap-1.5">
          {pinned && <Pin className="size-3 shrink-0 text-warning" />}
          {hidden && <EyeOff className="size-3 shrink-0 text-faint" />}
          <TruncatedText className="text-sm font-medium">{session.title}</TruncatedText>
          <AgentTicketChips refs={session.ticketRefs} />
        </div>

        {/* Project · branch */}
        <div className="hidden w-44 min-w-0 shrink-0 truncate text-xs text-muted-foreground sm:block" title={session.cwd}>
          <span className={cn(!project.isProject && 'italic')}>{project.name}</span>
          {session.gitBranch && <span className="font-mono text-[11px] text-faint"> · {session.gitBranch}</span>}
        </div>

        {/* Last exchange */}
        <div className="hidden min-w-0 basis-0 flex-1 items-center md:flex">
          <AgentLastExchange session={session} className="max-w-full" />
        </div>

        {/* Time */}
        <div
          className="w-16 shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-faint"
          title={formatDateTime(session.lastActivityAt)}
        >
          {formatRelativeTime(session.lastActivityAt, now)}
        </div>

        <AgentActionsMenu
          session={session}
          actions={actions}
          className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        />
      </div>
    </Card>
  );
}
