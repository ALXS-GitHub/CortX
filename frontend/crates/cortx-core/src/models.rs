use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ============================================================================
// Existing models (extracted from frontend/src-tauri/src/models.rs)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub name: String,
    pub working_dir: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modes: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra_args: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arg_presets: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_arg_preset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_vars: Option<HashMap<String, String>>,
    pub order: u32,
}

impl Service {
    pub fn new(name: String, working_dir: String, command: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            working_dir,
            command,
            modes: None,
            default_mode: None,
            extra_args: None,
            arg_presets: None,
            default_arg_preset: None,
            color: None,
            port: None,
            env_vars: None,
            order: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Script {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script_path: Option<String>,
    pub working_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub linked_service_ids: Vec<String>,
    pub order: u32,
}

impl Script {
    pub fn new(name: String, working_dir: String, command: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            description: None,
            command,
            script_path: None,
            working_dir,
            color: None,
            linked_service_ids: Vec::new(),
            order: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<DateTime<Utc>>,
    pub services: Vec<Service>,
    #[serde(default)]
    pub scripts: Vec<Script>,
    #[serde(default)]
    pub env_files: Vec<EnvFile>,
    #[serde(default)]
    pub env_files_discovered: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub toolbox_url: Option<String>,
}

impl Project {
    pub fn new(name: String, root_path: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            root_path,
            description: None,
            image_path: None,
            created_at: now,
            updated_at: now,
            last_opened_at: None,
            services: Vec::new(),
            scripts: Vec::new(),
            env_files: Vec::new(),
            env_files_discovered: false,
            tags: Vec::new(),
            status: None,
            toolbox_url: None,
        }
    }
}

// Environment file models

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVariable {
    pub key: String,
    pub value: String,
    pub line_number: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EnvFileVariant {
    Base,
    Local,
    Development,
    Production,
    Test,
    Staging,
    Example,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvFile {
    pub id: String,
    pub path: String,
    pub relative_path: String,
    pub filename: String,
    pub variant: EnvFileVariant,
    pub variables: Vec<EnvVariable>,
    pub is_manually_added: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_service_id: Option<String>,
    pub discovered_at: DateTime<Utc>,
    pub last_read_at: DateTime<Utc>,
}

impl EnvFile {
    pub fn new(
        path: String,
        relative_path: String,
        filename: String,
        variant: EnvFileVariant,
        variables: Vec<EnvVariable>,
        is_manually_added: bool,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            path,
            relative_path,
            filename,
            variant,
            variables,
            is_manually_added,
            linked_service_id: None,
            discovered_at: now,
            last_read_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvComparison {
    pub base_file_id: String,
    pub example_file_id: String,
    pub missing_in_base: Vec<String>,
    pub extra_in_base: Vec<String>,
    pub common_keys: Vec<String>,
}

// Terminal configuration

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TerminalPreset {
    WindowsTerminal,
    PowerShell,
    Cmd,
    Warp,
    MacTerminal,
    ITerm2,
    Custom,
}

impl Default for TerminalPreset {
    fn default() -> Self {
        #[cfg(target_os = "windows")]
        {
            Self::WindowsTerminal
        }
        #[cfg(target_os = "macos")]
        {
            Self::MacTerminal
        }
        #[cfg(target_os = "linux")]
        {
            Self::Custom
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TerminalConfig {
    pub preset: TerminalPreset,
    #[serde(default)]
    pub custom_path: String,
    #[serde(default)]
    pub custom_args: Vec<String>,
}

impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            preset: TerminalPreset::default(),
            custom_path: String::new(),
            custom_args: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceConfig {
    pub theme: Theme,
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            theme: Theme::System,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultsConfig {
    pub launch_method: LaunchMethod,
}

impl Default for DefaultsConfig {
    fn default() -> Self {
        Self {
            launch_method: LaunchMethod::Integrated,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LaunchMethod {
    Clipboard,
    External,
    Integrated,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub terminal: TerminalConfig,
    pub appearance: AppearanceConfig,
    pub defaults: DefaultsConfig,
    /// Global scripts configuration
    #[serde(default)]
    pub scripts_config: ScriptsConfig,
    /// Base URL for toolbox documentation links
    #[serde(default)]
    pub toolbox_base_url: String,
    /// Path to a local git repo for backing up CortX data
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_repo_path: Option<String>,
}

// Input types for commands

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    pub root_path: String,
    pub description: Option<String>,
    pub image_path: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub status: Option<String>,
    pub toolbox_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub root_path: Option<String>,
    pub description: Option<String>,
    pub image_path: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub toolbox_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateServiceInput {
    pub name: String,
    pub working_dir: String,
    pub command: String,
    pub modes: Option<HashMap<String, String>>,
    pub default_mode: Option<String>,
    pub extra_args: Option<String>,
    pub arg_presets: Option<HashMap<String, String>>,
    pub default_arg_preset: Option<String>,
    pub color: Option<String>,
    pub port: Option<u16>,
    pub env_vars: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateServiceInput {
    pub name: Option<String>,
    pub working_dir: Option<String>,
    pub command: Option<String>,
    pub modes: Option<HashMap<String, String>>,
    pub default_mode: Option<String>,
    pub extra_args: Option<String>,
    pub arg_presets: Option<HashMap<String, String>>,
    pub default_arg_preset: Option<String>,
    pub color: Option<String>,
    pub port: Option<u16>,
    pub env_vars: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScriptInput {
    pub name: String,
    pub description: Option<String>,
    pub command: String,
    pub script_path: Option<String>,
    pub working_dir: String,
    pub color: Option<String>,
    pub linked_service_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScriptInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub command: Option<String>,
    pub script_path: Option<String>,
    pub working_dir: Option<String>,
    pub color: Option<String>,
    pub linked_service_ids: Option<Vec<String>>,
}

// Environment file input types

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverEnvFilesInput {
    pub force: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddEnvFileInput {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkEnvToServiceInput {
    pub service_id: Option<String>,
}

// Runtime state types (not persisted)

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceStatus {
    Stopped,
    Starting,
    Running,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceState {
    pub service_id: String,
    pub status: ServiceStatus,
    pub pid: Option<u32>,
    pub active_mode: Option<String>,
    pub active_arg_preset: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp: DateTime<Utc>,
    pub stream: LogStream,
    pub content: String,
}

// Event payloads

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLogPayload {
    pub service_id: String,
    pub stream: LogStream,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatusPayload {
    pub service_id: String,
    pub status: ServiceStatus,
    pub pid: Option<u32>,
    pub active_mode: Option<String>,
    pub active_arg_preset: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceExitPayload {
    pub service_id: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScriptStatus {
    Idle,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptLogPayload {
    pub script_id: String,
    pub stream: LogStream,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptStatusPayload {
    pub script_id: String,
    pub status: ScriptStatus,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptExitPayload {
    pub script_id: String,
    pub exit_code: Option<i32>,
    pub success: bool,
}

// ============================================================================
// New models for Global Scripts feature
// ============================================================================

// Script parameter types

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ScriptParamType {
    String,
    Bool,
    Number,
    Enum,
    Path,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptParameter {
    pub name: String,
    pub param_type: ScriptParamType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_flag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub long_flag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,
    pub required: bool,
    #[serde(default)]
    pub enum_values: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nargs: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParameterPreset {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub values: HashMap<String, String>,
    /// Which parameters are enabled/disabled in this preset
    #[serde(default)]
    pub enabled: HashMap<String, bool>,
}

// Global Script

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalScript {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub parameters: Vec<ScriptParameter>,
    #[serde(default)]
    pub parameter_presets: Vec<ParameterPreset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_preset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_vars: Option<HashMap<String, String>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub order: u32,
    #[serde(default)]
    pub auto_discovered: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

impl GlobalScript {
    pub fn new(name: String, command: String, working_dir: Option<String>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            description: None,
            command,
            script_path: None,
            working_dir,
            color: None,
            tags: Vec::new(),
            parameters: Vec::new(),
            parameter_presets: Vec::new(),
            default_preset_id: None,
            env_vars: None,
            created_at: now,
            updated_at: now,
            order: 0,
            auto_discovered: false,
            status: None,
        }
    }
}

// Tag Definitions (enriched tags with color/order)

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagDefinition {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
}

// Script Groups

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum GroupExecutionMode {
    Parallel,
    Sequential,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptGroup {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub script_ids: Vec<String>,
    pub execution_mode: GroupExecutionMode,
    pub stop_on_failure: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    pub order: u32,
}

impl ScriptGroup {
    pub fn new(name: String, execution_mode: GroupExecutionMode) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            description: None,
            script_ids: Vec::new(),
            execution_mode,
            stop_on_failure: true,
            tags: Vec::new(),
            order: 0,
        }
    }
}

// Execution History

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRecord {
    pub id: String,
    pub script_id: String,
    pub started_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub parameters_used: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset_name: Option<String>,
}

impl ExecutionRecord {
    pub fn new(script_id: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            script_id,
            started_at: Utc::now(),
            finished_at: None,
            duration_ms: None,
            success: false,
            exit_code: None,
            parameters_used: HashMap::new(),
            preset_name: None,
        }
    }
}

// Scripts Configuration

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptsConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main_folder: Option<String>,
    #[serde(default = "default_scan_extensions")]
    pub scan_extensions: Vec<String>,
    #[serde(default = "default_ignored_patterns")]
    pub ignored_patterns: Vec<String>,
    #[serde(default)]
    pub auto_scan_on_startup: bool,
    #[serde(default = "default_command_templates")]
    pub command_templates: HashMap<String, String>,
}

fn default_scan_extensions() -> Vec<String> {
    vec![
        "sh".into(),
        "bash".into(),
        "zsh".into(),
        "ps1".into(),
        "bat".into(),
        "cmd".into(),
        "py".into(),
        "js".into(),
        "ts".into(),
        "rb".into(),
        "pl".into(),
    ]
}

fn default_command_templates() -> HashMap<String, String> {
    HashMap::from([
        ("py".into(), "python {{SCRIPT_FILE}}".into()),
        ("ps1".into(), "powershell -ExecutionPolicy Bypass -File {{SCRIPT_FILE}}".into()),
        ("bat".into(), "{{SCRIPT_FILE}}".into()),
        ("cmd".into(), "{{SCRIPT_FILE}}".into()),
        ("sh".into(), "bash {{SCRIPT_FILE}}".into()),
        ("bash".into(), "bash {{SCRIPT_FILE}}".into()),
        ("js".into(), "node {{SCRIPT_FILE}}".into()),
        ("ts".into(), "npx tsx {{SCRIPT_FILE}}".into()),
        ("rb".into(), "ruby {{SCRIPT_FILE}}".into()),
        ("pl".into(), "perl {{SCRIPT_FILE}}".into()),
    ])
}

fn default_ignored_patterns() -> Vec<String> {
    vec![
        "node_modules".into(),
        ".git".into(),
        "target".into(),
        "__pycache__".into(),
        ".venv".into(),
    ]
}

impl Default for ScriptsConfig {
    fn default() -> Self {
        Self {
            main_folder: None,
            scan_extensions: default_scan_extensions(),
            ignored_patterns: default_ignored_patterns(),
            auto_scan_on_startup: false,
            command_templates: default_command_templates(),
        }
    }
}

// Discovered script (from folder scanning)

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredScript {
    pub path: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub extension: String,
}

// Discovered tool (from package manager scanning)

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredTool {
    pub name: String,
    pub version: Option<String>,
    pub source: String,
    pub description: Option<String>,
    pub install_location: Option<String>,
    pub homepage: Option<String>,
}

// Input types for new commands

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGlobalScriptInput {
    pub name: String,
    pub description: Option<String>,
    pub command: String,
    pub script_path: Option<String>,
    pub working_dir: Option<String>,
    pub color: Option<String>,
    pub tags: Option<Vec<String>>,
    pub parameters: Option<Vec<ScriptParameter>>,
    pub parameter_presets: Option<Vec<ParameterPreset>>,
    pub env_vars: Option<HashMap<String, String>>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGlobalScriptInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub command: Option<String>,
    pub script_path: Option<String>,
    pub working_dir: Option<String>,
    pub color: Option<String>,
    pub tags: Option<Vec<String>>,
    pub parameters: Option<Vec<ScriptParameter>>,
    pub parameter_presets: Option<Vec<ParameterPreset>>,
    pub default_preset_id: Option<String>,
    pub env_vars: Option<HashMap<String, String>>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagDefinitionInput {
    pub name: String,
    pub color: Option<String>,
    pub order: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTagDefinitionInput {
    pub name: Option<String>,
    pub color: Option<String>,
    pub order: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScriptGroupInput {
    pub name: String,
    pub description: Option<String>,
    pub script_ids: Vec<String>,
    pub execution_mode: GroupExecutionMode,
    pub stop_on_failure: Option<bool>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScriptGroupInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub script_ids: Option<Vec<String>>,
    pub execution_mode: Option<GroupExecutionMode>,
    pub stop_on_failure: Option<bool>,
    pub tags: Option<Vec<String>>,
}

// Script export/import

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptExport {
    pub version: String,
    pub scripts: Vec<GlobalScript>,
    pub groups: Vec<ScriptGroup>,
    #[serde(default)]
    pub tools: Vec<Tool>,
    #[serde(default)]
    pub tag_definitions: Vec<TagDefinition>,
    #[serde(default)]
    pub aliases: Vec<ShellAlias>,
    #[serde(default)]
    pub apps: Vec<App>,
    #[serde(default)]
    pub status_definitions: Vec<StatusDefinition>,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<AppSettings>,
    pub exported_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub scripts_added: u32,
    pub groups_added: u32,
    pub skipped: u32,
    pub tools_added: u32,
    pub tag_definitions_added: u32,
    pub aliases_added: u32,
    pub apps_added: u32,
    pub status_definitions_added: u32,
    pub projects_added: u32,
    pub settings_imported: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    #[serde(default = "default_true")]
    pub projects: bool,
    #[serde(default = "default_true")]
    pub scripts: bool,
    #[serde(default = "default_true")]
    pub tools: bool,
    #[serde(default = "default_true")]
    pub apps: bool,
    #[serde(default = "default_true")]
    pub shell_config: bool,
    #[serde(default = "default_true")]
    pub tags_and_statuses: bool,
    #[serde(default = "default_true")]
    pub settings: bool,
}

impl Default for ImportOptions {
    fn default() -> Self {
        Self {
            projects: true,
            scripts: true,
            tools: true,
            apps: true,
            shell_config: true,
            tags_and_statuses: true,
            settings: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub version: String,
    pub exported_at: DateTime<Utc>,
    pub projects_count: usize,
    pub scripts_count: usize,
    pub groups_count: usize,
    pub tools_count: usize,
    pub apps_count: usize,
    pub aliases_count: usize,
    pub tag_definitions_count: usize,
    pub status_definitions_count: usize,
    pub has_settings: bool,
}

// ============================================================================
// Shell Aliases
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellAlias {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub order: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Alias type: "function" (default), "script", or "init"
    #[serde(default = "default_alias_type")]
    pub alias_type: String,
    /// Per-shell setup code (runs before alias definition)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup: Option<HashMap<String, String>>,
    /// Per-shell script/init content (used for "script" and "init" types)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<HashMap<String, String>>,
    /// Link to a Tool entry
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_id: Option<String>,
    /// Execution order for `cortx init` output. Aliases with this set appear first (sorted ascending). Those without appear after.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_order: Option<u32>,
}

fn default_alias_type() -> String {
    "function".to_string()
}

impl ShellAlias {
    pub fn new(name: String, command: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            command,
            description: None,
            tags: Vec::new(),
            created_at: now,
            updated_at: now,
            order: 0,
            status: None,
            alias_type: default_alias_type(),
            setup: None,
            script: None,
            tool_id: None,
            execution_order: None,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShellAliasInput {
    pub name: String,
    pub command: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub alias_type: Option<String>,
    pub setup: Option<HashMap<String, String>>,
    pub script: Option<HashMap<String, String>>,
    pub tool_id: Option<String>,
    pub execution_order: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateShellAliasInput {
    pub name: Option<String>,
    pub command: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub alias_type: Option<String>,
    pub setup: Option<HashMap<String, String>>,
    pub script: Option<HashMap<String, String>>,
    pub tool_id: Option<String>,
    pub execution_order: Option<u32>,
}

// ============================================================================
// Tools & Config Registry
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolConfigPath {
    pub label: String,
    pub path: String,
    #[serde(default)]
    pub is_directory: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replaced_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default)]
    pub config_paths: Vec<ToolConfigPath>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toolbox_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub order: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Tool {
    pub fn new(name: String, status: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            description: None,
            tags: Vec::new(),
            status,
            replaced_by: None,
            install_method: None,
            install_location: None,
            version: None,
            homepage: None,
            config_paths: Vec::new(),
            toolbox_url: None,
            notes: None,
            color: None,
            order: 0,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateToolInput {
    pub name: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub replaced_by: Option<String>,
    pub install_method: Option<String>,
    pub install_location: Option<String>,
    pub version: Option<String>,
    pub homepage: Option<String>,
    pub config_paths: Option<Vec<ToolConfigPath>>,
    pub toolbox_url: Option<String>,
    pub notes: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateToolInput {
    pub name: Option<String>,
    pub tags: Option<Vec<String>>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub replaced_by: Option<String>,
    pub install_method: Option<String>,
    pub install_location: Option<String>,
    pub version: Option<String>,
    pub homepage: Option<String>,
    pub config_paths: Option<Vec<ToolConfigPath>>,
    pub toolbox_url: Option<String>,
    pub notes: Option<String>,
    pub color: Option<String>,
}

// ============================================================================
// Status Definitions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusDefinition {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStatusDefinitionInput {
    pub name: String,
    pub color: Option<String>,
    pub order: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusDefinitionInput {
    pub name: Option<String>,
    pub color: Option<String>,
    pub order: Option<u32>,
}

// ============================================================================
// Apps (GUI Applications)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct App {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_args: Option<String>,
    #[serde(default)]
    pub config_paths: Vec<ToolConfigPath>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toolbox_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub order: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl App {
    pub fn new(name: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            description: None,
            tags: Vec::new(),
            status: None,
            version: None,
            homepage: None,
            executable_path: None,
            launch_args: None,
            config_paths: Vec::new(),
            toolbox_url: None,
            notes: None,
            color: None,
            order: 0,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAppInput {
    pub name: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub version: Option<String>,
    pub homepage: Option<String>,
    pub executable_path: Option<String>,
    pub launch_args: Option<String>,
    pub config_paths: Option<Vec<ToolConfigPath>>,
    pub toolbox_url: Option<String>,
    pub notes: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAppInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub version: Option<String>,
    pub homepage: Option<String>,
    pub executable_path: Option<String>,
    pub launch_args: Option<String>,
    pub config_paths: Option<Vec<ToolConfigPath>>,
    pub toolbox_url: Option<String>,
    pub notes: Option<String>,
    pub color: Option<String>,
}
