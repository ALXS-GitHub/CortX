import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CornerDownLeft, FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '@/stores/appStore';
import { AgentProviderIcon } from '@/components/agents/AgentProviderIcon';
import { comboFromEvent, comboLabelFor, effectiveCombos } from '@/lib/keybindings';
import { focusTerminal } from '@/lib/terminalSessions';
import { cn } from '@/lib/utils';
import type { TerminalAgentInfo } from '@/types';
import { useTerminalAgent, useTerminalAgentsStore } from './agentsStore';
import { agentPhase, AGENT_PHASE_LABEL } from './agentPhase';
import { AgentPhaseDot } from './TerminalStatusGlyph';
import {
  AGENT_PROMPT_EVENTS,
  attachmentOf,
  draftOf,
  isEditorOpen,
  promptHistory,
  saveClipboardImage,
  saveDraft,
  sendAgentPrompt,
  setEditorOpen,
  type AgentAttachment,
  type AgentDraft,
} from './agentPrompt';

const PROVIDER_NAME: Record<TerminalAgentInfo['provider'], string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

function providerName(agent: TerminalAgentInfo): string {
  return PROVIDER_NAME[agent.provider] ?? 'the agent';
}

/**
 * The agent prompt docked under a terminal while an agent runs in it (see
 * `agentPrompt.ts`): a one-line toolbelt, and over the terminal's last rows
 * an editor whose prompt goes to the agent. Nothing at all while no agent
 * runs, or when the setting is off.
 */
export function AgentPromptBar({ terminalId }: { terminalId: string }) {
  const agent = useTerminalAgent(terminalId);
  const enabled = useAppStore((s) => s.settings?.terminal?.agentPromptBar !== false);
  if (!enabled || !agent) return null;
  return <AgentPromptBarInner terminalId={terminalId} agent={agent} />;
}

function AgentPromptBarInner({ terminalId, agent }: { terminalId: string; agent: TerminalAgentInfo }) {
  const keybindings = useAppStore((s) => s.settings?.terminal?.keybindings);
  const unseen = useTerminalAgentsStore((s) => s.unseen.has(terminalId));
  const phase = agentPhase(agent, unseen);
  // A permission prompt is answered in the agent's own UI (its keys pick an
  // option): the editor steps aside until it is answered.
  const blocked = agent.needsInput === 'permission';
  const name = providerName(agent);

  const [open, setOpen] = useState(() => isEditorOpen(terminalId));
  const [draft, setDraftState] = useState<AgentDraft>(() => draftOf(terminalId));
  const [sending, setSending] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
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

  const show = useCallback(
    (focus = true) => {
      setOpen(true);
      setEditorOpen(terminalId, true);
      if (focus) requestAnimationFrame(() => fieldRef.current?.focus());
    },
    [terminalId]
  );

  const hide = useCallback(() => {
    setOpen(false);
    setEditorOpen(terminalId, false);
    focusTerminal(terminalId);
  }, [terminalId]);

  const addPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      setDraft((d) => ({
        ...d,
        attachments: [...d.attachments, ...paths.filter((p) => !d.attachments.some((a) => a.path === p)).map(attachmentOf)],
      }));
      show();
    },
    [setDraft, show]
  );

  // Ctrl+G (the window's shortcut table) and drops on the bar.
  useEffect(() => {
    const onToggle = (e: Event) => {
      if ((e as CustomEvent).detail?.terminalId !== terminalId) return;
      if (open && document.activeElement === fieldRef.current) hide();
      else show();
    };
    const onAttach = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.terminalId === terminalId) addPaths(detail.paths ?? []);
    };
    window.addEventListener(AGENT_PROMPT_EVENTS.toggle, onToggle);
    window.addEventListener(AGENT_PROMPT_EVENTS.attach, onAttach);
    return () => {
      window.removeEventListener(AGENT_PROMPT_EVENTS.toggle, onToggle);
      window.removeEventListener(AGENT_PROMPT_EVENTS.attach, onAttach);
    };
  }, [terminalId, open, show, hide, addPaths]);

  // The shortcut where no window-level table answers it (the dock of the
  // main window): on the pane itself, before xterm sees the key.
  useEffect(() => {
    const pane = barRef.current?.parentElement;
    if (!pane) return;
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e);
      if (!combo || !effectiveCombos('agent.prompt', keybindings).includes(combo)) return;
      e.preventDefault();
      e.stopPropagation();
      if (open && document.activeElement === fieldRef.current) hide();
      else show();
    };
    pane.addEventListener('keydown', onKey, true);
    return () => pane.removeEventListener('keydown', onKey, true);
  }, [keybindings, open, show, hide]);

  // A permission prompt took the keyboard back to the agent.
  const wasBlocked = useRef(blocked);
  useEffect(() => {
    if (blocked && !wasBlocked.current && open && document.activeElement === fieldRef.current) focusTerminal(terminalId);
    else if (!blocked && wasBlocked.current && open && barRef.current?.parentElement?.contains(document.activeElement)) {
      fieldRef.current?.focus();
    }
    wasBlocked.current = blocked;
  }, [blocked, open, terminalId]);

  // The field grows with its text, up to a third of the window.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, Math.round(window.innerHeight / 3))}px`;
  }, [draft.text, open, blocked]);

  const send = async () => {
    if (sending) return;
    const value = draft;
    if (!value.text.trim() && value.attachments.length === 0) return;
    setSending(true);
    try {
      const ok = await sendAgentPrompt(terminalId, value);
      if (!ok) {
        toast.error('The prompt could not be sent', { description: 'The terminal is not available.' });
        return;
      }
      recall.current = -1;
      setDraft({ text: '', attachments: [] });
    } catch (error) {
      toast.error('The prompt could not be sent', { description: String(error) });
    } finally {
      setSending(false);
      fieldRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const native = e.nativeEvent;
    if (native.isComposing) return;
    const combo = comboFromEvent(native);
    if (combo && effectiveCombos('agent.prompt', keybindings).includes(combo)) {
      e.preventDefault();
      e.stopPropagation();
      hide();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      void send();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hide();
      return;
    }
    // ↑ / ↓ on an empty field (or one recalled from the history) walk the
    // prompts already sent to this agent.
    const list = promptHistory(terminalId);
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
      const picked = await openDialog({ multiple: true, directory: false, defaultPath: agent.cwd });
      if (!picked) return;
      addPaths(Array.isArray(picked) ? picked : [picked]);
    } catch (error) {
      toast.error('Could not open the file picker', { description: String(error) });
    }
  };

  const removeAttachment = (path: string) =>
    setDraft((d) => ({ ...d, attachments: d.attachments.filter((a) => a.path !== path) }));

  const shortcut = comboLabelFor('agent.prompt', keybindings);
  const canSend = !sending && (draft.text.trim() !== '' || draft.attachments.length > 0);
  const pending = draft.text.trim() !== '' || draft.attachments.length > 0;

  return (
    <div ref={barRef} data-agent-bar={terminalId} className="relative shrink-0 select-none font-sans">
      {open && !blocked && (
        <div className="absolute inset-x-0 bottom-full z-20 px-2 pb-1.5">
          <div
            className="rounded-[var(--rad-md)] border border-border-strong bg-popover/95 shadow-pop backdrop-blur-sm"
            onMouseDown={(e) => {
              // A click on the frame (not the field) keeps the caret in it.
              if (e.target !== fieldRef.current && !(e.target as HTMLElement).closest('button')) e.preventDefault();
            }}
          >
            {draft.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-2.5 pt-2">
                {draft.attachments.map((a) => (
                  <span
                    key={a.path}
                    title={a.path}
                    className="inline-flex max-w-[16rem] items-center gap-1 rounded-[var(--rad-xs)] border border-border bg-muted/60 py-0.5 pr-0.5 pl-1.5 text-[11px] text-muted-foreground"
                  >
                    {a.image ? <ImageIcon className="size-3 shrink-0" /> : <FileText className="size-3 shrink-0" />}
                    <span className="truncate">{a.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${a.name}`}
                      onClick={() => removeAttachment(a.path)}
                      className="grid size-4 place-items-center rounded-[3px] hover:bg-accent hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={fieldRef}
              value={draft.text}
              rows={1}
              spellCheck={false}
              placeholder={`Message ${name}…`}
              onChange={(e) => {
                recall.current = -1;
                setDraft((d) => ({ ...d, text: e.target.value }));
              }}
              onKeyDown={onKeyDown}
              onPaste={(e) => void onPaste(e)}
              className="block max-h-[33vh] w-full resize-none bg-transparent px-3 pt-2 pb-1 font-mono text-[13px] leading-5 text-foreground outline-none placeholder:text-faint select-text"
            />
            <div className="flex items-center gap-2 px-2 pb-1.5 text-[11px] text-faint">
              <button
                type="button"
                onClick={() => void pickFiles()}
                className="inline-flex items-center gap-1 rounded-[var(--rad-xs)] px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                title="Attach files or images (or paste an image, or drop files here)"
              >
                <Paperclip className="size-3" />
                Attach
              </button>
              <span className="ml-auto">Shift+Enter new line · Esc back to the terminal</span>
              <button
                type="button"
                disabled={!canSend}
                onClick={() => void send()}
                className={cn(
                  'inline-flex items-center gap-1 rounded-[var(--rad-xs)] px-2 py-0.5 font-medium',
                  canSend ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-faint'
                )}
              >
                Send
                <CornerDownLeft className="size-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The toolbelt: which agent, what it is at, and the way in. */}
      <div className="flex h-8 items-center gap-2 border-t border-border/60 bg-terminal px-2.5 text-xs">
        <AgentPhaseDot phase={phase} needsInput={agent.needsInput} provider={agent.provider} size={7} />
        <AgentProviderIcon provider={agent.provider} plain />
        <span className="max-w-[12rem] shrink-0 truncate text-muted-foreground" title={agent.name || name}>
          {agent.name || name}
        </span>
        {blocked ? (
          <span className="min-w-0 flex-1 truncate text-st-blocked">Answer {name}&rsquo;s question in the terminal</span>
        ) : (
          <button
            type="button"
            onClick={() => (open ? fieldRef.current?.focus() : show())}
            className={cn(
              'flex h-6 min-w-0 flex-1 items-center gap-2 rounded-[var(--rad-sm)] border border-border/70 px-2 text-left transition-colors hover:border-border-strong',
              open && 'border-border-strong'
            )}
          >
            <span className={cn('min-w-0 flex-1 truncate', pending ? 'text-foreground' : 'text-faint')}>
              {pending ? draft.text.split('\n')[0] || `${draft.attachments.length} attachment(s)` : `Message ${name}…`}
            </span>
            {shortcut && <kbd className="shrink-0 font-sans text-[10px] text-faint">{shortcut}</kbd>}
          </button>
        )}
        <span className="hidden shrink-0 text-[11px] text-faint sm:inline">{AGENT_PHASE_LABEL[phase]}</span>
        <button
          type="button"
          aria-label="Attach files"
          title="Attach files or images"
          onClick={() => void pickFiles()}
          className="grid size-6 shrink-0 place-items-center rounded-[var(--rad-xs)] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Paperclip className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
