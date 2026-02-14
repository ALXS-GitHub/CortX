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
  VirtualFolder,
  CreateFolderInput,
  UpdateFolderInput,
  ScriptGroup,
  CreateScriptGroupInput,
  UpdateScriptGroupInput,
  ExecutionRecord,
  ScriptsConfig,
  ScriptParameter,
  ImportResult,
  DiscoveredScript,
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

// Folder commands
export async function getAllFolders(): Promise<VirtualFolder[]> {
  return invoke('get_all_folders');
}

export async function createFolder(input: CreateFolderInput): Promise<VirtualFolder> {
  return invoke('create_folder', { input });
}

export async function updateFolder(id: string, input: UpdateFolderInput): Promise<VirtualFolder> {
  return invoke('update_folder', { id, input });
}

export async function deleteFolder(id: string): Promise<void> {
  return invoke('delete_folder', { id });
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

export async function importScriptsConfig(json: string): Promise<ImportResult> {
  return invoke('import_scripts_config', { json });
}

// Execution history update
export async function updateExecutionRecord(
  scriptId: string,
  exitCode: number | null,
  success: boolean
): Promise<void> {
  return invoke('update_execution_record', { scriptId, exitCode, success });
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
