import { create } from 'zustand';
import { getTerminalAgents, onTerminalAgents } from '@/lib/tauri';
import { setAgentTerminalIds } from '@/lib/terminalLayout';
import type { TerminalAgentInfo } from '@/types';
import { agentPhase, foldPhases, rawPhase, type AgentPhase, type PhaseTransition, type RawPhase } from './agentPhase';

/**
 * Agents (Claude Code, Codex) running inside CortX terminals — the backend
 * walks the process tree and broadcasts the whole list on `terminal-agents`
 * (see `agents/terminal_link.rs`).
 *
 * Both windows use it: the dock shows the same tab titles and statuses as the
 * Terminal window. The subscription starts on first use and is never torn
 * down — one listener per window, for the life of the window.
 *
 * On top of the raw list it keeps what only this window can know: which
 * finished turns the user has not looked at yet (`unseen`), and since when
 * each agent has been in its phase (`since`, for the inbox order). See
 * `agentPhase.ts` for the vocabulary.
 */
interface TerminalAgentsState {
  /** Keyed by terminal id (`shell:<id>`, `service:<id>`, …). */
  agents: Map<string, TerminalAgentInfo>;
  /** Bumped on every payload, so memos that read the layout can depend on it. */
  revision: number;
  raw: Map<string, RawPhase>;
  /** Turns that ended out of sight and have not been looked at since. */
  unseen: Set<string>;
  /** When each terminal entered its current raw phase (epoch ms). */
  since: Map<string, number>;
  /** When each terminal's agent was first seen (epoch ms). */
  firstSeen: Map<string, number>;
  /** When the first payload arrived (epoch ms), null before. */
  readyAt: number | null;
  setAgents: (list: TerminalAgentInfo[]) => void;
  /** The user looked at these terminals. */
  markSeen: (terminalIds: Iterable<string>) => void;
}

/**
 * Is a terminal in front of the user right now? Registered by `appStore`
 * (its `isTerminalInView`), which imports this store — hence a setter rather
 * than an import.
 */
let inView: (terminalId: string) => boolean = () => false;
export function registerAgentInView(fn: (terminalId: string) => boolean): void {
  inView = fn;
}

type TransitionListener = (transitions: PhaseTransition[], agents: Map<string, TerminalAgentInfo>) => void;
const transitionListeners = new Set<TransitionListener>();
/** Every change of phase, for the notifications. Returns the disposer. */
export function onAgentTransitions(fn: TransitionListener): () => void {
  transitionListeners.add(fn);
  return () => transitionListeners.delete(fn);
}

export const useTerminalAgentsStore = create<TerminalAgentsState>()((set, get) => ({
  agents: new Map(),
  revision: 0,
  raw: new Map(),
  unseen: new Set(),
  since: new Map(),
  firstSeen: new Map(),
  readyAt: null,
  setAgents: (list) => {
    const agents = new Map(list.map((a) => [a.terminalId, a]));
    // The scope filter reads this registry through `tabInScope`.
    setAgentTerminalIds(agents.keys());
    const prev = get();
    const raw = new Map([...agents].map(([id, a]) => [id, rawPhase(a)]));
    const { unseen, transitions } = foldPhases(prev.raw, prev.unseen, raw, (id) => inView(id));
    const now = Date.now();
    const since = new Map<string, number>();
    for (const id of raw.keys()) since.set(id, prev.raw.get(id) === raw.get(id) ? prev.since.get(id) ?? now : now);
    const firstSeen = new Map<string, number>();
    for (const id of raw.keys()) firstSeen.set(id, prev.firstSeen.get(id) ?? now);
    set({ agents, raw, unseen, since, firstSeen, readyAt: prev.readyAt ?? now, revision: prev.revision + 1 });
    if (transitions.length > 0) for (const fn of transitionListeners) fn(transitions, agents);
  },
  markSeen: (terminalIds) => {
    const { unseen } = get();
    if (unseen.size === 0) return;
    let next: Set<string> | null = null;
    for (const id of terminalIds) {
      if (!unseen.has(id)) continue;
      next ??= new Set(unseen);
      next.delete(id);
    }
    if (next) set({ unseen: next, revision: get().revision + 1 });
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

/** The phase of the agent in a terminal, outside React. */
export function phaseOf(terminalId: string): AgentPhase | null {
  const s = useTerminalAgentsStore.getState();
  const agent = s.agents.get(terminalId);
  return agent ? agentPhase(agent, s.unseen.has(terminalId)) : null;
}

/** Same, as a hook. */
export function useAgentPhase(terminalId: string | undefined): AgentPhase | null {
  return useTerminalAgentsStore((s) => {
    const agent = terminalId ? s.agents.get(terminalId) : undefined;
    return agent && terminalId ? agentPhase(agent, s.unseen.has(terminalId)) : null;
  });
}
