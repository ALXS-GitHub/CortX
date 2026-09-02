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
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      aria-pressed={selected}
      className={cn(
        'group cursor-pointer transition-colors hover:border-primary/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'border-primary/60 bg-muted/30',
        hidden && 'opacity-60',
      )}
    >
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start gap-2">
          <div className="flex items-center gap-2 pt-1 shrink-0">
            <AgentStateDot state={session.state} />
            <AgentProviderIcon provider={session.provider} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              {pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
              {hidden && <EyeOff className="size-3 shrink-0 text-muted-foreground" />}
              <h3 className="font-medium text-sm truncate" title={session.title}>{session.title}</h3>
            </div>
            <p className="text-xs text-muted-foreground truncate" title={session.cwd}>
              <span className={cn(!project.isProject && 'italic')}>{project.name}</span>
              {session.gitBranch && ` · ${session.gitBranch}`}
            </p>
          </div>
          <AgentActionsMenu
            session={session}
            actions={actions}
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
          />
        </div>

        <AgentLastExchange session={session} lines={2} />

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1 flex-wrap min-w-0">
            <AgentTicketChips refs={session.ticketRefs} />
            {tags.slice(0, 3).map((tag) => (
              <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} className="h-4 px-1.5 text-[10px]" />
            ))}
          </div>
          <span
            className="text-xs text-muted-foreground tabular-nums whitespace-nowrap shrink-0"
            title={formatDateTime(session.lastActivityAt)}
          >
            {formatRelativeTime(session.lastActivityAt, now)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
