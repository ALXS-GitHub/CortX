import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type {
  Project,
  Service,
  AppSettings,
  CreateProjectInput,
  UpdateProjectInput,
  CreateServiceInput,
  UpdateServiceInput,
  ServiceLogPayload,
  ServiceStatusPayload,
  ServiceExitPayload,
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

// Launch commands
export async function getLaunchCommand(serviceId: string): Promise<string> {
  return invoke('get_launch_command', { serviceId });
}

export async function launchExternalTerminal(serviceId: string): Promise<void> {
  return invoke('launch_external_terminal', { serviceId });
}

export async function startIntegratedService(serviceId: string): Promise<number> {
  return invoke('start_integrated_service', { serviceId });
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
