/**
 * The colours of the agent dots — a family of their own (ticket: agent mode).
 *
 * A shell, a service or a script never uses any of these, and an agent never
 * uses theirs: green is "running" / "succeeded", red "failed", yellow
 * "starting", blue "open" for everything else in CortX. So:
 *
 * - working   — violet, pulsing (what agents already were);
 * - needs you — orange, the loudest;
 * - done      — cyan, "finished, you have not looked";
 * - idle      — a muted violet ring.
 *
 * Each can be changed (`terminal.agentColor*`). Pure, no imports, so
 * `terminalDefaults.ts` can take the defaults under plain Node.
 */
export const DEFAULT_AGENT_COLORS = {
  working: '#8b5cf6',
  needsYou: '#f97316',
  done: '#06b6d4',
  idle: '#8b7fb0',
} as const;

export type AgentColorKey = keyof typeof DEFAULT_AGENT_COLORS;

/** CSS custom property each colour is published under. */
export const AGENT_COLOR_VAR: Record<AgentColorKey, string> = {
  working: '--agent-working',
  needsYou: '--agent-needs-you',
  done: '--agent-done',
  idle: '--agent-idle',
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** The colour to use: the user's when it is a colour, else the default. */
export function agentColor(key: AgentColorKey, stored: string | null | undefined): string {
  const value = stored?.trim();
  return value && HEX.test(value) ? value : DEFAULT_AGENT_COLORS[key];
}
