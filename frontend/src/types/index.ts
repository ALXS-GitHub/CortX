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
  tags: string[];
  status?: string;
  toolboxUrl?: string;
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
  toolboxBaseUrl: string;
  backupRepoPath?: string;
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
  tags?: string[];
  status?: string;
  toolboxUrl?: string;
}

export interface UpdateProjectInput {
  name?: string;
  rootPath?: string;
  description?: string;
  imagePath?: string;
  tags?: string[];
  status?: string;
  toolboxUrl?: string;
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
  nargs?: string;
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
  tags: string[];
  parameters: ScriptParameter[];
  parameterPresets: ParameterPreset[];
  defaultPresetId?: string;
  envVars?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  order: number;
  autoDiscovered: boolean;
  status?: string;
}

export interface TagDefinition {
  name: string;
  color?: string;
  order?: number;
}

export type GroupExecutionMode = 'parallel' | 'sequential';

export interface ScriptGroup {
  id: string;
  name: string;
  description?: string;
  scriptIds: string[];
  executionMode: GroupExecutionMode;
  stopOnFailure: boolean;
  tags: string[];
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

// Discovered tool (from package manager scanning)
export interface DiscoveredTool {
  name: string;
  version?: string;
  source: string;
  description?: string;
  installLocation?: string;
  homepage?: string;
}

// Tool types
export interface ToolConfigPath {
  label: string;
  path: string;
  isDirectory: boolean;
}

export interface Tool {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  status: string;
  replacedBy?: string;
  installMethod?: string;
  installLocation?: string;
  version?: string;
  homepage?: string;
  configPaths: ToolConfigPath[];
  toolboxUrl?: string;
  notes?: string;
  color?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateToolInput {
  name: string;
  description?: string;
  tags?: string[];
  status?: string;
  replacedBy?: string;
  installMethod?: string;
  installLocation?: string;
  version?: string;
  homepage?: string;
  configPaths?: ToolConfigPath[];
  toolboxUrl?: string;
  notes?: string;
  color?: string;
}

export interface UpdateToolInput {
  name?: string;
  description?: string;
  tags?: string[];
  status?: string;
  replacedBy?: string;
  installMethod?: string;
  installLocation?: string;
  version?: string;
  homepage?: string;
  configPaths?: ToolConfigPath[];
  toolboxUrl?: string;
  notes?: string;
  color?: string;
}

// Input types for global script commands

export interface CreateGlobalScriptInput {
  name: string;
  description?: string;
  command: string;
  scriptPath?: string;
  workingDir?: string;
  color?: string;
  tags?: string[];
  parameters?: ScriptParameter[];
  parameterPresets?: ParameterPreset[];
  envVars?: Record<string, string>;
  status?: string;
}

export interface UpdateGlobalScriptInput {
  name?: string;
  description?: string;
  command?: string;
  scriptPath?: string;
  workingDir?: string;
  color?: string;
  tags?: string[];
  parameters?: ScriptParameter[];
  parameterPresets?: ParameterPreset[];
  defaultPresetId?: string;
  envVars?: Record<string, string>;
  status?: string;
}

export interface CreateTagDefinitionInput {
  name: string;
  color?: string;
  order?: number;
}

export interface UpdateTagDefinitionInput {
  name?: string;
  color?: string;
  order?: number;
}

export interface CreateScriptGroupInput {
  name: string;
  description?: string;
  scriptIds: string[];
  executionMode: GroupExecutionMode;
  stopOnFailure?: boolean;
  tags?: string[];
}

export interface UpdateScriptGroupInput {
  name?: string;
  description?: string;
  scriptIds?: string[];
  executionMode?: GroupExecutionMode;
  stopOnFailure?: boolean;
  tags?: string[];
}

// Import/Export result
export interface ImportResult {
  scriptsAdded: number;
  groupsAdded: number;
  skipped: number;
  toolsAdded: number;
  tagDefinitionsAdded: number;
  aliasesAdded: number;
  appsAdded: number;
  statusDefinitionsAdded: number;
  projectsAdded: number;
  settingsImported: boolean;
}

export interface ImportOptions {
  projects: boolean;
  scripts: boolean;
  tools: boolean;
  apps: boolean;
  shellConfig: boolean;
  tagsAndStatuses: boolean;
  settings: boolean;
}

export interface ExportSummary {
  version: string;
  exportedAt: string;
  projectsCount: number;
  scriptsCount: number;
  groupsCount: number;
  toolsCount: number;
  appsCount: number;
  aliasesCount: number;
  tagDefinitionsCount: number;
  statusDefinitionsCount: number;
  hasSettings: boolean;
}

// View types
export type View = 'dashboard' | 'project' | 'settings' | 'scripts' | 'script-detail' | 'tools' | 'tool-detail' | 'aliases' | 'alias-detail' | 'apps' | 'app-detail';

// Status Definition types
export interface StatusDefinition {
  name: string;
  color?: string;
  order?: number;
}

export interface CreateStatusDefinitionInput {
  name: string;
  color?: string;
  order?: number;
}

export interface UpdateStatusDefinitionInput {
  name?: string;
  color?: string;
  order?: number;
}

// App types (GUI Applications)
export interface App {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  status?: string;
  version?: string;
  homepage?: string;
  executablePath?: string;
  launchArgs?: string;
  configPaths: ToolConfigPath[];
  toolboxUrl?: string;
  notes?: string;
  color?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAppInput {
  name: string;
  description?: string;
  tags?: string[];
  status?: string;
  version?: string;
  homepage?: string;
  executablePath?: string;
  launchArgs?: string;
  configPaths?: ToolConfigPath[];
  toolboxUrl?: string;
  notes?: string;
  color?: string;
}

export interface UpdateAppInput {
  name?: string;
  description?: string;
  tags?: string[];
  status?: string;
  version?: string;
  homepage?: string;
  executablePath?: string;
  launchArgs?: string;
  configPaths?: ToolConfigPath[];
  toolboxUrl?: string;
  notes?: string;
  color?: string;
}

export type ListViewMode = 'card' | 'list' | 'compact';

// Shell Alias types
export type AliasType = 'function' | 'script' | 'init';

export interface ShellAlias {
  id: string;
  name: string;
  command: string;
  description?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  order: number;
  status?: string;
  aliasType: AliasType;
  setup?: Record<string, string>;
  script?: Record<string, string>;
  toolId?: string;
  executionOrder?: number;
}

export interface CreateShellAliasInput {
  name: string;
  command: string;
  description?: string;
  tags?: string[];
  status?: string;
  aliasType?: AliasType;
  setup?: Record<string, string>;
  script?: Record<string, string>;
  toolId?: string;
  executionOrder?: number;
}

export interface UpdateShellAliasInput {
  name?: string;
  command?: string;
  description?: string;
  tags?: string[];
  status?: string;
  aliasType?: AliasType;
  setup?: Record<string, string>;
  script?: Record<string, string>;
  toolId?: string;
  executionOrder?: number;
}
