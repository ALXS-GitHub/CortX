import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ListViewMode } from '@/types';

interface ViewPrefsState {
  projectsViewMode: ListViewMode;
  scriptsViewMode: ListViewMode;
  toolsViewMode: ListViewMode;
  aliasesViewMode: ListViewMode;
  appsViewMode: ListViewMode;
  setProjectsViewMode: (mode: ListViewMode) => void;
  setScriptsViewMode: (mode: ListViewMode) => void;
  setToolsViewMode: (mode: ListViewMode) => void;
  setAliasesViewMode: (mode: ListViewMode) => void;
  setAppsViewMode: (mode: ListViewMode) => void;
}

export const useViewPrefsStore = create<ViewPrefsState>()(
  persist(
    (set) => ({
      projectsViewMode: 'card',
      scriptsViewMode: 'list',
      toolsViewMode: 'list',
      aliasesViewMode: 'list',
      appsViewMode: 'list',
      setProjectsViewMode: (mode) => set({ projectsViewMode: mode }),
      setScriptsViewMode: (mode) => set({ scriptsViewMode: mode }),
      setToolsViewMode: (mode) => set({ toolsViewMode: mode }),
      setAliasesViewMode: (mode) => set({ aliasesViewMode: mode }),
      setAppsViewMode: (mode) => set({ appsViewMode: mode }),
    }),
    {
      name: 'cortx-view-prefs',
    }
  )
);
