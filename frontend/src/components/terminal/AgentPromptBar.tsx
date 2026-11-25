import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CornerDownLeft, FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '@/stores/appStore';
import { comboFromEvent, effectiveCombos } from '@/lib/keybindings';
import { focusTerminal } from '@/lib/terminalSessions';
import { cn } from '@/lib/utils';
import type { TerminalAgentInfo } from '@/types';
import { useTerminalAgent } from './agentsStore';
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
import {
  eraseMarker,
  imageMarker,
  markerSpans,
  nextImageNumber,
  snapCaret,
  visibleAttachments,
  type MarkerSpan,
} from './agentPromptParts';

const PROVIDER_NAME: Record<TerminalAgentInfo['provider'], string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

function providerName(agent: TerminalAgentInfo): string {
  return PROVIDER_NAME[agent.provider] ?? 'the agent';
}

/**
 * The prompt's text with each image marker drawn as a bubble. The bubble
 * holds the marker's own characters, so it is exactly as wide as the text it
 * stands for: the brackets are kept, invisible, as its padding. (No icon:
 * in a monospace line it would only get one character's width.)
 */
function renderWithBubbles(text: string, spans: MarkerSpan[]) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const sp of spans) {
    if (sp.start > last) out.push(text.slice(last, sp.start));
    out.push(
      <span
        key={sp.start}
        className="rounded-[5px] bg-primary/15 text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-primary)_45%,transparent)]"
      >
        <span className="text-transparent">[</span>
        {text.slice(sp.start + 1, sp.end - 1)}
        <span className="text-transparent">]</span>
      </span>
    );
    last = sp.end;
  }
  // A last empty line still takes its height in the field.
  out.push(text.slice(last) + (text.endsWith(NEWLINE) ? ZWSP : ''));
  return out;
}

const NEWLINE = String.fromCharCode(10);
const ZWSP = String.fromCharCode(0x200b);

/**
 * The agent prompt of a terminal running an agent (see `agentPrompt.ts`): a
 * bubble over the terminal's last rows, opened with Ctrl+G, whose prompt goes
 * to the agent. Closed, nothing shows and nothing takes room. Nothing at all
 * while no agent runs, or when the setting is off.
 */
export function AgentPromptBar({ terminalId }: { terminalId: string }) {
  const agent = useTerminalAgent(terminalId);
  const enabled = useAppStore((s) => s.settings?.terminal?.agentPromptBar !== false);
  if (!enabled || !agent) return null;
  return <AgentPromptBarInner terminalId={terminalId} agent={agent} />;
}

function AgentPromptBarInner({ terminalId, agent }: { terminalId: string; agent: TerminalAgentInfo }) {
  const keybindings = useAppStore((s) => s.settings?.terminal?.keybindings);
  const bubbleColor = useAppStore((s) => s.settings?.terminal?.agentPromptColor);
  const bubbleOpacity = useAppStore((s) => s.settings?.terminal?.agentPromptOpacity ?? 95);
  // A permission prompt is answered in the agent's own UI (its keys pick an
  // option): the editor steps aside until it is answered.
  const blocked = agent.needsInput === 'permission';
  const name = providerName(agent);

  const [open, setOpen] = useState(() => isEditorOpen(terminalId));
  const [draft, setDraftState] = useState<AgentDraft>(() => draftOf(terminalId));
  const [sending, setSending] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
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

  // The field to focus once it is there. Focusing it from `show()` (even a
  // frame later) raced React's render: on the first Ctrl+G the bubble was not
  // mounted yet, nothing took the keys, and it took a second Ctrl+G.
  const wantFocus = useRef(false);
  const show = useCallback(
    (focus = true) => {
      setOpen(true);
      setEditorOpen(terminalId, true);
      if (focus) {
        wantFocus.current = true;
        fieldRef.current?.focus();
      }
    },
    [terminalId]
  );
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!open || blocked || !wantFocus.current || !field) return;
    wantFocus.current = false;
    field.focus();
    // …and once more a frame later if the pane took it back meanwhile (the
    // terminal re-focusing itself after the key that opened the bubble).
    const pane = barRef.current?.parentElement;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active !== field && (!active || active === document.body || pane?.contains(active))) field.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, blocked]);

  const hide = useCallback(() => {
    setOpen(false);
    setEditorOpen(terminalId, false);
    focusTerminal(terminalId);
  }, [terminalId]);

  // Images go *into* the text, at the caret, as `[Image #N]` — where Claude
  // Code's own input puts a pasted image — and are sent there
  // (`agentPromptParts.ts`). The caret is put back after the marker once the
  // text is rendered.
  const pendingCaret = useRef<number | null>(null);
  const placeImages = useCallback(
    (images: AgentAttachment[]) => {
      if (images.length === 0) return;
      const field = fieldRef.current;
      const focused = !!field && document.activeElement === field;
      const from = focused ? field.selectionStart : null;
      const to = focused ? field.selectionEnd : null;
      setDraft((d) => {
        let n = nextImageNumber(d.attachments);
        const added = images.map((a) => ({ ...a, image: true, n: n++ }));
        const markers = added.map((a) => imageMarker(a.n)).join(' ');
        const before = d.text.slice(0, from ?? d.text.length);
        const after = d.text.slice(to ?? d.text.length);
        const head = `${before}${before && !/\s$/.test(before) ? ' ' : ''}${markers}${!/^\s/.test(after) ? ' ' : ''}`;
        pendingCaret.current = head.length;
        return { text: head + after, attachments: [...d.attachments, ...added] };
      });
    },
    [setDraft]
  );
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const field = fieldRef.current;
    if (caret === null || !field) return;
    pendingCaret.current = null;
    field.setSelectionRange(caret, caret);
  }, [draft.text]);

  const addPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const fresh = paths.map(attachmentOf);
      placeImages(fresh.filter((a) => a.image));
      const files = fresh.filter((a) => !a.image);
      if (files.length > 0) {
        setDraft((d) => ({
          ...d,
          attachments: [...d.attachments, ...files.filter((f) => !d.attachments.some((a) => a.path === f.path))],
        }));
      }
      show();
    },
    [setDraft, show, placeImages]
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
    // An image marker is one character to the keyboard: erased whole, and
    // stepped over by ← / →.
    {
      const field = e.currentTarget;
      const from = field.selectionStart;
      const to = field.selectionEnd;
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const erased = eraseMarker(draft.text, spans, from, to, e.key);
        if (erased) {
          e.preventDefault();
          recall.current = -1;
          pendingCaret.current = erased.caret;
          setDraft((d) => ({ ...d, text: erased.text }));
          return;
        }
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && from === to) {
        const left = e.key === 'ArrowLeft';
        const hit = spans.find((sp) => (left ? sp.end === from : sp.start === from));
        if (hit) {
          e.preventDefault();
          const caret = left ? hit.start : hit.end;
          field.setSelectionRange(caret, caret);
          return;
        }
      }
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
      placeImages(saved);
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

  // An image's chip takes its marker out of the text with it.
  const removeAttachment = (target: AgentAttachment) =>
    setDraft((d) => ({
      text:
        target.n !== undefined
          ? d.text.split(` ${imageMarker(target.n)}`).join('').split(imageMarker(target.n)).join('')
          : d.text,
      attachments: d.attachments.filter((a) => a !== target && a.path !== target.path),
    }));
  // Images are shown in the text itself (the bubbles below); the chips are
  // for the files, and for images from an older draft that has no marker.
  const chips = visibleAttachments(draft.text, draft.attachments).filter((a) => !a.image || a.n === undefined);

  // Where the image markers are, for the keys and for the bubbles drawn
  // under the field.
  const spans = markerSpans(draft.text, draft.attachments);

  const canSend = !sending && (draft.text.trim() !== '' || draft.attachments.length > 0);

  // No toolbelt any more: nothing under the terminal while an agent runs (so
  // the pane is never resized when one starts — a resize makes the agent
  // redraw its whole screen). Ctrl+G opens the bubble over the terminal's
  // last rows. The anchor below takes no room; it marks where the bubble
  // stands and where a drop attaches files.
  return (
    <div ref={barRef} data-agent-bar={terminalId} className="relative h-0 shrink-0 select-none font-sans">
      {open && !blocked && (
        <div className="absolute inset-x-0 bottom-0 z-20 px-2 pb-1.5">
          <div
            className="rounded-[var(--rad-md)] border border-border-strong shadow-pop backdrop-blur-sm"
            style={{
              // Settings > Agents > Agent prompt: colour and opacity.
              background: `color-mix(in srgb, ${bubbleColor || 'var(--color-popover)'} ${Math.min(100, Math.max(20, bubbleOpacity))}%, transparent)`,
            }}
            onMouseDown={(e) => {
              // A click on the frame (not the field) keeps the caret in it.
              if (e.target !== fieldRef.current && !(e.target as HTMLElement).closest('button')) e.preventDefault();
            }}
          >
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-2.5 pt-2">
                {chips.map((a) => (
                  <span
                    key={a.path}
                    title={a.path}
                    className="inline-flex max-w-[16rem] items-center gap-1 rounded-[var(--rad-xs)] border border-border bg-muted/60 py-0.5 pr-0.5 pl-1.5 text-[11px] text-muted-foreground"
                  >
                    {a.image ? <ImageIcon className="size-3 shrink-0" /> : <FileText className="size-3 shrink-0" />}
                    <span className="truncate">{a.image && a.n !== undefined ? imageMarker(a.n).slice(1, -1) : a.name}</span>
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
            {/* The text is drawn twice: by the field, transparent, which keeps
                the caret, the selection and all the editing; and under it, the
                same characters in the same monospace font, where an image
                marker is a bubble. Same box, same wrapping, so every glyph
                sits exactly under its own. */}
            <div className="relative">
              <div
                ref={backdropRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-hidden px-3 pt-2 pb-1 font-mono text-[13px] leading-5 break-words whitespace-pre-wrap text-foreground"
              >
                {renderWithBubbles(draft.text, spans)}
              </div>
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
                onSelect={(e) => {
                  // A click inside a marker puts the caret at its edge.
                  const field = e.currentTarget;
                  if (field.selectionStart !== field.selectionEnd) return;
                  const snapped = snapCaret(spans, field.selectionStart);
                  if (snapped !== field.selectionStart) field.setSelectionRange(snapped, snapped);
                }}
                onScroll={(e) => {
                  if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop;
                }}
                className="relative block max-h-[33vh] w-full resize-none bg-transparent px-3 pt-2 pb-1 font-mono text-[13px] leading-5 break-words whitespace-pre-wrap text-transparent caret-foreground outline-none [scrollbar-width:none] placeholder:text-faint select-text"
              />
            </div>
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
    </div>
  );
}
