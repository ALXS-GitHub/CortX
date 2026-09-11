/**
 * State of the floating completion menu, one entry per terminal (#17), and the
 * small broker that lets **two** surfaces drive it (U2.a / U2.b).
 *
 * Deliberately a plain external store rather than zustand: the menu is driven
 * from the xterm side (`terminalSuggest.ts`), which lives outside React and
 * outlives the components, and the React view only ever reads it through
 * `useSyncExternalStore`. Keeping the two apart is also what guarantees the
 * menu can never take the keyboard focus away from the terminal — no input,
 * no focusable node, nothing to focus.
 *
 * ## Why the engine registry is here
 *
 * Since U2 the completions and the ghost text have two consumers: the grid
 * (`terminalSuggest.ts`, which reads the line out of xterm's buffer) and the
 * universal input editor (`terminalInputEditor.ts`, which owns the line in a
 * `<textarea>`). Only the first one holds the ranked sources — the history of
 * this window, what the last command's output suggested, the cached specs —
 * so the second has to ask it. Having the editor import `terminalSuggest`
 * directly would close an import cycle (`terminalSuggest` already asks the
 * editor whether it owns the line), so the engine is *published* here instead,
 * in the module both already depend on. `terminalSuggest` registers, the
 * editor looks up, neither knows about the other.
 */
import type { CompletionItem } from '@/lib/terminalCompletion';

export interface CompletionMenuState {
  open: boolean;
  items: CompletionItem[];
  /** Index of the highlighted row. */
  index: number;
  /** Cursor cell in viewport coordinates, for `position: fixed`. */
  anchor: { left: number; top: number; bottom: number; cellHeight: number } | null;
  /**
   * One line of context about the command being typed rather than about any
   * row — today, the expansion of an alias CortX itself defines (#38),
   * `cc → claude --dangerously-skip-permissions`. Drawn as a footer, dimmed,
   * never selectable. Optional: a surface that has nothing to say omits it.
   */
  hint?: string | null;
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
    (prev.hint ?? null) === (next.hint ?? null) &&
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
 * Accepting a row is done by whoever opened the menu, not by the view; the
 * view only tells it which row was clicked.
 *
 * A **stack**, not a single slot: the grid's engine registers once for the
 * life of the session, and the input editor pushes its own accepter for as
 * long as *its* menu is open. The top of the stack wins, and unregistering
 * restores whoever was there before — so neither surface can silently steal
 * the other's rows.
 */
type AcceptFn = (index: number) => void;
const accepters = new Map<string, AcceptFn[]>();

export function registerAccept(terminalId: string, fn: AcceptFn): () => void {
  const stack = accepters.get(terminalId) ?? [];
  stack.push(fn);
  accepters.set(terminalId, stack);
  return () => {
    const current = accepters.get(terminalId);
    if (!current) return;
    const i = current.lastIndexOf(fn);
    if (i >= 0) current.splice(i, 1);
    if (current.length === 0) accepters.delete(terminalId);
  };
}

export function acceptMenuItem(terminalId: string, index: number) {
  const stack = accepters.get(terminalId);
  stack?.[stack.length - 1]?.(index);
}

// ---------------------------------------------------------------------------
// The completion engine, published for whoever needs it (U2)
// ---------------------------------------------------------------------------

/** Where a terminal is, for the sources that are filtered by directory. */
export interface EngineScope {
  cwd: string | null;
  projectId: string | null;
}

/**
 * Everything a surface needs to offer completions on a line it holds itself.
 *
 * Implemented by `terminalSuggest.ts`'s controller — it is the only thing that
 * knows the merged, ranked sources — and consumed by the input editor. Both
 * calls are synchronous and read from an in-memory cache; a miss schedules a
 * background fetch and `onCompletionData` fires when it lands.
 */
export interface CompletionEngine {
  /** The remainder to draw after `line`, or null for "say nothing". */
  ghost(line: string): string | null;
  /** Every candidate for `line`, best first. */
  items(line: string, limit?: number): CompletionItem[];
  /** The terminal's directory and project, for the history palette. */
  scope(): EngineScope;
}

const engines = new Map<string, CompletionEngine>();

export function registerEngine(terminalId: string, engine: CompletionEngine): () => void {
  engines.set(terminalId, engine);
  return () => {
    if (engines.get(terminalId) === engine) engines.delete(terminalId);
  };
}

/** Null when suggestions are switched off entirely (no controller attached). */
export function getEngine(terminalId: string): CompletionEngine | null {
  return engines.get(terminalId) ?? null;
}
