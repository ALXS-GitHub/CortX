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
          <div className="flex-1 flex items-center gap-1">
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
            <Button variant="ghost" size="icon" className="size-8" onClick={() => void commitTitle()} title="Save"><Check className="size-4" /></Button>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(false)} title="Cancel"><X className="size-4" /></Button>
          </div>
        ) : (
          <>
            <h2 className="flex-1 min-w-0 text-base font-semibold leading-snug break-words">
              {session.title}
              {session.titleSource === 'first-prompt' && (
                <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-muted-foreground/70">first prompt</span>
              )}
            </h2>
            <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={startEdit} title="Rename">
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn('size-7 shrink-0', pinned && 'text-amber-500')}
              onClick={() => actions.togglePin(session)}
              title={pinned ? 'Unpin' : 'Pin'}
            >
              {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </Button>
          </>
        )}
      </div>

      {/* State · provider · project · branch */}
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs">
        <AgentStateDot state={session.state} withLabel />
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <AgentProviderIcon provider={session.provider} plain />
          {PROVIDER_LABEL[session.provider]}
        </span>
        <span className="text-muted-foreground truncate max-w-full" title={session.cwd}>
          <span className={cn(!project.isProject && 'italic')}>{project.name}</span>
          {session.gitBranch && ` · ${session.gitBranch}`}
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
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => actions.resume(session)}>
          <Play className="size-4" />Resume
        </Button>
        <Button size="sm" variant="outline" onClick={() => actions.fork(session)}>
          <GitFork className="size-4" />Fork
        </Button>
        <Button size="sm" variant="outline" onClick={() => actions.copyResumeCommand(session)} title="Copy resume command">
          <Copy className="size-4" />Copy command
        </Button>
        <Button size="sm" variant="outline" onClick={() => actions.openFolder(session)} title={session.cwd}>
          <FolderOpen className="size-4" />Open folder
        </Button>
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => actions.toggleHidden(session)}>
          {hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          {hidden ? 'Unhide' : 'Hide'}
        </Button>
      </div>
    </div>
  );
}
