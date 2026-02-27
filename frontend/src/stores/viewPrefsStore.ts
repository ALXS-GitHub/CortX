import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ListViewMode } from '@/types';

interface ViewPrefsState {
  projectsViewMode: ListViewMode;
  scriptsViewMode: ListViewMode;
  toolsViewMode: ListViewMode;
  setProjectsViewMode: (mode: ListViewMode) => void;
  setScriptsViewMode: (mode: ListViewMode) => void;
  setToolsViewMode: (mode: ListViewMode) => void;
}

export const useViewPrefsStore = create<ViewPrefsState>()(
  persist(
    (set) => ({
      projectsViewMode: 'card',
      scriptsViewMode: 'list',
      toolsViewMode: 'list',
      setProjectsViewMode: (mode) => set({ projectsViewMode: mode }),
      setScriptsViewMode: (mode) => set({ scriptsViewMode: mode }),
      setToolsViewMode: (mode) => set({ toolsViewMode: mode }),
    }),
    {
      name: 'cortx-view-prefs',
    }
  )
);
