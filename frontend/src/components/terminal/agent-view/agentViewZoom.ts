/**
 * The zoom of each agent view (CORT-66): Ctrl + = / − / 0 and Ctrl + wheel
 * in a pane in GUI mode zoom that pane's conversation, not every terminal of
 * the window. Remembered per pane in this browser, like the side panel.
 */
import { create } from 'zustand';

/** The levels a step goes through, as browsers do. */
export const AGENT_VIEW_ZOOM_LEVELS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

const KEY = 'cortx.agentView.zoom';
/** Panes remembered at most; the oldest go first. */
const KEEP = 60;

function load(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function save(zoom: Record<string, number>) {
  try {
    const entries = Object.entries(zoom).filter(([, z]) => z !== 1);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries.slice(-KEEP))));
  } catch {
    /* not remembered */
  }
}

interface AgentViewZoomState {
  zoom: Record<string, number>;
}

export const useAgentViewZoomStore = create<AgentViewZoomState>()(() => ({ zoom: load() }));

export function agentViewZoom(terminalId: string): number {
  return useAgentViewZoomStore.getState().zoom[terminalId] ?? 1;
}

export function useAgentViewZoom(terminalId: string): number {
  return useAgentViewZoomStore((s) => s.zoom[terminalId] ?? 1);
}

function setZoom(terminalId: string, value: number) {
  const zoom = { ...useAgentViewZoomStore.getState().zoom };
  delete zoom[terminalId];
  if (value !== 1) zoom[terminalId] = value;
  useAgentViewZoomStore.setState({ zoom });
  save(zoom);
}

/** One level up (`step` > 0) or down; returns the new zoom. */
export function adjustAgentViewZoom(terminalId: string, step: number): number {
  const current = agentViewZoom(terminalId);
  const levels = AGENT_VIEW_ZOOM_LEVELS;
  let index = levels.findIndex((l) => Math.abs(l - current) < 0.001);
  if (index < 0) {
    // Off the scale (an older level): start from the nearest one.
    index = levels.reduce((best, l, i) => (Math.abs(l - current) < Math.abs(levels[best] - current) ? i : best), 0);
  }
  const next = levels[Math.min(levels.length - 1, Math.max(0, index + Math.sign(step)))];
  setZoom(terminalId, next);
  return next;
}

export function resetAgentViewZoom(terminalId: string) {
  setZoom(terminalId, 1);
}
