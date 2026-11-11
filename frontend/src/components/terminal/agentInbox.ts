import { useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { useTerminalGridStore } from '@/stores/terminalGridStore';
import { collectLeaves, findLeafByTerminal, tabInScope, tabIsLocal, type TerminalTab } from '@/lib/terminalLayout';
import type { TerminalAgentInfo } from '@/types';
import { useTerminalAgentsStore } from './agentsStore';
import { agentPhase, attentionOrder, type AgentPhase } from './agentPhase';

/**
 * The agents of this window, with their phase — what the counter, the inbox
 * and "go to the next agent that needs you" read. Only this window's own
 * tabs: another Terminal window keeps its own count.
 */
export interface AgentEntry {
  terminalId: string;
  tab: TerminalTab;
  agent: TerminalAgentInfo;
  phase: AgentPhase;
  /** Since when it is in this phase (epoch ms). */
  since: number;
}

function collect(
  tabs: readonly TerminalTab[],
  agents: ReadonlyMap<string, TerminalAgentInfo>,
  unseen: ReadonlySet<string>,
  since: ReadonlyMap<string, number>
): AgentEntry[] {
  const out: AgentEntry[] = [];
  for (const tab of tabs) {
    if (!tabIsLocal(tab)) continue;
    for (const leaf of collectLeaves(tab.layout)) {
      const agent = agents.get(leaf.terminalId);
      if (!agent) continue;
      out.push({
        terminalId: leaf.terminalId,
        tab,
        agent,
        phase: agentPhase(agent, unseen.has(leaf.terminalId)),
        since: since.get(leaf.terminalId) ?? 0,
      });
    }
  }
  return out;
}

export function localAgents(): AgentEntry[] {
  const { agents, unseen, since } = useTerminalAgentsStore.getState();
  return collect(useTerminalLayoutStore.getState().doc.window.tabs, agents, unseen, since);
}

export function useLocalAgents(): AgentEntry[] {
  const tabs = useTerminalLayoutStore((s) => s.doc.window.tabs);
  const agents = useTerminalAgentsStore((s) => s.agents);
  const unseen = useTerminalAgentsStore((s) => s.unseen);
  const since = useTerminalAgentsStore((s) => s.since);
  return useMemo(() => collect(tabs, agents, unseen, since), [tabs, agents, unseen, since]);
}

/**
 * Bring one terminal in front: its tab becomes the active one (widening the
 * scope if it is out of it), its pane the active pane, and in agent mode it
 * opens full size. Looking at it is what marks a finished turn as seen.
 */
export function revealTerminal(terminalId: string): boolean {
  const layout = useTerminalLayoutStore.getState();
  const tab = layout.doc.window.tabs.find((t) => tabIsLocal(t) && findLeafByTerminal(t.layout, terminalId));
  if (!tab) return false;
  const leaf = findLeafByTerminal(tab.layout, terminalId);
  if (!tabInScope(tab, layout.doc.window.scope)) layout.setScope('global');
  if (leaf) layout.setActiveLeaf(tab.id, leaf.id);
  else layout.setActiveTab(tab.id);
  if (useTerminalGridStore.getState().mode !== 'off') useTerminalGridStore.getState().zoom();
  useAppStore.getState().markTerminalSeen(terminalId);
  return true;
}

/**
 * The next agent that wants you — one stopped on you first, then one that
 * finished and was not looked at, the longest waiting first — brought in
 * front. Nothing to do: false, and the key falls through.
 */
export function gotoNextAgentAttention(): boolean {
  const [next] = attentionOrder(localAgents());
  return next ? revealTerminal(next.terminalId) : false;
}
