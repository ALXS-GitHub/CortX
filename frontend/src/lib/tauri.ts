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
