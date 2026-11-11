/**
 * What an agent in a terminal is doing, as the user cares about it — the
 * single vocabulary behind its dot, the grid, the counter, the inbox and the
 * notifications.
 *
 * Pure, **no imports**, so `agentPhase.test.ts` runs it on plain Node like
 * `sectionOrder.ts`.
 *
 * Everything here is read off what the agent writes by itself (its live
 * registry, its transcript) and off the terminal's own output — see
 * `agents/terminal_link.rs`, `mark_needs_input`. CortX never sends the agent
 * anything to find out.
 *
 * - `working`   — busy on a turn.
 * - `needs-you` — stopped on you: a question, a plan to approve, a permission
 *                 prompt.
 * - `done`      — finished its turn and you have not looked at it since.
 * - `idle`      — finished, and you have seen it.
 * - `unknown`   — alive, but publishes nothing (Codex).
 */
export type AgentPhase = 'working' | 'needs-you' | 'done' | 'idle' | 'unknown';

/** What each agent phase is called, for tooltips and lists. */
export const AGENT_PHASE_LABEL: Record<AgentPhase, string> = {
  working: 'Working',
  'needs-you': 'Needs you',
  done: 'Done · not seen yet',
  idle: 'Idle · your turn',
  unknown: 'Running',
};

/** The little of `TerminalAgentInfo` the decision reads. */
export interface AgentPhaseInput {
  state: 'running' | 'waiting' | 'stopped' | 'unknown';
  needsInput?: 'question' | 'permission' | null;
}

/** The phase before "seen" is taken into account: `done` and `idle` are one. */
export type RawPhase = 'working' | 'needs-you' | 'rest' | 'unknown';

export function rawPhase(agent: AgentPhaseInput): RawPhase {
  if (agent.needsInput) return 'needs-you';
  if (agent.state === 'running') return 'working';
  if (agent.state === 'waiting' || agent.state === 'stopped') return 'rest';
  return 'unknown';
}

export function agentPhase(agent: AgentPhaseInput, unseenDone: boolean): AgentPhase {
  const raw = rawPhase(agent);
  if (raw === 'rest') return unseenDone ? 'done' : 'idle';
  return raw;
}

/** The phases that ask something of the user, in the order they are owed. */
export function isAttention(phase: AgentPhase): phase is 'needs-you' | 'done' {
  return phase === 'needs-you' || phase === 'done';
}

export interface PhaseTransition {
  terminalId: string;
  from: RawPhase | null;
  to: RawPhase;
}

/**
 * Fold a new payload into the "finished, not looked at yet" set.
 *
 * A turn that ends (`working` / `needs-you` → `rest`) leaves the terminal
 * unseen unless it is in front of the user at that moment (`inView`). Going
 * back to work clears it — the next end will set it again — and so does an
 * agent leaving the terminal. `transitions` lists every change of raw phase,
 * for the notifications.
 */
export function foldPhases(
  previous: ReadonlyMap<string, RawPhase>,
  unseen: ReadonlySet<string>,
  next: ReadonlyMap<string, RawPhase>,
  inView: (terminalId: string) => boolean
): { unseen: Set<string>; transitions: PhaseTransition[] } {
  const out = new Set<string>();
  const transitions: PhaseTransition[] = [];
  for (const [id, to] of next) {
    const from = previous.get(id) ?? null;
    if (from !== to) transitions.push({ terminalId: id, from, to });
    if (to !== 'rest') continue;
    const ended = from === 'working' || from === 'needs-you';
    if (ended ? !inView(id) : unseen.has(id)) out.add(id);
  }
  return { unseen: out, transitions };
}

/** Attention first: needs-you before done, the longest-waiting first in each. */
export function attentionOrder<T extends { phase: AgentPhase; since: number }>(items: readonly T[]): T[] {
  const rank = (p: AgentPhase) => (p === 'needs-you' ? 0 : p === 'done' ? 1 : 2);
  return items
    .filter((i) => isAttention(i.phase))
    .slice()
    .sort((a, b) => rank(a.phase) - rank(b.phase) || a.since - b.since);
}
