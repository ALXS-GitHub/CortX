import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  Copy, Eye, EyeOff, FolderOpen, GitFork, MoreVertical, Pencil, Pin, PinOff, Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentSession } from '@/types';
import type { AgentActionHandlers } from './agentUtils';

interface AgentActionsMenuProps {
  session: AgentSession;
  actions: AgentActionHandlers;
  /** Compact rows only show the "more" button. */
  compact?: boolean;
  /** Detail header: always visible, larger buttons. */
  prominent?: boolean;
  className?: string;
}

export function AgentActionsMenu({ session, actions, compact = false, prominent = false, className }: AgentActionsMenuProps) {
  const { pinned, hidden } = session.annotations;
  const size = prominent ? 'icon-sm' : 'icon-xs';

  return (
    <div
      className={cn('flex shrink-0 items-center gap-0.5', className)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {!compact && (
        <Button variant="ghost" size={size} onClick={() => actions.resume(session)} title="Resume in terminal">
          <Play />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size={size} title="More actions">
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => actions.resume(session)}>
            <Play />
            Resume
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.fork(session)}>
            <GitFork />
            Fork
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.copyResumeCommand(session)}>
            <Copy />
            Copy resume command
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => actions.togglePin(session)}>
            {pinned ? <PinOff /> : <Pin />}
            {pinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.rename(session)}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.openFolder(session)}>
            <FolderOpen />
            Open folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => actions.toggleHidden(session)}>
            {hidden ? <Eye /> : <EyeOff />}
            {hidden ? 'Unhide' : 'Hide'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
