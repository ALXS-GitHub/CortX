export interface Service {
  id: string;
  name: string;
  workingDir: string;
  command: string;
  color?: string;
  port?: number;
  envVars?: Record<string, string>;
  order: number;
}

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  description?: string;
  imagePath?: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  services: Service[];
}

export interface TerminalConfig {
  executablePath: string;
  arguments: string[];
}

export interface AppearanceConfig {
  theme: 'light' | 'dark' | 'system';
}

export interface DefaultsConfig {
  launchMethod: 'clipboard' | 'external' | 'integrated';
}

export interface AppSettings {
  terminal: TerminalConfig;
  appearance: AppearanceConfig;
  defaults: DefaultsConfig;
}

export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface ServiceState {
  serviceId: string;
  status: ServiceStatus;
  pid?: number;
}

export type LogStream = 'stdout' | 'stderr';

export interface LogEntry {
  timestamp: string;
  stream: LogStream;
  content: string;
}

// Event payloads from Tauri
export interface ServiceLogPayload {
  serviceId: string;
  stream: LogStream;
  content: string;
}

export interface ServiceStatusPayload {
  serviceId: string;
  status: ServiceStatus;
  pid?: number;
}

export interface ServiceExitPayload {
  serviceId: string;
  exitCode?: number;
}

// Input types for commands
export interface CreateProjectInput {
  name: string;
  rootPath: string;
  description?: string;
  imagePath?: string;
}

export interface UpdateProjectInput {
  name?: string;
  rootPath?: string;
  description?: string;
  imagePath?: string;
}

export interface CreateServiceInput {
  name: string;
  workingDir: string;
  command: string;
  color?: string;
  port?: number;
  envVars?: Record<string, string>;
}

export interface UpdateServiceInput {
  name?: string;
  workingDir?: string;
  command?: string;
  color?: string;
  port?: number;
  envVars?: Record<string, string>;
}

// View types
export type View = 'dashboard' | 'project' | 'settings';
