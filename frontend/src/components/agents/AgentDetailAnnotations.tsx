import { useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TagBadge } from '@/components/ui/TagBadge';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/time';
import type { AgentAnnotations, AgentSession } from '@/types';

const NONE = '__none__';

interface AgentDetailAnnotationsProps {
  session: AgentSession;
}

/** Collapsible "Details": identifiers, timestamps, status, tags, notes. */
export function AgentDetailAnnotations({ session }: AgentDetailAnnotationsProps) {
  const { tagDefinitions, statusDefinitions, updateAgentAnnotations } = useAppStore();
  const [open, setOpen] = useState(false);
  // null = not editing (display the stored notes)
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const ann = session.annotations;

  const patch = async (changes: Partial<AgentAnnotations>) => {
    try {
      await updateAgentAnnotations(session.id, { ...ann, ...changes, updatedAt: new Date().toISOString() });
    } catch (e) {
      toast.error('Failed to update session', { description: String(e) });
    }
  };

  const commitNotes = () => {
    if (notesDraft === null) return;
    const next = notesDraft.trim();
    setNotesDraft(null);
    if (next === (ann.notes ?? '')) return;
    void patch({ notes: next || undefined });
  };

  const allTags = Array.from(new Set([...tagDefinitions.map((t) => t.name), ...ann.tags]));
  const toggleTag = (tag: string) => {
    const tags = ann.tags.includes(tag) ? ann.tags.filter((t) => t !== tag) : [...ann.tags, tag];
    void patch({ tags });
  };
  const statuses = Array.from(new Set([...statusDefinitions.map((s) => s.name), ...(ann.status ? [ann.status] : [])]));

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        Details, tags & notes
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-3 text-xs">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          <Fact label="Session id"><CopyValue value={session.id} mono /></Fact>
          {session.pid !== undefined && <Fact label="PID"><span className="font-mono text-[11px]">{session.pid}</span></Fact>}
          <Fact label="Folder"><CopyValue value={session.cwd} mono /></Fact>
          <Fact label="Transcript"><CopyValue value={session.transcriptPath} mono /></Fact>
          <Fact label="Started">{formatDateTime(session.startedAt)}</Fact>
          <Fact label="Last activity">{formatDateTime(session.lastActivityAt)}</Fact>
        </dl>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Status</Label>
          <Select value={ann.status ?? NONE} onValueChange={(v) => void patch({ status: v === NONE ? undefined : v })}>
            <SelectTrigger size="sm" className="w-48"><SelectValue placeholder="No status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No status</SelectItem>
              {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Tags</Label>
          {allTags.length === 0 ? (
            <p className="text-muted-foreground">No tags defined yet (Settings → Tags).</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => {
                const active = ann.tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      'rounded-full transition-opacity',
                      active ? 'ring-2 ring-ring/50 ring-offset-1 ring-offset-background' : 'opacity-60 hover:opacity-100',
                    )}
                  >
                    <TagBadge tag={tag} tagDefinitions={tagDefinitions} />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-notes" className="text-xs font-medium text-muted-foreground">Notes</Label>
          <Textarea
            id="agent-notes"
            value={notesDraft ?? ann.notes ?? ''}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={commitNotes}
            placeholder="Anything worth remembering about this session…"
            className="min-h-16 text-xs"
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="whitespace-nowrap text-faint">{label}</dt>
      <dd className="min-w-0 break-all">{children}</dd>
    </>
  );
}

function CopyValue({ value, mono }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      toast.error('Failed to copy', { description: String(e) });
    }
  };
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className={cn('truncate', mono && 'font-mono text-[11px] text-muted-foreground')} title={value}>{value}</span>
      <Button variant="ghost" size="icon-xs" className="size-5 shrink-0" onClick={copy} title="Copy">
        {copied ? <Check className="size-3 text-st-done" /> : <Copy className="size-3" />}
      </Button>
    </span>
  );
}
