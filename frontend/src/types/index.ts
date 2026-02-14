export interface Service {
  id: string;
  name: string;
  workingDir: string;
  command: string;
  modes?: Record<string, string>;  // Optional: { modeName: command }
  defaultMode?: string;  // If set, use this mode's command as default when starting
  extraArgs?: string;  // Static args always appended to command
  argPresets?: Record<string, string>;  // { presetName: argsString }
  defaultArgPreset?: string;  // Default preset to use
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
  folderId?: string;
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
  scriptsConfig: ScriptsConfig;
}

export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface ServiceState {
  serviceId: string;
  status: ServiceStatus;
  pid?: number;
  activeMode?: string;  // Track which mode is running
  activeArgPreset?: string;  // Track which arg preset is active
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
  activeMode?: string;
  activeArgPreset?: string;
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
  modes?: Record<string, string>;
  defaultMode?: string;
  extraArgs?: string;
  argPresets?: Record<string, string>;
  defaultArgPreset?: string;
  color?: string;
  port?: number;
  envVars?: Record<string, string>;
}

export interface UpdateServiceInput {
  name?: string;
  workingDir?: string;
  command?: string;
  modes?: Record<string, string>;
  defaultMode?: string;
  extraArgs?: string;
  argPresets?: Record<string, string>;
  defaultArgPreset?: string;
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

// ============================================================================
// Global Scripts types
// ============================================================================

export type ScriptParamType = 'string' | 'bool' | 'number' | 'enum' | 'path';

export interface ScriptParameter {
  name: string;
  paramType: ScriptParamType;
  shortFlag?: string;
  longFlag?: string;
  description?: string;
  defaultValue?: string;
  required: boolean;
  enumValues: string[];
}

export interface ParameterPreset {
  id: string;
  name: string;
  description?: string;
  values: Record<string, string>;
  enabled: Record<string, boolean>;
}

export interface GlobalScript {
  id: string;
  name: string;
  description?: string;
  command: string;
  scriptPath?: string;
  workingDir?: string;
  color?: string;
  folderId?: string;
  tags: string[];
  parameters: ScriptParameter[];
  parameterPresets: ParameterPreset[];
  defaultPresetId?: string;
  envVars?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  order: number;
  autoDiscovered: boolean;
}

export type FolderType = 'project' | 'script';

export interface VirtualFolder {
  id: string;
  name: string;
  color?: string;
  icon?: string;
  order?: number;
  folderType: FolderType;
}

export type GroupExecutionMode = 'parallel' | 'sequential';

export interface ScriptGroup {
  id: string;
  name: string;
  description?: string;
  scriptIds: string[];
  executionMode: GroupExecutionMode;
  stopOnFailure: boolean;
  folderId?: string;
  order: number;
}

export interface ExecutionRecord {
  id: string;
  scriptId: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  success: boolean;
  exitCode?: number;
  parametersUsed: Record<string, string>;
  presetName?: string;
}

export interface ScriptsConfig {
  mainFolder?: string;
  scanExtensions: string[];
  ignoredPatterns: string[];
  autoScanOnStartup: boolean;
  commandTemplates: Record<string, string>;
}

export interface DiscoveredScript {
  path: string;
  name: string;
  description?: string;
  extension: string;
}

// Input types for global script commands

export interface CreateGlobalScriptInput {
  name: string;
  description?: string;
  command: string;
  scriptPath?: string;
  workingDir?: string;
  color?: string;
  folderId?: string;
  tags?: string[];
  parameters?: ScriptParameter[];
  parameterPresets?: ParameterPreset[];
  envVars?: Record<string, string>;
}

export interface UpdateGlobalScriptInput {
  name?: string;
  description?: string;
  command?: string;
  scriptPath?: string;
  workingDir?: string;
  color?: string;
  folderId?: string;
  tags?: string[];
  parameters?: ScriptParameter[];
  parameterPresets?: ParameterPreset[];
  defaultPresetId?: string;
  envVars?: Record<string, string>;
}

export interface CreateFolderInput {
  name: string;
  color?: string;
  icon?: string;
  order?: number;
  folderType: FolderType;
}

export interface UpdateFolderInput {
  name?: string;
  color?: string;
  icon?: string;
  order?: number;
}

export interface CreateScriptGroupInput {
  name: string;
  description?: string;
  scriptIds: string[];
  executionMode: GroupExecutionMode;
  stopOnFailure?: boolean;
  folderId?: string;
}

export interface UpdateScriptGroupInput {
  name?: string;
  description?: string;
  scriptIds?: string[];
  executionMode?: GroupExecutionMode;
  stopOnFailure?: boolean;
  folderId?: string;
}

// Import/Export result
export interface ImportResult {
  scriptsAdded: number;
  foldersAdded: number;
  groupsAdded: number;
  skipped: number;
}

// View types
export type View = 'dashboard' | 'project' | 'settings' | 'scripts' | 'script-detail';
