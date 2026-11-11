import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { TERMINAL_WINDOW_ID } from '@/stores/terminalLayoutStore';

/**
 * Agent mode of a Terminal window: the grid view (ticket #55) — every tab of
 * the scope as a live tile, to keep an eye on several agents at once — with
 * the agent counter and inbox in the title bar. Opt-in, per window: off, the
 * Terminal is exactly the plain one.
 *
 * - `off`: agent mode off — the usual view, the active tab filling the content area.
 * - `grid`: the tiles. Clicking one opens it.
 * - `zoomed`: the tile you opened, full size and interactive — it *is* the
 *   active tab, shown the usual way, with a bar to go back to the grid.
 *
 * Per window and kept across restarts (one key per window label, since two
 * Terminal windows can each be in their own mode). Never in the shared layout
 * document: it is how this window looks, not what it holds.
 */
export type TerminalGridMode = 'off' | 'grid' | 'zoomed';

/** Order of the tiles: the rail's, the ones that want you first, or the latest active first. */
export type TerminalGridSort = 'rail' | 'attention' | 'recent';

/** How the grid is cut down and laid out (the grid's View menu). */
export interface TerminalGridView {
  sort: TerminalGridSort;
  /** Only the tabs an agent runs in. */
  agentsOnly: boolean;
  /** Leave out agents at rest that you have seen. */
  hideIdle: boolean;
  /** One section per project, with its name. */
  groupByProject: boolean;
}

export const DEFAULT_GRID_VIEW: TerminalGridView = {
  sort: 'rail',
  agentsOnly: false,
  hideIdle: false,
  groupByProject: false,
};

interface TerminalGridState {
  mode: TerminalGridMode;
  /** The grid shortcut and button: into the grid, and back out of it. */
  toggle: () => void;
  /** A tile was opened. */
  zoom: () => void;
  /** Back from the opened tile to the grid. */
  backToGrid: () => void;
  setMode: (mode: TerminalGridMode) => void;
  view: TerminalGridView;
  setView: (patch: Partial<TerminalGridView>) => void;
}

/** Storage that may be missing (private window) or throw (quota): never fatal. */
const safeStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // The mode is a convenience; losing it costs a click.
    }
  },
  removeItem: (name: string) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // Same.
    }
  },
}));

export const useTerminalGridStore = create<TerminalGridState>()(
  persist(
    (set) => ({
      mode: 'off',
      // From an opened tile the shortcut goes back to the grid, not out of
      // it: "zoomed" is a moment inside the grid view.
      toggle: () => set((s) => ({ mode: s.mode === 'off' ? 'grid' : s.mode === 'zoomed' ? 'grid' : 'off' })),
      zoom: () => set({ mode: 'zoomed' }),
      backToGrid: () => set({ mode: 'grid' }),
      setMode: (mode) => set({ mode }),
      view: DEFAULT_GRID_VIEW,
      setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
    }),
    {
      name: `cortx-terminal-grid:${TERMINAL_WINDOW_ID}`,
      storage: safeStorage,
      partialize: (s) => ({ mode: s.mode, view: s.view }),
      // A view saved by an older build lacks the newer keys.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<TerminalGridState>;
        return { ...current, ...p, view: { ...DEFAULT_GRID_VIEW, ...(p.view ?? {}) } };
      },
    }
  )
);
