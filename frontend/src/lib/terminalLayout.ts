/**
 * Terminal window layout: the document shared by every CortX window through
 * the backend (`get_terminal_layout` / `set_terminal_layout` + the
 * `terminal-layout` event). Pure types and tree helpers; no store logic.
 *
 * - `surfaces` says where each terminal id is shown: in the bottom dock of the
 *   main window or in a Terminal window. A terminal lives in one surface at a
 *   time.
 * - `window` is *this* webview's view of the Terminal windows: `tabs` holds
 *   every tab of every Terminal window (so whoever walks the whole document —
 *   session restore, snapshot pruning — sees all of them), while `scope` and
 *   `activeTabId` are the local window's. Each tab owns a split tree of leaves
 *   (one terminal per leaf) and belongs to a workspace (`project:<id>` or
 *   `free`), which the rail uses for grouping and the scope switcher for
 *   filtering.
 * - `windows` maps a Terminal window's Tauri label to its own scope and active
 *   tab; a tab names its window with `windowId` (DEV-13, ticket #20). A tab
 *   without one belongs to the first window, so a document written when there
 *   could only be one opens unchanged.
 *
 * "Which window am I?" is module state (`setLocalTerminalWindowId`), set once
 * by the layout store, so that every existing caller of `tabsInScope` keeps
 * meaning "the tabs of the window I am rendering".
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
  /**
   * Tauri label of the Terminal window showing this tab. Absent = the first
   * one (`PRIMARY_TERMINAL_WINDOW`), which is what every tab of a document
   * written before ticket #20 is.
   */
  windowId?: string;
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
  /** Scope of the *local* Terminal window. */
  scope: TerminalScope;
  /** Active tab of the *local* Terminal window. */
  activeTabId: string | null;
  /** Every tab of every Terminal window (filter with `tabsInScope`). */
  tabs: TerminalTab[];
}

/** What a Terminal window keeps for itself; the tabs live in `window.tabs`. */
export interface TerminalWindowState {
  scope: TerminalScope;
  activeTabId: string | null;
}

export interface TerminalLayoutDoc {
  version: number;
  surfaces: Record<string, TerminalSurface>;
  window: TerminalWindowLayout;
  /** Scope + active tab of each Terminal window, by Tauri label. */
  windows: Record<string, TerminalWindowState>;
  /** Maintained by the backend: was a Terminal window up at the last quit? */
  windowOpen?: boolean;
  /** Which Terminal windows were up, so the next start reopens them all. */
  openWindows?: string[];
}

/**
 * Document version this build writes. v1 knew a single Terminal window; v2
 * (ticket #20) adds `windowId` on tabs and the `windows` / `openWindows`
 * keys. `window.tabs` still holds every tab, so a v1 build opening a v2
 * document shows all of them in its one window instead of losing any.
 */
export const LAYOUT_VERSION = 2;

/** Tauri label of the first Terminal window (the one that always exists). */
export const PRIMARY_TERMINAL_WINDOW = 'terminal';

/**
 * Which Terminal window this webview renders. The Terminal windows set their
 * own label; the main window speaks for the first one (it is the window that
 * restores its sessions and owns its tabs while it is closed), exactly as it
 * did when there could only be one.
 */
let localWindowId: string = PRIMARY_TERMINAL_WINDOW;

export function setLocalTerminalWindowId(id: string): void {
  localWindowId = id || PRIMARY_TERMINAL_WINDOW;
}

export function localTerminalWindowId(): string {
  return localWindowId;
}

/** The window a tab is shown in (absent `windowId` = the first window). */
export function terminalWindowIdOf(tab: TerminalTab): string {
  return tab.windowId || PRIMARY_TERMINAL_WINDOW;
}

/** Is this tab shown by the window this webview renders? */
export function tabIsLocal(tab: TerminalTab): boolean {
  return terminalWindowIdOf(tab) === localWindowId;
}

/**
 * Put a tab in a window. The first window is stored as *no* `windowId`, so a
 * document that never used a second window stays exactly what it was.
 */
export function setTabWindow(tab: TerminalTab, windowId: string): TerminalTab {
  if (windowId === PRIMARY_TERMINAL_WINDOW) {
    if (tab.windowId === undefined) return tab;
    const rest: TerminalTab = { ...tab };
    delete rest.windowId;
    return rest;
  }
  return tab.windowId === windowId ? tab : { ...tab, windowId };
}

export function tabsOfWindow(layout: TerminalWindowLayout, windowId: string): TerminalTab[] {
  return layout.tabs.filter((t) => terminalWindowIdOf(t) === windowId).sort((a, b) => a.order - b.order);
}

/** Every window label the document knows about, first window first. */
export function terminalWindowIds(doc: TerminalLayoutDoc): string[] {
  const ids = new Set<string>([PRIMARY_TERMINAL_WINDOW, ...Object.keys(doc.windows)]);
  for (const tab of doc.window.tabs) ids.add(terminalWindowIdOf(tab));
  for (const id of doc.openWindows ?? []) ids.add(id);
  return [PRIMARY_TERMINAL_WINDOW, ...[...ids].filter((id) => id !== PRIMARY_TERMINAL_WINDOW).sort()];
}

/**
 * A free label for a new Terminal window: `terminal-2`, `terminal-3`… The
 * lowest free number is reused so the labels stay readable in logs and the
 * window titles stay small after a few detach / close rounds.
 */
export function nextTerminalWindowLabel(doc: TerminalLayoutDoc): string {
  const taken = new Set(terminalWindowIds(doc));
  for (let n = 2; n < 1000; n++) {
    const label = `${PRIMARY_TERMINAL_WINDOW}-${n}`;
    if (!taken.has(label)) return label;
  }
  return `${PRIMARY_TERMINAL_WINDOW}-${Date.now()}`;
}

/** 1 for the first window, 2 for `terminal-2`… (window titles, menus). */
export function terminalWindowNumber(windowId: string): number {
  if (windowId === PRIMARY_TERMINAL_WINDOW) return 1;
  const n = Number(windowId.slice(`${PRIMARY_TERMINAL_WINDOW}-`.length));
  return Number.isFinite(n) && n > 1 ? n : 1;
}

export function terminalWindowName(windowId: string): string {
  const n = terminalWindowNumber(windowId);
  return n === 1 ? 'Terminal' : `Terminal ${n}`;
}

export function emptyLayoutDoc(): TerminalLayoutDoc {
  return {
    version: LAYOUT_VERSION,
    surfaces: {},
    window: { scope: 'global', activeTabId: null, tabs: [] },
    windows: { [localWindowId]: { scope: 'global', activeTabId: null } },
    windowOpen: false,
    openWindows: [],
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

/**
 * Read the `windows` map, migrating a v1 document on the way: a document
 * written before ticket #20 has no `windows`, and its single window's scope
 * and active tab are the first window's. Rust does the same when it loads
 * `sessions.json` (`terminal/layout.rs::migrate`); this is the second line of
 * defence, for a document that reached us some other way.
 */
function normaliseWindowStates(raw: unknown, win: Partial<TerminalWindowLayout>): Record<string, TerminalWindowState> {
  const out: Record<string, TerminalWindowState> = {};
  if (raw && typeof raw === 'object') {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!id) continue;
      const state = (value ?? {}) as Partial<TerminalWindowState>;
      out[id] = { scope: normaliseScope(state.scope), activeTabId: state.activeTabId ?? null };
    }
  }
  if (Object.keys(out).length === 0) {
    out[PRIMARY_TERMINAL_WINDOW] = { scope: normaliseScope(win.scope), activeTabId: win.activeTabId ?? null };
  }
  return out;
}

/** Coerce whatever the backend hands back (possibly `null` or an older shape). */
export function normaliseLayoutDoc(raw: unknown): TerminalLayoutDoc {
  const base = emptyLayoutDoc();
  if (!raw || typeof raw !== 'object') return base;
  const doc = raw as Partial<TerminalLayoutDoc>;
  const win = doc.window && typeof doc.window === 'object' ? doc.window : base.window;
  const windows = normaliseWindowStates(doc.windows, win);
  // A window with no entry yet (freshly created, or the local one on a first
  // run) starts Global with nothing selected.
  const local = windows[localWindowId] ?? { scope: 'global' as TerminalScope, activeTabId: null };
  windows[localWindowId] = local;
  return {
    version: typeof doc.version === 'number' && doc.version > LAYOUT_VERSION ? doc.version : LAYOUT_VERSION,
    surfaces: doc.surfaces && typeof doc.surfaces === 'object' ? { ...doc.surfaces } : {},
    window: {
      scope: local.scope,
      activeTabId: local.activeTabId,
      tabs: Array.isArray(win.tabs) ? win.tabs.slice() : [],
    },
    windows,
    windowOpen: doc.windowOpen === true,
    openWindows: Array.isArray(doc.openWindows) ? doc.openWindows.filter((id) => typeof id === 'string') : [],
  };
}

/**
 * Fold the local window's `scope` / `activeTabId` back into `windows` before
 * the document is shared, and drop the windows nothing refers to any more.
 * Every mutation goes through here (see `terminalLayoutStore.commit`), which
 * is what lets the rest of the code keep mutating `doc.window` as if there
 * were still one Terminal window.
 */
export function withLocalWindow(doc: TerminalLayoutDoc): TerminalLayoutDoc {
  const referenced = new Set<string>([localWindowId, PRIMARY_TERMINAL_WINDOW, ...(doc.openWindows ?? [])]);
  for (const tab of doc.window.tabs) referenced.add(terminalWindowIdOf(tab));
  const windows: Record<string, TerminalWindowState> = {};
  for (const [id, state] of Object.entries(doc.windows)) {
    if (referenced.has(id)) windows[id] = state;
  }
  windows[localWindowId] = { scope: doc.window.scope, activeTabId: doc.window.activeTabId };
  for (const id of referenced) {
    windows[id] ??= { scope: 'global', activeTabId: null };
  }
  return { ...doc, version: doc.version || LAYOUT_VERSION, windows };
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

/**
 * Is this tab on screen here? A tab shown by another Terminal window is never
 * in scope — that is what keeps every existing caller of `tabsInScope` (the
 * rail, the strip, the palette, "which panes are visible") meaning "of this
 * window" now that `window.tabs` holds them all.
 */
export function tabInScope(tab: TerminalTab, scope: TerminalScope): boolean {
  if (!tabIsLocal(tab)) return false;
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

export function makeTab(
  terminalId: string,
  workspaceId: string,
  order: number,
  windowId: string = localWindowId
): TerminalTab {
  const leaf = makeLeaf(terminalId);
  return setTabWindow(
    {
      id: newLayoutId(),
      workspaceId,
      title: null,
      color: null,
      pinned: false,
      order,
      layout: leaf,
      activeLeafId: leaf.id,
    },
    windowId
  );
}

/**
 * Where a brand-new tab goes (ticket #25).
 *
 * Browsers open a new tab **next to the one you were on**, not at the far end
 * of the strip, and that is what this answers: the id the newcomer follows.
 *
 * The rail does not show `tabs` in raw order — it groups by workspace — so
 * "after the active tab" would put a tab of another project at the *top* of
 * its own group, which is not next to anything the user was looking at. Hence
 * two cases:
 *
 * - same workspace as the tab you were on → right after it (the browser rule,
 *   and it reads the same in the strip and in the rail);
 * - another workspace → after the last tab of **its own** group, which is
 *   where the rail is going to draw it anyway; the strip then shows it next to
 *   its siblings rather than stranded mid-list.
 *
 * A workspace with no tab yet has no group to join: it follows the active tab.
 */
function anchorTabId(siblings: TerminalTab[], tab: TerminalTab, afterTabId: string | null | undefined): string | null {
  const active = siblings.find((t) => t.id === afterTabId) ?? null;
  if (active && active.workspaceId === tab.workspaceId) return active.id;
  const own = siblings.filter((t) => t.workspaceId === tab.workspaceId);
  if (own.length > 0) return own[own.length - 1].id;
  return active?.id ?? null;
}

/**
 * Add `tab` to the window, ordered right after `afterTabId` (see
 * `anchorTabId`) instead of at the end. Only the tabs of the same Terminal
 * window are renumbered — `order` never competes across windows, since every
 * list that reads it (`tabsInScope`, `tabsOfWindow`) is already filtered to
 * one window.
 *
 * Pinned tabs are hoisted at display time (`sortTabs`), not here: a tab
 * inserted after a pinned one keeps that raw order and simply shows up first
 * among the unpinned, which is the closest "next to the one I was on" a
 * pinned-first list can offer.
 */
export function insertTabAfter(
  layout: TerminalWindowLayout,
  tab: TerminalTab,
  afterTabId: string | null | undefined
): TerminalTab[] {
  const windowId = terminalWindowIdOf(tab);
  const siblings = layout.tabs
    .filter((t) => terminalWindowIdOf(t) === windowId)
    .sort((a, b) => a.order - b.order);
  const anchor = anchorTabId(siblings, tab, afterTabId);
  const at = anchor ? siblings.findIndex((t) => t.id === anchor) + 1 : siblings.length;
  const sequence = [...siblings.slice(0, at), tab, ...siblings.slice(at)];
  const order = new Map(sequence.map((t, i) => [t.id, i + 1]));
  const placed = { ...tab, order: order.get(tab.id)! };
  const kept = layout.tabs.map((t) => {
    const next = order.get(t.id);
    return next === undefined || next === t.order ? t : { ...t, order: next };
  });
  return [...kept, placed];
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
