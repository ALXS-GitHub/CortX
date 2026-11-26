/**
 * The two modes of an agent pane (ticket CORT-62):
 *
 * - **TUI**: Claude Code's own interface, in the pane's terminal — the
 *   terminal as it always was.
 * - **GUI**: the conversation view. CortX runs Claude Code itself in
 *   stream-json mode, the way the Claude desktop app does
 *   (`agentGuiStore.ts`); the pane's shell stays underneath, unused.
 *
 * One session cannot be in both at once. Switching closes it in one mode
 * and resumes it in the other (`--resume <session>`): from the TUI, CortX
 * quits Claude Code (Ctrl+C twice, as you would) and starts the GUI agent on
 * the same session; from the GUI, it stops the GUI agent and types the TUI
 * command (`terminal.agentLaunchCommand`, e.g. `cc`) with `--resume` in the
 * shell. The choice is remembered per pane (`LeafNode.view`).
 */
import { ask } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';
import { agentSessionHasConversation, writeTerminal } from '@/lib/tauri';
import { focusTerminal } from '@/lib/terminalSessions';
import { collectLeaves, type LeafNode } from '@/lib/terminalLayout';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { refreshGuiPanes, registerGuiPanes, useTerminalAgentsStore, type GuiPaneRef } from '../agentsStore';
import { ensurePaneAgent, startPaneAgent, stopPaneAgent, useAgentGuiStore } from './agentGuiStore';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function leafOf(terminalId: string): LeafNode | null {
  for (const tab of useTerminalLayoutStore.getState().doc.window.tabs) {
    const leaf = collectLeaves(tab.layout).find((l) => l.terminalId === terminalId);
    if (leaf) return leaf;
  }
  return null;
}

function guiLeaves(): GuiPaneRef[] {
  const out: GuiPaneRef[] = [];
  for (const tab of useTerminalLayoutStore.getState().doc.window.tabs) {
    for (const leaf of collectLeaves(tab.layout)) {
      if (leaf.view === 'agent') out.push({ terminalId: leaf.terminalId, sessionId: leaf.agentSession ?? null, cwd: leaf.cwd ?? undefined });
    }
  }
  return out;
}

// A pane in GUI mode is an agent for the rest of the window — its tab's dot
// and colour, the grid, the inbox (CORT-66) — even before its agent runs.
registerGuiPanes(guiLeaves);
let guiSignature = '';
useTerminalLayoutStore.subscribe(() => {
  const next = guiLeaves()
    .map((p) => p.terminalId)
    .sort()
    .join('|');
  if (next === guiSignature) return;
  guiSignature = next;
  refreshGuiPanes();
});

/** Is this pane in GUI mode? */
export function isGuiPane(terminalId: string): boolean {
  return leafOf(terminalId)?.view === 'agent';
}

function tuiCommand(): string {
  return (useAppStore.getState().settings?.terminal?.agentLaunchCommand ?? 'claude').trim() || 'claude';
}

/** Where the pane's shell is (its live cwd), for the GUI agent to start in. */
function paneCwd(terminalId: string): string {
  const app = useAppStore.getState();
  const live = app.terminalStates.get(terminalId)?.cwd;
  if (live) return live;
  if (terminalId.startsWith('shell:')) return app.shellRuntimes.get(terminalId.slice('shell:'.length))?.cwd ?? '';
  return leafOf(terminalId)?.cwd ?? '';
}

/** Is Claude Code's TUI still detected in the terminal? */
function tuiThere(terminalId: string): boolean {
  const agent = useTerminalAgentsStore.getState().agents.get(terminalId);
  return !!agent && agent.kind !== 'gui';
}

/** Wait until no agent is detected in the terminal any more. */
async function tuiGone(terminalId: string, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!tuiThere(terminalId)) return true;
    await sleep(150);
  }
  return !tuiThere(terminalId);
}

/** TUI → GUI: quit Claude Code in the terminal, resume its session in the conversation view. */
export async function switchToGui(terminalId: string): Promise<boolean> {
  // The pane's own agent, in the terminal — not a GUI agent still reported
  // for it while it was switched back a moment ago.
  const found = useTerminalAgentsStore.getState().agents.get(terminalId);
  const agent = found?.kind === 'gui' ? undefined : found;
  const cwd = agent?.cwd || paneCwd(terminalId);
  let session: string | null = null;

  if (agent) {
    if (agent.provider !== 'claude-code') {
      toast.error('Only Claude Code has a GUI mode for now.');
      return false;
    }
    session = agent.sessionId ?? null;
    if (agent.state === 'running') {
      const ok = await ask('Claude is in the middle of a turn. Interrupt it and continue in the GUI mode?', {
        title: 'Switch to the GUI mode',
        kind: 'warning',
      });
      if (!ok) return false;
      await writeTerminal(terminalId, '\x1b');
      await sleep(400);
    }
    // Ctrl+C twice quits Claude Code (the first one clears its input).
    await writeTerminal(terminalId, '\x03');
    await sleep(250);
    await writeTerminal(terminalId, '\x03');
    if (!(await tuiGone(terminalId, 5000))) {
      toast.error('Claude Code did not quit in the terminal', { description: 'Quit it there (/exit), then switch again.' });
      return false;
    }
  }

  useTerminalLayoutStore.getState().setLeafView(terminalId, 'agent', session);
  ensurePaneAgent(terminalId, cwd, session);
  // Resumed right away: the conversation is ready when the view shows it.
  if (session) void startPaneAgent(terminalId);
  return true;
}

/** GUI → TUI: stop the GUI agent, resume its session with Claude Code in the terminal. */
export async function switchToTui(terminalId: string): Promise<boolean> {
  const pane = useAgentGuiStore.getState().panes[terminalId];
  const session = pane?.state.sessionId ?? pane?.resumeId ?? leafOf(terminalId)?.agentSession ?? null;
  if (pane?.state.busy) {
    const ok = await ask('Claude is in the middle of a turn. Stop it and continue in the terminal?', {
      title: 'Switch to the terminal',
      kind: 'warning',
    });
    if (!ok) return false;
  }
  await stopPaneAgent(terminalId);
  useTerminalLayoutStore.getState().setLeafView(terminalId, null, null);
  // A session nobody wrote in yet cannot be resumed (CORT-66): Claude Code
  // would stop on "No conversation found". A new one is started instead.
  const resumable = session ? await agentSessionHasConversation(session).catch(() => true) : false;
  const command = session && resumable ? `${tuiCommand()} --resume ${session}` : tuiCommand();
  await writeTerminal(terminalId, `${command}\r`).catch((error) => {
    toast.error('Could not start Claude Code in the terminal', { description: String(error) });
  });
  focusTerminal(terminalId);
  return true;
}

/** The pane's mode switch (button, Ctrl+Shift+M). */
export function toggleAgentView(terminalId: string): boolean {
  if (isGuiPane(terminalId)) void switchToTui(terminalId);
  else void switchToGui(terminalId);
  return true;
}

/** Event the agent view of one terminal answers (`detail.terminalId`): focus its composer. */
export const AGENT_VIEW_FOCUS_EVENT = 'cortx:agent-view-focus';

export function focusAgentView(terminalId: string) {
  window.dispatchEvent(new CustomEvent(AGENT_VIEW_FOCUS_EVENT, { detail: { terminalId } }));
}
