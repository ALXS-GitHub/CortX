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
  const iconBtn = prominent ? 'size-8' : 'size-6';
  const icon = prominent ? 'size-4' : 'size-3';

  return (
    <div
      className={cn('flex items-center gap-0.5 shrink-0', className)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {!compact && (
        <Button variant="ghost" size="icon" className={iconBtn} onClick={() => actions.resume(session)} title="Resume in terminal">
          <Play className={icon} />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className={iconBtn} title="More actions">
            <MoreVertical className={icon} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => actions.resume(session)}>
            <Play className="size-4 mr-2" />Resume
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.fork(session)}>
            <GitFork className="size-4 mr-2" />Fork
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.copyResumeCommand(session)}>
            <Copy className="size-4 mr-2" />Copy resume command
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => actions.togglePin(session)}>
            {pinned ? <PinOff className="size-4 mr-2" /> : <Pin className="size-4 mr-2" />}
            {pinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.rename(session)}>
            <Pencil className="size-4 mr-2" />Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.openFolder(session)}>
            <FolderOpen className="size-4 mr-2" />Open folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => actions.toggleHidden(session)}>
            {hidden ? <Eye className="size-4 mr-2" /> : <EyeOff className="size-4 mr-2" />}
            {hidden ? 'Unhide' : 'Hide'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
