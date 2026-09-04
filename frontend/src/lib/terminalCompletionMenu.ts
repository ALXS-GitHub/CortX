/**
 * State of the floating completion menu, one entry per terminal (#17).
 *
 * Deliberately a plain external store rather than zustand: the menu is driven
 * from the xterm side (`terminalSuggest.ts`), which lives outside React and
 * outlives the components, and the React view only ever reads it through
 * `useSyncExternalStore`. Keeping the two apart is also what guarantees the
 * menu can never take the keyboard focus away from the terminal — no input,
 * no focusable node, nothing to focus.
 */
import type { CompletionItem } from '@/lib/terminalCompletion';

export interface CompletionMenuState {
  open: boolean;
  items: CompletionItem[];
  /** Index of the highlighted row. */
  index: number;
  /** Cursor cell in viewport coordinates, for `position: fixed`. */
  anchor: { left: number; top: number; bottom: number; cellHeight: number } | null;
}

const CLOSED: CompletionMenuState = { open: false, items: [], index: 0, anchor: null };

const states = new Map<string, CompletionMenuState>();
const listeners = new Map<string, Set<() => void>>();

export function getMenuState(terminalId: string): CompletionMenuState {
  return states.get(terminalId) ?? CLOSED;
}

export function subscribeMenu(terminalId: string, listener: () => void): () => void {
  let set = listeners.get(terminalId);
  if (!set) {
    set = new Set();
    listeners.set(terminalId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listeners.delete(terminalId);
  };
}

function emit(terminalId: string) {
  for (const l of listeners.get(terminalId) ?? []) l();
}

/** Replace the state of one terminal's menu. */
export function setMenuState(terminalId: string, next: CompletionMenuState) {
  const prev = getMenuState(terminalId);
  if (
    prev.open === next.open &&
    prev.index === next.index &&
    prev.items === next.items &&
    prev.anchor?.left === next.anchor?.left &&
    prev.anchor?.top === next.anchor?.top
  ) {
    return;
  }
  states.set(terminalId, next);
  emit(terminalId);
}

export function closeMenu(terminalId: string) {
  if (!states.has(terminalId) || !getMenuState(terminalId).open) return;
  states.set(terminalId, CLOSED);
  emit(terminalId);
}

/** Forget a terminal entirely (its pane went away). */
export function forgetMenu(terminalId: string) {
  states.delete(terminalId);
  emit(terminalId);
}

/**
 * Accepting a row is done by the controller, not the view; the view only
 * tells it which row was clicked.
 */
type AcceptFn = (index: number) => void;
const accepters = new Map<string, AcceptFn>();

export function registerAccept(terminalId: string, fn: AcceptFn): () => void {
  accepters.set(terminalId, fn);
  return () => {
    if (accepters.get(terminalId) === fn) accepters.delete(terminalId);
  };
}

export function acceptMenuItem(terminalId: string, index: number) {
  accepters.get(terminalId)?.(index);
}
