import { create } from 'zustand';
import { getTerminalAgents, onTerminalAgents } from '@/lib/tauri';
import { setAgentTerminalIds } from '@/lib/terminalLayout';
import type { TerminalAgentInfo } from '@/types';

/**
 * Agents (Claude Code, Codex) running inside CortX terminals — the backend
 * walks the process tree and broadcasts the whole list on `terminal-agents`
 * (see `agents/terminal_link.rs`).
 *
 * Both windows use it: the dock shows the same tab titles and statuses as the
 * Terminal window. The subscription starts on first use and is never torn
 * down — one listener per window, for the life of the window.
 */
interface TerminalAgentsState {
  /** Keyed by terminal id (`shell:<id>`, `service:<id>`, …). */
  agents: Map<string, TerminalAgentInfo>;
  /** Bumped on every payload, so memos that read the layout can depend on it. */
  revision: number;
  setAgents: (list: TerminalAgentInfo[]) => void;
}

export const useTerminalAgentsStore = create<TerminalAgentsState>()((set, get) => ({
  agents: new Map(),
  revision: 0,
  setAgents: (list) => {
    const agents = new Map(list.map((a) => [a.terminalId, a]));
    // The scope filter reads this registry through `tabInScope`.
    setAgentTerminalIds(agents.keys());
    set({ agents, revision: get().revision + 1 });
  },
}));

let started = false;

/** Idempotent: load the current list once, then follow the event. */
export function ensureTerminalAgents(): void {
  if (started) return;
  started = true;
  const apply = (list: TerminalAgentInfo[]) => useTerminalAgentsStore.getState().setAgents(list);
  void getTerminalAgents()
    .then(apply)
    .catch(() => {
      /* Backend not ready (or not Tauri): the event will fill it in. */
    });
  void onTerminalAgents(apply).catch(() => {
    /* Without the event the list simply stays as loaded. */
  });
}

/** The agent running in a terminal, if any. */
export function useTerminalAgent(terminalId: string | undefined): TerminalAgentInfo | undefined {
  return useTerminalAgentsStore((s) => (terminalId ? s.agents.get(terminalId) : undefined));
}
