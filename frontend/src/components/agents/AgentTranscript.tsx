import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronUp, Loader2, MessageSquareOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getAgentTranscript } from '@/lib/tauri';
import type { AgentMessage, AgentState, AgentTranscriptPage } from '@/types';
import { AgentTranscriptMessage, type ToolResultPart } from './AgentTranscriptMessage';

const PAGE_SIZE = 50;

interface TranscriptState {
  messages: AgentMessage[];
  offset: number;
  total: number;
  hasMore: boolean;
}

type ScrollIntent = { type: 'none' } | { type: 'bottom' } | { type: 'keepDistance'; dist: number };

interface AgentTranscriptProps {
  sessionId: string;
  sessionState: AgentState;
  /** Bumped by the parent when `agent-sessions-changed` fires: reload the last page. */
  changeToken: number;
  /** The loaded messages, each time they change (the agent view reads the pending tool off them). */
  onMessages?: (messages: AgentMessage[]) => void;
  /** Shown after the last message (the agent view's "working" line); the list sticks to it. */
  footer?: ReactNode;
  /** Classes of the column holding the messages (the agent view centres it). */
  contentClassName?: string;
}

function toState(page: AgentTranscriptPage): TranscriptState {
  return { messages: page.messages, offset: page.offset, total: page.totalMessages, hasMore: page.hasMore };
}

/** Does this message only carry tool results (rendered inside their tool call)? */
function isToolResultOnly(m: AgentMessage): boolean {
  return m.role === 'user' && m.parts.length > 0 && m.parts.every((p) => p.type === 'tool-result');
}

/**
 * Paginated, read-only transcript. Loads the LAST page first and scrolls to the
 * bottom; "Load older" prepends while preserving the scroll position; live
 * reloads keep the position unless the user was already at the bottom.
 *
 * Mount with `key={sessionId}` so switching sessions starts fresh.
 * Default export so the sheet can lazy-load it (streamdown/shiki are heavy).
 */
export default function AgentTranscript({
  sessionId,
  sessionState,
  changeToken,
  onMessages,
  footer,
  contentClassName,
}: AgentTranscriptProps) {
  const [state, setState] = useState<TranscriptState | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<ScrollIntent>({ type: 'bottom' });
  // Mirror of `state` for effects that must not re-run on every page change.
  const stateRef = useRef<TranscriptState | null>(null);
  useEffect(() => { stateRef.current = state; }, [state]);
  const onMessagesRef = useRef(onMessages);
  useEffect(() => { onMessagesRef.current = onMessages; }, [onMessages]);
  useEffect(() => {
    if (state) onMessagesRef.current?.(state.messages);
  }, [state]);

  // Initial load: last page.
  useEffect(() => {
    let cancelled = false;
    getAgentTranscript(sessionId, { end: null, limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        pendingScroll.current = { type: 'bottom' };
        setState(toState(page));
      })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [sessionId]);

  // Live reload: refetch what is loaded (plus a margin for new messages).
  useEffect(() => {
    if (changeToken === 0) return;
    const current = stateRef.current;
    if (!current) return;
    const el = scrollRef.current;
    const atBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 48 : true;
    const limit = Math.max(PAGE_SIZE, current.messages.length + 20);
    let cancelled = false;
    getAgentTranscript(sessionId, { end: null, limit })
      .then((page) => {
        if (cancelled) return;
        pendingScroll.current = atBottom || !el
          ? { type: 'bottom' }
          : { type: 'keepDistance', dist: el.scrollHeight - el.scrollTop };
        setState(toState(page));
      })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [changeToken, sessionId]);

  // The footer coming or going (the agent starts / stops working): stay at
  // the bottom when the list was there.
  const footerShown = footer != null && footer !== false;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 96) el.scrollTop = el.scrollHeight;
  }, [footerShown]);

  // Apply the scroll intent once the new messages are in the DOM.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !state) return;
    const intent = pendingScroll.current;
    pendingScroll.current = { type: 'none' };
    if (intent.type === 'bottom') el.scrollTop = el.scrollHeight;
    else if (intent.type === 'keepDistance') el.scrollTop = el.scrollHeight - intent.dist;
  }, [state]);

  const loadOlder = async () => {
    if (!state || !state.hasMore || loadingOlder) return;
    const el = scrollRef.current;
    setLoadingOlder(true);
    try {
      const page = await getAgentTranscript(sessionId, { end: state.offset, limit: PAGE_SIZE });
      pendingScroll.current = { type: 'keepDistance', dist: el ? el.scrollHeight - el.scrollTop : 0 };
      setState((prev) => prev
        ? { messages: [...page.messages, ...prev.messages], offset: page.offset, total: page.totalMessages, hasMore: page.hasMore }
        : toState(page));
    } catch (e) {
      toast.error('Failed to load older messages', { description: String(e) });
    } finally {
      setLoadingOlder(false);
    }
  };

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <MessageSquareOff className="size-6 text-faint" />
        <p>Could not read the transcript.</p>
        <p className="break-all font-mono text-[11px] text-faint">{error}</p>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading transcript…
      </div>
    );
  }

  const toolResults = new Map<string, ToolResultPart>();
  for (const m of state.messages) {
    for (const part of m.parts) if (part.type === 'tool-result') toolResults.set(part.toolId, part);
  }
  const visible = state.messages.filter((m) => m.parts.length > 0 && !isToolResultOnly(m));

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn('flex flex-col gap-5 p-4', contentClassName)}>
        {state.hasMore && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder ? <Loader2 className="animate-spin" /> : <ChevronUp />}
              Load older ({state.offset.toLocaleString()} more)
            </Button>
          </div>
        )}
        {state.total === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No messages in this session yet.</p>
        )}
        {visible.map((m) => (
          <AgentTranscriptMessage key={m.id} message={m} toolResults={toolResults} sessionState={sessionState} />
        ))}
        {footer}
      </div>
    </div>
  );
}
