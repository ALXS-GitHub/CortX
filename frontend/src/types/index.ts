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

export interface Script {
  id: string;
  name: string;
  description?: string;
  command: string;
  scriptPath?: string;
  workingDir: string;
  color?: string;
  linkedServiceIds: string[];
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
  scripts: Script[];
  envFiles: EnvFile[];
  envFilesDiscovered: boolean;
}

// Environment file types

export interface EnvVariable {
  key: string;
  value: string;
  lineNumber: number;
}

export type EnvFileVariant =
  | 'base'
  | 'local'
  | 'development'
  | 'production'
  | 'test'
  | 'staging'
  | 'example'
  | 'other';

export interface EnvFile {
  id: string;
  path: string;
  relativePath: string;
  filename: string;
  variant: EnvFileVariant;
  variables: EnvVariable[];
  isManuallyAdded: boolean;
  linkedServiceId?: string;
  discoveredAt: string;
  lastReadAt: string;
}

export interface EnvComparison {
  baseFileId: string;
  exampleFileId: string;
  missingInBase: string[];
  extraInBase: string[];
  commonKeys: string[];
}

export type TerminalPreset =
  | 'windowsterminal'
  | 'powershell'
  | 'cmd'
  | 'warp'
  | 'macterminal'
  | 'iterm2'
  | 'custom';

export interface TerminalConfig {
  preset: TerminalPreset;
  customPath: string;
  customArgs: string[];
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

// Script types
export type ScriptStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface ScriptLogPayload {
  scriptId: string;
  stream: LogStream;
  content: string;
}

export interface ScriptStatusPayload {
  scriptId: string;
  status: ScriptStatus;
  pid?: number;
}

export interface ScriptExitPayload {
  scriptId: string;
  exitCode?: number;
  success: boolean;
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

export interface CreateScriptInput {
  name: string;
  description?: string;
  command: string;
  scriptPath?: string;
  workingDir: string;
  color?: string;
  linkedServiceIds?: string[];
}

export interface UpdateScriptInput {
  name?: string;
  description?: string;
  command?: string;
  scriptPath?: string;
  workingDir?: string;
  color?: string;
  linkedServiceIds?: string[];
}

// Environment file input types

export interface DiscoverEnvFilesInput {
  force: boolean;
}

export interface AddEnvFileInput {
  path: string;
}

export interface LinkEnvToServiceInput {
  serviceId: string | null;
}

// View types
export type View = 'dashboard' | 'project' | 'settings';
