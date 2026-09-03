import { EyeOff, Pin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { TagBadge } from '@/components/ui/TagBadge';
import { cn } from '@/lib/utils';
import { formatDateTime, formatRelativeTime } from '@/lib/time';
import { AgentStateDot } from './AgentStateDot';
import { AgentProviderIcon } from './AgentProviderIcon';
import { AgentTicketChips } from './AgentTicketChips';
import { AgentLastExchange } from './AgentLastExchange';
import { AgentActionsMenu } from './AgentActionsMenu';
import type { AgentItemProps } from './agentUtils';

/** Card mode: same facts as the row, laid out vertically with tags. */
export function AgentCard({ session, project, selected, onSelect, actions, now, tagDefinitions }: AgentItemProps) {
  const { pinned, hidden, tags } = session.annotations;

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
        'group outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        selected && 'border-accent-border bg-accent/40',
        hidden && 'opacity-60',
      )}
    >
      <CardContent className="space-y-2">
        <div className="flex items-start gap-2">
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <AgentStateDot state={session.state} />
            <AgentProviderIcon provider={session.provider} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              {pinned && <Pin className="size-3 shrink-0 text-warning" />}
              {hidden && <EyeOff className="size-3 shrink-0 text-faint" />}
              <h3 className="truncate font-display text-sm font-semibold tracking-tight" title={session.title}>{session.title}</h3>
            </div>
            <p className="truncate text-xs text-muted-foreground" title={session.cwd}>
              <span className={cn(!project.isProject && 'italic')}>{project.name}</span>
              {session.gitBranch && <span className="font-mono text-[11px] text-faint"> · {session.gitBranch}</span>}
            </p>
          </div>
          <AgentActionsMenu
            session={session}
            actions={actions}
            className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          />
        </div>

        <AgentLastExchange session={session} lines={2} />

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <AgentTicketChips refs={session.ticketRefs} />
            {tags.slice(0, 3).map((tag) => (
              <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
            ))}
          </div>
          <span
            className="shrink-0 whitespace-nowrap text-xs tabular-nums text-faint"
            title={formatDateTime(session.lastActivityAt)}
          >
            {formatRelativeTime(session.lastActivityAt, now)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
