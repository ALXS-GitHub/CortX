import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ChevronDown, Loader2, PanelRight, RotateCcw, Sparkles, SquareTerminal, TriangleAlert } from 'lucide-react';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { AgentProviderIcon } from '@/components/agents/AgentProviderIcon';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAppStore } from '@/stores/appStore';
import { comboLabelFor } from '@/lib/keybindings';
import { cn } from '@/lib/utils';
import { AGENT_VIEW_FOCUS_EVENT } from './paneMode';
import { AgentViewComposer, type AgentViewComposerHandle } from './AgentViewComposer';
import { PermissionCard } from './AgentViewPrompt';
import { ConversationTurns } from './ConversationTurns';
import { ensurePaneAgent, setPanePermissionMode, startPaneAgent, useAgentGuiStore } from './agentGuiStore';
import { visibleMessages } from './streamJson';
import { ImageLightbox } from './AgentImages';
import { AgentCwdContext } from './agentImageStore';
import { AgentSidePanel } from './AgentSidePanel';

const PANEL_KEY = 'cortx.agentPanel.open';

/** Is the side panel open? Remembered in this browser (a convenience). */
function usePanelOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(PANEL_KEY, String(!o));
      } catch {
        /* not remembered */
      }
      return !o;
    });
  return [open, toggle];
}

/** The width of an element, followed. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

interface AgentViewProps {
  terminalId: string;
  cwd: string;
  /** The session the pane resumes (restore, switch from the TUI). */
  sessionId: string | null;
  /** The pane is the one in front (active leaf of the active tab). */
  active: boolean;
  onShowTerminal: () => void;
}

const WIDTH_CLASS: Record<string, string> = {
  narrow: 'max-w-3xl',
  wide: 'max-w-5xl',
  full: 'max-w-none',
};

const MODES: { value: string; label: string; hint: string }[] = [
  {
    value: 'default',
    label: 'Ask permissions',
    hint: 'Ask before edits and commands',
  },
  {
    value: 'acceptEdits',
    label: 'Accept edits',
    hint: 'Edit files without asking',
  },
  {
    value: 'plan',
    label: 'Plan mode',
    hint: 'Explore and propose a plan, no changes',
  },
  {
    value: 'bypassPermissions',
    label: 'Bypass permissions',
    hint: 'Never ask (careful)',
  },
];

/** Seconds since `since`, ticking. */
function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.round((now - since) / 1000));
}

function formatElapsed(s: number): string {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * A pane in GUI mode (ticket CORT-62): the conversation with the agent CortX
 * runs for it in stream-json mode, live — the answer is drawn as it is
 * written, tool calls show as they run, permission requests come as cards —
 * and a composer. See `agentView.ts` for the two modes of a pane.
 */
export function AgentView({ terminalId, cwd, sessionId, active, onShowTerminal }: AgentViewProps) {
  const keybindings = useAppStore((s) => s.settings?.terminal?.keybindings);
  const background = useAppStore((s) => s.settings?.terminal?.agentViewBackground ?? 'terminal');
  const font = useAppStore((s) => s.settings?.terminal?.agentViewFont ?? 'interface');
  const textSize = useAppStore((s) => s.settings?.terminal?.agentViewTextSize ?? 14);
  const width = useAppStore((s) => s.settings?.terminal?.agentViewWidth ?? 'narrow');
  const terminalFont = useAppStore((s) => s.settings?.terminal?.fontFamily);
  const column = WIDTH_CLASS[width] ?? WIDTH_CLASS.narrow;

  useEffect(() => ensurePaneAgent(terminalId, cwd, sessionId), [terminalId, cwd, sessionId]);
  const pane = useAgentGuiStore((s) => s.panes[terminalId]);
  const workDir = pane?.cwd || cwd;
  const state = pane?.state;
  const live = useMemo(() => (state ? visibleMessages(state) : []), [state]);
  const history = pane?.history;
  const messages = useMemo(() => [...(history ?? []), ...live], [history, live]);
  const busy = !!state?.busy;
  const permissions = state?.permissions ?? [];
  const elapsed = useElapsed(busy ? (pane?.turnStartedAt ?? null) : null);

  // What the live line says: the block being written, or what runs.
  const streamingBlocks = state?.streaming ? Object.values(state.streaming.blocks) : [];
  const lastStreaming = streamingBlocks[streamingBlocks.length - 1];
  const liveLabel =
    state?.activity ??
    (lastStreaming?.type === 'reasoning'
      ? 'Thinking'
      : lastStreaming?.type === 'text'
        ? 'Writing'
        : lastStreaming?.type === 'tool-call'
          ? `Preparing ${lastStreaming.name}`
          : 'Working');

  const composerRef = useRef<AgentViewComposerHandle>(null);
  useEffect(() => {
    const onFocus = (e: Event) => {
      if ((e as CustomEvent).detail?.terminalId === terminalId) composerRef.current?.focus();
    };
    window.addEventListener(AGENT_VIEW_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(AGENT_VIEW_FOCUS_EVENT, onFocus);
  }, [terminalId]);
  useEffect(() => {
    if (active) composerRef.current?.focus();
  }, [active]);

  // Stick to the bottom while the answer is written, unless you scrolled up.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [showJump, setShowJump] = useState(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [messages, busy, permissions.length]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stuck.current = atBottom;
    setShowJump(!atBottom);
  };
  const jump = () => {
    const el = scrollRef.current;
    if (!el) return;
    stuck.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const rootRef = useRef<HTMLDivElement>(null);
  const paneWidth = useWidth(rootRef);
  const [panelOpen, togglePanel] = usePanelOpen();
  // A narrow pane: the panel goes over the conversation, closed by default.
  const narrowPane = paneWidth > 0 && paneWidth < 780;
  const [overlayOpen, setOverlayOpen] = useState(false);
  const showPanel = narrowPane ? overlayOpen : panelOpen;

  const viewCombo = comboLabelFor('agent.view', keybindings);
  const mode = MODES.find((m) => m.value === (state?.permissionMode ?? 'default')) ?? MODES[0];
  const empty = messages.length === 0 && pane?.historyState !== 'loading';

  return (
    <AgentCwdContext.Provider value={workDir}>
      <div
        ref={rootRef}
        data-agent-view={terminalId}
        // Drops attach to the composer (`pasteDroppedPaths`).
        data-agent-bar={terminalId}
        className={cn(
          'agent-view absolute inset-0 z-10 flex flex-col outline-none',
          background === 'app' ? 'bg-background' : 'bg-terminal',
          font === 'terminal' ? 'font-mono' : 'font-sans',
        )}
        style={
          {
            '--agent-view-text': `${Math.min(18, Math.max(12, textSize))}px`,
            ...(font === 'terminal' && terminalFont ? { fontFamily: terminalFont } : {}),
          } as React.CSSProperties
        }
      >
        {/* Header. The pane's floating actions sit over its right end. */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 pr-44 pl-3 text-xs">
          <AgentProviderIcon provider="claude-code" plain />
          <span className="font-medium text-foreground">Claude</span>
          {state?.model && <span className="truncate font-mono text-[11px] text-faint">{state.model}</span>}
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              pane?.status === 'running'
                ? busy
                  ? 'animate-pulse bg-st-agent'
                  : 'bg-st-done'
                : pane?.status === 'starting'
                  ? 'animate-pulse bg-st-progress'
                  : 'bg-faint',
            )}
            title={pane?.status}
          />
          <button
            type="button"
            onClick={() => (narrowPane ? setOverlayOpen((o) => !o) : togglePanel())}
            className={cn(
              'ml-auto grid size-6 shrink-0 place-items-center rounded-md hover:bg-accent hover:text-foreground',
              showPanel ? 'text-primary' : 'text-muted-foreground',
            )}
            title={showPanel ? 'Hide the session panel' : 'Show the session panel'}
            aria-label="Session panel"
          >
            <PanelRight className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onShowTerminal}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            title={`Continue this session in the terminal${viewCombo ? ` (${viewCombo})` : ''}`}
          >
            <SquareTerminal className="size-3.5" />
            Terminal
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto">
              <div className={cn('mx-auto flex w-full flex-col gap-6 px-5 pt-6 pb-4', column)}>
                {pane?.historyState === 'loading' && (
                  <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading the conversation…
                  </div>
                )}
                {empty && (
                  <div className="flex flex-col items-center gap-3 py-16 text-center">
                    <span className="grid size-11 place-items-center rounded-2xl bg-primary/12 text-primary">
                      <Sparkles className="size-5" />
                    </span>
                    <p className="font-display text-lg font-semibold tracking-tight text-foreground">What are we building?</p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      Claude works in <span className="font-mono text-xs">{workDir || 'this folder'}</span>.
                    </p>
                  </div>
                )}
                <ConversationTurns messages={messages} live={busy} subagents={state?.subagents ?? {}} />
                {busy && permissions.length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="relative flex size-2.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/50" />
                      <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
                    </span>
                    <Shimmer as="span" className="text-sm">{`${liveLabel}…`}</Shimmer>
                    <span className="font-mono text-[11px] text-faint">{formatElapsed(elapsed)}</span>
                    <span className="text-[11px] text-faint">· Esc to stop</span>
                  </div>
                )}
                {!busy && state?.lastResult?.isError && (
                  <div className="flex items-start gap-2 rounded-xl border border-st-blocked/30 bg-st-blocked/10 px-3 py-2 text-xs text-st-blocked">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span className="whitespace-pre-wrap">
                      {state.lastResult.text || `The turn ended with an error (${state.lastResult.subtype}).`}
                    </span>
                  </div>
                )}
                {pane?.status === 'exited' && pane.error && (
                  <div className="space-y-2 rounded-xl border border-st-blocked/30 bg-st-blocked/10 px-3 py-2.5 text-xs">
                    <p className="flex items-center gap-1.5 font-medium text-st-blocked">
                      <TriangleAlert className="size-3.5" /> Claude Code stopped
                    </p>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
                      {pane.error}
                    </pre>
                    <button
                      type="button"
                      onClick={() => void startPaneAgent(terminalId)}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-foreground hover:bg-accent"
                    >
                      <RotateCcw className="size-3" /> Start again
                    </button>
                  </div>
                )}
              </div>
              {showJump && (
                <button
                  type="button"
                  onClick={jump}
                  className="sticky bottom-3 left-1/2 mb-2 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-pop hover:text-foreground"
                  aria-label="Scroll to the latest message"
                >
                  <ArrowDown className="size-4" />
                </button>
              )}
            </div>

            <div className={cn('mx-auto flex w-full shrink-0 flex-col gap-2 px-5 pt-1 pb-4', column)}>
              {permissions.map((request) => (
                <PermissionCard key={request.requestId} paneKey={terminalId} request={request} />
              ))}
              <AgentViewComposer
                ref={composerRef}
                terminalId={terminalId}
                agentName="Claude"
                cwd={workDir}
                working={busy}
                locked={permissions.length > 0}
                commands={state?.slashCommands ?? []}
                status={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {mode.label}
                        <ChevronDown className="size-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top">
                      <DropdownMenuLabel>Permissions</DropdownMenuLabel>
                      {MODES.map((m) => (
                        <DropdownMenuItem key={m.value} onSelect={() => void setPanePermissionMode(terminalId, m.value)}>
                          <div className="flex flex-col">
                            <span className={cn(m.value === mode.value && 'font-medium text-primary')}>{m.label}</span>
                            <span className="text-[11px] text-muted-foreground">{m.hint}</span>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            </div>
          </div>
          {showPanel && state && <AgentSidePanel state={state} messages={messages} busy={busy} cwd={workDir} overlay={narrowPane} />}
        </div>
        <ImageLightbox />
      </div>
    </AgentCwdContext.Provider>
  );
}
