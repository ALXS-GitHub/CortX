import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Session rail geometry of the Terminal window (DEV-13 P1). */
export const RAIL_WIDTH_DEFAULT = 240;
export const RAIL_WIDTH_MIN = 180;
export const RAIL_WIDTH_MAX = 360;
export const RAIL_WIDTH_COLLAPSED = 44;

interface TerminalWindowPrefsState {
  /** Rail collapsed to its icon strip. */
  railCollapsed: boolean;
  /** Expanded rail width in px (user-resizable). */
  railWidth: number;
  toggleRail: () => void;
  setRailCollapsed: (collapsed: boolean) => void;
  setRailWidth: (width: number) => void;
}

/**
 * Per-machine preferences of the Terminal window, kept apart from the main
 * window's `viewPrefsStore` so the two windows never fight over one key.
 */
export const useTerminalWindowPrefsStore = create<TerminalWindowPrefsState>()(
  persist(
    (set) => ({
      railCollapsed: false,
      railWidth: RAIL_WIDTH_DEFAULT,
      toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
      setRailCollapsed: (collapsed) => set({ railCollapsed: collapsed }),
      setRailWidth: (width) =>
        set({ railWidth: Math.min(Math.max(Math.round(width), RAIL_WIDTH_MIN), RAIL_WIDTH_MAX) }),
    }),
    { name: 'cortx-terminal-window-prefs' }
  )
);
