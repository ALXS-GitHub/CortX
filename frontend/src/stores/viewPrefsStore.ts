import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ListViewMode } from '@/types';

export type AgentsGroupMode = 'global' | 'project';

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
  // Agents (beta)
  agentsViewMode: ListViewMode;
  agentsGroupMode: AgentsGroupMode;
  /** Group keys (project id, or `cwd:<path>` for the no-project buckets) the user collapsed. */
  agentsCollapsedGroups: string[];
  setAgentsViewMode: (mode: ListViewMode) => void;
  setAgentsGroupMode: (mode: AgentsGroupMode) => void;
  toggleAgentsGroupCollapsed: (key: string) => void;
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
      agentsViewMode: 'list',
      agentsGroupMode: 'global',
      agentsCollapsedGroups: [],
      setAgentsViewMode: (mode) => set({ agentsViewMode: mode }),
      setAgentsGroupMode: (mode) => set({ agentsGroupMode: mode }),
      toggleAgentsGroupCollapsed: (key) =>
        set((state) => ({
          agentsCollapsedGroups: state.agentsCollapsedGroups.includes(key)
            ? state.agentsCollapsedGroups.filter((k) => k !== key)
            : [...state.agentsCollapsedGroups, key],
        })),
    }),
    {
      name: 'cortx-view-prefs',
    }
  )
);
