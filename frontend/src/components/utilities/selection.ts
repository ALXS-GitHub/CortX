import { create } from 'zustand';

/**
 * Which utility is open, held outside the view so the command palette can jump
 * straight into a tool. Deliberately not persisted: reopening CortX should land
 * on the grid, not inside whatever was last used.
 */
interface UtilitySelectionState {
  openId: string | null;
  openUtility: (id: string | null) => void;
}

export const useUtilitySelection = create<UtilitySelectionState>()((set) => ({
  openId: null,
  openUtility: (id) => set({ openId: id }),
}));
