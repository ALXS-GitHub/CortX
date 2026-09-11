import { invoke, Channel } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
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
  ServiceLogPayload,
  ServiceStatusPayload,
  ShellInfo,
  ShellExitPayload,
  TerminalCapabilities,
  TerminalConfig,
  TerminalShellState,
  TerminalAgentInfo,
  CommandRecord,
  CommandSpec,
  CommandSuggestion,
  SpecItem,
  PathCompletion,
  LaunchConfig,
  TerminalTheme,
  TerminalThemeSummary,
  TerminalThemeImportReport,
  ServiceExitPayload,
  ServicePortsPayload,
  ScriptLogPayload,
  ScriptStatusPayload,
  ScriptExitPayload,
  EnvFile,
  EnvComparison,
  DiscoverEnvFilesInput,
  AddEnvFileInput,
  LinkEnvToServiceInput,
  GlobalScript,
  CreateGlobalScriptInput,
  UpdateGlobalScriptInput,
  TagDefinition,
  CreateTagDefinitionInput,
  UpdateTagDefinitionInput,
  ExecutionRecord,
  ScriptsConfig,
  ScriptParameter,
  ImportOptions,
  ImportResult,
  ExportSummary,
  DiscoveredScript,
  Tool,
  CreateToolInput,
  UpdateToolInput,
  DiscoveredTool,
  ShellAlias,
  CreateShellAliasInput,
  UpdateShellAliasInput,
  ShimStatus,
  ShimSyncReport,
  ShimInstallOutcome,
  StatusDefinition,
  CreateStatusDefinitionInput,
  UpdateStatusDefinitionInput,
  App,
  CreateAppInput,
  UpdateAppInput,
  AgentSession,
  AgentAnnotations,
  AgentTranscriptPage,
  AgentTranscriptQuery,
  AgentsHealth,
  ListAgentSessionsOptions,
} from '@/types';

// Project commands
export async function getAllProjects(): Promise<Project[]> {
  return invoke('get_all_projects');
}

export async function getProject(id: string): Promise<Project> {
  return invoke('get_project', { id });
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  return invoke('create_project', { input });
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  return invoke('update_project', { id, input });
}

export async function deleteProject(id: string): Promise<void> {
  return invoke('delete_project', { id });
}

export async function updateProjectLastOpened(id: string): Promise<void> {
  return invoke('update_project_last_opened', { id });
}

// Service commands
export async function addService(projectId: string, input: CreateServiceInput): Promise<Service> {
  return invoke('add_service', { projectId, input });
}

export async function updateService(serviceId: string, input: UpdateServiceInput): Promise<Service> {
  return invoke('update_service', { serviceId, input });
}

export async function deleteService(serviceId: string): Promise<void> {
  return invoke('delete_service', { serviceId });
}

export async function reorderServices(projectId: string, serviceIds: string[]): Promise<void> {
  return invoke('reorder_services', { projectId, serviceIds });
}

// Script commands
export async function addScript(projectId: string, input: CreateScriptInput): Promise<Script> {
  return invoke('add_script', { projectId, input });
}

export async function updateScript(scriptId: string, input: UpdateScriptInput): Promise<Script> {
  return invoke('update_script', { scriptId, input });
}

export async function deleteScript(scriptId: string): Promise<void> {
  return invoke('delete_script', { scriptId });
}

export async function reorderScripts(projectId: string, scriptIds: string[]): Promise<void> {
  return invoke('reorder_scripts', { projectId, scriptIds });
}

export async function runScript(scriptId: string): Promise<number> {
  return invoke('run_script', { scriptId });
}

export async function stopScript(scriptId: string): Promise<void> {
  return invoke('stop_script', { scriptId });
}

export async function isScriptRunning(scriptId: string): Promise<boolean> {
  return invoke('is_script_running', { scriptId });
}

// Launch commands
export async function getLaunchCommand(serviceId: string): Promise<string> {
  return invoke('get_launch_command', { serviceId });
}

export async function launchExternalTerminal(serviceId: string): Promise<void> {
  return invoke('launch_external_terminal', { serviceId });
}

export async function startIntegratedService(serviceId: string, mode?: string, argPreset?: string): Promise<number> {
  return invoke('start_integrated_service', { serviceId, mode, argPreset });
}

export async function stopIntegratedService(serviceId: string): Promise<void> {
  return invoke('stop_integrated_service', { serviceId });
}

export async function isServiceRunning(serviceId: string): Promise<boolean> {
  return invoke('is_service_running', { serviceId });
}

export async function getRunningServices(): Promise<string[]> {
  return invoke('get_running_services');
}

// Settings commands
export async function getSettings(): Promise<AppSettings> {
  return invoke('get_settings');
}

export async function updateSettings(settings: AppSettings): Promise<void> {
  return invoke('update_settings', { settings });
}

/** Register (or re-register) the OS-level global hotkey. Empty string disables. */
export async function setGlobalHotkey(combo: string): Promise<void> {
  return invoke('set_global_hotkey', { combo });
}

/** Real quit — runs the service-cleanup flow and exits the process.
 *  In contrast, closing the window (X / window.close()) only hides to tray. */
export async function quitApp(): Promise<void> {
  return invoke('quit_app');
}

// Utility commands
export async function openInExplorer(path: string): Promise<void> {
  return invoke('open_in_explorer', { path });
}

export async function openInVscode(path: string): Promise<void> {
  return invoke('open_in_vscode', { path });
}

/** Open a file in VS Code at a position (`code -g path:line:col`). */
export async function openInEditor(path: string, line?: number, column?: number): Promise<void> {
  return invoke('open_in_editor', { path, line, column });
}

export async function validatePath(path: string): Promise<boolean> {
  return invoke('validate_path', { path });
}

// Event listeners
export async function onServiceLog(
  callback: (payload: ServiceLogPayload) => void
): Promise<UnlistenFn> {
  return listen<ServiceLogPayload>('service-log', (event) => {
    callback(event.payload);
  });
}

export async function onServiceStatus(
  callback: (payload: ServiceStatusPayload) => void
): Promise<UnlistenFn> {
  return listen<ServiceStatusPayload>('service-status', (event) => {
    callback(event.payload);
  });
}

export async function onServiceExit(
  callback: (payload: ServiceExitPayload) => void
): Promise<UnlistenFn> {
  return listen<ServiceExitPayload>('service-exit', (event) => {
    callback(event.payload);
  });
}

export async function onServicePorts(
  callback: (payload: ServicePortsPayload) => void
): Promise<UnlistenFn> {
  return listen<ServicePortsPayload>('service-ports', (event) => {
    callback(event.payload);
  });
}

// Script event listeners
export async function onScriptLog(
  callback: (payload: ScriptLogPayload) => void
): Promise<UnlistenFn> {
  return listen<ScriptLogPayload>('script-log', (event) => {
    callback(event.payload);
  });
}

export async function onScriptStatus(
  callback: (payload: ScriptStatusPayload) => void
): Promise<UnlistenFn> {
  return listen<ScriptStatusPayload>('script-status', (event) => {
    callback(event.payload);
  });
}

export async function onScriptExit(
  callback: (payload: ScriptExitPayload) => void
): Promise<UnlistenFn> {
  return listen<ScriptExitPayload>('script-exit', (event) => {
    callback(event.payload);
  });
}

// Environment file commands
export async function discoverEnvFiles(
  projectId: string,
  input: DiscoverEnvFilesInput
): Promise<EnvFile[]> {
  return invoke('discover_env_files', { projectId, input });
}

export async function addEnvFile(
  projectId: string,
  input: AddEnvFileInput
): Promise<EnvFile> {
  return invoke('add_env_file', { projectId, input });
}

export async function removeEnvFile(projectId: string, envFileId: string): Promise<void> {
  return invoke('remove_env_file', { projectId, envFileId });
}

export async function refreshEnvFile(projectId: string, envFileId: string): Promise<EnvFile> {
  return invoke('refresh_env_file', { projectId, envFileId });
}

export async function refreshAllEnvFiles(projectId: string): Promise<EnvFile[]> {
  return invoke('refresh_all_env_files', { projectId });
}

export async function getEnvFiles(projectId: string): Promise<EnvFile[]> {
  return invoke('get_env_files', { projectId });
}

export async function getEnvFileContent(
  projectId: string,
  envFileId: string
): Promise<string> {
  return invoke('get_env_file_content', { projectId, envFileId });
}

export async function compareEnvFiles(
  projectId: string,
  baseFileId: string,
  exampleFileId: string
): Promise<EnvComparison> {
  return invoke('compare_env_files', { projectId, baseFileId, exampleFileId });
}

export async function linkEnvToService(
  projectId: string,
  envFileId: string,
  input: LinkEnvToServiceInput
): Promise<EnvFile> {
  return invoke('link_env_to_service', { projectId, envFileId, input });
}

// Global script commands
export async function getAllGlobalScripts(): Promise<GlobalScript[]> {
  return invoke('get_all_global_scripts');
}

export async function getGlobalScript(id: string): Promise<GlobalScript> {
  return invoke('get_global_script', { id });
}

export async function createGlobalScript(input: CreateGlobalScriptInput): Promise<GlobalScript> {
  return invoke('create_global_script', { input });
}

export async function updateGlobalScript(id: string, input: UpdateGlobalScriptInput): Promise<GlobalScript> {
  return invoke('update_global_script', { id, input });
}

export async function deleteGlobalScript(id: string): Promise<void> {
  return invoke('delete_global_script', { id });
}

export async function reorderGlobalScripts(scriptIds: string[]): Promise<void> {
  return invoke('reorder_global_scripts', { scriptIds });
}

/** `workingDir` is an optional per-run override. Left out (or blank), the backend
 *  falls back to the script's own working dir, then to the script file's folder. */
export async function runGlobalScript(
  scriptId: string,
  workingDir?: string,
  parameterValues?: Record<string, string>,
  extraArgs?: string
): Promise<number> {
  return invoke('run_global_script', { scriptId, workingDir, parameterValues, extraArgs });
}

export async function stopGlobalScript(scriptId: string): Promise<void> {
  return invoke('stop_global_script', { scriptId });
}

export async function isGlobalScriptRunning(scriptId: string): Promise<boolean> {
  return invoke('is_global_script_running', { scriptId });
}

// Tag definition commands
export async function getAllTagDefinitions(): Promise<TagDefinition[]> {
  return invoke('get_all_tag_definitions');
}

export async function createTagDefinition(input: CreateTagDefinitionInput): Promise<TagDefinition> {
  return invoke('create_tag_definition', { input });
}

export async function updateTagDefinition(name: string, input: UpdateTagDefinitionInput): Promise<TagDefinition> {
  return invoke('update_tag_definition', { name, input });
}

export async function deleteTagDefinition(name: string): Promise<void> {
  return invoke('delete_tag_definition', { name });
}

// Execution history commands
export async function getExecutionHistory(
  scriptId: string,
  limit?: number
): Promise<ExecutionRecord[]> {
  return invoke('get_execution_history', { scriptId, limit });
}

export async function clearExecutionHistory(scriptId: string): Promise<void> {
  return invoke('clear_execution_history', { scriptId });
}

// Scripts config commands
export async function getScriptsConfig(): Promise<ScriptsConfig> {
  return invoke('get_scripts_config');
}

export async function updateScriptsConfig(config: ScriptsConfig): Promise<void> {
  return invoke('update_scripts_config', { config });
}

export async function scanScriptsFolder(folder: string): Promise<DiscoveredScript[]> {
  return invoke('scan_scripts_folder', { folder });
}

// Help parser / auto-detect parameters
export async function autoDetectScriptParams(command: string, scriptPath?: string): Promise<ScriptParameter[]> {
  return invoke('auto_detect_script_params', { command, scriptPath });
}

// Import / Export
export async function exportScriptsConfig(): Promise<string> {
  return invoke('export_scripts_config');
}

export async function previewImport(json: string): Promise<ExportSummary> {
  return invoke('preview_import', { json });
}

export async function importScriptsConfig(json: string, options: ImportOptions): Promise<ImportResult> {
  return invoke('import_scripts_config', { json, options });
}

export async function backupToGit(): Promise<string> {
  return invoke('backup_to_git');
}

// Execution history update
export async function updateExecutionRecord(
  scriptId: string,
  exitCode: number | null,
  success: boolean
): Promise<void> {
  return invoke('update_execution_record', { scriptId, exitCode, success });
}

// Tool commands
export async function getAllTools(): Promise<Tool[]> {
  return invoke('get_all_tools');
}

export async function getTool(id: string): Promise<Tool> {
  return invoke('get_tool', { id });
}

export async function createTool(input: CreateToolInput): Promise<Tool> {
  return invoke('create_tool', { input });
}

export async function updateTool(id: string, input: UpdateToolInput): Promise<Tool> {
  return invoke('update_tool', { id, input });
}

export async function deleteTool(id: string): Promise<void> {
  return invoke('delete_tool', { id });
}

export async function reorderTools(toolIds: string[]): Promise<void> {
  return invoke('reorder_tools', { toolIds });
}

export async function openToolConfig(toolId: string, configIndex: number): Promise<void> {
  return invoke('open_tool_config', { toolId, configIndex });
}

export async function openToolLocation(toolId: string): Promise<void> {
  return invoke('open_tool_location', { toolId });
}

export async function openToolLocationVscode(toolId: string): Promise<void> {
  return invoke('open_tool_location_vscode', { toolId });
}

export async function openToolUrl(url: string): Promise<void> {
  return invoke('open_tool_url', { url });
}

export async function scanInstalledTools(): Promise<DiscoveredTool[]> {
  return invoke('scan_installed_tools');
}

// Alias commands
export async function getAllAliases(): Promise<ShellAlias[]> {
  return invoke('get_all_aliases');
}

export async function getAlias(id: string): Promise<ShellAlias> {
  return invoke('get_alias', { id });
}

export async function createAlias(input: CreateShellAliasInput): Promise<ShellAlias> {
  return invoke('create_alias', { input });
}

export async function updateAlias(id: string, input: UpdateShellAliasInput): Promise<ShellAlias> {
  return invoke('update_alias', { id, input });
}

export async function deleteAlias(id: string): Promise<void> {
  return invoke('delete_alias', { id });
}

export async function reorderAliases(aliasIds: string[]): Promise<void> {
  return invoke('reorder_aliases', { aliasIds });
}

export async function generateShellInit(shell: string): Promise<string> {
  return invoke('generate_shell_init', { shell });
}

// Shim commands (real launcher files for aliases, callable from any process)
export async function getShimStatus(): Promise<ShimStatus> {
  return invoke('get_shim_status');
}

export async function syncShims(): Promise<ShimSyncReport> {
  return invoke('sync_shims');
}

export async function installShimPath(): Promise<ShimInstallOutcome> {
  return invoke('install_shim_path');
}

// Status definition commands
export async function getAllStatusDefinitions(): Promise<StatusDefinition[]> {
  return invoke('get_all_status_definitions');
}

export async function createStatusDefinition(input: CreateStatusDefinitionInput): Promise<StatusDefinition> {
  return invoke('create_status_definition', { input });
}

export async function updateStatusDefinition(name: string, input: UpdateStatusDefinitionInput): Promise<StatusDefinition> {
  return invoke('update_status_definition', { name, input });
}

export async function deleteStatusDefinition(name: string): Promise<void> {
  return invoke('delete_status_definition', { name });
}

// App commands
export async function getAllApps(): Promise<App[]> {
  return invoke('get_all_apps');
}

export async function getApp(id: string): Promise<App> {
  return invoke('get_app', { id });
}

export async function createApp(input: CreateAppInput): Promise<App> {
  return invoke('create_app', { input });
}

export async function updateApp(id: string, input: UpdateAppInput): Promise<App> {
  return invoke('update_app', { id, input });
}

export async function deleteApp(id: string): Promise<void> {
  return invoke('delete_app', { id });
}

export async function reorderApps(appIds: string[]): Promise<void> {
  return invoke('reorder_apps', { appIds });
}

export async function launchApp(appId: string): Promise<void> {
  return invoke('launch_app', { appId });
}

export async function openAppConfig(appId: string, configIndex: number): Promise<void> {
  return invoke('open_app_config', { appId, configIndex });
}

export async function openAppUrl(url: string): Promise<void> {
  return invoke('open_app_url', { url });
}

// Data change listener (file watcher)
export async function onDataChanged(callback: () => void): Promise<UnlistenFn> {
  return listen('data-changed', () => callback());
}

/** Fires when the OS-level global hotkey is pressed, asking the UI to open
 *  the command palette (and ensure the window is shown + focused). */
export async function onOpenCommandPalette(callback: () => void): Promise<UnlistenFn> {
  return listen('open-command-palette', () => callback());
}

// Global script event listeners
export async function onGlobalScriptLog(
  callback: (payload: ScriptLogPayload) => void
): Promise<UnlistenFn> {
  return listen<ScriptLogPayload>('global-script-log', (event) => {
    callback(event.payload);
  });
}

export async function onGlobalScriptStatus(
  callback: (payload: ScriptStatusPayload) => void
): Promise<UnlistenFn> {
  return listen<ScriptStatusPayload>('global-script-status', (event) => {
    callback(event.payload);
  });
}

export async function onGlobalScriptExit(
  callback: (payload: ScriptExitPayload) => void
): Promise<UnlistenFn> {
  return listen<ScriptExitPayload>('global-script-exit', (event) => {
    callback(event.payload);
  });
}

// ============================================================================
// Agents (beta) — DEV-11
// ============================================================================

export async function listAgentSessions(options: ListAgentSessionsOptions = {}): Promise<AgentSession[]> {
  return invoke('list_agent_sessions', { options });
}

/** Full rescan, then list with default options. */
export async function refreshAgentSessions(): Promise<AgentSession[]> {
  return invoke('refresh_agent_sessions');
}

export async function getAgentTranscript(sessionId: string, query: AgentTranscriptQuery): Promise<AgentTranscriptPage> {
  return invoke('get_agent_transcript', { sessionId, query });
}

export async function updateAgentAnnotations(sessionId: string, annotations: AgentAnnotations): Promise<AgentSession> {
  return invoke('update_agent_annotations', { sessionId, annotations });
}

/** Opens the external terminal (Settings preset) in the session cwd running the resume command. */
export async function resumeAgentSession(sessionId: string, fork: boolean): Promise<void> {
  return invoke('resume_agent_session', { sessionId, fork });
}

export async function getAgentResumeCommand(sessionId: string, fork: boolean): Promise<string> {
  return invoke('get_agent_resume_command', { sessionId, fork });
}

export async function createProjectFromSession(sessionId: string): Promise<Project> {
  return invoke('create_project_from_session', { sessionId });
}

export async function getAgentsHealth(): Promise<AgentsHealth> {
  return invoke('get_agents_health');
}

/** Fired by the agents watcher (debounced). Payload is null: re-list. */
export async function onAgentSessionsChanged(callback: () => void): Promise<UnlistenFn> {
  return listen('agent-sessions-changed', () => callback());
}

// ============================================================================
// Integrated terminal (PTY)
// ============================================================================

/** Normalise whatever the Channel hands us (ArrayBuffer for raw bodies, but be
 *  lenient) into a Uint8Array xterm.js can write directly. */
function toBytes(message: unknown): Uint8Array {
  if (message instanceof Uint8Array) return message;
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  if (Array.isArray(message)) return Uint8Array.from(message as number[]);
  if (typeof message === 'string') return new TextEncoder().encode(message);
  return new Uint8Array();
}

/**
 * Subscribe to a terminal's output. The stored scrollback arrives as the first
 * message, then live bytes in order. Resolves with a token for detachTerminal.
 */
export async function attachTerminal(
  terminalId: string,
  onData: (bytes: Uint8Array) => void
): Promise<number> {
  const channel = new Channel<unknown>();
  channel.onmessage = (message) => onData(toBytes(message));
  return invoke('attach_terminal', { terminalId, onData: channel });
}

export async function detachTerminal(terminalId: string, token: number): Promise<void> {
  return invoke('detach_terminal', { terminalId, token });
}

export async function writeTerminal(terminalId: string, data: string): Promise<void> {
  return invoke('write_terminal', { terminalId, data });
}

export async function resizeTerminal(terminalId: string, cols: number, rows: number): Promise<void> {
  return invoke('resize_terminal', { terminalId, cols, rows });
}

export async function clearTerminalScrollback(terminalId: string): Promise<void> {
  return invoke('clear_terminal_scrollback', { terminalId });
}

export async function removeTerminal(terminalId: string): Promise<void> {
  return invoke('remove_terminal', { terminalId });
}

export async function spawnShell(options: {
  cwd?: string;
  projectId?: string;
  cols?: number;
  rows?: number;
  /** Session restore: terminal id this shell replaces (its scrollback snapshot is replayed first). */
  restoreFrom?: string;
}): Promise<ShellInfo> {
  return invoke('spawn_shell', {
    cwd: options.cwd ?? null,
    projectId: options.projectId ?? null,
    cols: options.cols ?? null,
    rows: options.rows ?? null,
    restoreFrom: options.restoreFrom ?? null,
  });
}

export async function killShell(shellId: string): Promise<void> {
  return invoke('kill_shell', { shellId });
}

export async function listShells(): Promise<ShellInfo[]> {
  return invoke('list_shells');
}

export async function getTerminalCapabilities(): Promise<TerminalCapabilities> {
  return invoke('get_terminal_capabilities');
}

export async function onShellExit(
  callback: (payload: ShellExitPayload) => void
): Promise<UnlistenFn> {
  return listen<ShellExitPayload>('shell-exit', (event) => {
    callback(event.payload);
  });
}

// ============================================================================
// Shell integration (OSC 7 / OSC 133 from `cortx init`)
// ============================================================================

/**
 * What to tell the user about the shell a terminal runs, or `null` when CortX
 * has an integration for it. `program` is what the PTY was started with — a
 * bare name or a full path, both understood.
 *
 * Cheap and pure: the answer only depends on the name, so callers cache it per
 * program rather than asking once per terminal (see `ShellNoteBanner`).
 */
export async function terminalShellNote(program: string): Promise<string | null> {
  return (await invoke<string | null>('terminal_shell_note', { program })) ?? null;
}

/** Fired whenever a terminal's shell reports a new cwd, command start or end. */
export async function onTerminalState(
  callback: (state: TerminalShellState) => void
): Promise<UnlistenFn> {
  return listen<TerminalShellState>('terminal-state', (event) => {
    callback(event.payload);
  });
}

/** Every known shell state — used to seed the store after a reload. */
export async function getTerminalStates(): Promise<TerminalShellState[]> {
  return invoke('get_terminal_states');
}

/**
 * One line of `runtime/command-history.jsonl`, with the git ref the command
 * ran on (`cortx_core::terminal::history::CommandRecord`). Older lines, and
 * commands run outside a repository, simply have no `gitHead`.
 *
 * Declared here rather than in `types/index.ts` so the history view (#39) can
 * read the field the backend now writes; the base shape stays the shared
 * `CommandRecord`.
 */
export interface HistoryRecord extends CommandRecord {
  /** Branch name, or the short commit id when HEAD was detached. */
  gitHead?: string;
}

/** One value of a history filter dropdown, with how many records carry it. */
export interface HistoryFacet {
  value: string;
  count: number;
}

/**
 * Filters of the history view. Everything is optional; `{}` means "the whole
 * file, newest first". Mirrors `cortx_core::terminal::history::HistoryQuery`.
 */
export interface HistoryQuery {
  /** Words that must all appear in the command, in any order, any case. */
  search?: string;
  projectId?: string;
  /** Exact working directory (compared case-insensitively on Windows). */
  cwd?: string;
  terminalId?: string;
  /** Only commands that exited non-zero (an unknown code is not a failure). */
  failuresOnly?: boolean;
  /** Only commands that ran at least this long. */
  minDurationMs?: number;
  /** Only commands that finished at or after this instant. */
  sinceMs?: number;
  offset?: number;
  limit?: number;
}

/** One page of `getCommandHistoryPage`. */
export interface HistoryPage {
  records: HistoryRecord[];
  /** Records matching the whole query, not just this page. */
  total: number;
  hasMore: boolean;
  /** Lines the file held, matched or not. */
  scanned: number;
  /** Projects present, ignoring the `projectId` filter. */
  projects: HistoryFacet[];
  /** Directories present, ignoring the `cwd` filter. */
  cwds: HistoryFacet[];
}

/**
 * Most recent finished commands across all terminals, newest first.
 * Unfiltered — the history view uses `getCommandHistoryPage` instead.
 */
export async function getCommandHistory(limit = 200): Promise<CommandRecord[]> {
  const page = await invoke<HistoryPage>('get_command_history', { limit });
  return page.records;
}

/**
 * One filtered, paged slice of the command history (#39).
 *
 * The filtering runs in Rust: the file is capped at 10 MB, and a single
 * streamed pass returns the page, the match count and the values the filter
 * dropdowns offer — so the view never holds the history it is searching.
 */
export async function getCommandHistoryPage(query: HistoryQuery): Promise<HistoryPage> {
  return invoke('get_command_history', { query });
}

/** What one pass of `redactCommandHistory` did. */
export interface RedactionReport {
  /** Lines read, across the history file and its `.jsonl.1` archive. */
  scanned: number;
  /** Lines whose command held a secret and was masked. */
  redacted: number;
  /** Lines that are not readable records; kept byte for byte. */
  skipped: number;
}

/**
 * Run the secret filter over the command history **already on disk**.
 *
 * `redactSecrets` only masks new lines on their way in; this is the one-off
 * pass over what is already there. It **rewrites the user's own history file
 * in place and keeps no backup** — a `.bak` holding the secrets would defeat
 * the point — so it is only ever called from behind a confirmation, never at
 * startup and never on a timer.
 */
export async function redactCommandHistory(): Promise<RedactionReport> {
  return invoke('redact_command_history');
}

/**
 * `TerminalConfig::default()` from the process that writes `settings.json` —
 * what the settings panel's "changed" markers compare against (ticket #39).
 *
 * `Partial`, and not by accident: serde skips the `Option` fields, so the
 * seventeen of them are simply **absent** from the object rather than `null`.
 * Their effective default is the frontend's
 * (`components/terminal/settings/terminalDefaults.ts`).
 */
export async function terminalDefaultSettings(): Promise<Partial<TerminalConfig>> {
  return invoke('terminal_default_settings');
}

/**
 * The shared command history ranked for one terminal (#17): frequency,
 * recency, same directory, same project, minus what never worked. The result
 * is independent of the typed prefix, so it is fetched once per prompt and
 * filtered locally.
 */
export async function suggestHistory(
  cwd?: string,
  projectId?: string,
  limit = 400
): Promise<CommandSuggestion[]> {
  return invoke('suggest_history', { cwd, projectId, limit });
}

/**
 * Flags and subcommands of `command`, learned from its `--help` page once and
 * cached on disk. `null` when the name may not be probed (it must be a bare
 * program name already on the PATH; see `terminal::spec`).
 */
export async function getCommandSpec(
  command: string,
  refresh = false
): Promise<CommandSpec | null> {
  return invoke('get_command_spec', { command, refresh });
}

/** Branches, remotes and tags of the repository at `cwd`. */
export async function completeGitRefs(cwd: string): Promise<string[]> {
  return invoke('complete_git_refs', { cwd });
}

/** `scripts` of the `package.json` in `cwd`. */
export async function completeNpmScripts(cwd: string): Promise<SpecItem[]> {
  return invoke('complete_npm_scripts', { cwd });
}

/** Directory entries matching a half-typed path, resolved against `cwd`. */
export async function completePaths(
  cwd: string,
  fragment: string,
  limit = 60
): Promise<PathCompletion[]> {
  return invoke('complete_paths', { cwd, fragment, limit });
}

// ============================================================================
// Agents running inside terminals (DEV-13)
// ============================================================================

/** Which terminal runs which agent right now — seeds the GUI after a reload. */
export async function getTerminalAgents(): Promise<TerminalAgentInfo[]> {
  return invoke('get_terminal_agents');
}

/**
 * Fired when the set of agents running in CortX terminals changes (an agent
 * started or exited, Claude Code flipped between busy and idle). Carries the
 * whole list, never a delta.
 */
export async function onTerminalAgents(
  callback: (agents: TerminalAgentInfo[]) => void
): Promise<UnlistenFn> {
  return listen<TerminalAgentInfo[]>('terminal-agents', (event) => {
    callback(event.payload);
  });
}

/**
 * Bring the main window up on a session of the Agents section (DEV-11), from
 * the Terminal window. The main window listens for `open-agent-session`.
 */
export async function revealAgentSession(sessionId: string): Promise<void> {
  return invoke('reveal_agent_session', { sessionId });
}

/** OS notification (toast centre). Fire-and-forget. */
export async function sendOsNotification(title: string, body: string): Promise<void> {
  return invoke('send_os_notification', { title, body });
}

// ============================================================================
// Terminal layout shared between windows + Terminal window (DEV-13 P1)
// ============================================================================

export interface TerminalLayoutDocEnvelope {
  revision: number;
  /** Raw document; see `lib/terminalLayout.ts` for the schema. */
  layout: unknown;
}

export interface TerminalLayoutEvent extends TerminalLayoutDocEnvelope {
  /** Label of the window that wrote it. */
  source: string;
}

export async function getTerminalLayout(): Promise<TerminalLayoutDocEnvelope> {
  return invoke('get_terminal_layout');
}

export async function setTerminalLayout(layout: unknown, source: string): Promise<number> {
  return invoke('set_terminal_layout', { layout, source });
}

export async function onTerminalLayout(
  callback: (event: TerminalLayoutEvent) => void
): Promise<UnlistenFn> {
  return listen<TerminalLayoutEvent>('terminal-layout', (event) => callback(event.payload));
}

/** Project id pushed to an already-open Terminal window (`cortx terminal --project`). */
export async function onTerminalScope(callback: (projectId: string) => void): Promise<UnlistenFn> {
  return listen<string>('terminal-scope', (event) => callback(event.payload));
}

export async function openTerminalWindow(projectId?: string | null): Promise<void> {
  return invoke('open_terminal_window', { projectId: projectId ?? null });
}

export async function showMainWindow(): Promise<void> {
  return invoke('show_main_window');
}

/** Project scope the Terminal window was created with (read once on boot). */
export async function takeTerminalWindowScope(): Promise<string | null> {
  return invoke('take_terminal_window_scope');
}

// ============================================================================
// Session restore + launch configurations (DEV-13 P2)
// ============================================================================

/** Launch configuration id requested by `cortx terminal --layout` (read once on boot). */
export async function takeTerminalWindowLaunch(): Promise<string | null> {
  return invoke('take_terminal_window_launch');
}

/** Pushed to an already-open Terminal window by `cortx terminal --layout`. */
export async function onTerminalLaunch(callback: (launchId: string) => void): Promise<UnlistenFn> {
  return listen<string>('terminal-launch', (event) => callback(event.payload));
}

/** Open / focus the Terminal window and run a launch configuration there. */
export async function openTerminalWindowWithLaunch(launchId: string, projectId?: string | null): Promise<void> {
  return invoke('open_terminal_window', { projectId: projectId ?? null, launch: launchId });
}

/** Write the scrollback tail of the given (or all) terminals to `runtime/terminal-snapshots/`. */
export async function saveTerminalSnapshots(terminalIds?: string[]): Promise<void> {
  return invoke('save_terminal_snapshots', { terminalIds: terminalIds ?? null });
}

export async function pruneTerminalSnapshots(keep: string[]): Promise<void> {
  return invoke('prune_terminal_snapshots', { keep });
}

/** Store a GUI-serialised buffer as the terminal's restore snapshot. */
export async function storeTerminalSnapshot(terminalId: string, text: string): Promise<void> {
  return invoke('store_terminal_snapshot', { terminalId, text });
}

export async function listLaunchConfigs(): Promise<LaunchConfig[]> {
  return invoke('list_launch_configs');
}

export async function getLaunchConfig(id: string): Promise<LaunchConfig | null> {
  return invoke('get_launch_config', { id });
}

export async function readLaunchConfigYaml(id: string): Promise<string | null> {
  return invoke('read_launch_config_yaml', { id });
}

export async function saveLaunchConfig(config: LaunchConfig): Promise<LaunchConfig> {
  return invoke('save_launch_config', { config });
}

export async function saveLaunchConfigYaml(expectedId: string | null, yaml: string): Promise<LaunchConfig> {
  return invoke('save_launch_config_yaml', { expectedId, yaml });
}

export async function deleteLaunchConfig(id: string): Promise<void> {
  return invoke('delete_launch_config', { id });
}

export async function launchConfigToYaml(config: LaunchConfig): Promise<string> {
  return invoke('launch_config_to_yaml', { config });
}

// ---------------------------------------------------------------------------
// Terminal themes (DEV-13 P3)
// ---------------------------------------------------------------------------

export async function listTerminalThemes(): Promise<TerminalThemeSummary[]> {
  return invoke('list_terminal_themes');
}

export async function getTerminalTheme(name: string): Promise<TerminalTheme | null> {
  return invoke('get_terminal_theme', { name });
}

export async function importTerminalThemeFile(path: string): Promise<TerminalTheme> {
  return invoke('import_terminal_theme_file', { path });
}

export async function importTerminalThemeFolder(path: string): Promise<TerminalThemeImportReport> {
  return invoke('import_terminal_theme_folder', { path });
}

export async function deleteTerminalTheme(name: string): Promise<void> {
  return invoke('delete_terminal_theme', { name });
}

export async function saveTerminalTheme(theme: TerminalTheme): Promise<TerminalTheme> {
  return invoke('save_terminal_theme', { theme });
}

/** The theme's wallpaper as a `data:` URL, `null` when it has none. */
export async function readTerminalThemeImage(name: string): Promise<string | null> {
  return invoke('read_terminal_theme_image', { name });
}

/**
 * A theme file (or wallpaper) appeared, changed or was removed in
 * `data/terminal/themes/`. Broadcast to every window — the main one and the
 * Terminal one — so a dropped-in or imported theme shows up without a
 * restart. The watcher starts with the first `listTerminalThemes()`.
 */
export async function onTerminalThemesChanged(
  callback: (keys: string[]) => void
): Promise<UnlistenFn> {
  return listen<{ keys: string[] }>('terminal-themes-changed', (event) => callback(event.payload.keys));
}

/**
 * Backdrop effect of the Terminal window (acrylic / mica on Windows,
 * vibrancy on macOS). `tint` = theme background (acrylic tint), `dark` picks
 * the material. Opacity itself is CSS (`--terminal-window-alpha`).
 */
export async function setTerminalWindowEffect(
  effect: 'none' | 'acrylic' | 'mica' | 'vibrancy',
  opacity: number,
  tint?: string | null,
  dark?: boolean
): Promise<void> {
  return invoke('set_terminal_window_effect', { effect, opacity, tint: tint ?? null, dark: dark ?? null });
}
