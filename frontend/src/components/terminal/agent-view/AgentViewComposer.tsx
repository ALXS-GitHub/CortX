import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, Image as ImageIcon, Paperclip, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { cn } from '@/lib/utils';
import { AGENT_PROMPT_EVENTS, attachmentOf, draftOf, saveClipboardImage, saveDraft, type AgentAttachment, type AgentDraft } from '../agentPrompt';
import { imageMarker, visibleAttachments } from '../agentPromptParts';
import { interruptPaneAgent, sendPanePrompt } from './agentGuiStore';

export interface AgentViewComposerHandle {
  focus: () => void;
  /** Nothing typed and nothing attached (the keys may go to the agent's menu). */
  isEmpty: () => boolean;
}

interface AgentViewComposerProps {
  terminalId: string;
  agentName: string;
  cwd?: string;
  /** The agent is working: Stop instead of Send while nothing is typed. */
  working: boolean;
  /** The agent waits on a card above (a permission, a question): it gets the answer first. */
  locked: boolean;
  /** The agent's slash commands, for the completion list. */
  commands: string[];
  /** Under the field: the model, the permission mode… */
  status?: React.ReactNode;
}

/** Prompts sent from this composer, per pane, most recent last (↑ walks them). */
const sentHistory = new Map<string, string[]>();

/**
 * The composer at the bottom of the agent view, the way the Claude desktop
 * app has one. What it sends goes to the GUI agent as a stream-json user
 * message (`agentGuiStore.sendPanePrompt`): the text, the images as image
 * blocks, the files as paths. While the agent works, Send queues the prompt
 * (Claude Code takes it after the current step) and Stop / Esc interrupt it.
 * `/` opens the agent's own slash commands.
 */
export const AgentViewComposer = forwardRef<AgentViewComposerHandle, AgentViewComposerProps>(function AgentViewComposer(
  { terminalId, agentName, cwd, working, locked, commands, status },
  ref
) {
  const [draft, setDraftState] = useState<AgentDraft>(() => draftOf(terminalId));
  const [sending, setSending] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const recall = useRef(-1);

  const setDraft = useCallback(
    (next: AgentDraft | ((d: AgentDraft) => AgentDraft)) => {
      setDraftState((prev) => {
        const value = typeof next === 'function' ? next(prev) : next;
        saveDraft(terminalId, value);
        return value;
      });
    },
    [terminalId]
  );

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => fieldRef.current?.focus(),
      isEmpty: () => !draftRef.current.text.trim() && draftRef.current.attachments.length === 0,
    }),
    []
  );

  const addPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      setDraft((d) => ({
        ...d,
        attachments: [...d.attachments, ...paths.map(attachmentOf).filter((f) => !d.attachments.some((a) => a.path === f.path))],
      }));
      fieldRef.current?.focus();
    },
    [setDraft]
  );

  // Files dropped on the view (`pasteDroppedPaths` sends them to the prompt
  // of the terminal; in the agent view, that is this field).
  useEffect(() => {
    const onAttach = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.terminalId === terminalId) addPaths(detail.paths ?? []);
    };
    window.addEventListener(AGENT_PROMPT_EVENTS.attach, onAttach);
    return () => window.removeEventListener(AGENT_PROMPT_EVENTS.attach, onAttach);
  }, [terminalId, addPaths]);

  // The field grows with its text, up to a third of the window.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, Math.round(window.innerHeight / 3))}px`;
  }, [draft.text]);

  const stop = useCallback(() => void interruptPaneAgent(terminalId), [terminalId]);

  const send = async (override?: string) => {
    if (sending || locked) return;
    const value = override !== undefined ? { ...draft, text: override } : draft;
    if (!value.text.trim() && value.attachments.length === 0) return;
    setSending(true);
    try {
      const text = value.text.replace(/\[Image #\d+\]/g, '').trim();
      const ok = await sendPanePrompt(terminalId, {
        text,
        images: value.attachments.filter((a) => a.image).map((a) => a.path),
        files: value.attachments.filter((a) => !a.image).map((a) => a.path),
      });
      if (!ok) return;
      if (text) {
        const list = sentHistory.get(terminalId) ?? [];
        if (list[list.length - 1] !== text) list.push(text);
        sentHistory.set(terminalId, list.slice(-50));
      }
      recall.current = -1;
      setDraft({ text: '', attachments: [] });
    } finally {
      setSending(false);
      fieldRef.current?.focus();
    }
  };

  // Slash commands: `/` at the start, no space yet.
  const [pick, setPick] = useState(0);
  const slash = /^\/[^\s]*$/.test(draft.text) ? draft.text.slice(1).toLowerCase() : null;
  const matches = slash === null ? [] : commands.filter((c) => c.toLowerCase().startsWith(slash)).slice(0, 8);
  useEffect(() => setPick(0), [slash]);

  const pending = draft.text.trim() !== '' || draft.attachments.length > 0;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (matches.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPick((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && `/${matches[pick]}` !== draft.text)) {
        e.preventDefault();
        setDraft((d) => ({ ...d, text: `/${matches[pick]} ` }));
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      void send();
      return;
    }
    if (e.key === 'Escape' && working) {
      // As in Claude Code's own input: Esc stops the agent.
      e.preventDefault();
      stop();
      return;
    }
    // ↑ / ↓ on an empty field (or one recalled from the history) walk the
    // prompts already sent to this agent.
    const list = sentHistory.get(terminalId) ?? [];
    const field = e.currentTarget;
    const atStart = field.selectionStart === 0 && field.selectionEnd === 0;
    const recalled = recall.current >= 0 && draft.text === list[list.length - 1 - recall.current];
    if (e.key === 'ArrowUp' && list.length > 0 && (draft.text === '' || (recalled && atStart))) {
      e.preventDefault();
      recall.current = Math.min(list.length - 1, recall.current + 1);
      setDraft((d) => ({ ...d, text: list[list.length - 1 - recall.current] }));
      return;
    }
    if (e.key === 'ArrowDown' && recalled && field.selectionStart === draft.text.length) {
      e.preventDefault();
      recall.current -= 1;
      setDraft((d) => ({ ...d, text: recall.current >= 0 ? list[list.length - 1 - recall.current] : '' }));
    }
  };

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...e.clipboardData.items].filter((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (images.length === 0) return;
    e.preventDefault();
    try {
      const saved: AgentAttachment[] = [];
      for (const item of images) {
        const blob = item.getAsFile();
        if (blob) saved.push(await saveClipboardImage(blob));
      }
      setDraft((d) => ({ ...d, attachments: [...d.attachments, ...saved] }));
    } catch (error) {
      toast.error('The image could not be attached', { description: String(error) });
    }
  };

  const pickFiles = async () => {
    try {
      const picked = await openDialog({ multiple: true, directory: false, defaultPath: cwd });
      if (!picked) return;
      addPaths(Array.isArray(picked) ? picked : [picked]);
    } catch (error) {
      toast.error('Could not open the file picker', { description: String(error) });
    }
  };

  const removeAttachment = (target: AgentAttachment) =>
    setDraft((d) => ({
      text:
        target.n !== undefined
          ? d.text.split(` ${imageMarker(target.n)}`).join('').split(imageMarker(target.n)).join('')
          : d.text,
      attachments: d.attachments.filter((a) => a !== target && a.path !== target.path),
    }));
  const chips = visibleAttachments(draft.text, draft.attachments);

  const canSend = !sending && !locked && pending;
  const showStop = working && !pending;

  return (
    <div
      className={cn(
        'rounded-2xl border bg-card shadow-soft transition-colors',
        locked ? 'border-border/60 opacity-70' : 'border-border-strong focus-within:border-primary/50'
      )}
      onMouseDown={(e) => {
        // A click on the frame (not the field or a button) puts the caret in the field.
        const target = e.target as HTMLElement;
        if (target !== fieldRef.current && !target.closest('button')) {
          e.preventDefault();
          fieldRef.current?.focus();
        }
      }}
    >
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
          {chips.map((a) => (
            <span
              key={a.path}
              title={a.path}
              className="inline-flex max-w-[16rem] items-center gap-1 rounded-md border border-border bg-muted/60 py-0.5 pr-0.5 pl-1.5 text-[11px] text-muted-foreground"
            >
              {a.image ? <ImageIcon className="size-3 shrink-0" /> : <FileText className="size-3 shrink-0" />}
              <span className="truncate">{a.name}</span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => removeAttachment(a)}
                className="grid size-4 place-items-center rounded-[3px] hover:bg-accent hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {matches.length > 0 && (
        <div className="mx-2 mt-2 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-pop">
          {matches.map((c, i) => (
            <button
              key={c}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setDraft((d) => ({ ...d, text: `/${c} ` }));
                fieldRef.current?.focus();
              }}
              className={cn(
                'flex w-full items-center px-3 py-1.5 text-left font-mono text-xs',
                i === pick ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
              )}
            >
              /{c}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={fieldRef}
        value={draft.text}
        rows={1}
        disabled={locked}
        placeholder={locked ? `Answer ${agentName} above first…` : working ? `Queue a message for ${agentName}…` : `Reply to ${agentName}…`}
        onChange={(e) => {
          recall.current = -1;
          setDraft((d) => ({ ...d, text: e.target.value }));
        }}
        onKeyDown={onKeyDown}
        onPaste={(e) => void onPaste(e)}
        className="block max-h-[33vh] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm leading-6 break-words text-foreground outline-none [scrollbar-width:thin] placeholder:text-faint disabled:cursor-not-allowed"
      />
      <div className="flex items-center gap-2 px-2.5 pb-2.5">
        <button
          type="button"
          onClick={() => void pickFiles()}
          disabled={locked}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          title="Attach files or images (or paste an image, or drop files here)"
          aria-label="Attach files"
        >
          <Paperclip className="size-4" />
        </button>
        <div className="min-w-0 flex-1 truncate text-[11px] text-faint">{status}</div>
        {showStop ? (
          <button
            type="button"
            onClick={stop}
            className="grid size-7 place-items-center rounded-lg bg-foreground text-background hover:bg-foreground/85"
            title="Stop (Esc)"
            aria-label="Stop the agent"
          >
            <Square className="size-3 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            disabled={!canSend}
            onClick={() => void send()}
            className={cn(
              'grid size-7 place-items-center rounded-lg transition-colors',
              canSend ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-faint'
            )}
            title={working ? 'Send (queued until the agent is free)' : 'Send (Enter)'}
            aria-label="Send"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
});
