import { invoke } from '@tauri-apps/api/core';
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
  ServiceExitPayload,
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
  ScriptGroup,
  CreateScriptGroupInput,
  UpdateScriptGroupInput,
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
  StatusDefinition,
  CreateStatusDefinitionInput,
  UpdateStatusDefinitionInput,
  App,
  CreateAppInput,
  UpdateAppInput,
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

// Utility commands
export async function openInExplorer(path: string): Promise<void> {
  return invoke('open_in_explorer', { path });
}

export async function openInVscode(path: string): Promise<void> {
  return invoke('open_in_vscode', { path });
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

export async function runGlobalScript(
  scriptId: string,
  workingDir: string,
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

// Script group commands
export async function getAllScriptGroups(): Promise<ScriptGroup[]> {
  return invoke('get_all_script_groups');
}

export async function createScriptGroup(input: CreateScriptGroupInput): Promise<ScriptGroup> {
  return invoke('create_script_group', { input });
}

export async function updateScriptGroup(id: string, input: UpdateScriptGroupInput): Promise<ScriptGroup> {
  return invoke('update_script_group', { id, input });
}

export async function deleteScriptGroup(id: string): Promise<void> {
  return invoke('delete_script_group', { id });
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

// Script group execution
export async function runScriptGroup(groupId: string): Promise<[string, { Ok: number } | { Err: string }][]> {
  return invoke('run_script_group', { groupId });
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
