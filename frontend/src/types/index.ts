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
  /** Pinned by the user: favorites are listed first and can be filtered on. */
  favorite: boolean;
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
  | 'custom'
  /** CortX's own Terminal window: "external" launches run in a PTY there. */
  | 'cortxterminal';

export interface TerminalConfig {
  preset: TerminalPreset;
  customPath: string;
  customArgs: string[];
  /** Shell launched by "new terminal" tabs in the integrated terminal, as a
   *  command line (e.g. `pwsh -NoLogo`, `/bin/zsh -l`). Empty = auto-detect. */
  integratedShell?: string;
  /** `cortx init` emits OSC 7 / OSC 133 (cwd, command boundaries, exit codes)
   *  inside CortX terminals. Default true. */
  shellIntegration?: boolean;
  /** Toast + OS notification when a long command finishes in a terminal you
   *  are not looking at. Default true. */
  notifyOnLongCommand?: boolean;
  /** Threshold for "long", in seconds. Default 10. */
  longCommandSeconds?: number;
  /** Terminal window: sessions rail on the left (default) or a tab strip on top — never both. */
  tabsPlacement?: 'sidebar' | 'top';
  /** Font of every terminal. Empty = bundled monospace stack. */
  fontFamily?: string;
  /** Font size in px. Default 12. */
  fontSize?: number;
  /** Line height multiplier 1.0–2.0. Default 1.2. */
  lineHeight?: number;
  /** Reopen the Terminal window's tabs on start (shells in their last cwd, nothing re-run). Default true. */
  restoreSessions?: boolean;
  /** Seed restored shells with the tail of their previous scrollback. Default true. */
  restoreScrollback?: boolean;
  /** Lines kept per terminal. Default 200. */
  restoreScrollbackLines?: number;
  /** Where a started service / script shows up. Default dock. */
  openProcessesIn?: TerminalTargetSurface;
  /** Where a launch configuration opens its tabs. Default window. */
  openDevSessionsIn?: TerminalTargetSurface;
  /** Terminal window shortcuts: action id → combo (e.g. `{ "split.right": "Ctrl+Shift+D" }`). Missing = default. */
  keybindings?: Record<string, string>;
  /** Terminal theme names (files under data/terminal/themes/) for dark / light app mode. */
  themeDark?: string;
  themeLight?: string;
  /** Pick the dark/light theme from the app mode (default true) or always use themeDark. */
  themeFollowsApp?: boolean;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
  /** Inner padding in px. Default 8. */
  padding?: number;
  /** Terminal window opacity 50–100. Default 100. */
  windowOpacity?: number;
  windowEffect?: 'none' | 'acrylic' | 'mica' | 'vibrancy';
  /** Ghost-text completions from the command history (→ accepts). Default true. */
  inlineSuggestions?: boolean;
  /** Wallpaper overrides; undefined = the theme file's own values. */
  wallpaperOpacity?: number;
  wallpaperBlur?: number;
  wallpaperFit?: 'cover' | 'contain' | 'tile' | 'center';
  /** Darkening overlay on the wallpaper, 0–90 %. Default 0. */
  wallpaperDim?: number;
  /** Title bar + rail background alpha 0–100 %. Default 72. */
  chromeOpacity?: number;
  /** Title bar + rail backdrop blur in px. Default 20. */
  chromeBlur?: number;
  /** Colour the main window's dock terminals with the terminal theme too. Default false. */
  dockUsesTerminalTheme?: boolean;
}

export type TerminalTargetSurface = 'dock' | 'window';

// ---------------------------------------------------------------------------
// Launch configurations (data/terminal/launch/*.yaml)
// ---------------------------------------------------------------------------

export type LaunchSplitDirection = 'horizontal' | 'vertical';

export type LaunchNode =
  | { split: LaunchSplitDirection; children: LaunchNode[]; sizes?: number[] }
  | { cwd?: string; command?: string; shell?: string; title?: string };

export interface LaunchTab {
  title?: string;
  layout: LaunchNode;
}

export interface LaunchConfig {
  id: string;
  name: string;
  projectId?: string;
  /** `terminal` (default) or `dock`. */
  window: 'terminal' | 'dock';
  tabs: LaunchTab[];
}

export function isLaunchSplit(node: LaunchNode): node is { split: LaunchSplitDirection; children: LaunchNode[]; sizes?: number[] } {
  return typeof node === 'object' && node !== null && 'split' in node;
}

export type ShellPhase = 'unknown' | 'idle' | 'running';

/** What the shell behind a terminal reported through shell integration
 *  (`terminal-state` event / `get_terminal_states`). */
export interface TerminalShellState {
  terminalId: string;
  phase: ShellPhase;
  cwd?: string | null;
  /** Command currently running (phase === 'running'). */
  command?: string | null;
  /** Epoch ms. */
  startedAt?: number | null;
  lastCommand?: string | null;
  lastExitCode?: number | null;
  lastDurationMs?: number | null;
  lastFinishedAt?: number | null;
  /** Increments on every finished command. */
  completedCommands: number;
}

/** One line of `runtime/command-history.jsonl`. */
export interface CommandRecord {
  ts: number;
  terminalId: string;
  projectId?: string;
  cwd?: string;
  command?: string;
  exitCode?: number;
  durationMs: number;
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
  /** tauri-plugin-global-shortcut combo (e.g. "CmdOrCtrl+Shift+Space").
   *  Undefined / empty means "disabled". */
  globalHotkey?: string;
  /** Directory where alias shims (real launcher files) are written. Empty/undefined
   *  means use the platform default (`%LOCALAPPDATA%\CortX\bin`, `~/.local/share/CortX/bin`). */
  shimDir?: string;
  /** Agents (beta) section: provider roots, toggles and list defaults. */
  agents: AgentsSettings;
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

// Integrated terminal (PTY) — see cortx_core::process_manager / terminal
export interface ShellInfo {
  id: string;
  pid: number;
  cwd: string;
  projectId?: string | null;
  program: string;
  startedAt: string;
}

export interface ShellExitPayload {
  shellId: string;
  exitCode?: number | null;
}

export interface TerminalCapabilities {
  /** Windows only: the bundled Windows Terminal ConPTY (image passthrough) is in use. */
  conptySideloaded: boolean;
  platform: string;
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

export interface ServicePortsPayload {
  serviceId: string;
  ports: number[];
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
  /** Empty string clears the status; omit the field to leave it untouched. */
  status?: string;
  toolboxUrl?: string;
  favorite?: boolean;
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
  /** Pinned by the user: favorites are listed first and can be filtered on. */
  favorite: boolean;
}

export interface TagDefinition {
  name: string;
  color?: string;
  order?: number;
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
  /** Pinned by the user: favorites are listed first and can be filtered on. */
  favorite: boolean;
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
  /** Empty string clears the status; omit the field to leave it untouched. */
  status?: string;
  favorite?: boolean;
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
  /** Empty string clears the status; omit the field to leave it untouched. */
  status?: string;
  favorite?: boolean;
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

// Import/Export result
export interface ImportResult {
  scriptsAdded: number;
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
  toolsCount: number;
  appsCount: number;
  aliasesCount: number;
  tagDefinitionsCount: number;
  statusDefinitionsCount: number;
  hasSettings: boolean;
}

// View types
export type View = 'dashboard' | 'project' | 'settings' | 'scripts' | 'script-detail' | 'tools' | 'tool-detail' | 'aliases' | 'alias-detail' | 'apps' | 'app-detail' | 'utilities' | 'agents';

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
  /** Pinned by the user: favorites are listed first and can be filtered on. */
  favorite: boolean;
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
  /** Empty string clears the status; omit the field to leave it untouched. */
  status?: string;
  favorite?: boolean;
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
  /** When true, a real launcher file ("shim") is written so this alias is
   *  callable from any process (agents, scheduled tasks), not just shells that
   *  source `cortx init`. Only effective for `function` aliases. */
  shim?: boolean;
  /** Pinned by the user: favorites are listed first and can be filtered on. */
  favorite: boolean;
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
  shim?: boolean;
}

export interface UpdateShellAliasInput {
  name?: string;
  command?: string;
  description?: string;
  tags?: string[];
  /** Empty string clears the status; omit the field to leave it untouched. */
  status?: string;
  aliasType?: AliasType;
  setup?: Record<string, string>;
  script?: Record<string, string>;
  toolId?: string;
  executionOrder?: number;
  shim?: boolean;
  favorite?: boolean;
}

// Alias shim (real launcher files) status & operations
export interface ShimStatus {
  dir: string;
  onPath: boolean;
  count: number;
  names: string[];
}

export interface ShimSyncReport {
  written: string[];
  removed: string[];
}

export type ShimInstallOutcome =
  | { status: 'added' }
  | { status: 'alreadyPresent' }
  | { status: 'manual'; instruction: string };

// ============================================================================
// Agents (beta) — DEV-11. Types mirror the Rust structs (camelCase / kebab-case enums).
// ============================================================================

export type AgentProvider = 'claude-code' | 'codex';
export type AgentState = 'running' | 'waiting' | 'stopped' | 'unknown';
export type AgentTitleSource = 'custom' | 'auto' | 'first-prompt';

export interface AgentAnnotations {
  customName?: string;
  tags: string[];              // reuse existing tag definitions
  status?: string;             // reuse existing status definitions (free label)
  pinned: boolean;
  hidden: boolean;
  notes?: string;
  projectIdOverride?: string;  // forces project attachment
  updatedAt: string;
}

export interface AgentSession {
  id: string;                  // Claude sessionId (uuid) | Codex thread id
  provider: AgentProvider;
  title: string;               // custom-title/customName > ai-title/codex title > first prompt (truncated 80 chars)
  titleSource: AgentTitleSource;
  cwd: string;                 // normalized absolute path, no `\\?\` prefix
  projectId?: string;          // resolved by longest-prefix match against Project.rootPath, or annotations.projectIdOverride
  gitBranch?: string;
  state: AgentState;
  pid?: number;
  kind?: string;               // 'interactive' | 'background' | 'exec' | ...
  startedAt: string;
  lastActivityAt: string;
  lastUserPrompt?: string;     // single line, max 200 chars
  lastAssistantText?: string;  // single line, max 200 chars
  currentTool?: string;        // last tool_use without tool_result (Claude), e.g. "Bash" or "Edit"
  messageCount: number;
  subagentCount: number;
  model?: string;
  version?: string;            // CLI version
  transcriptPath: string;
  ticketRefs: string[];        // regex [A-Z]{2,}-\d+ and #\d+ found in title / first prompt, deduped
  annotations: AgentAnnotations;
}

export type AgentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolId: string; name: string; input: unknown }
  | { type: 'tool-result'; toolId: string; name?: string; output: string; isError: boolean }
  | { type: 'attachment'; description: string };

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: string;
  parts: AgentPart[];
  isSidechain: boolean;
}

export interface AgentTranscriptPage {
  sessionId: string;
  messages: AgentMessage[];    // chronological order
  totalMessages: number;
  offset: number;              // index of messages[0] in the full transcript
  hasMore: boolean;            // true if offset > 0 (older messages exist)
}

export interface AgentProviderHealth {
  provider: AgentProvider;
  enabled: boolean;
  detected: boolean;           // root dir exists
  rootPath: string;
  version?: string;
  sessionCount: number;
  liveCount: number;
  unreadableCount: number;
  liveSupported: boolean;      // true for claude-code, false for codex
}

export interface AgentsHealth {
  providers: AgentProviderHealth[];
  indexing: boolean;
  lastScanAt?: string;
}

// AppSettings gets a new field `agents` (Rust: #[serde(default)] pub agents: AgentsSettings)
export interface AgentsSettings {
  claudeConfigDir?: string;        // default: ~/.claude  (empty/undefined => default)
  codexHome?: string;              // default: ~/.codex
  claudeEnabled: boolean;          // default true
  codexEnabled: boolean;           // default true
  codexLiveThresholdMinutes: number; // default 5 — Codex thread updated within N min => 'running' (best effort), else 'stopped'
  recentDays: number;              // default 7 — UI default filter for finished sessions
}

export interface ListAgentSessionsOptions {
  sinceDays?: number | null;   // null/undefined => all. Running/waiting sessions are ALWAYS included regardless of age
  includeHidden?: boolean;     // default false
}

export interface AgentTranscriptQuery {
  end?: number | null;         // exclusive end index; null => totalMessages
  limit: number;               // e.g. 50
}

// ---------------------------------------------------------------------------
// Terminal themes (data/terminal/themes/*.yaml, Warp's format) — DEV-13 P3.
// Field names mirror the YAML (snake_case) so a file round-trips unchanged.
// ---------------------------------------------------------------------------

export type TerminalThemeDetails = 'darker' | 'lighter';
export type TerminalThemeImageFit = 'cover' | 'contain' | 'tile' | 'center';
export type TerminalThemeSource = 'bundled' | 'user';

export interface TerminalAnsiColors {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
}

export interface TerminalThemeImage {
  /** Absolute path once read through `getTerminalTheme` (bare file name on disk). */
  path: string;
  /** Percent, Warp semantics. Missing = 100. */
  opacity?: number | null;
}

/** CortX-only knobs under the `cortx:` key (ignored by Warp). */
export interface TerminalThemeCortxExt {
  cursor?: string | null;
  selection?: string | null;
  /** Wallpaper blur in px. */
  blur?: number | null;
  imageFit?: TerminalThemeImageFit | null;
}

export interface TerminalTheme {
  /** File stem — what the settings (`themeDark` / `themeLight`) refer to. */
  key: string;
  name: string;
  background: string;
  accent: string;
  foreground: string;
  details: TerminalThemeDetails;
  background_image?: TerminalThemeImage | null;
  terminal_colors: { normal: TerminalAnsiColors; bright: TerminalAnsiColors };
  cortx?: TerminalThemeCortxExt | null;
}

/** One row of the theme picker. */
export interface TerminalThemeSummary {
  key: string;
  name: string;
  background: string;
  accent: string;
  foreground: string;
  details: TerminalThemeDetails;
  hasImage: boolean;
  source: TerminalThemeSource;
  /** The 8 normal ANSI colours. */
  swatches: string[];
}

export interface TerminalThemeImportReport {
  imported: number;
  skipped: number;
  keys: string[];
}
