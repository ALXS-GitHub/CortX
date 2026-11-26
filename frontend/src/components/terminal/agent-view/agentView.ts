/**
 * The agent view (ticket CORT-62): a pane running an agent, shown as a
 * conversation — the way the Claude desktop app shows one — instead of as
 * the terminal. Only a way of showing it:
 *
 * - the agent keeps running in its terminal, untouched: same process, same
 *   PTY, same screen (kept rendered, out of sight, so it stays the right size
 *   and its menus can be read);
 * - what the view shows is the session's transcript, the JSONL file Claude
 *   Code writes on its own (`get_agent_transcript`), followed live;
 * - what you write in it goes to the agent through the PTY, as if typed in
 *   the terminal (`agentPrompt.sendAgentPrompt`);
 * - a menu the agent shows (a permission, a question, a plan to approve) is
 *   read off its screen (`agentMenu.ts`) and drawn as buttons, which send the
 *   arrows and Enter you would have typed.
 *
 * So the two views never disagree, and switching back and forth loses
 * nothing. The choice is remembered per pane (`LeafNode.view`), and ignored
 * while no agent runs there: the pane is then the terminal, as always.
 */
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { collectLeaves } from '@/lib/terminalLayout';
import type { TerminalAgentInfo } from '@/types';
import { useTerminalAgentsStore } from '../agentsStore';

/** Can this agent be shown as a conversation? Claude Code with a known session, for now. */
export function canShowAgentView(agent: TerminalAgentInfo | undefined): agent is TerminalAgentInfo & { sessionId: string } {
  return !!agent && agent.provider === 'claude-code' && !!agent.sessionId;
}

/** The view the user chose for a terminal's pane. */
export function leafViewOf(terminalId: string): 'agent' | null {
  for (const tab of useTerminalLayoutStore.getState().doc.window.tabs) {
    const leaf = collectLeaves(tab.layout).find((l) => l.terminalId === terminalId);
    if (leaf) return leaf.view ?? null;
  }
  return null;
}

/**
 * Switch a pane between the terminal and the agent view. False (nothing
 * done) when no agent the view can show runs in it.
 */
export function toggleAgentView(terminalId: string): boolean {
  const agent = useTerminalAgentsStore.getState().agents.get(terminalId);
  const current = leafViewOf(terminalId);
  // Back to the terminal is always possible (the agent may have just left).
  if (current !== 'agent' && !canShowAgentView(agent)) return false;
  useTerminalLayoutStore.getState().setLeafView(terminalId, current === 'agent' ? null : 'agent');
  return true;
}

/** Event the agent view of one terminal answers (`detail.terminalId`): focus its composer. */
export const AGENT_VIEW_FOCUS_EVENT = 'cortx:agent-view-focus';

export function focusAgentView(terminalId: string) {
  window.dispatchEvent(new CustomEvent(AGENT_VIEW_FOCUS_EVENT, { detail: { terminalId } }));
}
