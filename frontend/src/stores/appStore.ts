import { create } from 'zustand';
import type {
  Project,
  Service,
  AppSettings,
  CreateProjectInput,
  UpdateProjectInput,
  CreateServiceInput,
  UpdateServiceInput,
  ServiceStatus,
  LogEntry,
  View,
} from '@/types';
import * as api from '@/lib/tauri';

interface ServiceRuntime {
  status: ServiceStatus;
  pid?: number;
  logs: LogEntry[];
}

interface AppState {
  // Projects
  projects: Project[];
  selectedProjectId: string | null;
  isLoadingProjects: boolean;

  // Settings
  settings: AppSettings | null;
  isLoadingSettings: boolean;

  // Service runtime state
  serviceRuntimes: Map<string, ServiceRuntime>;

  // UI state
  currentView: View;
  terminalPanelOpen: boolean;
  activeTerminalServiceId: string | null;

  // Actions - Projects
  loadProjects: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<Project>;
  updateProject: (id: string, input: UpdateProjectInput) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  selectProject: (id: string | null) => void;

  // Actions - Services
  addService: (projectId: string, input: CreateServiceInput) => Promise<Service>;
  updateService: (serviceId: string, input: UpdateServiceInput) => Promise<void>;
  deleteService: (serviceId: string) => Promise<void>;

  // Actions - Launch
  startService: (serviceId: string) => Promise<void>;
  stopService: (serviceId: string) => Promise<void>;
  copyLaunchCommand: (serviceId: string) => Promise<string>;
  launchExternal: (serviceId: string) => Promise<void>;

  // Actions - Runtime updates
  updateServiceStatus: (serviceId: string, status: ServiceStatus, pid?: number) => void;
  appendServiceLog: (serviceId: string, log: LogEntry) => void;
  clearServiceLogs: (serviceId: string) => void;

  // Actions - Settings
  loadSettings: () => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;

  // Actions - UI
  setCurrentView: (view: View) => void;
  toggleTerminalPanel: () => void;
  setActiveTerminalServiceId: (serviceId: string | null) => void;
}

export const useAppStore = create<AppState>((set, _get) => ({
  // Initial state
  projects: [],
  selectedProjectId: null,
  isLoadingProjects: false,
  settings: null,
  isLoadingSettings: false,
  serviceRuntimes: new Map(),
  currentView: 'dashboard',
  terminalPanelOpen: false,
  activeTerminalServiceId: null,

  // Project actions
  loadProjects: async () => {
    set({ isLoadingProjects: true });
    try {
      const projects = await api.getAllProjects();
      set({ projects, isLoadingProjects: false });
    } catch (error) {
      console.error('Failed to load projects:', error);
      set({ isLoadingProjects: false });
    }
  },

  createProject: async (input) => {
    const project = await api.createProject(input);
    set((state) => ({ projects: [...state.projects, project] }));
    return project;
  },

  updateProject: async (id, input) => {
    const updated = await api.updateProject(id, input);
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? updated : p)),
    }));
  },

  deleteProject: async (id) => {
    await api.deleteProject(id);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      selectedProjectId: state.selectedProjectId === id ? null : state.selectedProjectId,
    }));
  },

  selectProject: (id) => {
    set({ selectedProjectId: id });
    if (id) {
      api.updateProjectLastOpened(id).catch(console.error);
      set({ currentView: 'project' });
    } else {
      set({ currentView: 'dashboard' });
    }
  },

  // Service actions
  addService: async (projectId, input) => {
    const service = await api.addService(projectId, input);
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, services: [...p.services, service] } : p
      ),
    }));
    return service;
  },

  updateService: async (serviceId, input) => {
    const updated = await api.updateService(serviceId, input);
    set((state) => ({
      projects: state.projects.map((p) => ({
        ...p,
        services: p.services.map((s) => (s.id === serviceId ? updated : s)),
      })),
    }));
  },

  deleteService: async (serviceId) => {
    await api.deleteService(serviceId);
    set((state) => ({
      projects: state.projects.map((p) => ({
        ...p,
        services: p.services.filter((s) => s.id !== serviceId),
      })),
    }));
  },

  // Launch actions
  startService: async (serviceId) => {
    try {
      await api.startIntegratedService(serviceId);
      // Status will be updated via events
      set({ terminalPanelOpen: true, activeTerminalServiceId: serviceId });
    } catch (error) {
      console.error('Failed to start service:', error);
      throw error;
    }
  },

  stopService: async (serviceId) => {
    try {
      await api.stopIntegratedService(serviceId);
      // Status will be updated via events
    } catch (error) {
      console.error('Failed to stop service:', error);
      throw error;
    }
  },

  copyLaunchCommand: async (serviceId) => {
    const command = await api.getLaunchCommand(serviceId);
    return command;
  },

  launchExternal: async (serviceId) => {
    await api.launchExternalTerminal(serviceId);
  },

  // Runtime updates
  updateServiceStatus: (serviceId, status, pid) => {
    set((state) => {
      const runtimes = new Map(state.serviceRuntimes);
      const existing = runtimes.get(serviceId) || { status: 'stopped', logs: [] };
      runtimes.set(serviceId, { ...existing, status, pid });
      return { serviceRuntimes: runtimes };
    });
  },

  appendServiceLog: (serviceId, log) => {
    set((state) => {
      const runtimes = new Map(state.serviceRuntimes);
      const existing = runtimes.get(serviceId) || { status: 'stopped', logs: [] };
      // Keep last 1000 logs
      const logs = [...existing.logs, log].slice(-1000);
      runtimes.set(serviceId, { ...existing, logs });
      return { serviceRuntimes: runtimes };
    });
  },

  clearServiceLogs: (serviceId) => {
    set((state) => {
      const runtimes = new Map(state.serviceRuntimes);
      const existing = runtimes.get(serviceId);
      if (existing) {
        runtimes.set(serviceId, { ...existing, logs: [] });
      }
      return { serviceRuntimes: runtimes };
    });
  },

  // Settings actions
  loadSettings: async () => {
    set({ isLoadingSettings: true });
    try {
      const settings = await api.getSettings();
      set({ settings, isLoadingSettings: false });
    } catch (error) {
      console.error('Failed to load settings:', error);
      set({ isLoadingSettings: false });
    }
  },

  updateSettings: async (settings) => {
    await api.updateSettings(settings);
    set({ settings });
  },

  // UI actions
  setCurrentView: (view) => {
    set({ currentView: view });
    if (view === 'dashboard') {
      set({ selectedProjectId: null });
    }
  },

  toggleTerminalPanel: () => {
    set((state) => ({ terminalPanelOpen: !state.terminalPanelOpen }));
  },

  setActiveTerminalServiceId: (serviceId) => {
    set({ activeTerminalServiceId: serviceId });
  },
}));
