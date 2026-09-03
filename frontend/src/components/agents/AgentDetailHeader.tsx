import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Eye, EyeOff, FolderOpen, GitFork, Pencil, Pin, PinOff, Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import { formatDateTime, formatRelativeTime } from '@/lib/time';
import type { AgentSession } from '@/types';
import { AgentStateDot } from './AgentStateDot';
import { AgentProviderIcon } from './AgentProviderIcon';
import { AgentTicketChips } from './AgentTicketChips';
import { PROVIDER_LABEL, type AgentActionHandlers, type ProjectLabel } from './agentUtils';

interface AgentDetailHeaderProps {
  session: AgentSession;
  project: ProjectLabel;
  actions: AgentActionHandlers;
}

/** Title (editable), state/provider/project line, key facts, primary buttons. */
export function AgentDetailHeader({ session, project, actions }: AgentDetailHeaderProps) {
  const updateAgentAnnotations = useAppStore((s) => s.updateAgentAnnotations);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { pinned, hidden } = session.annotations;

  const startEdit = () => {
    setDraft(session.annotations.customName ?? session.title);
    setEditing(true);
  };

  const commitTitle = async () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === (session.annotations.customName ?? '') || (!trimmed && !session.annotations.customName)) return;
    try {
      await updateAgentAnnotations(session.id, {
        ...session.annotations,
        customName: trimmed || undefined,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      toast.error('Failed to rename session', { description: String(e) });
    }
  };

  const facts: string[] = [];
  if (session.model) facts.push(session.model);
  if (session.version) facts.push(`v${session.version}`);
  facts.push(`${session.messageCount.toLocaleString()} message${session.messageCount === 1 ? '' : 's'}`);
  if (session.subagentCount > 0) facts.push(`${session.subagentCount} subagent${session.subagentCount === 1 ? '' : 's'}`);
  if (session.kind && session.kind !== 'interactive') facts.push(session.kind);

  return (
    <div className="space-y-3">
      {/* Title */}
      <div className="flex items-start gap-2">
        {editing ? (
          <div className="flex flex-1 items-center gap-1">
            <Input
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void commitTitle(); }
                if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
              }}
              className="h-8"
              placeholder="Custom name (empty = provider title)"
            />
            <Button variant="ghost" size="icon-sm" onClick={() => void commitTitle()} title="Save"><Check /></Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setEditing(false)} title="Cancel"><X /></Button>
          </div>
        ) : (
          <>
            <h2 className="min-w-0 flex-1 break-words font-display text-base font-semibold leading-snug tracking-tight">
              {session.title}
              {session.titleSource === 'first-prompt' && (
                <span className="ml-2 align-middle text-[10px] font-normal uppercase tracking-wide text-faint">first prompt</span>
              )}
            </h2>
            <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={startEdit} title="Rename">
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn('shrink-0', pinned && 'text-warning hover:text-warning')}
              onClick={() => actions.togglePin(session)}
              title={pinned ? 'Unpin' : 'Pin'}
            >
              {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </Button>
          </>
        )}
      </div>

      {/* State · provider · project · branch */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <AgentStateDot state={session.state} withLabel />
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <AgentProviderIcon provider={session.provider} plain />
          {PROVIDER_LABEL[session.provider]}
        </span>
        <span className="max-w-full truncate text-muted-foreground" title={session.cwd}>
          <span className={cn(!project.isProject && 'italic')}>{project.name}</span>
          {session.gitBranch && <span className="font-mono text-[11px] text-faint"> · {session.gitBranch}</span>}
        </span>
        {hidden && <span className="inline-flex items-center gap-1 text-muted-foreground"><EyeOff className="size-3" />hidden</span>}
        <AgentTicketChips refs={session.ticketRefs} max={5} />
      </div>

      {facts.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {facts.join(' · ')}
          <span title={formatDateTime(session.lastActivityAt)}> · active {formatRelativeTime(session.lastActivityAt)}</span>
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => actions.resume(session)}>
          <Play />
          Resume
        </Button>
        <Button size="sm" variant="outline" onClick={() => actions.fork(session)}>
          <GitFork />
          Fork
        </Button>
        <Button size="sm" variant="outline" onClick={() => actions.copyResumeCommand(session)} title="Copy resume command">
          <Copy />
          Copy command
        </Button>
        <Button size="sm" variant="outline" onClick={() => actions.openFolder(session)} title={session.cwd}>
          <FolderOpen />
          Open folder
        </Button>
        <Button size="sm" variant="ghost" onClick={() => actions.toggleHidden(session)}>
          {hidden ? <Eye /> : <EyeOff />}
          {hidden ? 'Unhide' : 'Hide'}
        </Button>
      </div>
    </div>
  );
}
