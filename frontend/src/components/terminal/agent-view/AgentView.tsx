import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { GitBranch, Loader2, SquareTerminal } from 'lucide-react';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { AgentProviderIcon } from '@/components/agents/AgentProviderIcon';
import { useAppStore } from '@/stores/appStore';
import { comboLabelFor } from '@/lib/keybindings';
import { cn } from '@/lib/utils';
import type { AgentMessage, TerminalAgentInfo } from '@/types';
import { useTerminalAgentsStore } from '../agentsStore';
import { agentPhase, AGENT_PHASE_LABEL } from '../agentPhase';
import { AgentPhaseDot } from '../TerminalStatusGlyph';
import { KEY_DOWN, KEY_ENTER, KEY_UP } from '../agentMenu';
import { AGENT_VIEW_FOCUS_EVENT } from './agentView';
import { AgentViewComposer, type AgentViewComposerHandle } from './AgentViewComposer';
import { AgentViewPrompt } from './AgentViewPrompt';
import { pickMenuOption, sendMenuKey } from './menuKeys';
import { pendingToolCall } from './pendingTool';
import { useAgentMenu, useTranscriptChanges } from './useAgentLive';

// The transcript pulls streamdown + shiki: keep them out of the main chunk.
const AgentTranscript = lazy(() => import('@/components/agents/AgentTranscript'));

interface AgentViewProps {
  terminalId: string;
  agent: TerminalAgentInfo & { sessionId: string };
  /** The pane is the one in front (active leaf of the active tab). */
  active: boolean;
  onShowTerminal: () => void;
}

const WIDTH_CLASS: Record<string, string> = {
  narrow: 'max-w-3xl',
  wide: 'max-w-5xl',
  full: 'max-w-none',
};

/** What the agent is at, for the line under the last message. */
function workingLabel(agent: TerminalAgentInfo): string {
  if (agent.pendingTool) return `Running ${agent.pendingTool}…`;
  return 'Working…';
}

function isTextField(el: Element | null): boolean {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
}

/**
 * The agent view of a pane (ticket CORT-62, see `agentView.ts`): the
 * session's conversation, followed live from its transcript, a card for what
 * the agent waits on you for, and a composer whose text goes to the agent
 * through its terminal. Drawn over the terminal, which keeps running under it.
 */
export function AgentView({ terminalId, agent, active, onShowTerminal }: AgentViewProps) {
  const keybindings = useAppStore((s) => s.settings?.terminal?.keybindings);
  const background = useAppStore((s) => s.settings?.terminal?.agentViewBackground ?? 'terminal');
  const font = useAppStore((s) => s.settings?.terminal?.agentViewFont ?? 'interface');
  const textSize = useAppStore((s) => s.settings?.terminal?.agentViewTextSize ?? 14);
  const width = useAppStore((s) => s.settings?.terminal?.agentViewWidth ?? 'narrow');
  const terminalFont = useAppStore((s) => s.settings?.terminal?.fontFamily);
  const column = WIDTH_CLASS[width] ?? WIDTH_CLASS.narrow;
  const unseen = useTerminalAgentsStore((s) => s.unseen.has(terminalId));
  const phase = agentPhase(agent, unseen);
  const name = agent.provider === 'claude-code' ? 'Claude' : 'the agent';
  const changeToken = useTranscriptChanges(agent.lastActivity);
  const menu = useAgentMenu(terminalId);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  // The call the agent is on, from the transcript — only when the agent
  // itself reports it pending (an older call left without a result is not).
  const pendingCall = pendingToolCall(messages);
  const call = pendingCall && agent.pendingTool === pendingCall.name ? pendingCall : null;
  const asking = menu !== null || agent.needsInput != null;
  const working = agent.state === 'running' && !asking;
  const rootRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<AgentViewComposerHandle>(null);

  // Ctrl+G (the agent prompt) lands in the composer.
  useEffect(() => {
    const onFocus = (e: Event) => {
      if ((e as CustomEvent).detail?.terminalId === terminalId) composerRef.current?.focus();
    };
    window.addEventListener(AGENT_VIEW_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(AGENT_VIEW_FOCUS_EVENT, onFocus);
  }, [terminalId]);

  // The keyboard goes where the answer is: the view itself while a menu is
  // up (its keys pick), the composer otherwise.
  const hasMenu = menu !== null;
  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    const focused = document.activeElement;
    const ours = !focused || focused === document.body || !!root?.contains(focused);
    if (!ours) return;
    if (hasMenu) {
      if (!isTextField(focused) || (focused as HTMLTextAreaElement).disabled) root?.focus();
    } else composerRef.current?.focus();
  }, [hasMenu, active]);

  // A menu's keys, as in the terminal: 1–9 pick, ↑ ↓ move, Enter confirms,
  // Esc / Tab go to the agent. Not while typing in a field.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!menu || e.nativeEvent.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement;
      if (isTextField(target) && !(target as HTMLTextAreaElement).disabled) {
        // The composer, empty, lets the menu have the arrows and Enter.
        const empty = target.tagName === 'TEXTAREA' && composerRef.current?.isEmpty();
        if (!empty) return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const option = menu.options.find((o) => o.n === Number(e.key));
        if (!option || option.freeText) return;
        e.preventDefault();
        void pickMenuOption(terminalId, menu, option);
        return;
      }
      const key =
        e.key === 'ArrowDown' ? KEY_DOWN : e.key === 'ArrowUp' ? KEY_UP : e.key === 'Enter' ? KEY_ENTER : e.key === 'Escape' ? '\x1b' : e.key === 'Tab' ? (e.shiftKey ? '\x1b[Z' : '\t') : null;
      if (!key) return;
      e.preventDefault();
      void sendMenuKey(terminalId, key);
    },
    [menu, terminalId]
  );

  const viewCombo = comboLabelFor('agent.view', keybindings);
  const title = agent.name || 'Claude Code';

  return (
    <div
      ref={rootRef}
      data-agent-view={terminalId}
      // Drops attach to the composer (`pasteDroppedPaths`).
      data-agent-bar={terminalId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // Settings > Agents > Agent view. The terminal's background is its
      // theme colour — transparent over a wallpaper or a see-through window,
      // which then shows through here exactly as it does in the terminal.
      className={cn(
        'agent-view absolute inset-0 z-10 flex flex-col outline-none',
        background === 'app' ? 'bg-background' : 'bg-terminal',
        font === 'terminal' ? 'font-mono' : 'font-sans'
      )}
      style={
        {
          '--agent-view-text': `${Math.min(18, Math.max(12, textSize))}px`,
          ...(font === 'terminal' && terminalFont ? { fontFamily: terminalFont } : {}),
        } as React.CSSProperties
      }
    >
      {/* Header: which agent, what it is at. The pane's floating actions sit
          over its right end. */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 pr-44 pl-3 text-xs">
        <AgentPhaseDot phase={phase} needsInput={agent.needsInput} provider={agent.provider} size={7} />
        <AgentProviderIcon provider={agent.provider} plain />
        <span className="min-w-0 truncate font-medium text-foreground" title={title}>
          {title}
        </span>
        <span className="shrink-0 text-[11px] text-faint">{AGENT_PHASE_LABEL[phase]}</span>
        {agent.gitBranch && (
          <span className="hidden min-w-0 items-center gap-1 truncate text-[11px] text-faint sm:inline-flex">
            <GitBranch className="size-3 shrink-0" />
            {agent.gitBranch}
          </span>
        )}
        <button
          type="button"
          onClick={onShowTerminal}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          title={`Show the terminal${viewCombo ? ` (${viewCombo})` : ''}`}
        >
          <SquareTerminal className="size-3.5" />
          Terminal
        </button>
      </div>

      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading the conversation…
          </div>
        }
      >
        <AgentTranscript
          key={agent.sessionId}
          sessionId={agent.sessionId}
          sessionState={agent.state}
          changeToken={changeToken}
          onMessages={setMessages}
          contentClassName={cn('mx-auto w-full px-5 py-5', column)}
          footer={
            working ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="size-2 animate-pulse rounded-full bg-primary" />
                <Shimmer as="span" className="text-sm">
                  {workingLabel(agent)}
                </Shimmer>
              </div>
            ) : null
          }
        />
      </Suspense>

      <div className={cn('mx-auto flex w-full shrink-0 flex-col gap-2 px-5 pt-1 pb-4', column)}>
        {asking && (
          <AgentViewPrompt
            key={call?.toolId ?? 'menu'}
            terminalId={terminalId}
            agentName={name === 'Claude' ? 'Claude' : 'The agent'}
            menu={menu}
            call={call}
            onOpenTerminal={onShowTerminal}
          />
        )}
        <AgentViewComposer
          ref={composerRef}
          terminalId={terminalId}
          agentName={name}
          cwd={agent.cwd}
          working={working}
          locked={hasMenu}
          status={
            <>
              {agent.model && <span className="font-mono">{agent.model}</span>}
              {agent.model && agent.cwd && <span> · </span>}
              {agent.cwd && <span title={agent.cwd}>{agent.cwd.split(/[\\/]/).filter(Boolean).pop()}</span>}
            </>
          }
        />
      </div>
    </div>
  );
}
