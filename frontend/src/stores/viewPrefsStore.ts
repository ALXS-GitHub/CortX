import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ListViewMode } from '@/types';

export type AgentsGroupMode = 'global' | 'project';
export type AgentsScope = 'active' | 'recent' | 'all';

interface ViewPrefsState {
  /** Sidebar collapsed to its icon rail. */
  sidebarCollapsed: boolean;
  /** Expanded sidebar width in px (user-resizable). */
  sidebarWidth: number;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
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
  /** Which sessions to show: live only (default), finished within N days, or everything. */
  agentsScope: AgentsScope;
  /** Group keys (project id, or `cwd:<path>` for the no-project buckets) the user collapsed. */
  agentsCollapsedGroups: string[];
  setAgentsViewMode: (mode: ListViewMode) => void;
  setAgentsGroupMode: (mode: AgentsGroupMode) => void;
  setAgentsScope: (scope: AgentsScope) => void;
  toggleAgentsGroupCollapsed: (key: string) => void;
}

export const useViewPrefsStore = create<ViewPrefsState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      sidebarWidth: 252,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarWidth: (width) => set({ sidebarWidth: Math.min(Math.max(width, 200), 380) }),
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
      agentsScope: 'active',
      agentsCollapsedGroups: [],
      setAgentsViewMode: (mode) => set({ agentsViewMode: mode }),
      setAgentsGroupMode: (mode) => set({ agentsGroupMode: mode }),
      setAgentsScope: (scope) => set({ agentsScope: scope }),
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
