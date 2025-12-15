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
  detectedPort?: number;
}

// Strip ANSI escape codes and orphaned bracket sequences
function stripAnsiCodes(str: string): string {
  // Remove proper ANSI escape codes (ESC [ ... m)
  let result = str.replace(/\x1b\[[0-9;]*m/g, '');
  // Also remove orphaned bracket sequences (e.g., [1m, [22m, [39m)
  result = result.replace(/\[([0-9;]*)m/g, '');
  return result;
}

// Port detection patterns
const PORT_PATTERNS = [
  // URLs with ports - most specific first
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d{2,5})/i,
  /https?:\/\/[^/:]+:(\d{2,5})/i,
  // Direct host:port patterns
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/i,
  // Common log messages
  /listening\s+(?:on\s+)?(?:port\s+)?:?(\d{2,5})/i,
  /server\s+(?:is\s+)?(?:running|started|listening)\s+(?:on\s+)?(?:port\s+)?:?(\d{2,5})/i,
  /started\s+(?:on\s+)?(?:port\s+)?:?(\d{2,5})/i,
  /running\s+(?:on\s+)?(?:port\s+)?:?(\d{2,5})/i,
  /available\s+(?:on|at)\s+(?:port\s+)?:?(\d{2,5})/i,
  /bound\s+to\s+(?:port\s+)?:?(\d{2,5})/i,
  // Generic port mentions
  /port[:\s]+(\d{2,5})/i,
  /:(\d{4,5})(?:\/|\s|$)/,  // :PORT followed by / or space or end
];

function detectPort(content: string): number | null {
  // Strip ANSI codes first to handle colored output
  const cleanContent = stripAnsiCodes(content);

  for (const pattern of PORT_PATTERNS) {
    const match = cleanContent.match(pattern);
    if (match && match[1]) {
      const port = parseInt(match[1], 10);
      // Valid port range (excluding very common non-port numbers)
      if (port >= 1024 && port <= 65535) {
        return port;
      }
    }
  }
  return null;
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
  terminalHeight: number;
  activeTerminalServiceId: string | null;
  hiddenTerminalIds: Set<string>;
  closedTerminalIds: Set<string>;

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
  closeAllTerminals: () => void;

  // Actions - Terminal visibility
  hideTerminal: (serviceId: string) => void;
  showTerminal: (serviceId: string) => void;
  closeTerminal: (serviceId: string) => void;

  // Actions - Settings
  loadSettings: () => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;

  // Actions - UI
  setCurrentView: (view: View) => void;
  toggleTerminalPanel: () => void;
  setActiveTerminalServiceId: (serviceId: string | null) => void;
  setTerminalHeight: (height: number) => void;
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
  terminalHeight: 256,
  activeTerminalServiceId: null,
  hiddenTerminalIds: new Set(),
  closedTerminalIds: new Set(),

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
      // Also unhide terminal if it was hidden and remove from closed
      set((state) => {
        const hidden = new Set(state.hiddenTerminalIds);
        hidden.delete(serviceId);
        const closed = new Set(state.closedTerminalIds);
        closed.delete(serviceId);
        return {
          terminalPanelOpen: true,
          activeTerminalServiceId: serviceId,
          hiddenTerminalIds: hidden,
          closedTerminalIds: closed,
        };
      });
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
      // Clear detected port when service stops
      const detectedPort = status === 'stopped' ? undefined : existing.detectedPort;
      runtimes.set(serviceId, { ...existing, status, pid, detectedPort });
      return { serviceRuntimes: runtimes };
    });
  },

  appendServiceLog: (serviceId, log) => {
    set((state) => {
      const runtimes = new Map(state.serviceRuntimes);
      const existing = runtimes.get(serviceId) || { status: 'stopped', logs: [] };
      // Keep last 1000 logs
      const logs = [...existing.logs, log].slice(-1000);

      // Try to detect port from log content (only if not already detected)
      let detectedPort = existing.detectedPort;
      if (!detectedPort) {
        const port = detectPort(log.content);
        if (port) {
          detectedPort = port;
        }
      }

      runtimes.set(serviceId, { ...existing, logs, detectedPort });
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

  closeAllTerminals: () => {
    set((state) => {
      // Hide all terminals that have logs or are running
      const hidden = new Set<string>();
      for (const [serviceId, runtime] of state.serviceRuntimes) {
        if (runtime.logs.length > 0 || runtime.status !== 'stopped') {
          hidden.add(serviceId);
        }
      }
      return { hiddenTerminalIds: hidden, activeTerminalServiceId: null };
    });
  },

  // Terminal visibility actions
  hideTerminal: (serviceId) => {
    set((state) => {
      const hidden = new Set(state.hiddenTerminalIds);
      hidden.add(serviceId);
      // If hiding the active terminal, switch to another visible one or null
      let newActiveId = state.activeTerminalServiceId;
      if (state.activeTerminalServiceId === serviceId) {
        // Find first visible terminal
        for (const [id, runtime] of state.serviceRuntimes) {
          if (!hidden.has(id) && (runtime.logs.length > 0 || runtime.status !== 'stopped')) {
            newActiveId = id;
            break;
          }
        }
        if (newActiveId === serviceId) {
          newActiveId = null;
        }
      }
      return { hiddenTerminalIds: hidden, activeTerminalServiceId: newActiveId };
    });
  },

  showTerminal: (serviceId) => {
    set((state) => {
      const hidden = new Set(state.hiddenTerminalIds);
      hidden.delete(serviceId);
      return {
        hiddenTerminalIds: hidden,
        activeTerminalServiceId: serviceId,
        terminalPanelOpen: true,
      };
    });
  },

  closeTerminal: (serviceId) => {
    set((state) => {
      // Add to closed, remove from hidden, clear logs and runtime
      const closed = new Set(state.closedTerminalIds);
      closed.add(serviceId);
      const hidden = new Set(state.hiddenTerminalIds);
      hidden.delete(serviceId);
      const runtimes = new Map(state.serviceRuntimes);
      runtimes.delete(serviceId);

      // Update active terminal if needed
      let newActiveId = state.activeTerminalServiceId;
      if (state.activeTerminalServiceId === serviceId) {
        newActiveId = null;
        // Find another visible terminal
        for (const [id, runtime] of runtimes) {
          if (!hidden.has(id) && !closed.has(id) && (runtime.logs.length > 0 || runtime.status !== 'stopped')) {
            newActiveId = id;
            break;
          }
        }
      }

      return {
        closedTerminalIds: closed,
        hiddenTerminalIds: hidden,
        serviceRuntimes: runtimes,
        activeTerminalServiceId: newActiveId,
      };
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

  setTerminalHeight: (height) => {
    // Clamp height between 100px and 600px
    const clampedHeight = Math.min(Math.max(height, 100), 600);
    set({ terminalHeight: clampedHeight });
  },
}));
