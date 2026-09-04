/**
 * Terminal window layout: the document shared by every CortX window through
 * the backend (`get_terminal_layout` / `set_terminal_layout` + the
 * `terminal-layout` event). Pure types and tree helpers; no store logic.
 *
 * - `surfaces` says where each terminal id is shown: in the bottom dock of the
 *   main window or in the dedicated Terminal window. A terminal lives in one
 *   surface at a time.
 * - `window` is the Terminal window itself: flat tabs, each tab owning a
 *   split tree of leaves (one terminal per leaf). Tabs belong to a workspace
 *   (`project:<id>` or `free`), which the rail uses for grouping and the
 *   scope switcher for filtering.
 */

/** The window is scoped to one project. */
export interface ProjectScope {
  projectId: string;
  agents?: false;
}

/**
 * The window is scoped to the sessions an agent is running in (DEV-13). It
 * carries `projectId: null` so the callers that only ask "which project is
 * this window scoped to?" keep working — the answer is simply "none".
 */
export interface AgentsScope {
  projectId: null;
  agents: true;
}

/**
 * What the Terminal window shows: everything, one project, or only the
 * sessions an agent is running in. The agent scope is a filter over the same
 * list, not another way of managing agents (that is the Agents section).
 */
export type TerminalScope = 'global' | ProjectScope | AgentsScope;

export const AGENTS_SCOPE: AgentsScope = { projectId: null, agents: true };

export function isAgentsScope(scope: TerminalScope): scope is AgentsScope {
  return typeof scope !== 'string' && scope.agents === true;
}

export type TerminalSurface = 'dock' | 'window';
/** `horizontal` = children side by side, `vertical` = stacked. */
export type SplitDirection = 'horizontal' | 'vertical';

export const FREE_WORKSPACE_ID = 'free';

export interface LeafNode {
  kind: 'leaf';
  id: string;
  terminalId: string;
  /** Last directory the shell reported (OSC 7); where a restored shell reopens. */
  cwd?: string | null;
  /** Last size of the pane, so a restored shell starts at the size it will
      have instead of being resized once its prompt is already drawn. */
  cols?: number;
  rows?: number;
  /** Shell command line to use when restoring (launch configs). */
  shell?: string | null;
}

export interface SplitNode {
  kind: 'split';
  id: string;
  direction: SplitDirection;
  /** Fractions summing to 1, one per child. */
  sizes: number[];
  children: LayoutNode[];
}

export type LayoutNode = LeafNode | SplitNode;

export interface TerminalTab {
  id: string;
  /** `project:<projectId>` or `free`. */
  workspaceId: string;
  /** Manual title; null = derived from the active leaf's terminal. */
  title: string | null;
  color: string | null;
  pinned: boolean;
  order: number;
  layout: LayoutNode;
  activeLeafId: string;
  /** One leaf shown alone, the rest of the split hidden (Ctrl+Shift+Enter). */
  maximizedLeafId?: string | null;
}

export interface TerminalWindowLayout {
  scope: TerminalScope;
  activeTabId: string | null;
  tabs: TerminalTab[];
}

export interface TerminalLayoutDoc {
  version: 1;
  surfaces: Record<string, TerminalSurface>;
  window: TerminalWindowLayout;
  /** Maintained by the backend: was the Terminal window up at the last quit? */
  windowOpen?: boolean;
}

export function emptyLayoutDoc(): TerminalLayoutDoc {
  return {
    version: 1,
    surfaces: {},
    window: { scope: 'global', activeTabId: null, tabs: [] },
    windowOpen: false,
  };
}

/**
 * A persisted document may carry a scope this build knows nothing about (an
 * older CortX reading a newer `sessions.json`, or the other way round).
 * Anything unrecognised falls back to Global rather than blowing up.
 */
export function normaliseScope(raw: unknown): TerminalScope {
  if (raw === 'global') return 'global';
  if (raw === 'agents') return AGENTS_SCOPE;
  if (raw && typeof raw === 'object') {
    const scope = raw as { projectId?: unknown; agents?: unknown };
    if (scope.agents === true) return AGENTS_SCOPE;
    if (typeof scope.projectId === 'string' && scope.projectId) return { projectId: scope.projectId };
  }
  return 'global';
}

/** Coerce whatever the backend hands back (possibly `null` or an older shape). */
export function normaliseLayoutDoc(raw: unknown): TerminalLayoutDoc {
  const base = emptyLayoutDoc();
  if (!raw || typeof raw !== 'object') return base;
  const doc = raw as Partial<TerminalLayoutDoc>;
  const win = doc.window && typeof doc.window === 'object' ? doc.window : base.window;
  return {
    version: 1,
    surfaces: doc.surfaces && typeof doc.surfaces === 'object' ? { ...doc.surfaces } : {},
    window: {
      scope: normaliseScope(win.scope),
      activeTabId: win.activeTabId ?? null,
      tabs: Array.isArray(win.tabs) ? win.tabs.slice() : [],
    },
    windowOpen: doc.windowOpen === true,
  };
}

export function newLayoutId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function workspaceIdForProject(projectId?: string | null): string {
  return projectId ? `project:${projectId}` : FREE_WORKSPACE_ID;
}

export function projectIdOfWorkspace(workspaceId: string): string | null {
  return workspaceId.startsWith('project:') ? workspaceId.slice('project:'.length) : null;
}

export function scopeEquals(a: TerminalScope, b: TerminalScope): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  if (isAgentsScope(a) || isAgentsScope(b)) return isAgentsScope(a) && isAgentsScope(b);
  return a.projectId === b.projectId;
}

// ---------------------------------------------------------------------------
// Terminals hosting an agent (DEV-13)
// ---------------------------------------------------------------------------

/**
 * Terminal ids an agent is currently running in, kept next to the pure
 * helpers so `tabInScope` can answer for the `agents` scope without every
 * caller (the layout store, the window, the palette, the find bar) having to
 * thread the agent list through. Written by
 * `components/terminal/agentsStore.ts` on every `terminal-agents` event.
 */
let agentTerminalIds: ReadonlySet<string> = new Set();

export function setAgentTerminalIds(ids: Iterable<string>): void {
  agentTerminalIds = new Set(ids);
}

export function isAgentTerminal(terminalId: string): boolean {
  return agentTerminalIds.has(terminalId);
}

/** Does this tab hold at least one terminal an agent is running in? */
export function tabHasAgent(tab: TerminalTab): boolean {
  if (agentTerminalIds.size === 0) return false;
  return collectLeaves(tab.layout).some((l) => agentTerminalIds.has(l.terminalId));
}

export function tabInScope(tab: TerminalTab, scope: TerminalScope): boolean {
  if (scope === 'global') return true;
  if (isAgentsScope(scope)) return tabHasAgent(tab);
  return tab.workspaceId === workspaceIdForProject(scope.projectId);
}

export function tabsInScope(layout: TerminalWindowLayout, scope: TerminalScope): TerminalTab[] {
  return layout.tabs.filter((t) => tabInScope(t, scope)).sort((a, b) => a.order - b.order);
}

// ---------------------------------------------------------------------------
// Tree helpers (all pure; return new nodes, never mutate)
// ---------------------------------------------------------------------------

export function collectLeaves(node: LayoutNode): LeafNode[] {
  if (node.kind === 'leaf') return [node];
  return node.children.flatMap(collectLeaves);
}

export function findLeaf(node: LayoutNode, leafId: string): LeafNode | null {
  if (node.kind === 'leaf') return node.id === leafId ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, leafId);
    if (found) return found;
  }
  return null;
}

export function findLeafByTerminal(node: LayoutNode, terminalId: string): LeafNode | null {
  return collectLeaves(node).find((l) => l.terminalId === terminalId) ?? null;
}

export function makeLeaf(terminalId: string): LeafNode {
  return { kind: 'leaf', id: newLayoutId(), terminalId };
}

/**
 * Insert `leaf` next to `targetLeafId`, splitting in `direction`. When the
 * target's parent already splits in that direction the leaf joins it as a
 * sibling; otherwise the target is replaced by a new two-child split.
 */
export function insertLeafBeside(
  node: LayoutNode,
  targetLeafId: string,
  leaf: LeafNode,
  direction: SplitDirection,
  after = true
): LayoutNode {
  if (node.kind === 'leaf') {
    if (node.id !== targetLeafId) return node;
    const children = after ? [node, leaf] : [leaf, node];
    return { kind: 'split', id: newLayoutId(), direction, sizes: [0.5, 0.5], children };
  }
  const idx = node.children.findIndex((c) => c.kind === 'leaf' && c.id === targetLeafId);
  if (idx !== -1 && node.direction === direction) {
    const children = node.children.slice();
    const insertAt = after ? idx + 1 : idx;
    children.splice(insertAt, 0, leaf);
    // Give the newcomer half of the target's share.
    const sizes = node.sizes.slice();
    const share = sizes[idx] / 2;
    sizes[idx] = share;
    sizes.splice(insertAt, 0, share);
    return { ...node, children, sizes };
  }
  return {
    ...node,
    children: node.children.map((c) => insertLeafBeside(c, targetLeafId, leaf, direction, after)),
  };
}

/** Remove a leaf; splits with one child left collapse into that child. */
export function removeLeaf(node: LayoutNode, leafId: string): LayoutNode | null {
  if (node.kind === 'leaf') return node.id === leafId ? null : node;
  const kept: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const next = removeLeaf(child, leafId);
    if (next) {
      kept.push(next);
      sizes.push(node.sizes[i] ?? 1 / node.children.length);
    }
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0];
  const total = sizes.reduce((s, v) => s + v, 0) || 1;
  return { ...node, children: kept, sizes: sizes.map((s) => s / total) };
}

export function setSplitSizes(node: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (node.kind === 'leaf') return node;
  if (node.id === splitId) return { ...node, sizes };
  return { ...node, children: node.children.map((c) => setSplitSizes(c, splitId, sizes)) };
}

/** Leaves in visual order (left→right, top→bottom), for keyboard navigation. */
export function orderedLeafIds(node: LayoutNode): string[] {
  return collectLeaves(node).map((l) => l.id);
}

export function tabContainingTerminal(layout: TerminalWindowLayout, terminalId: string): TerminalTab | null {
  return layout.tabs.find((t) => findLeafByTerminal(t.layout, terminalId)) ?? null;
}

export function nextTabOrder(layout: TerminalWindowLayout): number {
  return layout.tabs.reduce((m, t) => Math.max(m, t.order), 0) + 1;
}

export function makeTab(terminalId: string, workspaceId: string, order: number): TerminalTab {
  const leaf = makeLeaf(terminalId);
  return {
    id: newLayoutId(),
    workspaceId,
    title: null,
    color: null,
    pinned: false,
    order,
    layout: leaf,
    activeLeafId: leaf.id,
  };
}

/** Apply `fn` to every leaf, returning a new tree (unchanged leaves keep identity). */
export function mapLeaves(node: LayoutNode, fn: (leaf: LeafNode) => LeafNode): LayoutNode {
  if (node.kind === 'leaf') return fn(node);
  let changed = false;
  const children = node.children.map((c) => {
    const next = mapLeaves(c, fn);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/** Record the live cwd of a terminal on its leaf (session restore reopens it there). */
export function setLeafCwd(layout: TerminalWindowLayout, terminalId: string, cwd: string): TerminalWindowLayout {
  let changed = false;
  const tabs = layout.tabs.map((t) => {
    const next = mapLeaves(t.layout, (leaf) =>
      leaf.terminalId === terminalId && leaf.cwd !== cwd ? { ...leaf, cwd } : leaf
    );
    if (next === t.layout) return t;
    changed = true;
    return { ...t, layout: next };
  });
  return changed ? { ...layout, tabs } : layout;
}

/**
 * Record the size of a terminal's pane on its leaf.
 *
 * A shell spawned at the wrong size gets resized once it has already printed
 * its prompt (and, for a profile like fastfetch, a screenful above it). The
 * shell's line editor keeps the coordinates it captured before the resize, so
 * what you type lands several lines above the prompt. Restoring at the right
 * size removes the resize altogether.
 */
export function setLeafSize(
  layout: TerminalWindowLayout,
  terminalId: string,
  cols: number,
  rows: number
): TerminalWindowLayout {
  let changed = false;
  const tabs = layout.tabs.map((t) => {
    const next = mapLeaves(t.layout, (leaf) =>
      leaf.terminalId === terminalId && (leaf.cols !== cols || leaf.rows !== rows)
        ? { ...leaf, cols, rows }
        : leaf
    );
    if (next === t.layout) return t;
    changed = true;
    return { ...t, layout: next };
  });
  return changed ? { ...layout, tabs } : layout;
}

/** Swap terminal ids (restored shells get fresh ids). */
export function replaceTerminalIds(layout: TerminalWindowLayout, mapping: Record<string, string>): TerminalWindowLayout {
  const tabs = layout.tabs.map((t) => ({
    ...t,
    layout: mapLeaves(t.layout, (leaf) =>
      mapping[leaf.terminalId] ? { ...leaf, terminalId: mapping[leaf.terminalId] } : leaf
    ),
  }));
  return { ...layout, tabs };
}

/** Every leaf of the window with its tab. */
export function allWindowLeaves(layout: TerminalWindowLayout): Array<{ tab: TerminalTab; leaf: LeafNode }> {
  return layout.tabs.flatMap((tab) => collectLeaves(tab.layout).map((leaf) => ({ tab, leaf })));
}
