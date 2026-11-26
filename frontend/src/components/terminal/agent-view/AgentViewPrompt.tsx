import { useState } from 'react';
import { Check, CornerDownLeft, FileCode2, Globe, ListChecks, MessageCircleQuestion, ShieldQuestion, SquareTerminal } from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { cn } from '@/lib/utils';
import type { PermissionRequest } from './streamJson';
import { questionAnswers, setModeUpdate } from './streamJson';
import { answerPermission } from './agentGuiStore';
import { diffLines, toolCardTitle, toolPreview, type ToolPreview } from './pendingTool';

interface PermissionCardProps {
  paneKey: string;
  request: PermissionRequest;
}

function iconFor(name: string) {
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return SquareTerminal;
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return FileCode2;
    case 'ExitPlanMode':
      return ListChecks;
    case 'AskUserQuestion':
      return MessageCircleQuestion;
    case 'WebFetch':
      return Globe;
    default:
      return ShieldQuestion;
  }
}

function Preview({ preview }: { preview: ToolPreview }) {
  switch (preview.kind) {
    case 'command':
      return (
        <div className="space-y-1.5">
          {preview.description && <p className="text-xs text-muted-foreground">{preview.description}</p>}
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs text-foreground">
            <span className="select-none text-faint">$ </span>
            {preview.command}
          </pre>
        </div>
      );
    case 'edit':
      return (
        <div className="space-y-1.5">
          <p className="truncate font-mono text-xs text-muted-foreground" title={preview.path}>
            {preview.path}
          </p>
          <div className="max-h-64 overflow-auto rounded-lg bg-muted/50 py-1.5 font-mono text-xs">
            {preview.hunks.map((hunk, i) => (
              <div key={i} className={cn(i > 0 && 'mt-1.5 border-t border-border/60 pt-1.5')}>
                {diffLines(hunk).map((line, j) => (
                  <div
                    key={j}
                    className={cn(
                      'whitespace-pre-wrap break-words px-3',
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
        </div>
      );
    case 'write':
      return (
        <div className="space-y-1.5">
          <p className="truncate font-mono text-xs text-muted-foreground" title={preview.path}>
            {preview.path}
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs">
            {preview.content}
          </pre>
        </div>
      );
    case 'url':
      return (
        <div className="space-y-1">
          <p className="break-all font-mono text-xs text-foreground">{preview.url}</p>
          {preview.prompt && <p className="text-xs text-muted-foreground">{preview.prompt}</p>}
        </div>
      );
    case 'generic':
      return (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {JSON.stringify(preview.input, null, 2)}
        </pre>
      );
    default:
      return null;
  }
}

function CardFrame({ icon: Icon, title, children }: { icon: typeof ShieldQuestion; title: string; children: React.ReactNode }) {
  return (
    <div data-agent-view-prompt className="overflow-hidden rounded-2xl border border-border-strong bg-card shadow-pop">
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-1">
        <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
          <Icon className="size-3.5" />
        </span>
        <h3 className="min-w-0 text-sm font-medium text-foreground">{title}</h3>
      </div>
      <div className="space-y-3 px-4 pt-2 pb-3.5">{children}</div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  variant = 'outline',
  hint,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'outline' | 'ghost';
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors',
        variant === 'primary' && 'bg-primary text-primary-foreground shadow-soft hover:bg-primary/90',
        variant === 'outline' && 'border border-border-strong bg-background/60 text-foreground hover:bg-accent',
        variant === 'ghost' && 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      {children}
      {hint && <kbd className="font-sans text-[10px] opacity-60">{hint}</kbd>}
    </button>
  );
}

/**
 * What the agent waits on you for, as the Claude desktop app asks it: a
 * card over the composer. The request comes from Claude Code itself (the
 * `can_use_tool` control request of the stream-json protocol), and so does
 * everything it shows; the answer goes back the same way.
 */
export function PermissionCard({ paneKey, request }: PermissionCardProps) {
  if (request.toolName === 'AskUserQuestion') return <QuestionCard paneKey={paneKey} request={request} />;
  if (request.toolName === 'ExitPlanMode') return <PlanCard paneKey={paneKey} request={request} />;
  return <ToolCard paneKey={paneKey} request={request} />;
}

function ToolCard({ paneKey, request }: PermissionCardProps) {
  const preview = toolPreview({ name: request.toolName, input: request.input });
  const title = request.title ?? toolCardTitle({ name: request.toolName, input: request.input }, 'Claude');
  const canAlways = request.suggestions.length > 0 && !request.suppressAlways;
  return (
    <CardFrame icon={iconFor(request.toolName)} title={title}>
      {request.description && <p className="text-xs text-muted-foreground">{request.description}</p>}
      <Preview preview={preview} />
      {request.reason && <p className="text-[11px] text-faint">{request.reason}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-0.5">
        <ActionButton variant="ghost" onClick={() => void answerPermission(paneKey, request, { kind: 'deny', message: 'The user denied this tool call.' })}>
          Deny
        </ActionButton>
        {canAlways && (
          <ActionButton onClick={() => void answerPermission(paneKey, request, { kind: 'allow', always: true })}>Always allow</ActionButton>
        )}
        <ActionButton variant="primary" onClick={() => void answerPermission(paneKey, request, { kind: 'allow' })}>
          Allow once
        </ActionButton>
      </div>
    </CardFrame>
  );
}

interface AskQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

function questionsOf(input: unknown): AskQuestion[] {
  const list = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) return [];
  return list
    .filter((q): q is AskQuestion => !!q && typeof q === 'object' && typeof (q as AskQuestion).question === 'string')
    .map((q) => ({ ...q, options: Array.isArray(q.options) ? q.options.filter((o) => o && typeof o.label === 'string') : [] }));
}

/** AskUserQuestion: the questions with their options, answered in place. */
function QuestionCard({ paneKey, request }: PermissionCardProps) {
  const questions = questionsOf(request.input);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  const answerOf = (q: AskQuestion): string | string[] | null => {
    const free = other[q.question]?.trim();
    const chosen = picked[q.question] ?? [];
    if (q.multiSelect) {
      const all = free ? [...chosen, free] : chosen;
      return all.length > 0 ? all : null;
    }
    return free || chosen[0] || null;
  };
  const complete = questions.every((q) => answerOf(q) !== null);

  const submit = (override?: Record<string, string[]>) => {
    const answers: Record<string, string | string[]> = {};
    for (const q of questions) {
      const chosen = override?.[q.question];
      const a = chosen ? (q.multiSelect ? chosen : chosen[0]) : answerOf(q);
      if (a !== null && a !== undefined) answers[q.question] = a;
    }
    void answerPermission(paneKey, request, { kind: 'allow', updatedInput: questionAnswers(request, answers) });
  };

  const choose = (q: AskQuestion, label: string) => {
    if (q.multiSelect) {
      setPicked((p) => {
        const cur = p[q.question] ?? [];
        return { ...p, [q.question]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
      });
      return;
    }
    const next = { ...picked, [q.question]: [label] };
    setPicked(next);
    setOther((o) => ({ ...o, [q.question]: '' }));
    // One question, one choice: answered on the click, as in the desktop app.
    if (questions.length === 1) submit(next);
  };

  return (
    <CardFrame icon={MessageCircleQuestion} title={questions.length > 1 ? 'Claude has a few questions' : 'Claude has a question'}>
      {questions.map((q) => (
        <div key={q.question} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {q.header && <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">{q.header}</span>}
            <p className="text-sm text-foreground">{q.question}</p>
          </div>
          <div className="flex flex-col gap-1">
            {q.options.map((o, i) => {
              const on = (picked[q.question] ?? []).includes(o.label);
              return (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => choose(q, o.label)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors',
                    on ? 'border-primary/50 bg-primary/10' : 'border-border/70 bg-background/40 hover:border-border-strong hover:bg-accent'
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 grid size-4 shrink-0 place-items-center border text-[10px]',
                      q.multiSelect ? 'rounded-[4px]' : 'rounded-full',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong text-faint'
                    )}
                  >
                    {on ? <Check className="size-3" /> : q.multiSelect ? '' : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-foreground">{o.label}</span>
                    {o.description && <span className="mt-0.5 block text-xs text-muted-foreground">{o.description}</span>}
                  </span>
                </button>
              );
            })}
            <input
              value={other[q.question] ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setOther((o) => ({ ...o, [q.question]: v }));
                if (!q.multiSelect && v) setPicked((p) => ({ ...p, [q.question]: [] }));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && complete) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Something else…"
              className="h-9 rounded-xl border border-border/70 bg-background/40 px-3 text-sm outline-none placeholder:text-faint focus:border-primary/50"
            />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-end gap-2">
        <ActionButton
          variant="ghost"
          onClick={() => void answerPermission(paneKey, request, { kind: 'deny', message: 'The user chose not to answer.' })}
        >
          Skip
        </ActionButton>
        {(questions.length > 1 || questions.some((q) => q.multiSelect || other[q.question])) && (
          <button
            type="button"
            disabled={!complete}
            onClick={() => submit()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground shadow-soft hover:bg-primary/90 disabled:bg-muted disabled:text-faint disabled:shadow-none"
          >
            Submit
            <CornerDownLeft className="size-3.5" />
          </button>
        )}
      </div>
    </CardFrame>
  );
}

/** ExitPlanMode: the plan, to approve (and how edits go next) or to keep refining. */
function PlanCard({ paneKey, request }: PermissionCardProps) {
  const [feedback, setFeedback] = useState('');
  const plan = (request.input as { plan?: unknown } | null)?.plan;
  return (
    <CardFrame icon={ListChecks} title="Claude has a plan for you">
      {typeof plan === 'string' && plan.trim() && (
        <div className="agent-prose max-h-[24rem] overflow-auto rounded-xl border border-border/60 bg-background/40 px-4 py-3 text-sm leading-7">
          <MessageResponse>{plan}</MessageResponse>
        </div>
      )}
      <input
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Tell Claude what to change, to keep planning…"
        className="h-9 w-full rounded-xl border border-border/70 bg-background/40 px-3 text-sm outline-none placeholder:text-faint focus:border-primary/50"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ActionButton
          variant="ghost"
          onClick={() =>
            void answerPermission(paneKey, request, {
              kind: 'deny',
              message: feedback.trim() || 'The user wants to keep planning.',
            })
          }
        >
          Keep planning
        </ActionButton>
        <ActionButton onClick={() => void answerPermission(paneKey, request, { kind: 'allow', updatedPermissions: [setModeUpdate('default')] })}>
          Approve, ask before edits
        </ActionButton>
        <ActionButton
          variant="primary"
          onClick={() => void answerPermission(paneKey, request, { kind: 'allow', updatedPermissions: [setModeUpdate('acceptEdits')] })}
        >
          Approve, auto-accept edits
        </ActionButton>
      </div>
    </CardFrame>
  );
}
