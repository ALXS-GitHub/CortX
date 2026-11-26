import { useState } from 'react';
import { CornerDownLeft, FileCode2, Globe, ListChecks, MessageCircleQuestion, ShieldQuestion, SquareTerminal } from 'lucide-react';
import { toast } from 'sonner';
import { MessageResponse } from '@/components/ai-elements/message';
import { cn } from '@/lib/utils';
import type { AgentMenu, AgentMenuOption } from '../agentMenu';
import { pickMenuOption } from './menuKeys';
import { diffLines, toolCardTitle, toolPreview, type ToolCall, type ToolPreview } from './pendingTool';

interface AgentViewPromptProps {
  terminalId: string;
  agentName: string;
  /** The menu on the agent's screen; null when it waits without one we can read. */
  menu: AgentMenu | null;
  /** The tool call the menu is about, from the transcript. */
  call: ToolCall | null;
  onOpenTerminal: () => void;
}

function iconFor(call: ToolCall | null) {
  switch (call?.name) {
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

/** The header chip of the question shown (AskUserQuestion's `header`). */
function questionHeader(call: ToolCall | null, title: string | null): string | null {
  if (call?.name !== 'AskUserQuestion' || !title) return null;
  const questions = (call.input as { questions?: { question?: string; header?: string }[] } | null)?.questions;
  if (!Array.isArray(questions)) return null;
  const q = questions.find((x) => typeof x.question === 'string' && x.question.trim() === title.trim());
  return q?.header ?? null;
}

function Preview({ preview }: { preview: ToolPreview }) {
  switch (preview.kind) {
    case 'command':
      return (
        <div className="space-y-1.5">
          {preview.description && <p className="text-xs text-muted-foreground">{preview.description}</p>}
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 px-3 py-2 font-mono text-xs text-foreground">
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
          <div className="max-h-64 overflow-auto rounded-md bg-muted/60 py-1.5 font-mono text-xs">
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
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 px-3 py-2 font-mono text-xs">
            {preview.content}
          </pre>
        </div>
      );
    case 'plan':
      return (
        <div className="max-h-80 overflow-auto rounded-md border border-border/60 bg-background/40 px-4 py-3 text-sm">
          <MessageResponse>{preview.plan}</MessageResponse>
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
      return preview.summary ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 px-3 py-2 font-mono text-xs">
          {preview.summary}
        </pre>
      ) : null;
    case 'question':
      return null;
  }
}

/**
 * What the agent is waiting on you for — a permission, a question, a plan —
 * as a card over the composer, the way the Claude desktop app asks it.
 *
 * The *content* comes from the transcript (the tool call: its command, its
 * diff, its plan); the *choices* come from the agent's own screen
 * (`agentMenu.ts`), so they are always the ones the agent offers, in its
 * words, and picking one sends the keys you would have typed. Keys work too:
 * 1–9 pick, ↑ ↓ Enter move and confirm (see `AgentView`).
 */
export function AgentViewPrompt({ terminalId, agentName, menu, call, onOpenTerminal }: AgentViewPromptProps) {
  const [freeText, setFreeText] = useState<{ n: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const Icon = iconFor(call);
  const preview = call ? toolPreview(call) : null;
  const header = questionHeader(call, menu?.title ?? null);
  // A menu with no tool behind it (a slash command's picker, the trust
  // prompt): its own rows say what it is about.
  const title = call ? toolCardTitle(call, agentName) : menu?.title ?? toolCardTitle(null, agentName);
  const question = call && menu?.title && menu.title !== title ? menu.title : null;

  const pick = async (option: AgentMenuOption, text?: string) => {
    if (!menu || busy) return;
    if (option.freeText && text === undefined) {
      setFreeText({ n: option.n, text: '' });
      return;
    }
    setBusy(true);
    try {
      await pickMenuOption(terminalId, menu, option, text);
      setFreeText(null);
    } catch (error) {
      toast.error('Could not answer the agent', { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-agent-view-prompt
      className="rounded-xl border border-border-strong bg-card shadow-pop"
    >
      <div className="flex items-start gap-2.5 px-4 pt-3.5">
        <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            {header && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">{header}</span>
            )}
          </div>
          {call && preview?.kind === 'generic' && (
            <p className="mt-0.5 font-mono text-[11px] text-faint">{call.name}</p>
          )}
        </div>
      </div>

      <div className="space-y-3 px-4 pt-2.5 pb-3.5">
        {preview && <Preview preview={preview} />}
        {!call && menu && menu.context.length > 0 && (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
            {menu.context.join('\n')}
          </pre>
        )}
        {question && <p className="text-sm text-foreground">{question}</p>}

        {menu ? (
          <div className="flex flex-col gap-1" role="listbox" aria-label={question ?? title}>
            {menu.options.map((option) =>
              freeText?.n === option.n ? (
                <form
                  key={option.n}
                  className="flex items-center gap-2 rounded-lg border border-primary/50 bg-background/60 px-2 py-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (freeText.text.trim()) void pick(option, freeText.text);
                  }}
                >
                  <kbd className="grid size-5 shrink-0 place-items-center rounded-[5px] border border-border bg-muted font-sans text-[11px] text-muted-foreground">
                    {option.n}
                  </kbd>
                  <input
                    autoFocus
                    value={freeText.text}
                    onChange={(e) => setFreeText({ n: option.n, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setFreeText(null);
                      }
                    }}
                    placeholder={option.label.replace(/\.$/, '') + '…'}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
                  />
                  <button
                    type="submit"
                    disabled={!freeText.text.trim() || busy}
                    className="grid size-6 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground disabled:bg-muted disabled:text-faint"
                    aria-label="Send the answer"
                  >
                    <CornerDownLeft className="size-3.5" />
                  </button>
                </form>
              ) : (
                <button
                  key={option.n}
                  type="button"
                  role="option"
                  aria-selected={option.selected}
                  disabled={busy}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void pick(option)}
                  className={cn(
                    'group/opt flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-60',
                    option.selected
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-border/70 bg-background/40 hover:border-border-strong hover:bg-accent'
                  )}
                >
                  <kbd
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded-[5px] border font-sans text-[11px]',
                      option.selected ? 'border-primary/50 bg-primary/20 text-primary' : 'border-border bg-muted text-muted-foreground'
                    )}
                  >
                    {option.n}
                  </kbd>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm text-foreground">
                      {option.checked !== null && (
                        <span
                          aria-hidden
                          className={cn(
                            'grid size-3.5 place-items-center rounded-[3px] border text-[9px]',
                            option.checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong'
                          )}
                        >
                          {option.checked ? '✓' : ''}
                        </span>
                      )}
                      <span className="break-words">{option.label}</span>
                    </span>
                    {option.detail && <span className="mt-0.5 block text-xs text-muted-foreground">{option.detail}</span>}
                  </span>
                </button>
              )
            )}
            {menu.hint && <p className="px-1 pt-1 text-[11px] text-faint">{menu.hint}</p>}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <span>{agentName} is waiting for an answer in the terminal.</span>
            <button
              type="button"
              onClick={onOpenTerminal}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-foreground hover:bg-accent"
            >
              <SquareTerminal className="size-3.5" />
              Answer in the terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
