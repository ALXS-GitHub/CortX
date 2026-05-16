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
  GlobalScript,
  CreateGlobalScriptInput,
  UpdateGlobalScriptInput,
  TagDefinition,
  CreateTagDefinitionInput,
  UpdateTagDefinitionInput,
  ScriptsConfig,
  ScriptParameter,
  ImportOptions,
  ImportResult,
  ExportSummary,
  DiscoveredScript,
  Tool,
  CreateToolInput,
  UpdateToolInput,
  ShellAlias,
  CreateShellAliasInput,
  UpdateShellAliasInput,
  StatusDefinition,
  CreateStatusDefinitionInput,
  UpdateStatusDefinitionInput,
  App,
  CreateAppInput,
  UpdateAppInput,
} from '@/types';
import * as api from '@/lib/tauri';

interface ServiceRuntime {
  status: ServiceStatus;
  pid?: number;
  logs: LogEntry[];
  /** TCP ports the service (and its descendants) are currently listening on,
   *  populated by the OS-level poller via the `service-ports` Tauri event.
   *  Empty list = no listening ports detected (yet, or service released them). */
  detectedPorts: number[];
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

// Terminal entity — single source of truth for "which terminal is where, what state is it in"
export type TerminalKind = 'service' | 'script' | 'global-script';
export type TerminalVisibility = 'visible' | 'hidden' | 'closed';

export interface Terminal {
  id: string;                      // Canonical: `${kind}:${runtimeKey}` e.g. "service:abc"
  kind: TerminalKind;
  runtimeKey: string;              // Raw serviceId / scriptId / globalScriptId — looks up runtime
  paneId: string | null;           // Which pane this terminal lives in (null when hidden or closed)
  visibility: TerminalVisibility;  // 'visible' = in a pane, 'hidden' = in tray, 'closed' = user-closed
  order: number;                   // Sort order within pane (monotonic; lower = earlier)
  createdAt: number;
}

// Terminal pane for multi-pane terminal view.
// Tab membership is derived: filter `state.terminals` where `paneId === pane.id`, sorted by `order`.
export interface TerminalPane {
  id: string;                      // Unique pane ID
  activeTerminalId: string | null; // Which tab is currently visible in this pane (terminal.id)
  width: number;                   // Width as percentage (0-100), will be normalized
}

export type DragOverPosition = 'left' | 'center' | 'right' | null;

// Helper: build a Terminal entity ID from kind + runtimeKey
function terminalId(kind: TerminalKind, runtimeKey: string): string {
  return `${kind}:${runtimeKey}`;
}

// Helper: parse a Terminal ID back into kind + runtimeKey
function parseTerminalId(id: string): { kind: TerminalKind; runtimeKey: string } | null {
  if (id.startsWith('global-script:')) {
    return { kind: 'global-script', runtimeKey: id.slice('global-script:'.length) };
  }
  if (id.startsWith('service:')) {
    return { kind: 'service', runtimeKey: id.slice('service:'.length) };
  }
  if (id.startsWith('script:')) {
    return { kind: 'script', runtimeKey: id.slice('script:'.length) };
  }
  return null;
}

// Helper: ensure a Terminal entity exists for a given (kind, runtimeKey).
// If it already exists, returns the current map unchanged. If not, creates one in 'hidden' state.
// This is called from runtime mutations (appendServiceLog, etc.) to keep terminals in sync
// with runtimes that may appear from async events (e.g. app re-attach after reload).
function ensureTerminal(
  terminals: Map<string, Terminal>,
  kind: TerminalKind,
  runtimeKey: string
): Map<string, Terminal> {
  const id = terminalId(kind, runtimeKey);
  if (terminals.has(id)) return terminals;
  const next = new Map(terminals);
  next.set(id, {
    id,
    kind,
    runtimeKey,
    paneId: null,
    visibility: 'hidden',
    order: Date.now(),
    createdAt: Date.now(),
  });
  return next;
}

// Helper: redistribute pane widths to sum to 100%
function redistributePaneWidths(panes: TerminalPane[]): TerminalPane[] {
  if (panes.length === 0) return panes;
  const total = panes.reduce((sum, p) => sum + p.width, 0);
  if (total === 0) return panes.map((p) => ({ ...p, width: 100 / panes.length }));
  return panes.map((p) => ({ ...p, width: (p.width / total) * 100 }));
}

// Helper: prune empty panes (those with no visible terminals), keeping at least one pane.
// Returns updated { terminalPanes, focusedPaneId } if changes occurred, else null.
function pruneEmptyPanes(
  panes: TerminalPane[],
  terminals: Map<string, Terminal>,
  focusedPaneId: string | null
): { terminalPanes: TerminalPane[]; focusedPaneId: string | null } | null {
  if (panes.length <= 1) return null; // Always keep at least one pane

  const hasVisibleTerminal = (paneId: string) => {
    for (const t of terminals.values()) {
      if (t.paneId === paneId && t.visibility === 'visible') return true;
    }
    return false;
  };

  const kept = panes.filter((p) => hasVisibleTerminal(p.id));
  if (kept.length === panes.length) return null; // No change
  if (kept.length === 0) {
    // All panes were empty — keep the first one
    return {
      terminalPanes: redistributePaneWidths([{ ...panes[0], activeTerminalId: null }]),
      focusedPaneId: panes[0].id,
    };
  }
  const newFocused = kept.find((p) => p.id === focusedPaneId)?.id ?? kept[0].id;
  return {
    terminalPanes: redistributePaneWidths(kept),
    focusedPaneId: newFocused,
  };
}

// Helper: pick a new active terminal for a pane after the current active was removed.
// Returns the ID of another visible terminal in the same pane, or null.
function pickNewActiveForPane(
  paneId: string,
  terminals: Map<string, Terminal>,
  excludeId?: string
): string | null {
  const candidates: Terminal[] = [];
  for (const t of terminals.values()) {
    if (t.paneId === paneId && t.visibility === 'visible' && t.id !== excludeId) {
      candidates.push(t);
    }
  }
  candidates.sort((a, b) => a.order - b.order);
  return candidates[0]?.id ?? null;
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

  // Global scripts
  globalScripts: GlobalScript[];
  tagDefinitions: TagDefinition[];
  globalScriptRuntimes: Map<string, ScriptRuntime>;
  scriptsConfig: ScriptsConfig | null;
  selectedGlobalScriptId: string | null;
  isLoadingGlobalScripts: boolean;

  // Tools
  tools: Tool[];
  selectedToolId: string | null;
  isLoadingTools: boolean;

  // Aliases
  aliases: ShellAlias[];
  selectedAliasId: string | null;
  isLoadingAliases: boolean;

  // Status Definitions
  statusDefinitions: StatusDefinition[];

  // Apps
  apps: App[];
  selectedAppId: string | null;
  isLoadingApps: boolean;

  // Run Script Dialog
  runScriptDialogTarget: GlobalScript | null;

  // UI state
  currentView: View;
  terminalPanelOpen: boolean;
  terminalHeight: number;

  // Terminal entities — single source of truth for terminal placement & visibility.
  // Each Terminal is identified by `${kind}:${runtimeKey}`. Pane membership and
  // visibility live here; the old hiddenTerminalIds / closedTerminalIds / per-pane
  // terminalIds[] / activeTerminalServiceId / activeTerminalScriptId are all derived.
  terminals: Map<string, Terminal>;

  // Multi-pane terminal state. Each pane just tracks which terminal is currently
  // active inside it; the list of terminals in the pane is derived from `terminals`.
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
  updateServiceDetectedPorts: (serviceId: string, ports: number[]) => void;
  appendServiceLog: (serviceId: string, log: LogEntry) => void;
  clearServiceLogs: (serviceId: string) => void;

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

  // Actions - Global Scripts
  loadGlobalScripts: () => Promise<void>;
  createGlobalScript: (input: CreateGlobalScriptInput) => Promise<GlobalScript>;
  updateGlobalScript: (id: string, input: UpdateGlobalScriptInput) => Promise<void>;
  deleteGlobalScript: (id: string) => Promise<void>;
  reorderGlobalScripts: (scriptIds: string[]) => Promise<void>;
  runGlobalScript: (scriptId: string, workingDir: string, parameterValues?: Record<string, string>, extraArgs?: string) => Promise<void>;
  stopGlobalScript: (scriptId: string) => Promise<void>;
  selectGlobalScript: (id: string | null) => void;

  // Actions - Global Script runtime updates
  updateGlobalScriptStatus: (scriptId: string, status: ScriptStatus, pid?: number) => void;
  appendGlobalScriptLog: (scriptId: string, log: LogEntry) => void;
  clearGlobalScriptLogs: (scriptId: string) => void;
  setGlobalScriptExitResult: (scriptId: string, exitCode?: number, success?: boolean) => void;

  // Actions - Tag Definitions
  loadTagDefinitions: () => Promise<void>;
  createTagDefinition: (input: CreateTagDefinitionInput) => Promise<TagDefinition>;
  updateTagDefinition: (name: string, input: UpdateTagDefinitionInput) => Promise<void>;
  deleteTagDefinition: (name: string) => Promise<void>;

  // Actions - Scripts Config
  loadScriptsConfig: () => Promise<void>;
  updateScriptsConfig: (config: ScriptsConfig) => Promise<void>;
  scanScriptsFolder: (folder: string) => Promise<DiscoveredScript[]>;

  // Actions - Help Parser
  autoDetectScriptParams: (command: string, scriptPath?: string) => Promise<ScriptParameter[]>;

  // Actions - Tools
  loadTools: () => Promise<void>;
  createTool: (input: CreateToolInput) => Promise<Tool>;
  updateTool: (id: string, input: UpdateToolInput) => Promise<void>;
  deleteTool: (id: string) => Promise<void>;
  reorderTools: (toolIds: string[]) => Promise<void>;
  selectTool: (id: string | null) => void;

  // Actions - Aliases
  loadAliases: () => Promise<void>;
  createAlias: (input: CreateShellAliasInput) => Promise<ShellAlias>;
  updateAlias: (id: string, input: UpdateShellAliasInput) => Promise<ShellAlias>;
  deleteAlias: (id: string) => Promise<void>;
  reorderAliases: (aliasIds: string[]) => Promise<void>;
  selectAlias: (id: string | null) => void;

  // Status Definition actions
  loadStatusDefinitions: () => Promise<void>;
  createStatusDefinition: (input: CreateStatusDefinitionInput) => Promise<StatusDefinition>;
  updateStatusDefinition: (name: string, input: UpdateStatusDefinitionInput) => Promise<StatusDefinition>;
  deleteStatusDefinition: (name: string) => Promise<void>;

  // App actions
  loadApps: () => Promise<void>;
  createApp: (input: CreateAppInput) => Promise<App>;
  updateAppItem: (id: string, input: UpdateAppInput) => Promise<App>;
  deleteApp: (id: string) => Promise<void>;
  reorderApps: (appIds: string[]) => Promise<void>;
  selectApp: (id: string | null) => void;
  launchApp: (appId: string) => Promise<void>;

  // Actions - Import / Export / Backup
  exportScriptsConfig: () => Promise<string>;
  previewImport: (json: string) => Promise<ExportSummary>;
  importScriptsConfig: (json: string, options: ImportOptions) => Promise<ImportResult>;
  backupToGit: () => Promise<string>;

  // Actions - Execution History Update
  updateExecutionRecordOnExit: (scriptId: string, exitCode: number | null, success: boolean) => Promise<void>;

  // Actions - Run Script Dialog
  openRunScriptDialog: (script: GlobalScript) => void;
  closeRunScriptDialog: () => void;

  // Actions - UI
  setCurrentView: (view: View) => void;
  toggleTerminalPanel: () => void;
  setTerminalHeight: (height: number) => void;

  // Actions - Terminals (unified, work on Terminal IDs like "service:abc")
  // Open or restore a terminal: assigns it to the focused pane, makes it active,
  // opens the panel. Creates the Terminal entity if it doesn't exist. Idempotent.
  openTerminal: (kind: TerminalKind, runtimeKey: string) => void;
  // Hide a terminal: removes from pane (logs preserved in runtime). Reversible via openTerminal.
  hideTerminal: (terminalId: string) => void;
  // Close a terminal: user-explicit removal. Deletes the runtime entry (logs gone).
  // Stays in 'closed' state to suppress re-show on async runtime events.
  closeTerminal: (terminalId: string) => void;
  // Close all visible terminals (used by the "close all" toolbar button — moves them to hidden tray).
  closeAllTerminals: () => void;

  // Actions - Multi-pane terminal
  addPane: (position: 'left' | 'right', referenceId?: string) => string;
  removePane: (paneId: string) => void;
  setActiveTerminalInPane: (paneId: string, terminalId: string | null) => void;
  moveTerminalToPane: (terminalId: string, targetPaneId: string) => void;
  reorderTerminalInPane: (paneId: string, terminalId: string, newIndex: number) => void;
  focusPane: (paneId: string) => void;
  resizePanes: (paneWidths: { id: string; width: number }[]) => void;
  setDragOverState: (paneId: string | null, position: DragOverPosition) => void;

  // Selectors (derived) — call these instead of accessing raw state slices
  getTerminalsInPane: (paneId: string) => Terminal[];
  getVisibleTerminals: () => Terminal[];
  getHiddenTerminals: () => Terminal[];
  isTerminalClosed: (terminalId: string) => boolean;
}

export const useAppStore = create<AppState>((set, get) => ({
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
  globalScripts: [],
  tagDefinitions: [],
  globalScriptRuntimes: new Map(),
  scriptsConfig: null,
  selectedGlobalScriptId: null,
  isLoadingGlobalScripts: false,
  tools: [],
  selectedToolId: null,
  isLoadingTools: false,

  aliases: [],
  selectedAliasId: null,
  isLoadingAliases: false,
  statusDefinitions: [],
  apps: [],
  selectedAppId: null,
  isLoadingApps: false,
  runScriptDialogTarget: null,
  currentView: 'dashboard',
  terminalPanelOpen: false,
  terminalHeight: 256,

  // Terminal entities — canonical store. Starts empty; entities are created on demand
  // by openTerminal (user action) or ensureTerminal (async runtime mutations).
  terminals: new Map(),

  // Multi-pane terminal initial state — one default pane, no active tab yet
  terminalPanes: [{ id: 'default', activeTerminalId: null, width: 100 }],
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
      // Status & logs will arrive via Tauri events; just show the terminal.
      get().openTerminal('script', scriptId);
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
      const terminals = ensureTerminal(state.terminals, 'script', scriptId);
      return { scriptRuntimes: runtimes, terminals };
    });
  },

  appendScriptLog: (scriptId, log) => {
    set((state) => {
      const runtimes = new Map(state.scriptRuntimes);
      const existing = runtimes.get(scriptId) || { status: 'idle', logs: [] };
      // Keep last 1000 logs
      const logs = [...existing.logs, log].slice(-1000);
      runtimes.set(scriptId, { ...existing, logs });
      const terminals = ensureTerminal(state.terminals, 'script', scriptId);
      return { scriptRuntimes: runtimes, terminals };
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
      // Status & logs will arrive via Tauri events; just show the terminal.
      get().openTerminal('service', serviceId);
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
      const existing = runtimes.get(serviceId) || { status: 'stopped', logs: [], detectedPorts: [] };
      // Clear detected ports, mode, and preset when service stops; the OS poller
      // will also emit an empty list on shutdown but we clear eagerly here too.
      const detectedPorts = status === 'stopped' ? [] : existing.detectedPorts;
      const mode = status === 'stopped' ? undefined : (activeMode ?? existing.activeMode);
      const preset = status === 'stopped' ? undefined : (activeArgPreset ?? existing.activeArgPreset);
      runtimes.set(serviceId, { ...existing, status, pid, detectedPorts, activeMode: mode, activeArgPreset: preset });
      // Auto-create Terminal entity (in hidden state) if this is the first time we see this runtime
      const terminals = ensureTerminal(state.terminals, 'service', serviceId);
      return { serviceRuntimes: runtimes, terminals };
    });
  },

  appendServiceLog: (serviceId, log) => {
    set((state) => {
      const runtimes = new Map(state.serviceRuntimes);
      const existing = runtimes.get(serviceId) || { status: 'stopped', logs: [], detectedPorts: [] };
      // Keep last 1000 logs. Port detection no longer happens here — the backend
      // queries the OS directly via the port poller (see process_manager.rs).
      const logs = [...existing.logs, log].slice(-1000);
      runtimes.set(serviceId, { ...existing, logs });
      const terminals = ensureTerminal(state.terminals, 'service', serviceId);
      return { serviceRuntimes: runtimes, terminals };
    });
  },

  /**
   * Update the list of OS-detected listening TCP ports for a service.
   * Called by the `service-ports` Tauri event listener.
   */
  updateServiceDetectedPorts: (serviceId: string, ports: number[]) => {
    set((state) => {
      const runtimes = new Map(state.serviceRuntimes);
      const existing = runtimes.get(serviceId) || { status: 'stopped', logs: [], detectedPorts: [] };
      runtimes.set(serviceId, { ...existing, detectedPorts: ports });
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
    // "Close all" = move every visible terminal to hidden state.
    // The user can still find them in the hidden tray.
    set((state) => {
      const terminals = new Map(state.terminals);
      for (const [id, t] of terminals) {
        if (t.visibility === 'visible') {
          terminals.set(id, { ...t, visibility: 'hidden', paneId: null });
        }
      }
      // Clear active in all panes
      const terminalPanes = state.terminalPanes.map((p) => ({ ...p, activeTerminalId: null }));
      return { terminals, terminalPanes };
    });
  },

  // ===== Unified terminal actions =====
  // These replace the 9 old hide/show/close functions (×3 kinds) with 3 actions that
  // work on Terminal IDs ("service:abc", "script:xyz", "global-script:foo").

  /**
   * Open or restore a terminal in the focused pane. Creates the Terminal entity if
   * it doesn't exist (lazy). Always atomic in one set() call.
   *
   * If the terminal was 'closed', transitioning back to 'visible' implicitly reopens
   * the session — the user's previous close is overridden by this explicit open.
   */
  openTerminal: (kind, runtimeKey) => {
    set((state) => {
      const id = terminalId(kind, runtimeKey);
      const terminals = new Map(state.terminals);
      const existing = terminals.get(id);

      const targetPaneId = state.focusedPaneId ?? state.terminalPanes[0]?.id ?? 'default';

      const terminal: Terminal = existing
        ? { ...existing, paneId: targetPaneId, visibility: 'visible' }
        : {
            id,
            kind,
            runtimeKey,
            paneId: targetPaneId,
            visibility: 'visible',
            order: Date.now(),
            createdAt: Date.now(),
          };
      terminals.set(id, terminal);

      // Set the target pane's active tab to this terminal
      const terminalPanes = state.terminalPanes.map((p) =>
        p.id === targetPaneId ? { ...p, activeTerminalId: id } : p
      );

      return {
        terminals,
        terminalPanes,
        focusedPaneId: targetPaneId,
        terminalPanelOpen: true,
      };
    });
  },

  /**
   * Hide a terminal: remove from its pane (visibility='hidden', paneId=null).
   * Runtime + logs are preserved — user can reopen via openTerminal.
   * Reassigns the pane's active terminal if needed, prunes empty panes.
   */
  hideTerminal: (id) => {
    set((state) => {
      const existing = state.terminals.get(id);
      if (!existing) return state;

      const terminals = new Map(state.terminals);
      const oldPaneId = existing.paneId;
      terminals.set(id, { ...existing, visibility: 'hidden', paneId: null });

      // If this terminal was the active one in its pane, pick another active.
      let terminalPanes = state.terminalPanes;
      if (oldPaneId) {
        terminalPanes = terminalPanes.map((p) => {
          if (p.id !== oldPaneId) return p;
          if (p.activeTerminalId === id) {
            return { ...p, activeTerminalId: pickNewActiveForPane(p.id, terminals, id) };
          }
          return p;
        });
      }

      // Prune empty panes
      const pruned = pruneEmptyPanes(terminalPanes, terminals, state.focusedPaneId);
      if (pruned) {
        return { terminals, terminalPanes: pruned.terminalPanes, focusedPaneId: pruned.focusedPaneId };
      }
      return { terminals, terminalPanes };
    });
  },

  /**
   * Close a terminal: user-explicit removal. Terminal moves to 'closed' state
   * (suppresses re-show on async runtime events) and the underlying runtime
   * is deleted (logs gone — matches the old "close = logs gone" behavior).
   */
  closeTerminal: (id) => {
    set((state) => {
      const existing = state.terminals.get(id);
      if (!existing) return state;

      const terminals = new Map(state.terminals);
      const oldPaneId = existing.paneId;
      terminals.set(id, { ...existing, visibility: 'closed', paneId: null });

      // Delete the underlying runtime
      const serviceRuntimes = existing.kind === 'service' ? new Map(state.serviceRuntimes) : state.serviceRuntimes;
      const scriptRuntimes = existing.kind === 'script' ? new Map(state.scriptRuntimes) : state.scriptRuntimes;
      const globalScriptRuntimes = existing.kind === 'global-script' ? new Map(state.globalScriptRuntimes) : state.globalScriptRuntimes;
      if (existing.kind === 'service') (serviceRuntimes as Map<string, ServiceRuntime>).delete(existing.runtimeKey);
      else if (existing.kind === 'script') (scriptRuntimes as Map<string, ScriptRuntime>).delete(existing.runtimeKey);
      else if (existing.kind === 'global-script') (globalScriptRuntimes as Map<string, ScriptRuntime>).delete(existing.runtimeKey);

      // Reassign pane active if needed
      let terminalPanes = state.terminalPanes;
      if (oldPaneId) {
        terminalPanes = terminalPanes.map((p) => {
          if (p.id !== oldPaneId) return p;
          if (p.activeTerminalId === id) {
            return { ...p, activeTerminalId: pickNewActiveForPane(p.id, terminals, id) };
          }
          return p;
        });
      }

      // Prune empty panes
      const pruned = pruneEmptyPanes(terminalPanes, terminals, state.focusedPaneId);
      if (pruned) {
        return {
          terminals,
          terminalPanes: pruned.terminalPanes,
          focusedPaneId: pruned.focusedPaneId,
          serviceRuntimes,
          scriptRuntimes,
          globalScriptRuntimes,
        };
      }
      return { terminals, terminalPanes, serviceRuntimes, scriptRuntimes, globalScriptRuntimes };
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

  // Global Scripts actions
  loadGlobalScripts: async () => {
    set({ isLoadingGlobalScripts: true });
    try {
      const globalScripts = await api.getAllGlobalScripts();
      set({ globalScripts, isLoadingGlobalScripts: false });
    } catch (error) {
      console.error('Failed to load global scripts:', error);
      set({ isLoadingGlobalScripts: false });
    }
  },

  createGlobalScript: async (input) => {
    const script = await api.createGlobalScript(input);
    set((state) => ({ globalScripts: [...state.globalScripts, script] }));
    return script;
  },

  updateGlobalScript: async (id, input) => {
    const updated = await api.updateGlobalScript(id, input);
    set((state) => ({
      globalScripts: state.globalScripts.map((s) => (s.id === id ? updated : s)),
    }));
  },

  deleteGlobalScript: async (id) => {
    await api.deleteGlobalScript(id);
    set((state) => ({
      globalScripts: state.globalScripts.filter((s) => s.id !== id),
      selectedGlobalScriptId: state.selectedGlobalScriptId === id ? null : state.selectedGlobalScriptId,
    }));
  },

  reorderGlobalScripts: async (scriptIds) => {
    await api.reorderGlobalScripts(scriptIds);
    set((state) => {
      const ordered = scriptIds
        .map((id) => state.globalScripts.find((s) => s.id === id))
        .filter(Boolean) as GlobalScript[];
      return { globalScripts: ordered };
    });
  },

  runGlobalScript: async (scriptId, workingDir, parameterValues, extraArgs) => {
    try {
      await api.runGlobalScript(scriptId, workingDir, parameterValues, extraArgs);
      // Status & logs will arrive via Tauri events; just show the terminal.
      get().openTerminal('global-script', scriptId);
    } catch (error) {
      console.error('Failed to run global script:', error);
      throw error;
    }
  },

  stopGlobalScript: async (scriptId) => {
    try {
      await api.stopGlobalScript(scriptId);
    } catch (error) {
      console.error('Failed to stop global script:', error);
      throw error;
    }
  },

  selectGlobalScript: (id) => {
    set({ selectedGlobalScriptId: id });
    if (id) {
      set({ currentView: 'script-detail' });
    }
  },

  // Global Script runtime updates
  updateGlobalScriptStatus: (scriptId, status, pid) => {
    set((state) => {
      const runtimes = new Map(state.globalScriptRuntimes);
      const existing = runtimes.get(scriptId) || { status: 'idle', logs: [] };
      runtimes.set(scriptId, { ...existing, status, pid });
      const terminals = ensureTerminal(state.terminals, 'global-script', scriptId);
      return { globalScriptRuntimes: runtimes, terminals };
    });
  },

  appendGlobalScriptLog: (scriptId, log) => {
    set((state) => {
      const runtimes = new Map(state.globalScriptRuntimes);
      const existing = runtimes.get(scriptId) || { status: 'idle', logs: [] };
      const logs = [...existing.logs, log].slice(-1000);
      runtimes.set(scriptId, { ...existing, logs });
      const terminals = ensureTerminal(state.terminals, 'global-script', scriptId);
      return { globalScriptRuntimes: runtimes, terminals };
    });
  },

  clearGlobalScriptLogs: (scriptId) => {
    set((state) => {
      const runtimes = new Map(state.globalScriptRuntimes);
      const existing = runtimes.get(scriptId);
      if (existing) {
        runtimes.set(scriptId, { ...existing, logs: [] });
      }
      return { globalScriptRuntimes: runtimes };
    });
  },

  setGlobalScriptExitResult: (scriptId, exitCode, success) => {
    set((state) => {
      const runtimes = new Map(state.globalScriptRuntimes);
      const existing = runtimes.get(scriptId);
      if (existing) {
        runtimes.set(scriptId, { ...existing, lastExitCode: exitCode, lastSuccess: success });
      }
      return { globalScriptRuntimes: runtimes };
    });
  },

  // Tag Definitions actions
  loadTagDefinitions: async () => {
    try {
      const tagDefinitions = await api.getAllTagDefinitions();
      set({ tagDefinitions });
    } catch (error) {
      console.error('Failed to load tag definitions:', error);
    }
  },

  createTagDefinition: async (input) => {
    const def = await api.createTagDefinition(input);
    set((state) => ({ tagDefinitions: [...state.tagDefinitions, def] }));
    return def;
  },

  updateTagDefinition: async (name, input) => {
    const updated = await api.updateTagDefinition(name, input);
    set((state) => ({
      tagDefinitions: state.tagDefinitions.map((d) => (d.name.toLowerCase() === name.toLowerCase() ? updated : d)),
    }));
  },

  deleteTagDefinition: async (name) => {
    await api.deleteTagDefinition(name);
    set((state) => ({
      tagDefinitions: state.tagDefinitions.filter((d) => d.name.toLowerCase() !== name.toLowerCase()),
    }));
  },

  // Scripts Config actions
  loadScriptsConfig: async () => {
    try {
      const scriptsConfig = await api.getScriptsConfig();
      set({ scriptsConfig });
    } catch (error) {
      console.error('Failed to load scripts config:', error);
    }
  },

  updateScriptsConfig: async (config) => {
    await api.updateScriptsConfig(config);
    set({ scriptsConfig: config });
  },

  scanScriptsFolder: async (folder) => {
    return api.scanScriptsFolder(folder);
  },

  // Help Parser actions
  autoDetectScriptParams: async (command, scriptPath?) => {
    return api.autoDetectScriptParams(command, scriptPath);
  },

  // Import / Export actions
  exportScriptsConfig: async () => {
    return api.exportScriptsConfig();
  },

  previewImport: async (json) => {
    return api.previewImport(json);
  },

  importScriptsConfig: async (json, options) => {
    const result = await api.importScriptsConfig(json, options);
    // Reload all affected data after import
    const [globalScripts, tagDefinitions, tools, aliases, apps, statusDefinitions, projects, settings] = await Promise.all([
      api.getAllGlobalScripts(),
      api.getAllTagDefinitions(),
      api.getAllTools(),
      api.getAllAliases(),
      api.getAllApps(),
      api.getAllStatusDefinitions(),
      api.getAllProjects(),
      api.getSettings(),
    ]);
    set({ globalScripts, tagDefinitions, tools, aliases, apps, statusDefinitions, projects, settings });
    return result;
  },

  backupToGit: async () => {
    return api.backupToGit();
  },

  // Tool actions
  loadTools: async () => {
    set({ isLoadingTools: true });
    try {
      const tools = await api.getAllTools();
      set({ tools, isLoadingTools: false });
    } catch (error) {
      console.error('Failed to load tools:', error);
      set({ isLoadingTools: false });
    }
  },

  createTool: async (input) => {
    const tool = await api.createTool(input);
    set((state) => ({ tools: [...state.tools, tool] }));
    return tool;
  },

  updateTool: async (id, input) => {
    const updated = await api.updateTool(id, input);
    set((state) => ({
      tools: state.tools.map((t) => (t.id === id ? updated : t)),
    }));
  },

  deleteTool: async (id) => {
    await api.deleteTool(id);
    set((state) => ({
      tools: state.tools.filter((t) => t.id !== id),
      selectedToolId: state.selectedToolId === id ? null : state.selectedToolId,
    }));
  },

  reorderTools: async (toolIds) => {
    await api.reorderTools(toolIds);
    set((state) => {
      const ordered = toolIds
        .map((id) => state.tools.find((t) => t.id === id))
        .filter(Boolean) as Tool[];
      return { tools: ordered };
    });
  },

  selectTool: (id) => {
    set({ selectedToolId: id });
    if (id) {
      set({ currentView: 'tool-detail' });
    }
  },

  // Alias actions
  loadAliases: async () => {
    set({ isLoadingAliases: true });
    try {
      const aliases = await api.getAllAliases();
      set({ aliases, isLoadingAliases: false });
    } catch (error) {
      console.error('Failed to load aliases:', error);
      set({ isLoadingAliases: false });
    }
  },

  createAlias: async (input) => {
    const alias = await api.createAlias(input);
    set((state) => ({ aliases: [...state.aliases, alias] }));
    return alias;
  },

  updateAlias: async (id, input) => {
    const updated = await api.updateAlias(id, input);
    set((state) => ({
      aliases: state.aliases.map((a) => (a.id === id ? updated : a)),
    }));
    return updated;
  },

  deleteAlias: async (id) => {
    await api.deleteAlias(id);
    set((state) => ({
      aliases: state.aliases.filter((a) => a.id !== id),
      selectedAliasId: state.selectedAliasId === id ? null : state.selectedAliasId,
    }));
  },

  reorderAliases: async (aliasIds) => {
    await api.reorderAliases(aliasIds);
    set((state) => {
      const ordered = aliasIds
        .map((id) => state.aliases.find((a) => a.id === id))
        .filter(Boolean) as ShellAlias[];
      return { aliases: ordered };
    });
  },

  selectAlias: (id) => {
    set({ selectedAliasId: id });
    if (id) {
      set({ currentView: 'alias-detail' });
    }
  },

  // Status Definition actions
  loadStatusDefinitions: async () => {
    try {
      const statusDefinitions = await api.getAllStatusDefinitions();
      set({ statusDefinitions });
    } catch (error) {
      console.error('Failed to load status definitions:', error);
    }
  },

  createStatusDefinition: async (input) => {
    const def = await api.createStatusDefinition(input);
    set((state) => ({ statusDefinitions: [...state.statusDefinitions, def] }));
    return def;
  },

  updateStatusDefinition: async (name, input) => {
    const updated = await api.updateStatusDefinition(name, input);
    set((state) => ({
      statusDefinitions: state.statusDefinitions.map((d) =>
        d.name.toLowerCase() === name.toLowerCase() ? updated : d
      ),
    }));
    return updated;
  },

  deleteStatusDefinition: async (name) => {
    await api.deleteStatusDefinition(name);
    set((state) => ({
      statusDefinitions: state.statusDefinitions.filter(
        (d) => d.name.toLowerCase() !== name.toLowerCase()
      ),
    }));
  },

  // App actions
  loadApps: async () => {
    set({ isLoadingApps: true });
    try {
      const apps = await api.getAllApps();
      set({ apps, isLoadingApps: false });
    } catch (error) {
      console.error('Failed to load apps:', error);
      set({ isLoadingApps: false });
    }
  },

  createApp: async (input) => {
    const app = await api.createApp(input);
    set((state) => ({ apps: [...state.apps, app] }));
    return app;
  },

  updateAppItem: async (id, input) => {
    const updated = await api.updateApp(id, input);
    set((state) => ({
      apps: state.apps.map((a) => (a.id === id ? updated : a)),
    }));
    return updated;
  },

  deleteApp: async (id) => {
    await api.deleteApp(id);
    set((state) => ({
      apps: state.apps.filter((a) => a.id !== id),
      selectedAppId: state.selectedAppId === id ? null : state.selectedAppId,
    }));
  },

  reorderApps: async (appIds) => {
    await api.reorderApps(appIds);
    set((state) => {
      const ordered = appIds
        .map((id) => state.apps.find((a) => a.id === id))
        .filter(Boolean) as App[];
      return { apps: ordered };
    });
  },

  selectApp: (id) => {
    set({ selectedAppId: id });
    if (id) {
      set({ currentView: 'app-detail' });
    }
  },

  launchApp: async (appId) => {
    await api.launchApp(appId);
  },

  // Execution History Update actions
  updateExecutionRecordOnExit: async (scriptId, exitCode, success) => {
    await api.updateExecutionRecord(scriptId, exitCode, success);
  },

  // Run Script Dialog actions
  openRunScriptDialog: (script) => set({ runScriptDialogTarget: script }),
  closeRunScriptDialog: () => set({ runScriptDialogTarget: null }),

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

  setTerminalHeight: (height) => {
    // Clamp height between 100px and 600px
    const clampedHeight = Math.min(Math.max(height, 100), 600);
    set({ terminalHeight: clampedHeight });
  },

  // Multi-pane terminal actions.
  // Tab membership is derived from `state.terminals` filtered by `paneId`; these
  // actions only mutate the canonical Terminal entities + the Pane records.

  addPane: (position, referenceId) => {
    const newPaneId = `pane-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    set((state) => {
      const panes = [...state.terminalPanes];
      const referenceIndex = referenceId
        ? panes.findIndex((p) => p.id === referenceId)
        : position === 'right' ? panes.length - 1 : 0;

      if (referenceIndex === -1) {
        panes.push({ id: newPaneId, activeTerminalId: null, width: 50 });
      } else {
        // Split the reference pane's width with the new pane
        const refPane = panes[referenceIndex];
        const newWidth = refPane.width / 2;
        panes[referenceIndex] = { ...refPane, width: newWidth };

        const newPane: TerminalPane = { id: newPaneId, activeTerminalId: null, width: newWidth };
        if (position === 'left') panes.splice(referenceIndex, 0, newPane);
        else panes.splice(referenceIndex + 1, 0, newPane);
      }

      return { terminalPanes: panes, focusedPaneId: newPaneId };
    });

    return newPaneId;
  },

  removePane: (paneId) => {
    set((state) => {
      if (state.terminalPanes.length <= 1) return state; // Always keep at least one pane

      const index = state.terminalPanes.findIndex((p) => p.id === paneId);
      if (index === -1) return state;

      // Move all terminals from this pane to the adjacent pane
      const adjacentIndex = index === 0 ? 1 : index - 1;
      const adjacentPaneId = state.terminalPanes[adjacentIndex].id;

      const terminals = new Map(state.terminals);
      let movedActiveId: string | null = null;
      for (const [id, t] of terminals) {
        if (t.paneId === paneId) {
          terminals.set(id, { ...t, paneId: adjacentPaneId });
          // Remember at least one moved terminal to use as the adjacent pane's active if needed
          if (!movedActiveId && t.visibility === 'visible') movedActiveId = id;
        }
      }

      const removedWidth = state.terminalPanes[index].width;
      const remaining = state.terminalPanes.filter((p) => p.id !== paneId);
      // Carry over moved terminals' active state to the adjacent pane if it had none
      const withMovedActive = remaining.map((p) => {
        if (p.id === adjacentPaneId && !p.activeTerminalId && movedActiveId) {
          return { ...p, activeTerminalId: movedActiveId };
        }
        return p;
      });
      // Redistribute the removed pane's width to the rest proportionally
      const totalRemainingWidth = withMovedActive.reduce((sum, p) => sum + p.width, 0);
      const newPanes = withMovedActive.map((p) => ({
        ...p,
        width: p.width + (removedWidth * p.width) / totalRemainingWidth,
      }));

      const newFocusedId = state.focusedPaneId === paneId ? adjacentPaneId : state.focusedPaneId;

      return { terminals, terminalPanes: newPanes, focusedPaneId: newFocusedId };
    });
  },

  setActiveTerminalInPane: (paneId, terminalIdOrNull) => {
    set((state) => {
      const panes = state.terminalPanes.map((p) =>
        p.id === paneId ? { ...p, activeTerminalId: terminalIdOrNull } : p
      );
      return { terminalPanes: panes, focusedPaneId: paneId };
    });
  },

  moveTerminalToPane: (id, targetPaneId) => {
    set((state) => {
      const existing = state.terminals.get(id);
      if (!existing || existing.paneId === targetPaneId) return state;

      const sourcePaneId = existing.paneId;
      const terminals = new Map(state.terminals);
      terminals.set(id, { ...existing, paneId: targetPaneId, visibility: 'visible' });

      // Reassign source pane's active if needed; set target pane's active to the moved terminal
      let terminalPanes = state.terminalPanes.map((p) => {
        if (p.id === sourcePaneId && p.activeTerminalId === id) {
          return { ...p, activeTerminalId: pickNewActiveForPane(p.id, terminals, id) };
        }
        if (p.id === targetPaneId) {
          return { ...p, activeTerminalId: id };
        }
        return p;
      });

      // Prune source pane if it became empty
      const pruned = pruneEmptyPanes(terminalPanes, terminals, targetPaneId);
      if (pruned) terminalPanes = pruned.terminalPanes;

      return { terminals, terminalPanes, focusedPaneId: targetPaneId };
    });
  },

  reorderTerminalInPane: (paneId, id, newIndex) => {
    // Order is a numeric field on Terminal entities — to reorder, recompute order values
    // for the visible terminals in this pane so the target ends up at `newIndex`.
    set((state) => {
      const inPane: Terminal[] = [];
      for (const t of state.terminals.values()) {
        if (t.paneId === paneId && t.visibility === 'visible') inPane.push(t);
      }
      inPane.sort((a, b) => a.order - b.order);

      const oldIndex = inPane.findIndex((t) => t.id === id);
      if (oldIndex === -1 || oldIndex === newIndex) return state;

      const reordered = [...inPane];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      const terminals = new Map(state.terminals);
      reordered.forEach((t, i) => {
        terminals.set(t.id, { ...t, order: i });
      });
      return { terminals };
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
          return { ...p, width: Math.max(newWidth.width, 15) }; // min 15%
        }
        return p;
      });
      return { terminalPanes: panes };
    });
  },

  setDragOverState: (paneId, position) => {
    set({ dragOverPaneId: paneId, dragOverPosition: position });
  },

  // ===== Selectors (derived; cheap to call from React) =====

  getTerminalsInPane: (paneId) => {
    const state = get();
    const result: Terminal[] = [];
    for (const t of state.terminals.values()) {
      if (t.paneId === paneId && t.visibility === 'visible') result.push(t);
    }
    return result.sort((a, b) => a.order - b.order);
  },

  getVisibleTerminals: () => {
    const state = get();
    const result: Terminal[] = [];
    for (const t of state.terminals.values()) {
      if (t.visibility === 'visible') result.push(t);
    }
    return result.sort((a, b) => a.order - b.order);
  },

  getHiddenTerminals: () => {
    const state = get();
    const result: Terminal[] = [];
    for (const t of state.terminals.values()) {
      if (t.visibility === 'hidden') result.push(t);
    }
    return result.sort((a, b) => a.order - b.order);
  },

  isTerminalClosed: (id) => {
    return get().terminals.get(id)?.visibility === 'closed';
  },
}));

// Expose the parseTerminalId helper so consumers can read kind + runtimeKey from a Terminal ID.
// (The Terminal entity already carries these as fields, so use those when you have the entity;
// this helper is only useful when you only have the raw ID string.)
export { parseTerminalId };
