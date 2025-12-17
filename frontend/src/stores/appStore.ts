import { create } from 'zustand';
import type {
  Project,
  Service,
  Script,
  AppSettings,
  CreateProjectInput,
  UpdateProjectInput,
  CreateServiceInput,
  UpdateServiceInput,
  CreateScriptInput,
  UpdateScriptInput,
  ServiceStatus,
  ScriptStatus,
  LogEntry,
  View,
  EnvFile,
  EnvComparison,
  AddEnvFileInput,
} from '@/types';
import * as api from '@/lib/tauri';

interface ServiceRuntime {
  status: ServiceStatus;
  pid?: number;
  logs: LogEntry[];
  detectedPort?: number;
  activeMode?: string;
  activeArgPreset?: string;
}

interface ScriptRuntime {
  status: ScriptStatus;
  pid?: number;
  logs: LogEntry[];
  lastExitCode?: number;
  lastSuccess?: boolean;
}

// Terminal pane for multi-pane terminal view
export interface TerminalPane {
  id: string;                      // Unique pane ID
  terminalIds: string[];           // Array of terminal IDs in this pane (the tabs)
  activeTerminalId: string | null; // Which tab is currently visible in this pane
  width: number;                   // Width as percentage (0-100), will be normalized
}

export type DragOverPosition = 'left' | 'center' | 'right' | null;

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

  // Script runtime state
  scriptRuntimes: Map<string, ScriptRuntime>;

  // Environment files state
  isDiscoveringEnvFiles: boolean;
  envFileComparisons: Map<string, EnvComparison>;

  // UI state
  currentView: View;
  terminalPanelOpen: boolean;
  terminalHeight: number;
  activeTerminalServiceId: string | null;
  activeTerminalScriptId: string | null;
  hiddenTerminalIds: Set<string>;
  closedTerminalIds: Set<string>;

  // Multi-pane terminal state
  terminalPanes: TerminalPane[];
  focusedPaneId: string | null;
  dragOverPaneId: string | null;
  dragOverPosition: DragOverPosition;

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

  // Actions - Scripts
  addScript: (projectId: string, input: CreateScriptInput) => Promise<Script>;
  updateScript: (scriptId: string, input: UpdateScriptInput) => Promise<void>;
  deleteScript: (scriptId: string) => Promise<void>;
  runScript: (scriptId: string) => Promise<void>;
  stopScript: (scriptId: string) => Promise<void>;

  // Actions - Script runtime updates
  updateScriptStatus: (scriptId: string, status: ScriptStatus, pid?: number) => void;
  appendScriptLog: (scriptId: string, log: LogEntry) => void;
  clearScriptLogs: (scriptId: string) => void;
  setScriptExitResult: (scriptId: string, exitCode?: number, success?: boolean) => void;

  // Actions - Launch
  startService: (serviceId: string, mode?: string, argPreset?: string) => Promise<void>;
  stopService: (serviceId: string) => Promise<void>;
  copyLaunchCommand: (serviceId: string) => Promise<string>;
  launchExternal: (serviceId: string) => Promise<void>;

  // Actions - Runtime updates
  updateServiceStatus: (serviceId: string, status: ServiceStatus, pid?: number, activeMode?: string, activeArgPreset?: string) => void;
  appendServiceLog: (serviceId: string, log: LogEntry) => void;
  clearServiceLogs: (serviceId: string) => void;
  closeAllTerminals: () => void;

  // Actions - Terminal visibility
  hideTerminal: (serviceId: string) => void;
  hideScriptTerminal: (scriptId: string) => void;
  showTerminal: (serviceId: string) => void;
  showScriptTerminal: (scriptId: string) => void;
  closeTerminal: (serviceId: string) => void;
  closeScriptTerminal: (scriptId: string) => void;

  // Actions - Environment files
  discoverEnvFiles: (projectId: string, force?: boolean) => Promise<EnvFile[]>;
  addEnvFile: (projectId: string, input: AddEnvFileInput) => Promise<EnvFile>;
  removeEnvFile: (projectId: string, envFileId: string) => Promise<void>;
  refreshEnvFile: (projectId: string, envFileId: string) => Promise<EnvFile>;
  refreshAllEnvFiles: (projectId: string) => Promise<EnvFile[]>;
  compareEnvFiles: (projectId: string, baseFileId: string, exampleFileId: string) => Promise<EnvComparison>;
  linkEnvToService: (projectId: string, envFileId: string, serviceId: string | null) => Promise<void>;

  // Actions - Settings
  loadSettings: () => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;

  // Actions - UI
  setCurrentView: (view: View) => void;
  toggleTerminalPanel: () => void;
  setActiveTerminalServiceId: (serviceId: string | null) => void;
  setActiveTerminalScriptId: (scriptId: string | null) => void;
  setTerminalHeight: (height: number) => void;

  // Actions - Multi-pane terminal
  addPane: (position: 'left' | 'right', referenceId?: string) => string;
  removePane: (paneId: string) => void;
  setActiveTerminalInPane: (paneId: string, terminalId: string | null) => void;
  addTerminalToPane: (paneId: string, terminalId: string) => void;
  removeTerminalFromPane: (paneId: string, terminalId: string) => void;
  moveTerminalToPane: (terminalId: string, targetPaneId: string) => void;
  reorderTerminalInPane: (paneId: string, terminalId: string, newIndex: number) => void;
  focusPane: (paneId: string) => void;
  resizePanes: (paneWidths: { id: string; width: number }[]) => void;
  setDragOverState: (paneId: string | null, position: DragOverPosition) => void;
}

export const useAppStore = create<AppState>((set, _get) => ({
  // Initial state
  projects: [],
  selectedProjectId: null,
  isLoadingProjects: false,
  settings: null,
  isLoadingSettings: false,
  serviceRuntimes: new Map(),
  scriptRuntimes: new Map(),
  isDiscoveringEnvFiles: false,
  envFileComparisons: new Map(),
  currentView: 'dashboard',
  terminalPanelOpen: false,
  terminalHeight: 256,
  activeTerminalServiceId: null,
  activeTerminalScriptId: null,
  hiddenTerminalIds: new Set(),
  closedTerminalIds: new Set(),

  // Multi-pane terminal initial state
  terminalPanes: [{ id: 'default', terminalIds: [], activeTerminalId: null, width: 100 }],
  focusedPaneId: 'default',
  dragOverPaneId: null,
  dragOverPosition: null,

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

  // Script actions
  addScript: async (projectId, input) => {
    const script = await api.addScript(projectId, input);
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, scripts: [...(p.scripts || []), script] } : p
      ),
    }));
    return script;
  },

  updateScript: async (scriptId, input) => {
    const updated = await api.updateScript(scriptId, input);
    set((state) => ({
      projects: state.projects.map((p) => ({
        ...p,
        scripts: (p.scripts || []).map((s) => (s.id === scriptId ? updated : s)),
      })),
    }));
  },

  deleteScript: async (scriptId) => {
    await api.deleteScript(scriptId);
    set((state) => ({
      projects: state.projects.map((p) => ({
        ...p,
        scripts: (p.scripts || []).filter((s) => s.id !== scriptId),
      })),
    }));
  },

  runScript: async (scriptId) => {
    try {
      await api.runScript(scriptId);
      // Status will be updated via events
      // Unhide terminal if hidden and remove from closed
      // Add terminal to focused pane's tabs
      set((state) => {
        const hidden = new Set(state.hiddenTerminalIds);
        hidden.delete(scriptId);
        const closed = new Set(state.closedTerminalIds);
        closed.delete(scriptId);

        // Add terminal to focused pane (or first pane if none focused)
        const terminalId = `script:${scriptId}`;
        let terminalPanes = state.terminalPanes;
        const isAlreadyInAnyPane = terminalPanes.some(p => p.terminalIds.includes(terminalId));

        if (!isAlreadyInAnyPane) {
          // Add to focused pane, or first pane
          const targetPaneId = state.focusedPaneId || terminalPanes[0].id;
          terminalPanes = terminalPanes.map(p =>
            p.id === targetPaneId
              ? { ...p, terminalIds: [...p.terminalIds, terminalId], activeTerminalId: terminalId }
              : p
          );
        } else {
          // Terminal already in a pane, just make it active in that pane
          terminalPanes = terminalPanes.map(p =>
            p.terminalIds.includes(terminalId)
              ? { ...p, activeTerminalId: terminalId }
              : p
          );
        }

        return {
          terminalPanelOpen: true,
          activeTerminalScriptId: scriptId,
          activeTerminalServiceId: null, // Clear service selection
          hiddenTerminalIds: hidden,
          closedTerminalIds: closed,
          terminalPanes,
        };
      });
    } catch (error) {
      console.error('Failed to run script:', error);
      throw error;
    }
  },

  stopScript: async (scriptId) => {
    try {
      await api.stopScript(scriptId);
      // Status will be updated via events
    } catch (error) {
      console.error('Failed to stop script:', error);
      throw error;
    }
  },

  // Script runtime updates
  updateScriptStatus: (scriptId, status, pid) => {
    set((state) => {
      const runtimes = new Map(state.scriptRuntimes);
      const existing = runtimes.get(scriptId) || { status: 'idle', logs: [] };
      runtimes.set(scriptId, { ...existing, status, pid });
      return { scriptRuntimes: runtimes };
    });
  },

  appendScriptLog: (scriptId, log) => {
    set((state) => {
      const runtimes = new Map(state.scriptRuntimes);
      const existing = runtimes.get(scriptId) || { status: 'idle', logs: [] };
      // Keep last 1000 logs
      const logs = [...existing.logs, log].slice(-1000);
      runtimes.set(scriptId, { ...existing, logs });
      return { scriptRuntimes: runtimes };
    });
  },

  clearScriptLogs: (scriptId) => {
    set((state) => {
      const runtimes = new Map(state.scriptRuntimes);
      const existing = runtimes.get(scriptId);
      if (existing) {
        runtimes.set(scriptId, { ...existing, logs: [] });
      }
      return { scriptRuntimes: runtimes };
    });
  },

  setScriptExitResult: (scriptId, exitCode, success) => {
    set((state) => {
      const runtimes = new Map(state.scriptRuntimes);
      const existing = runtimes.get(scriptId);
      if (existing) {
        runtimes.set(scriptId, { ...existing, lastExitCode: exitCode, lastSuccess: success });
      }
      return { scriptRuntimes: runtimes };
    });
  },

  // Launch actions
  startService: async (serviceId, mode, argPreset) => {
    try {
      await api.startIntegratedService(serviceId, mode, argPreset);
      // Status will be updated via events
      // Also unhide terminal if it was hidden and remove from closed
      // Add terminal to focused pane's tabs
      set((state) => {
        const hidden = new Set(state.hiddenTerminalIds);
        hidden.delete(serviceId);
        const closed = new Set(state.closedTerminalIds);
        closed.delete(serviceId);

        // Add terminal to focused pane (or first pane if none focused)
        const terminalId = `service:${serviceId}`;
        let terminalPanes = state.terminalPanes;
        const isAlreadyInAnyPane = terminalPanes.some(p => p.terminalIds.includes(terminalId));

        if (!isAlreadyInAnyPane) {
          // Add to focused pane, or first pane
          const targetPaneId = state.focusedPaneId || terminalPanes[0].id;
          terminalPanes = terminalPanes.map(p =>
            p.id === targetPaneId
              ? { ...p, terminalIds: [...p.terminalIds, terminalId], activeTerminalId: terminalId }
              : p
          );
        } else {
          // Terminal already in a pane, just make it active in that pane
          terminalPanes = terminalPanes.map(p =>
            p.terminalIds.includes(terminalId)
              ? { ...p, activeTerminalId: terminalId }
              : p
          );
        }

        return {
          terminalPanelOpen: true,
          activeTerminalServiceId: serviceId,
          activeTerminalScriptId: null, // Clear script selection
          hiddenTerminalIds: hidden,
          closedTerminalIds: closed,
          terminalPanes,
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
  updateServiceStatus: (serviceId, status, pid, activeMode, activeArgPreset) => {
    set((state) => {
      const runtimes = new Map(state.serviceRuntimes);
      const existing = runtimes.get(serviceId) || { status: 'stopped', logs: [] };
      // Clear detected port, mode, and preset when service stops
      const detectedPort = status === 'stopped' ? undefined : existing.detectedPort;
      const mode = status === 'stopped' ? undefined : (activeMode ?? existing.activeMode);
      const preset = status === 'stopped' ? undefined : (activeArgPreset ?? existing.activeArgPreset);
      runtimes.set(serviceId, { ...existing, status, pid, detectedPort, activeMode: mode, activeArgPreset: preset });
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

      // Remove from any pane's terminalIds
      const terminalId = `service:${serviceId}`;
      let terminalPanes = state.terminalPanes.map((p) => {
        if (p.terminalIds.includes(terminalId)) {
          const newIds = p.terminalIds.filter((id) => id !== terminalId);
          return {
            ...p,
            terminalIds: newIds,
            activeTerminalId: p.activeTerminalId === terminalId
              ? (newIds[0] || null)
              : p.activeTerminalId,
          };
        }
        return p;
      });

      // Auto-close empty panes (if more than one pane exists)
      if (terminalPanes.length > 1) {
        const emptyPanes = terminalPanes.filter(p => p.terminalIds.length === 0);
        if (emptyPanes.length > 0) {
          terminalPanes = terminalPanes.filter(p => p.terminalIds.length > 0);
          // Redistribute width proportionally
          const totalWidth = terminalPanes.reduce((sum, p) => sum + p.width, 0);
          terminalPanes = terminalPanes.map(p => ({
            ...p,
            width: (p.width / totalWidth) * 100,
          }));
        }
      }

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

      // Update focused pane if the focused pane was removed
      let newFocusedPaneId = state.focusedPaneId;
      if (newFocusedPaneId && !terminalPanes.find(p => p.id === newFocusedPaneId)) {
        newFocusedPaneId = terminalPanes[0]?.id || null;
      }

      return { hiddenTerminalIds: hidden, activeTerminalServiceId: newActiveId, terminalPanes, focusedPaneId: newFocusedPaneId };
    });
  },

  hideScriptTerminal: (scriptId) => {
    set((state) => {
      const hidden = new Set(state.hiddenTerminalIds);
      hidden.add(scriptId);

      // Remove from any pane's terminalIds
      const terminalId = `script:${scriptId}`;
      let terminalPanes = state.terminalPanes.map((p) => {
        if (p.terminalIds.includes(terminalId)) {
          const newIds = p.terminalIds.filter((id) => id !== terminalId);
          return {
            ...p,
            terminalIds: newIds,
            activeTerminalId: p.activeTerminalId === terminalId
              ? (newIds[0] || null)
              : p.activeTerminalId,
          };
        }
        return p;
      });

      // Auto-close empty panes (if more than one pane exists)
      if (terminalPanes.length > 1) {
        const emptyPanes = terminalPanes.filter(p => p.terminalIds.length === 0);
        if (emptyPanes.length > 0) {
          terminalPanes = terminalPanes.filter(p => p.terminalIds.length > 0);
          // Redistribute width proportionally
          const totalWidth = terminalPanes.reduce((sum, p) => sum + p.width, 0);
          terminalPanes = terminalPanes.map(p => ({
            ...p,
            width: (p.width / totalWidth) * 100,
          }));
        }
      }

      // If hiding the active terminal, switch to another visible one or null
      let newActiveScriptId = state.activeTerminalScriptId;
      if (state.activeTerminalScriptId === scriptId) {
        // Find first visible script terminal
        for (const [id, runtime] of state.scriptRuntimes) {
          if (!hidden.has(id) && (runtime.logs.length > 0 || runtime.status !== 'idle')) {
            newActiveScriptId = id;
            break;
          }
        }
        if (newActiveScriptId === scriptId) {
          newActiveScriptId = null;
        }
      }

      // Update focused pane if the focused pane was removed
      let newFocusedPaneId = state.focusedPaneId;
      if (newFocusedPaneId && !terminalPanes.find(p => p.id === newFocusedPaneId)) {
        newFocusedPaneId = terminalPanes[0]?.id || null;
      }

      return { hiddenTerminalIds: hidden, activeTerminalScriptId: newActiveScriptId, terminalPanes, focusedPaneId: newFocusedPaneId };
    });
  },

  showTerminal: (serviceId) => {
    set((state) => {
      const hidden = new Set(state.hiddenTerminalIds);
      hidden.delete(serviceId);

      // Add terminal to focused pane's tabs
      const terminalId = `service:${serviceId}`;
      let terminalPanes = state.terminalPanes;
      const isAlreadyInAnyPane = terminalPanes.some(p => p.terminalIds.includes(terminalId));

      if (!isAlreadyInAnyPane) {
        // Add to focused pane, or first pane
        const targetPaneId = state.focusedPaneId || terminalPanes[0].id;
        terminalPanes = terminalPanes.map(p =>
          p.id === targetPaneId
            ? { ...p, terminalIds: [...p.terminalIds, terminalId], activeTerminalId: terminalId }
            : p
        );
      } else {
        // Terminal already in a pane, just make it active
        terminalPanes = terminalPanes.map(p =>
          p.terminalIds.includes(terminalId)
            ? { ...p, activeTerminalId: terminalId }
            : p
        );
      }

      return {
        hiddenTerminalIds: hidden,
        activeTerminalServiceId: serviceId,
        activeTerminalScriptId: null,
        terminalPanelOpen: true,
        terminalPanes,
      };
    });
  },

  showScriptTerminal: (scriptId) => {
    set((state) => {
      const hidden = new Set(state.hiddenTerminalIds);
      hidden.delete(scriptId);

      // Add terminal to focused pane's tabs
      const terminalId = `script:${scriptId}`;
      let terminalPanes = state.terminalPanes;
      const isAlreadyInAnyPane = terminalPanes.some(p => p.terminalIds.includes(terminalId));

      if (!isAlreadyInAnyPane) {
        // Add to focused pane, or first pane
        const targetPaneId = state.focusedPaneId || terminalPanes[0].id;
        terminalPanes = terminalPanes.map(p =>
          p.id === targetPaneId
            ? { ...p, terminalIds: [...p.terminalIds, terminalId], activeTerminalId: terminalId }
            : p
        );
      } else {
        // Terminal already in a pane, just make it active
        terminalPanes = terminalPanes.map(p =>
          p.terminalIds.includes(terminalId)
            ? { ...p, activeTerminalId: terminalId }
            : p
        );
      }

      return {
        hiddenTerminalIds: hidden,
        activeTerminalScriptId: scriptId,
        activeTerminalServiceId: null,
        terminalPanelOpen: true,
        terminalPanes,
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

  closeScriptTerminal: (scriptId) => {
    set((state) => {
      // Add to closed, remove from hidden, clear logs and runtime
      const closed = new Set(state.closedTerminalIds);
      closed.add(scriptId);
      const hidden = new Set(state.hiddenTerminalIds);
      hidden.delete(scriptId);
      const runtimes = new Map(state.scriptRuntimes);
      runtimes.delete(scriptId);

      // Update active terminal if needed
      let newActiveScriptId = state.activeTerminalScriptId;
      if (state.activeTerminalScriptId === scriptId) {
        newActiveScriptId = null;
        // Find another visible script terminal
        for (const [id, runtime] of runtimes) {
          if (!hidden.has(id) && !closed.has(id) && (runtime.logs.length > 0 || runtime.status !== 'idle')) {
            newActiveScriptId = id;
            break;
          }
        }
      }

      return {
        closedTerminalIds: closed,
        hiddenTerminalIds: hidden,
        scriptRuntimes: runtimes,
        activeTerminalScriptId: newActiveScriptId,
      };
    });
  },

  // Environment file actions
  discoverEnvFiles: async (projectId, force = false) => {
    set({ isDiscoveringEnvFiles: true });
    try {
      const envFiles = await api.discoverEnvFiles(projectId, { force });
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === projectId ? { ...p, envFiles, envFilesDiscovered: true } : p
        ),
        isDiscoveringEnvFiles: false,
      }));
      return envFiles;
    } catch (error) {
      console.error('Failed to discover env files:', error);
      set({ isDiscoveringEnvFiles: false });
      throw error;
    }
  },

  addEnvFile: async (projectId, input) => {
    const envFile = await api.addEnvFile(projectId, input);
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, envFiles: [...p.envFiles, envFile] } : p
      ),
    }));
    return envFile;
  },

  removeEnvFile: async (projectId, envFileId) => {
    await api.removeEnvFile(projectId, envFileId);
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, envFiles: p.envFiles.filter((f) => f.id !== envFileId) }
          : p
      ),
    }));
  },

  refreshEnvFile: async (projectId, envFileId) => {
    const envFile = await api.refreshEnvFile(projectId, envFileId);
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, envFiles: p.envFiles.map((f) => (f.id === envFileId ? envFile : f)) }
          : p
      ),
    }));
    return envFile;
  },

  refreshAllEnvFiles: async (projectId) => {
    const envFiles = await api.refreshAllEnvFiles(projectId);
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, envFiles } : p
      ),
    }));
    return envFiles;
  },

  compareEnvFiles: async (projectId, baseFileId, exampleFileId) => {
    const comparison = await api.compareEnvFiles(projectId, baseFileId, exampleFileId);
    set((state) => {
      const comparisons = new Map(state.envFileComparisons);
      comparisons.set(baseFileId, comparison);
      return { envFileComparisons: comparisons };
    });
    return comparison;
  },

  linkEnvToService: async (projectId, envFileId, serviceId) => {
    const envFile = await api.linkEnvToService(projectId, envFileId, { serviceId });
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, envFiles: p.envFiles.map((f) => (f.id === envFileId ? envFile : f)) }
          : p
      ),
    }));
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
    set({ activeTerminalServiceId: serviceId, activeTerminalScriptId: null });
  },

  setActiveTerminalScriptId: (scriptId) => {
    set({ activeTerminalScriptId: scriptId, activeTerminalServiceId: null });
  },

  setTerminalHeight: (height) => {
    // Clamp height between 100px and 600px
    const clampedHeight = Math.min(Math.max(height, 100), 600);
    set({ terminalHeight: clampedHeight });
  },

  // Multi-pane terminal actions
  addPane: (position, referenceId) => {
    const newPaneId = `pane-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    set((state) => {
      const panes = [...state.terminalPanes];
      const referenceIndex = referenceId
        ? panes.findIndex((p) => p.id === referenceId)
        : position === 'right' ? panes.length - 1 : 0;

      if (referenceIndex === -1) {
        // Reference not found, add to end
        panes.push({ id: newPaneId, terminalIds: [], activeTerminalId: null, width: 50 });
      } else {
        // Calculate new widths - split reference pane's width
        const refPane = panes[referenceIndex];
        const newWidth = refPane.width / 2;
        refPane.width = newWidth;

        const newPane: TerminalPane = { id: newPaneId, terminalIds: [], activeTerminalId: null, width: newWidth };

        if (position === 'left') {
          panes.splice(referenceIndex, 0, newPane);
        } else {
          panes.splice(referenceIndex + 1, 0, newPane);
        }
      }

      return { terminalPanes: panes, focusedPaneId: newPaneId };
    });

    return newPaneId;
  },

  removePane: (paneId) => {
    set((state) => {
      const panes = state.terminalPanes;
      if (panes.length <= 1) return state; // Can't remove last pane

      const index = panes.findIndex((p) => p.id === paneId);
      if (index === -1) return state;

      const removedPane = panes[index];
      const removedWidth = removedPane.width;

      // Move terminals from removed pane to adjacent pane
      const adjacentIndex = index === 0 ? 1 : index - 1;
      const adjacentPane = panes[adjacentIndex];

      const newPanes = panes.filter((p) => p.id !== paneId).map((p) => {
        if (p.id === adjacentPane.id) {
          return {
            ...p,
            terminalIds: [...p.terminalIds, ...removedPane.terminalIds],
            activeTerminalId: p.activeTerminalId || removedPane.activeTerminalId,
          };
        }
        return p;
      });

      // Redistribute width to remaining panes proportionally
      const totalRemainingWidth = newPanes.reduce((sum, p) => sum + p.width, 0);
      newPanes.forEach((p) => {
        p.width = p.width + (removedWidth * p.width / totalRemainingWidth);
      });

      // Update focused pane if needed
      let newFocusedId = state.focusedPaneId;
      if (newFocusedId === paneId) {
        newFocusedId = newPanes[Math.min(index, newPanes.length - 1)].id;
      }

      return { terminalPanes: newPanes, focusedPaneId: newFocusedId };
    });
  },

  setActiveTerminalInPane: (paneId, terminalId) => {
    set((state) => {
      const panes = state.terminalPanes.map((p) =>
        p.id === paneId ? { ...p, activeTerminalId: terminalId } : p
      );
      return { terminalPanes: panes, focusedPaneId: paneId };
    });
  },

  addTerminalToPane: (paneId, terminalId) => {
    set((state) => {
      const panes = state.terminalPanes.map((p) => {
        if (p.id === paneId && !p.terminalIds.includes(terminalId)) {
          return {
            ...p,
            terminalIds: [...p.terminalIds, terminalId],
            activeTerminalId: terminalId,
          };
        }
        return p;
      });
      return { terminalPanes: panes, focusedPaneId: paneId };
    });
  },

  removeTerminalFromPane: (paneId, terminalId) => {
    set((state) => {
      let panes = state.terminalPanes.map((p) => {
        if (p.id === paneId) {
          const newIds = p.terminalIds.filter((id) => id !== terminalId);
          return {
            ...p,
            terminalIds: newIds,
            activeTerminalId: p.activeTerminalId === terminalId
              ? (newIds[0] || null)
              : p.activeTerminalId,
          };
        }
        return p;
      });

      // Auto-close empty panes (if more than one pane exists)
      if (panes.length > 1) {
        const emptyPane = panes.find(p => p.id === paneId && p.terminalIds.length === 0);
        if (emptyPane) {
          // Remove the empty pane and redistribute width
          const emptyIndex = panes.findIndex(p => p.id === paneId);
          const adjacentIndex = emptyIndex > 0 ? emptyIndex - 1 : emptyIndex + 1;
          const adjacentPane = panes[adjacentIndex];

          if (adjacentPane) {
            panes = panes.filter(p => p.id !== paneId);
            // Redistribute width proportionally
            const totalWidth = panes.reduce((sum, p) => sum + p.width, 0);
            panes = panes.map(p => ({
              ...p,
              width: (p.width / totalWidth) * 100,
            }));
          }
        }
      }

      return { terminalPanes: panes };
    });
  },

  moveTerminalToPane: (terminalId, targetPaneId) => {
    set((state) => {
      let sourcePaneId: string | null = null;

      let panes = state.terminalPanes.map((p) => {
        // Remove from source pane
        if (p.terminalIds.includes(terminalId) && p.id !== targetPaneId) {
          sourcePaneId = p.id;
          const newIds = p.terminalIds.filter((id) => id !== terminalId);
          return {
            ...p,
            terminalIds: newIds,
            activeTerminalId: p.activeTerminalId === terminalId
              ? (newIds[0] || null)
              : p.activeTerminalId,
          };
        }
        // Add to target pane
        if (p.id === targetPaneId && !p.terminalIds.includes(terminalId)) {
          return {
            ...p,
            terminalIds: [...p.terminalIds, terminalId],
            activeTerminalId: terminalId,
          };
        }
        return p;
      });

      // Auto-close empty source pane (if more than one pane exists)
      if (panes.length > 1 && sourcePaneId) {
        const emptyPane = panes.find(p => p.id === sourcePaneId && p.terminalIds.length === 0);
        if (emptyPane) {
          panes = panes.filter(p => p.id !== sourcePaneId);
          // Redistribute width proportionally
          const totalWidth = panes.reduce((sum, p) => sum + p.width, 0);
          panes = panes.map(p => ({
            ...p,
            width: (p.width / totalWidth) * 100,
          }));
        }
      }

      return { terminalPanes: panes, focusedPaneId: targetPaneId };
    });
  },

  reorderTerminalInPane: (paneId, terminalId, newIndex) => {
    set((state) => {
      const panes = state.terminalPanes.map((p) => {
        if (p.id === paneId) {
          const oldIndex = p.terminalIds.indexOf(terminalId);
          if (oldIndex !== -1 && oldIndex !== newIndex) {
            const newIds = [...p.terminalIds];
            newIds.splice(oldIndex, 1);
            newIds.splice(newIndex, 0, terminalId);
            return { ...p, terminalIds: newIds };
          }
        }
        return p;
      });
      return { terminalPanes: panes };
    });
  },

  focusPane: (paneId) => {
    set({ focusedPaneId: paneId });
  },

  resizePanes: (paneWidths) => {
    set((state) => {
      const panes = state.terminalPanes.map((p) => {
        const newWidth = paneWidths.find((w) => w.id === p.id);
        if (newWidth) {
          // Enforce minimum width of 15%
          return { ...p, width: Math.max(newWidth.width, 15) };
        }
        return p;
      });
      return { terminalPanes: panes };
    });
  },

  setDragOverState: (paneId, position) => {
    set({ dragOverPaneId: paneId, dragOverPosition: position });
  },
}));
