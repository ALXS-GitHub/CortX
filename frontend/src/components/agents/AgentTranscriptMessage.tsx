import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import type { ToolUIPart } from 'ai';
import { Button } from '@/components/ui/button';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Tool, ToolContent, ToolHeader, ToolInput } from '@/components/ai-elements/tool';
import { cn } from '@/lib/utils';
import type { AgentMessage, AgentPart, AgentState } from '@/types';

export type ToolCallPart = Extract<AgentPart, { type: 'tool-call' }>;
export type ToolResultPart = Extract<AgentPart, { type: 'tool-result' }>;

interface AgentTranscriptMessageProps {
  message: AgentMessage;
  /** tool-result parts (from any message) keyed by toolId. */
  toolResults: Map<string, ToolResultPart>;
  sessionState: AgentState;
}

const OUTPUT_LIMIT = 4000;

/** Pull the most descriptive string out of a tool input for the collapsed header. */
function toolSummary(input: unknown): string | undefined {
  if (typeof input === 'string') return input.slice(0, 100);
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description', 'prompt', 'skill']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.replace(/\s+/g, ' ').trim().slice(0, 100);
  }
  return undefined;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function AgentTranscriptMessage({ message, toolResults, sessionState }: AgentTranscriptMessageProps) {
  if (message.role === 'system') {
    const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('').trim();
    if (!text) return null;
    return (
      <p className="max-w-[80%] self-center whitespace-pre-wrap break-words text-center text-xs italic text-faint">
        {text}
      </p>
    );
  }

  const isUser = message.role === 'user';

  return (
    <Message
      from={isUser ? 'user' : 'assistant'}
      className={cn(message.isSidechain && 'border-l-2 border-dashed border-border-strong pl-3')}
    >
      {message.isSidechain && (
        <span className="eyebrow">subagent</span>
      )}
      {isUser ? <UserParts parts={message.parts} /> : (
        message.parts.map((part, i) => (
          <AssistantPart key={i} part={part} toolResults={toolResults} sessionState={sessionState} />
        ))
      )}
      <time
        className={cn('text-[10px] tabular-nums text-faint', isUser && 'self-end')}
        dateTime={message.timestamp}
      >
        {formatTime(message.timestamp)}
      </time>
    </Message>
  );
}

function UserParts({ parts }: { parts: AgentPart[] }) {
  const text = parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n').trim();
  const attachments = parts.filter((p) => p.type === 'attachment');
  if (!text && attachments.length === 0) return null;
  return (
    <MessageContent>
      {text && <div className="whitespace-pre-wrap break-words text-sm">{text}</div>}
      {attachments.map((a, i) => <AttachmentLine key={i} description={a.description} />)}
    </MessageContent>
  );
}

function AssistantPart({ part, toolResults, sessionState }: { part: AgentPart; toolResults: Map<string, ToolResultPart>; sessionState: AgentState }) {
  switch (part.type) {
    case 'text':
      if (!part.text.trim()) return null;
      return (
        <MessageContent>
          <MessageResponse>{part.text}</MessageResponse>
        </MessageContent>
      );
    case 'reasoning':
      if (!part.text.trim()) return null;
      return (
        <Reasoning defaultOpen={false} isStreaming={false} className="mb-0">
          <ReasoningTrigger getThinkingMessage={() => <span>Reasoning</span>} />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case 'tool-call':
      return <ToolBlock part={part} result={toolResults.get(part.toolId)} sessionState={sessionState} />;
    case 'tool-result':
      // Results normally attach to their call; an orphan (call on an older page) is shown bare.
      return toolResults.has(part.toolId) ? null : <ToolResultOutput result={part} />;
    case 'attachment':
      return <AttachmentLine description={part.description} />;
    default:
      return null;
  }
}

function AttachmentLine({ description }: { description: string }) {
  return (
    <p className="inline-flex items-center gap-1 text-xs italic text-muted-foreground">
      <Paperclip className="size-3" />{description}
    </p>
  );
}

function ToolBlock({ part, result, sessionState }: { part: ToolCallPart; result?: ToolResultPart; sessionState: AgentState }) {
  const state: ToolUIPart['state'] = result
    ? (result.isError ? 'output-error' : 'output-available')
    : sessionState === 'running' ? 'input-available' : 'input-streaming';
  const summary = toolSummary(part.input);

  return (
    <Tool className="mb-0 bg-card/40" defaultOpen={false}>
      <ToolHeader
        type={`tool-${part.name}`}
        state={state}
        title={summary ? `${part.name} · ${summary}` : part.name}
        className="py-2 text-left [&>div>span]:truncate [&>div]:min-w-0"
      />
      <ToolContent className="space-y-3 p-3">
        <ToolInput input={part.input} />
        {result && <ToolResultOutput result={result} />}
      </ToolContent>
    </Tool>
  );
}

function ToolResultOutput({ result }: { result: ToolResultPart }) {
  const [showAll, setShowAll] = useState(false);
  const text = result.output ?? '';
  const truncated = !showAll && text.length > OUTPUT_LIMIT;

  return (
    <div className="space-y-1">
      <h4 className={cn('eyebrow', result.isError && 'text-destructive')}>
        {result.isError ? 'Error' : 'Result'}
      </h4>
      <pre
        className={cn(
          'max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-sm p-3 font-mono text-xs',
          result.isError ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-foreground',
        )}
      >
        {text ? (truncated ? text.slice(0, OUTPUT_LIMIT) : text) : '(no output)'}
      </pre>
      {truncated && (
        <Button variant="ghost" size="xs" onClick={() => setShowAll(true)}>
          Show all ({text.length.toLocaleString()} chars)
        </Button>
      )}
    </div>
  );
}
