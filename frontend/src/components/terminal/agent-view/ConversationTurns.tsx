import { memo, useMemo, useState, type ComponentProps, type ComponentType } from 'react';
import { motion } from 'motion/react';
import {
  Bot,
  Brain,
  Check,
  ChevronRight,
  Circle,
  CircleDot,
  Copy,
  FileText,
  Globe,
  ImageIcon,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  Pencil,
  Search,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { MessageResponse } from '@/components/ai-elements/message';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import type { AgentMessage } from '@/types';
import {
  buildTurns,
  editStats,
  stepLabel,
  stepsSummary,
  type Block,
  type Step,
  type StepCategory,
  type Todo,
  type Turn,
} from './conversationModel';
import { diffLines, toolPreview } from './pendingTool';
import { MarkdownImage, PathImages, Thumbnails } from './AgentImages';
import { codeHighlighter } from './codeHighlighter';
import { dataUrl } from './agentImageStore';

const CATEGORY_ICON: Record<StepCategory, ComponentType<{ className?: string }>> = {
  read: FileText,
  edit: Pencil,
  command: SquareTerminal,
  search: Search,
  web: Globe,
  agent: Bot,
  other: Wrench,
};

const OUTPUT_LIMIT = 6000;

/**
 * A link in the agent's markdown opens in the browser. Streamdown's own asks
 * first in a modal, then calls `window.open` — which, in a webview, opens
 * the page inside CortX.
 */
function MarkdownLink({ href, children, className }: ComponentProps<'a'>) {
  const external = !!href && /^(https?:|mailto:)/i.test(href);
  return (
    <a
      href={href}
      title={href}
      className={cn('wrap-anywhere font-medium text-primary underline underline-offset-2', className)}
      onClick={(e) => {
        e.preventDefault();
        if (external) openExternal(href).catch(() => {});
      }}
    >
      {children}
    </a>
  );
}

/** Images in the agent's markdown: thumbnails, local files read from disk. */
const MARKDOWN_COMPONENTS = { img: MarkdownImage, a: MarkdownLink } as const;
const MARKDOWN_PLUGINS = { code: codeHighlighter } as const;
const NO_LINK_SAFETY = { enabled: false } as const;

/** The agent's markdown, as the Claude desktop app renders it: code highlighted, links to the browser. */
function Markdown({ text }: { text: string }) {
  return (
    <MessageResponse components={MARKDOWN_COMPONENTS} plugins={MARKDOWN_PLUGINS} linkSafety={NO_LINK_SAFETY}>
      {text}
    </MessageResponse>
  );
}

interface ConversationTurnsProps {
  messages: AgentMessage[];
  /** The agent is on a turn: the last answer is the live one. */
  live: boolean;
  /** What each running sub-agent is doing, by its Task tool call id. */
  subagents?: Record<string, string>;
}

const NO_SUBAGENTS: Record<string, string> = {};

/**
 * The conversation of the agent view (ticket CORT-62), laid out the way the
 * Claude desktop app lays one out: your messages in bubbles on the right,
 * the agent's answers as plain text across the column, its tool calls folded
 * into quiet step rows ("Read 3 files, ran a command") that open on a click,
 * its to-do list as a checklist. New turns slide in; the live answer shows
 * what the agent is doing right now.
 */
export const ConversationTurns = memo(function ConversationTurns({ messages, live, subagents = NO_SUBAGENTS }: ConversationTurnsProps) {
  const turns = useMemo(() => buildTurns(messages), [messages]);
  // Turns there on the first render appear at once; the ones that arrive
  // afterwards slide in.
  const [initial] = useState(() => new Set(turns.map((t) => t.id)));

  const lastAssistant = turns.length > 0 && turns[turns.length - 1].kind === 'assistant' ? turns[turns.length - 1].id : null;

  return (
    <>
      {turns.map((turn) => (
        <motion.div
          key={turn.id}
          initial={initial.has(turn.id) ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          <TurnView turn={turn} live={live && turn.id === lastAssistant} subagents={subagents} />
        </motion.div>
      ))}
    </>
  );
});

function TurnView({ turn, live, subagents }: { turn: Turn; live: boolean; subagents: Record<string, string> }) {
  switch (turn.kind) {
    case 'user':
      return <UserTurn turn={turn} />;
    case 'notice':
      return (
        <div className="flex items-center gap-3 py-0.5 text-[11px] text-faint">
          <span className="h-px flex-1 bg-border/70" />
          <span className="max-w-[80%] truncate whitespace-pre-wrap" title={turn.text}>
            {turn.text}
          </span>
          <span className="h-px flex-1 bg-border/70" />
        </div>
      );
    case 'assistant':
      return <AssistantTurn turn={turn} live={live} subagents={subagents} />;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function UserTurn({ turn }: { turn: Extract<Turn, { kind: 'user' }> }) {
  if (turn.command) {
    return (
      <div className="flex justify-end">
        <span className="inline-flex max-w-[85%] items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1 font-mono text-xs text-muted-foreground">
          <span className="text-primary">{turn.command.name}</span>
          {turn.command.args && <span className="truncate text-foreground">{turn.command.args}</span>}
        </span>
      </div>
    );
  }
  return (
    <div className="group/user flex flex-col items-end gap-1.5">
      <Thumbnails images={turn.pictures.map((p, i) => ({ src: dataUrl(p), alt: `Image ${i + 1}` }))} className="max-w-[85%] justify-end" />
      {(turn.text || turn.images > 0) && (
        <div className="agent-leading max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap break-words text-foreground shadow-soft">
          {turn.images > 0 && (
            <span className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
              <ImageIcon className="size-3.5" />
              {turn.images === 1 ? 'Image' : `${turn.images} images`}
            </span>
          )}
          {turn.text}
        </div>
      )}
      {turn.text && <PathImages text={turn.text} className="max-w-[85%] justify-end" />}
      <time className="pr-1 text-[10px] text-faint opacity-0 transition-opacity group-hover/user:opacity-100" dateTime={turn.timestamp}>
        {formatTime(turn.timestamp)}
      </time>
    </div>
  );
}

function AssistantTurn({
  turn,
  live,
  subagents,
}: {
  turn: Extract<Turn, { kind: 'assistant' }>;
  live: boolean;
  subagents: Record<string, string>;
}) {
  const lastIndex = turn.blocks.length - 1;
  const text = turn.blocks
    .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('\n\n');
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="group/answer flex flex-col gap-3">
      {turn.blocks.map((block, i) => (
        <BlockView key={block.key} block={block} live={live && i === lastIndex} subagents={subagents} />
      ))}
      {!live && text && (
        <div className="-mt-1 flex h-6 items-center gap-1 opacity-0 transition-opacity group-hover/answer:opacity-100">
          <button
            type="button"
            onClick={copy}
            className="grid size-6 place-items-center rounded-md text-faint hover:bg-accent hover:text-foreground"
            title="Copy the answer"
            aria-label="Copy the answer"
          >
            {copied ? <Check className="size-3.5 text-st-done" /> : <Copy className="size-3.5" />}
          </button>
          <time className="text-[10px] text-faint" dateTime={turn.timestamp}>
            {formatTime(turn.timestamp)}
          </time>
        </div>
      )}
    </div>
  );
}

function BlockView({ block, live, subagents }: { block: Block; live: boolean; subagents: Record<string, string> }) {
  switch (block.kind) {
    case 'text':
      return (
        <div className="agent-prose text-sm text-foreground">
          <Markdown text={block.text} />
          {!live && <PathImages text={block.text} className="mt-2" />}
        </div>
      );
    case 'thinking':
      return <Thinking text={block.text} live={live} />;
    case 'steps':
      return <Steps steps={block.steps} live={live} subagents={subagents} />;
    case 'todos':
      return <Todos todos={block.todos} />;
    case 'plan':
      return (
        <div className="overflow-hidden rounded-xl border border-border bg-card/80 shadow-soft">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5 text-xs">
            <ListChecks className="size-4 text-primary" />
            <span className="font-medium text-foreground">Plan</span>
            {block.result && (
              <span
                className={cn(
                  'ml-auto rounded-full px-2 py-0.5 text-[11px]',
                  block.result.isError ? 'bg-muted text-muted-foreground' : 'bg-st-done/15 text-st-done'
                )}
              >
                {block.result.isError ? 'Not approved' : 'Approved'}
              </span>
            )}
          </div>
          <div className="agent-prose max-h-[28rem] overflow-auto px-4 py-3 text-sm">
            <Markdown text={block.plan} />
          </div>
        </div>
      );
    case 'question':
      return (
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-card/70 px-4 py-3 text-sm">
          <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 space-y-1">
            {block.questions.map((q) => (
              <p key={q} className="text-foreground">
                {q}
              </p>
            ))}
            {block.answer ? (
              <p className="text-muted-foreground">
                <span className="text-faint">You answered</span> {block.answer}
              </p>
            ) : (
              block.pending && <p className="text-xs text-faint">Waiting for your answer…</p>
            )}
          </div>
        </div>
      );
  }
}

function Thinking({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group/think inline-flex items-center gap-1.5 rounded-md py-0.5 text-muted-foreground hover:text-foreground"
      >
        <Brain className="size-3.5" />
        {live ? <Shimmer as="span">Thinking…</Shimmer> : <span>Thought</span>}
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="mt-1.5 border-l-2 border-border pl-3 text-xs leading-6 whitespace-pre-wrap text-muted-foreground">{text}</div>
      )}
    </div>
  );
}

/** A run of tool calls: one row each, or folded under a summary when there are several. */
function Steps({ steps, live, subagents }: { steps: Step[]; live: boolean; subagents: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const running = live ? steps.find((s) => !s.result) ?? null : null;
  if (steps.length === 1) return <StepRow step={steps[0]} live={live} activity={subagents[steps[0].call.toolId]} />;
  const failed = steps.filter((s) => s.result?.isError).length;
  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-muted-foreground hover:text-foreground"
      >
        <span className="flex -space-x-1">
          {[...new Set(steps.map((s) => stepLabel(s.call, true).category))].slice(0, 3).map((c) => {
            const Icon = CATEGORY_ICON[c];
            return (
              <span key={c} className="grid size-4 place-items-center rounded-full bg-background ring-1 ring-border">
                <Icon className="size-2.5" />
              </span>
            );
          })}
        </span>
        <span className="truncate">{stepsSummary(steps)}</span>
        {failed > 0 && <span className="shrink-0 text-xs text-st-blocked">· {failed} failed</span>}
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open ? (
        <div className="mt-1.5 ml-2 flex flex-col gap-0.5 border-l border-border pl-3">
          {steps.map((s) => (
            <StepRow key={s.call.toolId} step={s} live={live} activity={subagents[s.call.toolId]} />
          ))}
        </div>
      ) : (
        running && (
          <div className="mt-1 ml-2 border-l border-border pl-3">
            <StepRow step={running} live activity={subagents[running.call.toolId]} />
          </div>
        )
      )}
    </div>
  );
}

function StepRow({ step, live, activity }: { step: Step; live: boolean; activity?: string }) {
  const [open, setOpen] = useState(false);
  const done = !!step.result;
  const label = stepLabel(step.call, done || !live);
  const Icon = CATEGORY_ICON[label.category];
  const stats = editStats(step.call);
  const error = step.result?.isError ?? false;
  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group/step flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 text-left text-muted-foreground hover:text-foreground"
      >
        {!done && live ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <Icon className={cn('size-3.5 shrink-0', error && 'text-st-blocked')} />
        )}
        <span className="shrink-0">{!done && live ? <Shimmer as="span">{label.verb}</Shimmer> : label.verb}</span>
        {label.target && (
          <span className={cn('min-w-0 truncate text-foreground/90', label.mono && 'font-mono text-[0.92em]')} title={label.target}>
            {label.target}
          </span>
        )}
        {stats && (stats.added > 0 || stats.removed > 0) && (
          <span className="shrink-0 font-mono text-[11px]">
            {stats.added > 0 && <span className="text-st-done">+{stats.added}</span>}
            {stats.removed > 0 && <span className="ml-1 text-st-blocked">−{stats.removed}</span>}
          </span>
        )}
        {error && <X className="size-3.5 shrink-0 text-st-blocked" />}
        <ChevronRight className={cn('ml-auto size-3.5 shrink-0 opacity-0 transition-all group-hover/step:opacity-100', open && 'rotate-90 opacity-100')} />
      </button>
      {activity && !done && live && (
        <p className="ml-5 truncate text-xs text-faint" title={activity}>
          ↳ {activity}
        </p>
      )}
      {step.result?.images && step.result.images.length > 0 && (
        <Thumbnails
          images={step.result.images.map((img, i) => ({ src: dataUrl(img), alt: `${label.target || label.verb} · ${i + 1}` }))}
          className="mt-1.5 mb-1 ml-5"
        />
      )}
      {open && <StepDetail step={step} />}
    </div>
  );
}

function StepDetail({ step }: { step: Step }) {
  const [all, setAll] = useState(false);
  const preview = toolPreview(step.call);
  const output = step.result?.output ?? '';
  const shown = all || output.length <= OUTPUT_LIMIT ? output : output.slice(0, OUTPUT_LIMIT);
  return (
    <div className="mt-1.5 mb-2 space-y-2 overflow-hidden rounded-lg border border-border/70 bg-card/70 p-2.5">
      {preview.kind === 'command' && (
        <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-xs text-foreground">
          <span className="select-none text-faint">$ </span>
          {preview.command}
        </pre>
      )}
      {preview.kind === 'edit' && (
        <div className="max-h-80 overflow-auto rounded-md bg-muted/40 py-1 font-mono text-xs">
          <p className="truncate px-2.5 pb-1 text-faint" title={preview.path}>
            {preview.path}
          </p>
          {preview.hunks.map((hunk, i) => (
            <div key={i} className={cn(i > 0 && 'mt-1 border-t border-border/60 pt-1')}>
              {diffLines(hunk).map((line, j) => (
                <div
                  key={j}
                  className={cn(
                    'whitespace-pre-wrap break-words px-2.5',
                    line.sign === '-' ? 'bg-destructive/10 text-destructive' : 'bg-st-done/10 text-st-done'
                  )}
                >
                  <span className="mr-2 select-none opacity-60">{line.sign}</span>
                  {line.text}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {preview.kind === 'write' && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 px-2.5 py-1.5 font-mono text-xs">
          {preview.content}
        </pre>
      )}
      {(preview.kind === 'generic' || preview.kind === 'url' || preview.kind === 'question' || preview.kind === 'plan') && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
          {JSON.stringify(step.call.input, null, 2)}
        </pre>
      )}
      {step.result && preview.kind !== 'edit' && preview.kind !== 'write' && (
        <div>
          <pre
            className={cn(
              'max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md px-2.5 py-1.5 font-mono text-xs',
              step.result.isError ? 'bg-destructive/10 text-destructive' : 'bg-muted/40 text-foreground/90'
            )}
          >
            {shown || '(no output)'}
          </pre>
          {shown.length < output.length && (
            <button type="button" onClick={() => setAll(true)} className="mt-1 text-[11px] text-primary hover:underline">
              Show all ({output.length.toLocaleString()} characters)
            </button>
          )}
        </div>
      )}
      {step.result?.isError && (preview.kind === 'edit' || preview.kind === 'write') && (
        <p className="rounded-md bg-destructive/10 px-2.5 py-1.5 font-mono text-xs text-destructive">{output}</p>
      )}
    </div>
  );
}

function Todos({ todos }: { todos: Todo[] }) {
  const done = todos.filter((t) => t.status === 'completed').length;
  return (
    <div className="rounded-xl border border-border bg-card/70 px-4 py-3 shadow-soft">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <ListChecks className="size-4 text-primary" />
        <span className="font-medium text-foreground">To-do</span>
        <span className="text-faint">
          {done}/{todos.length}
        </span>
        <span className="ml-auto h-1 w-24 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${(done / Math.max(1, todos.length)) * 100}%` }} />
        </span>
      </div>
      <ul className="space-y-1">
        {todos.map((t, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            {t.status === 'completed' ? (
              <Check className="mt-1 size-3.5 shrink-0 text-st-done" />
            ) : t.status === 'in_progress' ? (
              <CircleDot className="mt-1 size-3.5 shrink-0 animate-pulse text-primary" />
            ) : (
              <Circle className="mt-1 size-3.5 shrink-0 text-faint" />
            )}
            <span
              className={cn(
                'min-w-0 break-words',
                t.status === 'completed' && 'text-muted-foreground line-through decoration-border-strong',
                t.status === 'in_progress' && 'font-medium text-foreground'
              )}
            >
              {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
