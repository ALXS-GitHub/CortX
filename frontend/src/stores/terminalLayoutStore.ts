import { create } from 'zustand';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as api from '@/lib/tauri';
import {
  emptyLayoutDoc,
  normaliseLayoutDoc,
  makeTab,
  makeLeaf,
  insertLeafBeside,
  removeLeaf,
  setSplitSizes,
  setLeafCwd,
  setLeafSize,
  collectLeaves,
  findLeafByTerminal,
  tabContainingTerminal,
  tabsInScope,
  tabInScope,
  tabIsLocal,
  insertTabAfter,
  nextTabOrder,
  setLocalTerminalWindowId,
  setTabWindow,
  terminalWindowIdOf,
  withLocalWindow,
  workspaceIdForProject,
  PRIMARY_TERMINAL_WINDOW,
  type TerminalLayoutDoc,
  type TerminalScope,
  type TerminalTab,
  type SplitDirection,
  type LayoutNode,
  mapLeaves,
} from '@/lib/terminalLayout';
import { disposeTerminal, hasTerminalSession } from '@/lib/terminalSessions';
import { openTerminalWindow } from '@/components/terminal/terminalWindows';
import { useAppStore } from '@/stores/appStore';
import { registerFocusInTerminalWindow, registerSendToTerminalWindow } from '@/lib/terminalWindowBridge';

// Debounced cwd writes (see updateLeafCwd).
const pendingCwd = new Map<string, string>();
let cwdTimer: number | null = null;
// Debounced pane-size writes (see updateLeafSize): a drag on a splitter fires
// a fit on every frame.
const pendingSize = new Map<string, { cols: number; rows: number }>();
let sizeTimer: number | null = null;

/** `main` or `terminal` — every window keeps its own copy of this store. */
export const WINDOW_LABEL: string = (() => {
  try {
    return getCurrentWindow().label;
  } catch {
    return 'main';
  }
})();

/**
 * A Terminal window is the first one (`terminal`) or one detached from it
 * (`terminal-2`, `terminal-3`… — see `nextTerminalWindowLabel`).
 */
export const IS_TERMINAL_WINDOW =
  WINDOW_LABEL === PRIMARY_TERMINAL_WINDOW || WINDOW_LABEL.startsWith(`${PRIMARY_TERMINAL_WINDOW}-`);

/**
 * Which Terminal window this webview speaks for. The main window speaks for
 * the first one: it is the window that restores its sessions and keeps its
 * tabs while it is closed, exactly as before there could be several.
 */
export const TERMINAL_WINDOW_ID = IS_TERMINAL_WINDOW ? WINDOW_LABEL : PRIMARY_TERMINAL_WINDOW;

setLocalTerminalWindowId(TERMINAL_WINDOW_ID);

export interface SplitFrom {
  tabId: string;
  leafId: string;
  direction: SplitDirection;
  after?: boolean;
}

/** Shape of a tab that was closed, kept so "reopen closed tab" can bring it back (shells only, in their last cwd). */
export interface ClosedTab {
  workspaceId: string;
  title: string | null;
  color: string | null;
  /** The tab's tree with every leaf's cwd filled in (live cwd at close time). */
  layout: LayoutNode;
  closedAt: number;
}

const CLOSED_TABS_MAX = 10;

export interface AddToWindowOptions {
  /** Workspace the new tab joins (ignored when `splitFrom` is given). */
  projectId?: string | null;
  /** Put the terminal in an existing tab, next to a leaf, instead of a new tab. */
  splitFrom?: SplitFrom;
  /** Make it the active tab / leaf. Default true. */
  activate?: boolean;
}

interface TerminalLayoutState {
  doc: TerminalLayoutDoc;
  revision: number;
  loaded: boolean;
  /** Most recent first; in memory only (this window). */
  closedTabs: ClosedTab[];
  /**
   * Recently-active tabs of each Terminal window, most recent first
   * (ticket #29). Rebuilt from the document on every change, never written to
   * `sessions.json`: "the tab I was on before this one" is a fact about the
   * session you are in, and restoring one from the previous run would send the
   * first close of the day to a tab you have not looked at since yesterday.
   */
  tabMru: Record<string, string[]>;

  /** Read the shared document from the backend (on boot). */
  load: () => Promise<void>;
  /** Apply a `terminal-layout` broadcast from another window. */
  applyRemote: (event: api.TerminalLayoutEvent) => void;
  /** Mutate locally, then push. The mutator returns the next doc. */
  commit: (mutate: (doc: TerminalLayoutDoc) => TerminalLayoutDoc) => void;

  // Terminal window operations
  setScope: (scope: TerminalScope) => void;
  setActiveTab: (tabId: string | null) => void;
  setActiveLeaf: (tabId: string, leafId: string) => void;
  renameTab: (tabId: string, title: string | null) => void;
  setTabColor: (tabId: string, color: string | null) => void;
  togglePinTab: (tabId: string) => void;
  reorderTabs: (orderedTabIds: string[]) => void;
  setSplitSizes: (tabId: string, splitId: string, sizes: number[]) => void;
  /** Show one leaf alone in its tab; call again (or with null) to restore the split. */
  toggleMaximizeLeaf: (tabId: string, leafId: string | null) => void;
  /** Take the most recently closed tab out of the memory (null when empty). */
  popClosedTab: () => ClosedTab | null;
  /** Place a terminal in the window (new tab or split) and mark its surface. */
  addTerminalToWindow: (terminalId: string, options?: AddToWindowOptions) => void;
  /** Take a terminal out of the window layout. `surface` = where it goes:
   *  'dock' (main window re-opens it) or null (closed for good). */
  removeTerminalFromWindow: (terminalId: string, surface: 'dock' | null) => void;
  /** Dock → window. */
  sendToWindow: (terminalId: string, projectId?: string | null) => void;
  /** Window → dock. */
  sendToDock: (terminalId: string) => void;
  /** Remove a whole tab; returns the terminal ids it held. */
  closeTab: (tabId: string) => string[];
  /** Move a tab to another Terminal window (ticket #20); the shells keep running. */
  moveTabToWindow: (tabId: string, windowId: string) => void;
  /** Pull one pane out of its tab into a tab of its own in `windowId`. */
  moveLeafToWindow: (terminalId: string, windowId: string) => void;
  /** Which Terminal window shows a terminal, or null when none does. */
  windowIdOfTerminal: (terminalId: string) => string | null;
  /** Record that a Terminal window is up (restore reopens the ones that were). */
  markWindowOpen: (windowId: string) => void;
  /** Record that a Terminal window was closed. */
  markWindowClosed: (windowId: string) => void;
  /** Record a terminal's live cwd on its leaf (debounced; session restore reopens it there). */
  updateLeafCwd: (terminalId: string, cwd: string) => void;
  /** Remember a pane's size so a restored shell spawns at that size. */
  updateLeafSize: (terminalId: string, cols: number, rows: number) => void;
  /** Append ready-made tabs (launch configuration) and show the first one. */
  addLaunchTabs: (tabs: TerminalTab[], projectId: string | null) => void;
  /**
   * Put this window's recently-used stack back in a given order (issue 45b).
   *
   * The only caller is the end of a Ctrl+Tab cycle. Walking a frozen snapshot
   * switches tab several times, and each switch pushes the tab it passed
   * through to the front of the stack — so a cycle A → C → B would leave
   * `[B, C, A]` and send the next Ctrl+Tab to C, a tab that was only flashed
   * past. This restores the order the snapshot had, with the tab actually
   * landed on at its head. Ids the window no longer holds are dropped, and
   * ids not mentioned (other scopes, tabs opened during the cycle) keep their
   * places behind the ones given.
   */
  setTabMruOrder: (orderedTabIds: string[]) => void;

  // Selectors
  scopedTabs: () => TerminalTab[];
  activeTab: () => TerminalTab | null;
  terminalsInWindow: () => string[];
  /**
   * The tabs of this window in most-recently-used order: the ones you have
   * been on (current first), then the ones you never visited in list order, so
   * the list always holds every tab of the scope exactly once. This is what
   * `terminal.ctrlTabBehavior = 'recentlyUsed'` snapshots when a Ctrl+Tab
   * cycle begins (issue 45b) — it is read once, at the first press, never
   * again while the modifier is held.
   */
  recentTabs: () => TerminalTab[];
}

/** Live cwd of a shell (shell integration, else where it opened), for the closed-tab memory. */
function liveCwd(terminalId: string): string | undefined {
  const app = useAppStore.getState();
  const live = app.terminalStates.get(terminalId)?.cwd;
  if (live) return live;
  if (terminalId.startsWith('shell:')) return app.shellRuntimes.get(terminalId.slice('shell:'.length))?.cwd;
  return undefined;
}

/** Snapshot a tab for "reopen closed tab" — only tabs that hold at least one shell are worth keeping. */
function snapshotClosedTab(tab: TerminalTab): ClosedTab | null {
  if (!collectLeaves(tab.layout).some((l) => l.terminalId.startsWith('shell:'))) return null;
  return {
    workspaceId: tab.workspaceId,
    title: tab.title,
    color: tab.color,
    layout: mapLeaves(tab.layout, (leaf) => ({ ...leaf, cwd: liveCwd(leaf.terminalId) ?? leaf.cwd ?? null })),
    closedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Recently used tabs (ticket #29)
// ---------------------------------------------------------------------------

/**
 * How many tabs back the "last one I was on" memory goes. It only ever holds
 * ids of tabs that still exist, so this is a ceiling, not a size.
 */
const MRU_MAX = 32;

/**
 * Recompute the recently-used stacks from the document.
 *
 * Deriving them from `doc.windows[*].activeTabId` rather than from the
 * `setActiveTab` call site means every way a tab becomes current is recorded —
 * a click, Ctrl+N, the palette, a tab arriving from another window, and the
 * `terminal-layout` broadcast that tells us another window switched *our*
 * window's tab. Ids of tabs that no longer exist are dropped here, so the
 * stack can never resurrect a closed tab.
 *
 * The stacks are **per window** and live in memory only: see `recentTabs`.
 */
function nextTabMru(current: Record<string, string[]>, doc: TerminalLayoutDoc): Record<string, string[]> {
  // A tab that moved to another window (ticket #20) is still alive, but it is
  // no longer *this* window's business: the stacks are keyed by window.
  const live = new Map(doc.window.tabs.map((t) => [t.id, terminalWindowIdOf(t)]));
  const out: Record<string, string[]> = {};
  let changed = false;
  for (const id of new Set([...Object.keys(current), ...Object.keys(doc.windows)])) {
    const previous = current[id] ?? [];
    const active = doc.windows[id]?.activeTabId ?? null;
    const has = (tabId: string): boolean => live.get(tabId) === id;
    const kept = previous.filter((tabId) => has(tabId) && tabId !== active);
    const stack = (active && has(active) ? [active, ...kept] : kept).slice(0, MRU_MAX);
    if (stack.length !== previous.length || stack.some((tabId, i) => tabId !== previous[i])) changed = true;
    if (stack.length > 0) out[id] = stack;
  }
  return changed ? out : current;
}

/** The tabs either side of `tabId`, in the window's own order (last-resort fallback). */
function neighbourTabIds(doc: TerminalLayoutDoc, tabId: string | null | undefined): string[] {
  if (!tabId) return [];
  const tabs = tabsInScope(doc.window, doc.window.scope);
  const at = tabs.findIndex((t) => t.id === tabId);
  if (at === -1) return [];
  return [tabs[at + 1]?.id, tabs[at - 1]?.id].filter((id): id is string => Boolean(id));
}

/**
 * Which tab the window shows now. In order: an explicitly preferred one, the
 * one already current if it survived, then — ticket #29 — the tab you were on
 * **before** it (`recent`, most recent first), and only as a last resort a
 * neighbour in the list, then its first tab.
 *
 * Falling back to `tabs[0]` alone is what made closing a tab jump to the top
 * of the list: after three closes you were somewhere you had never been.
 */
function pickActiveTab(
  doc: TerminalLayoutDoc,
  opts: { preferred?: string | null; recent?: string[]; near?: string[] } = {}
): string | null {
  const tabs = tabsInScope(doc.window, doc.window.scope);
  const has = (id: string | null | undefined): boolean => Boolean(id) && tabs.some((t) => t.id === id);
  if (has(opts.preferred)) return opts.preferred!;
  if (has(doc.window.activeTabId)) return doc.window.activeTabId;
  for (const id of opts.recent ?? []) if (has(id)) return id;
  for (const id of opts.near ?? []) if (has(id)) return id;
  return tabs[0]?.id ?? null;
}

/**
 * After the document changed: the main window moves terminals out of / back
 * into its dock; the Terminal window fetches the runtime of shells it has
 * never heard of (a shell spawned in the other window sends no event).
 */
function reconcileDock(doc: TerminalLayoutDoc) {
  const app = useAppStore.getState();
  if (IS_TERMINAL_WINDOW) {
    const unknownShell = Object.entries(doc.surfaces).some(
      ([id, surface]) => surface === 'window' && id.startsWith('shell:') && !app.shellRuntimes.has(id.slice('shell:'.length))
    );
    if (unknownShell) {
      app.loadShells();
      app.loadTerminalStates();
    }
    releaseMovedSessions(doc);
    return;
  }
  app.syncTerminalSurfaces(doc.surfaces);
}

/**
 * A tab that left this window for another one (ticket #20) must stop being
 * rendered here: the PTY lives in the app process and both webviews may
 * attach to it, so a session left behind would keep consuming its output and
 * holding an xterm buffer for a pane the user cannot see. Disposing detaches;
 * the window that now shows the tab attaches and replays the scrollback from
 * `TerminalHub`, which is the same path a hidden tab already takes.
 *
 * Only terminals the document still knows about are touched — a session for a
 * shell this window has just spawned is not in the document yet.
 */
function releaseMovedSessions(doc: TerminalLayoutDoc) {
  const mine = new Set<string>();
  const elsewhere = new Set<string>();
  for (const tab of doc.window.tabs) {
    const target = tabIsLocal(tab) ? mine : elsewhere;
    for (const leaf of collectLeaves(tab.layout)) target.add(leaf.terminalId);
  }
  for (const id of elsewhere) {
    if (!mine.has(id) && hasTerminalSession(id)) disposeTerminal(id);
  }
  // Terminals handed back to the dock are rendered by the main window now.
  for (const [id, surface] of Object.entries(doc.surfaces)) {
    if (surface === 'dock' && !mine.has(id) && hasTerminalSession(id)) disposeTerminal(id);
  }
}

/**
 * May this window record the live cwd / pane size of a terminal? Whoever
 * shows it does; when no Terminal window shows it, the main window speaks for
 * it. Without this the windows would fight over the same leaf.
 */
function ownsLeafWrites(doc: TerminalLayoutDoc, terminalId: string): boolean {
  const tab = tabContainingTerminal(doc.window, terminalId);
  if (!tab) return false;
  const windowId = terminalWindowIdOf(tab);
  if (IS_TERMINAL_WINDOW) return windowId === TERMINAL_WINDOW_ID;
  if ((doc.openWindows ?? []).includes(windowId)) return false;
  return !(windowId === PRIMARY_TERMINAL_WINDOW && doc.windowOpen === true);
}

export const useTerminalLayoutStore = create<TerminalLayoutState>((set, get) => ({
  doc: emptyLayoutDoc(),
  revision: 0,
  loaded: false,
  closedTabs: [],
  tabMru: {},

  load: async () => {
    try {
      const env = await api.getTerminalLayout();
      const doc = normaliseLayoutDoc(env.layout);
      set({ doc, revision: env.revision, loaded: true, tabMru: nextTabMru(get().tabMru, doc) });
      reconcileDock(doc);
    } catch (e) {
      console.warn('Failed to load the terminal layout', e);
      set({ loaded: true });
    }
  },

  applyRemote: (event) => {
    if (event.source === WINDOW_LABEL) {
      // Our own write echoed back: just track the revision.
      if (event.revision > get().revision) set({ revision: event.revision });
      return;
    }
    if (event.revision <= get().revision) return;
    const doc = normaliseLayoutDoc(event.layout);
    set({ doc, revision: event.revision, tabMru: nextTabMru(get().tabMru, doc) });
    reconcileDock(doc);
  },

  commit: (mutate) => {
    // `withLocalWindow` folds this window's scope / active tab back into the
    // shared `windows` map, so every mutator can keep working on `doc.window`
    // as if there were a single Terminal window.
    const next = withLocalWindow(mutate(get().doc));
    // The recently-used stacks are read *by* the mutators (`pickActiveTab`),
    // so they are refreshed from the result, never before it.
    set({ doc: next, tabMru: nextTabMru(get().tabMru, next) });
    reconcileDock(next);
    api.setTerminalLayout(next, WINDOW_LABEL)
      .then((revision) => {
        if (revision > get().revision) set({ revision });
      })
      .catch((e) => console.warn('Failed to save the terminal layout', e));
  },

  setScope: (scope) =>
    get().commit((doc) => {
      const window = { ...doc.window, scope };
      const next = { ...doc, window };
      // Switching scope: the tab you were on last *in that scope* beats its
      // first tab, exactly as on a close.
      const recent = get().tabMru[TERMINAL_WINDOW_ID];
      return { ...next, window: { ...window, activeTabId: pickActiveTab(next, { recent }) } };
    }),

  setActiveTab: (tabId) =>
    get().commit((doc) => ({ ...doc, window: { ...doc.window, activeTabId: tabId } })),

  setActiveLeaf: (tabId, leafId) =>
    get().commit((doc) => ({
      ...doc,
      window: {
        ...doc.window,
        activeTabId: tabId,
        tabs: doc.window.tabs.map((t) => (t.id === tabId ? { ...t, activeLeafId: leafId } : t)),
      },
    })),

  renameTab: (tabId, title) =>
    get().commit((doc) => ({
      ...doc,
      window: {
        ...doc.window,
        tabs: doc.window.tabs.map((t) => (t.id === tabId ? { ...t, title: title?.trim() || null } : t)),
      },
    })),

  setTabColor: (tabId, color) =>
    get().commit((doc) => ({
      ...doc,
      window: { ...doc.window, tabs: doc.window.tabs.map((t) => (t.id === tabId ? { ...t, color } : t)) },
    })),

  togglePinTab: (tabId) =>
    get().commit((doc) => ({
      ...doc,
      window: {
        ...doc.window,
        tabs: doc.window.tabs.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t)),
      },
    })),

  reorderTabs: (orderedTabIds) =>
    get().commit((doc) => {
      const order = new Map(orderedTabIds.map((id, i) => [id, i + 1]));
      return {
        ...doc,
        window: {
          ...doc.window,
          tabs: doc.window.tabs.map((t) => (order.has(t.id) ? { ...t, order: order.get(t.id)! } : t)),
        },
      };
    }),

  setSplitSizes: (tabId, splitId, sizes) =>
    get().commit((doc) => ({
      ...doc,
      window: {
        ...doc.window,
        tabs: doc.window.tabs.map((t) =>
          t.id === tabId ? { ...t, layout: setSplitSizes(t.layout, splitId, sizes) } : t
        ),
      },
    })),

  toggleMaximizeLeaf: (tabId, leafId) =>
    get().commit((doc) => ({
      ...doc,
      window: {
        ...doc.window,
        tabs: doc.window.tabs.map((t) =>
          t.id === tabId ? { ...t, maximizedLeafId: leafId && t.maximizedLeafId !== leafId ? leafId : null } : t
        ),
      },
    })),

  popClosedTab: () => {
    const [first, ...rest] = get().closedTabs;
    if (!first) return null;
    set({ closedTabs: rest });
    return first;
  },

  addTerminalToWindow: (terminalId, options = {}) =>
    get().commit((doc) => {
      const activate = options.activate ?? true;
      // Already placed: just focus it.
      const existing = tabContainingTerminal(doc.window, terminalId);
      if (existing) {
        const leaf = findLeafByTerminal(existing.layout, terminalId)!;
        const surfaces = { ...doc.surfaces, [terminalId]: 'window' as const };
        const tabs = activate
          ? doc.window.tabs.map((t) => (t.id === existing.id ? { ...t, activeLeafId: leaf.id } : t))
          : doc.window.tabs;
        // Already shown by another Terminal window: select it *there* rather
        // than stealing the tab (the caller raises that window).
        if (!tabIsLocal(existing)) {
          const owner = terminalWindowIdOf(existing);
          const windows = activate
            ? { ...doc.windows, [owner]: { ...(doc.windows[owner] ?? { scope: 'global' as TerminalScope }), activeTabId: existing.id } }
            : doc.windows;
          return { ...doc, surfaces, windows, window: { ...doc.window, tabs } };
        }
        return {
          ...doc,
          surfaces,
          window: activate ? { ...doc.window, activeTabId: existing.id, tabs } : doc.window,
        };
      }
      const surfaces = { ...doc.surfaces, [terminalId]: 'window' as const };
      if (options.splitFrom) {
        const { tabId, leafId, direction, after = true } = options.splitFrom;
        const leaf = makeLeaf(terminalId);
        const tabs = doc.window.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                layout: insertLeafBeside(t.layout, leafId, leaf, direction, after),
                activeLeafId: activate ? leaf.id : t.activeLeafId,
              }
            : t
        );
        return {
          ...doc,
          surfaces,
          window: { ...doc.window, tabs, activeTabId: activate ? tabId : doc.window.activeTabId },
        };
      }
      // Ticket #25: a new tab opens next to the one you were on, the way a
      // browser does it, not at the far end of the list. `insertTabAfter`
      // gives it its order (and renumbers its siblings), so the 0 here is only
      // a placeholder.
      const tab = makeTab(terminalId, workspaceIdForProject(options.projectId), 0);
      const window = { ...doc.window, tabs: insertTabAfter(doc.window, tab, doc.window.activeTabId) };
      // A tab outside the current scope would be invisible: widen to global.
      const scope: TerminalScope = activate && !tabInScope(tab, window.scope) ? 'global' : window.scope;
      return {
        ...doc,
        surfaces,
        window: { ...window, scope, activeTabId: activate ? tab.id : pickActiveTab({ ...doc, window }) },
      };
    }),

  removeTerminalFromWindow: (terminalId, surface) =>
    get().commit((doc) => {
      // Read before the tab list changes: if this empties the tab, these are
      // the rows either side of it (ticket #29's last resort).
      const near = neighbourTabIds(doc, tabContainingTerminal(doc.window, terminalId)?.id);
      const surfaces = { ...doc.surfaces };
      if (surface === 'dock') surfaces[terminalId] = 'dock';
      else delete surfaces[terminalId];
      const tabs: TerminalTab[] = [];
      for (const t of doc.window.tabs) {
        const leaf = findLeafByTerminal(t.layout, terminalId);
        if (!leaf) {
          tabs.push(t);
          continue;
        }
        const layout = removeLeaf(t.layout, leaf.id);
        if (!layout) {
          // Tab is empty now: closed for good (not docked) → worth reopening later.
          if (surface === null) {
            const snapshot = snapshotClosedTab(t);
            if (snapshot) set({ closedTabs: [snapshot, ...get().closedTabs].slice(0, CLOSED_TABS_MAX) });
          }
          continue;
        }
        const activeLeafId = t.activeLeafId === leaf.id ? collectLeaves(layout)[0].id : t.activeLeafId;
        const maximizedLeafId = t.maximizedLeafId === leaf.id ? null : t.maximizedLeafId;
        tabs.push({ ...t, layout, activeLeafId, maximizedLeafId });
      }
      const window = { ...doc.window, tabs };
      const next = { ...doc, surfaces, window };
      const recent = get().tabMru[TERMINAL_WINDOW_ID];
      return { ...next, window: { ...window, activeTabId: pickActiveTab(next, { recent, near }) } };
    }),

  sendToWindow: (terminalId, projectId) => {
    get().addTerminalToWindow(terminalId, { projectId });
  },

  sendToDock: (terminalId) => {
    get().removeTerminalFromWindow(terminalId, 'dock');
  },

  closeTab: (tabId) => {
    const tab = get().doc.window.tabs.find((t) => t.id === tabId);
    if (!tab) return [];
    const ids = collectLeaves(tab.layout).map((l) => l.terminalId);
    const snapshot = snapshotClosedTab(tab);
    if (snapshot) set({ closedTabs: [snapshot, ...get().closedTabs].slice(0, CLOSED_TABS_MAX) });
    get().commit((doc) => {
      // Ticket #29: closing the tab you are on lands on the tab you were on
      // before it (`recent`), not on the top of the list. `near` only speaks
      // for a tab that was never current — a freshly restored session, say.
      const near = neighbourTabIds(doc, tabId);
      const recent = get().tabMru[TERMINAL_WINDOW_ID];
      const surfaces = { ...doc.surfaces };
      for (const id of ids) delete surfaces[id];
      const window = { ...doc.window, tabs: doc.window.tabs.filter((t) => t.id !== tabId) };
      const next = { ...doc, surfaces, window };
      return { ...next, window: { ...window, activeTabId: pickActiveTab(next, { recent, near }) } };
    });
    return ids;
  },

  moveTabToWindow: (tabId, windowId) =>
    get().commit((doc) => {
      const tab = doc.window.tabs.find((t) => t.id === tabId);
      if (!tab || terminalWindowIdOf(tab) === windowId) return doc;
      const tabs = doc.window.tabs.map((t) => (t.id === tabId ? setTabWindow(t, windowId) : t));
      // The tab is selected in the window it lands in; the window it leaves
      // falls back to whatever is still in scope there.
      const target = doc.windows[windowId] ?? { scope: 'global' as TerminalScope, activeTabId: null };
      const windows = { ...doc.windows, [windowId]: { ...target, activeTabId: tabId } };
      // A tab moved into a window scoped to another project would be
      // invisible on arrival: widen that window to Global.
      if (target.scope !== 'global' && !tabInScope(setTabWindow(tab, windowId), target.scope)) {
        windows[windowId] = { ...windows[windowId], scope: 'global' };
      }
      const next = { ...doc, windows, window: { ...doc.window, tabs } };
      const recent = get().tabMru[TERMINAL_WINDOW_ID];
      const near = neighbourTabIds(doc, tabId);
      return { ...next, window: { ...next.window, activeTabId: pickActiveTab(next, { recent, near }) } };
    }),

  moveLeafToWindow: (terminalId, windowId) =>
    get().commit((doc) => {
      const from = tabContainingTerminal(doc.window, terminalId);
      if (!from) return doc;
      const leaf = findLeafByTerminal(from.layout, terminalId)!;
      const leaves = collectLeaves(from.layout);
      // The only pane of its tab: the whole tab travels, keeping its title,
      // colour and pin — nothing is recreated.
      if (leaves.length === 1) {
        if (terminalWindowIdOf(from) === windowId) return doc;
        const tabs = doc.window.tabs.map((t) => (t.id === from.id ? setTabWindow(t, windowId) : t));
        const target = doc.windows[windowId] ?? { scope: 'global' as TerminalScope, activeTabId: null };
        const windows = { ...doc.windows, [windowId]: { ...target, activeTabId: from.id, scope: 'global' as TerminalScope } };
        const next = { ...doc, windows, window: { ...doc.window, tabs } };
        const recent = get().tabMru[TERMINAL_WINDOW_ID];
        const near = neighbourTabIds(doc, from.id);
        return { ...next, window: { ...next.window, activeTabId: pickActiveTab(next, { recent, near }) } };
      }
      const trimmed = removeLeaf(from.layout, leaf.id)!;
      const moved = setTabWindow(
        {
          ...makeTab(terminalId, from.workspaceId, nextTabOrder(doc.window), windowId),
          color: from.color,
        },
        windowId
      );
      const tabs = doc.window.tabs.map((t) =>
        t.id === from.id
          ? {
              ...t,
              layout: trimmed,
              activeLeafId: t.activeLeafId === leaf.id ? collectLeaves(trimmed)[0].id : t.activeLeafId,
              maximizedLeafId: t.maximizedLeafId === leaf.id ? null : t.maximizedLeafId,
            }
          : t
      );
      tabs.push(moved);
      const target = doc.windows[windowId] ?? { scope: 'global' as TerminalScope, activeTabId: null };
      const windows = { ...doc.windows, [windowId]: { ...target, activeTabId: moved.id, scope: 'global' as TerminalScope } };
      return { ...doc, windows, window: { ...doc.window, tabs } };
    }),

  windowIdOfTerminal: (terminalId) => {
    const tab = tabContainingTerminal(get().doc.window, terminalId);
    return tab ? terminalWindowIdOf(tab) : null;
  },

  markWindowOpen: (windowId) => {
    const { doc } = get();
    const open = doc.openWindows ?? [];
    if (open.includes(windowId) && doc.windowOpen === true) return;
    get().commit((d) => ({
      ...d,
      windowOpen: true,
      openWindows: (d.openWindows ?? []).includes(windowId)
        ? (d.openWindows ?? [])
        : [...(d.openWindows ?? []), windowId],
    }));
  },

  markWindowClosed: (windowId) => {
    const { doc } = get();
    const open = doc.openWindows ?? [];
    if (!open.includes(windowId) && doc.windowOpen !== true) return;
    // `windowOpen` is what session restore reads to know whether to bring a
    // Terminal window back at all; keep it meaning "at least one was up".
    get().commit((d) => {
      const rest = (d.openWindows ?? []).filter((id) => id !== windowId);
      return { ...d, openWindows: rest, windowOpen: rest.length > 0 };
    });
  },

  updateLeafCwd: (terminalId, cwd) => {
    // Whichever window shows the pane writes; the main window speaks for the
    // Terminal windows that are closed. The two never race over a leaf.
    const { doc } = get();
    if (!ownsLeafWrites(doc, terminalId)) return;
    pendingCwd.set(terminalId, cwd);
    if (cwdTimer !== null) return;
    cwdTimer = window.setTimeout(() => {
      cwdTimer = null;
      const updates = Array.from(pendingCwd.entries());
      pendingCwd.clear();
      get().commit((d) => {
        let win = d.window;
        for (const [id, dir] of updates) win = setLeafCwd(win, id, dir);
        return win === d.window ? d : { ...d, window: win };
      });
    }, 500);
  },

  updateLeafSize: (terminalId, cols, rows) => {
    // Same ownership rule as updateLeafCwd: whichever window shows the pane.
    const { doc } = get();
    if (cols < 2 || rows < 2) return;
    if (!ownsLeafWrites(doc, terminalId)) return;
    pendingSize.set(terminalId, { cols, rows });
    if (sizeTimer !== null) return;
    sizeTimer = window.setTimeout(() => {
      sizeTimer = null;
      const updates = Array.from(pendingSize.entries());
      pendingSize.clear();
      get().commit((d) => {
        let win = d.window;
        for (const [id, size] of updates) win = setLeafSize(win, id, size.cols, size.rows);
        return win === d.window ? d : { ...d, window: win };
      });
    }, 800);
  },

  addLaunchTabs: (tabs, projectId) =>
    get().commit((doc) => {
      if (tabs.length === 0) return doc;
      const surfaces = { ...doc.surfaces };
      let order = nextTabOrder(doc.window);
      const placed = tabs.map((t) => {
        for (const leaf of collectLeaves(t.layout)) surfaces[leaf.terminalId] = 'window';
        // Ready-made tabs (launch configs, "reopen closed tab") land in the
        // window that asked for them, not always the first one.
        return setTabWindow({ ...t, order: order++ }, TERMINAL_WINDOW_ID);
      });
      const window = { ...doc.window, tabs: [...doc.window.tabs, ...placed] };
      const scope: TerminalScope = projectId ? { projectId } : window.scope;
      const first = placed[0];
      return {
        ...doc,
        surfaces,
        window: { ...window, scope: tabInScope(first, scope) ? scope : 'global', activeTabId: first.id },
      };
    }),

  setTabMruOrder: (orderedTabIds) => {
    const { doc, tabMru } = get();
    // Same rules as `nextTabMru`, applied to a hand-written order: only tabs
    // this window still holds, the current one first, capped at `MRU_MAX`.
    const mine = new Set(doc.window.tabs.filter((t) => tabIsLocal(t)).map((t) => t.id));
    const previous = tabMru[TERMINAL_WINDOW_ID] ?? [];
    const merged = [...orderedTabIds, ...previous.filter((id) => !orderedTabIds.includes(id))];
    const active = doc.window.activeTabId;
    const kept = merged.filter((id) => mine.has(id) && id !== active);
    const stack = (active && mine.has(active) ? [active, ...kept] : kept).slice(0, MRU_MAX);
    if (stack.length === previous.length && stack.every((id, i) => id === previous[i])) return;
    set({ tabMru: { ...tabMru, [TERMINAL_WINDOW_ID]: stack } });
  },

  scopedTabs: () => tabsInScope(get().doc.window, get().doc.window.scope),
  activeTab: () => {
    const { window } = get().doc;
    return window.tabs.find((t) => t.id === window.activeTabId) ?? null;
  },
  terminalsInWindow: () => get().doc.window.tabs.flatMap((t) => collectLeaves(t.layout).map((l) => l.terminalId)),
  recentTabs: () => {
    const tabs = get().scopedTabs();
    const byId = new Map(tabs.map((t) => [t.id, t]));
    const out: TerminalTab[] = [];
    for (const id of get().tabMru[TERMINAL_WINDOW_ID] ?? []) {
      const tab = byId.get(id);
      if (tab) {
        out.push(tab);
        byId.delete(id);
      }
    }
    // Never activated (a restored session, a tab opened in the background):
    // they still belong to the cycle, after everything you have been on.
    for (const tab of tabs) if (byId.has(tab.id)) out.push(tab);
    return out;
  },
}));

// Dev-only escape hatch for CDP-driven checks (see terminalSessions.ts).
if (import.meta.env.DEV) {
  (window as unknown as { __cortxLayoutStore?: typeof useTerminalLayoutStore }).__cortxLayoutStore = useTerminalLayoutStore;
}

// "Open" a terminal that already lives in the Terminal window: activate its
// tab there and bring the window up (used by appStore.openTerminal).
registerFocusInTerminalWindow((terminalId) => {
  const store = useTerminalLayoutStore.getState();
  store.addTerminalToWindow(terminalId, { activate: true });
  // The terminal may already live in a detached window: raise that one.
  const target = useTerminalLayoutStore.getState().windowIdOfTerminal(terminalId) ?? TERMINAL_WINDOW_ID;
  if (target !== WINDOW_LABEL) openTerminalWindow(target).catch(() => {});
});

// A freshly started process placed in the window by the "open processes in"
// setting (used by appStore.openTerminal).
registerSendToTerminalWindow((terminalId, projectId) => {
  useTerminalLayoutStore.getState().sendToWindow(terminalId, projectId);
  const target = useTerminalLayoutStore.getState().windowIdOfTerminal(terminalId) ?? TERMINAL_WINDOW_ID;
  if (target !== WINDOW_LABEL) openTerminalWindow(target).catch(() => {});
});
