use rmcp::schemars;
use serde::Deserialize;
use std::collections::HashMap;

// ============================================================================
// Shared enums
// ============================================================================

/// Execution mode for script groups
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionMode {
    /// Launch all scripts at the same time
    Parallel,
    /// Launch scripts one by one, waiting for each to finish
    Sequential,
}

// ============================================================================
// Shared types
// ============================================================================

/// A configuration file or directory path associated with a tool or app.
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
pub struct ConfigPath {
    #[schemars(description = "Display label (e.g. 'config', 'profile', 'data dir')")]
    pub label: String,
    #[schemars(description = "Absolute path to the file or directory")]
    pub path: String,
    #[schemars(description = "True if this path is a directory, false if it's a file (default: false)")]
    #[serde(default)]
    pub is_directory: bool,
}

impl From<ConfigPath> for cortx_core::models::ToolConfigPath {
    fn from(cp: ConfigPath) -> Self {
        cortx_core::models::ToolConfigPath {
            label: cp.label,
            path: cp.path,
            is_directory: cp.is_directory,
        }
    }
}

// ============================================================================
// Global Scripts
// ============================================================================

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListGlobalScriptsParams {
    #[schemars(description = "Filter scripts by tag name (case-insensitive match)")]
    pub tag: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetGlobalScriptParams {
    #[schemars(description = "Script UUID. Provide either 'id' or 'name'.")]
    pub id: Option<String>,
    #[schemars(
        description = "Script name (case-insensitive). Used when 'id' is not provided."
    )]
    pub name: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateGlobalScriptParams {
    #[schemars(description = "Display name for the script")]
    pub name: String,
    #[schemars(
        description = "Shell command to execute. Use {{SCRIPT_FILE}} as a placeholder that gets replaced by 'script_path'. Examples: 'python {{SCRIPT_FILE}}', 'npm run build', 'cargo test'"
    )]
    pub command: String,
    #[schemars(description = "Human-readable description of what the script does")]
    pub description: Option<String>,
    #[schemars(
        description = "Absolute path to script file. Replaces {{SCRIPT_FILE}} placeholder in 'command'."
    )]
    pub script_path: Option<String>,
    #[schemars(
        description = "Working directory for execution (absolute path). Defaults to current directory if omitted."
    )]
    pub working_dir: Option<String>,
    #[schemars(description = "Display color as hex string (e.g. '#ff5733')")]
    pub color: Option<String>,
    #[schemars(description = "Tags for categorization (e.g. ['devops', 'python'])")]
    pub tags: Option<Vec<String>>,
    #[schemars(
        description = "Environment variables injected at runtime (e.g. {\"NODE_ENV\": \"production\"})"
    )]
    pub env_vars: Option<HashMap<String, String>>,
    #[schemars(description = "Status label (e.g. 'Active', 'WIP', 'Deprecated')")]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateGlobalScriptParams {
    #[schemars(description = "Script UUID to update")]
    pub id: String,
    #[schemars(description = "New display name")]
    pub name: Option<String>,
    #[schemars(description = "New description")]
    pub description: Option<String>,
    #[schemars(description = "New command (see create_global_script for format)")]
    pub command: Option<String>,
    #[schemars(description = "New script file path")]
    pub script_path: Option<String>,
    #[schemars(description = "New working directory (absolute path)")]
    pub working_dir: Option<String>,
    #[schemars(description = "New display color as hex string")]
    pub color: Option<String>,
    #[schemars(description = "Replace all tags")]
    pub tags: Option<Vec<String>>,
    #[schemars(description = "UUID of the default parameter preset to use")]
    pub default_preset_id: Option<String>,
    #[schemars(description = "Replace environment variables")]
    pub env_vars: Option<HashMap<String, String>>,
    #[schemars(description = "New status label")]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteGlobalScriptParams {
    #[schemars(description = "Script UUID to delete")]
    pub id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RunGlobalScriptParams {
    #[schemars(description = "Script UUID to run")]
    pub id: String,
    #[schemars(
        description = "Parameter values as {param_name: value}. Overrides preset values. Use get_global_script to see available parameters."
    )]
    pub parameter_values: Option<HashMap<String, String>>,
    #[schemars(
        description = "Preset UUID to use for parameter values. Ignored if 'parameter_values' is provided. Falls back to the script's default preset if omitted."
    )]
    pub preset_id: Option<String>,
    #[schemars(description = "Extra arguments appended after all parameters")]
    pub extra_args: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct StopGlobalScriptParams {
    #[schemars(description = "Script UUID of the running script to stop")]
    pub id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DetectScriptParametersParams {
    #[schemars(
        description = "Base command to run --help on (e.g. 'python myscript.py', 'cargo'). The tool appends --help automatically."
    )]
    pub command: String,
}

// ============================================================================
// Projects
// ============================================================================

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListProjectsParams {
    #[schemars(description = "Filter projects by tag name (case-insensitive match)")]
    pub tag: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetProjectParams {
    #[schemars(description = "Project UUID")]
    pub id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateProjectParams {
    #[schemars(description = "Project display name")]
    pub name: String,
    #[schemars(description = "Absolute path to the project root directory (e.g. 'C:/Projects/my-app')")]
    pub root_path: String,
    #[schemars(description = "Human-readable project description")]
    pub description: Option<String>,
    #[schemars(description = "Path to a project icon or image file")]
    pub image_path: Option<String>,
    #[schemars(description = "Tags for categorization")]
    pub tags: Option<Vec<String>>,
    #[schemars(description = "Status label (e.g. 'Active', 'WIP', 'Deprecated')")]
    pub status: Option<String>,
    #[schemars(description = "Toolbox documentation page URL")]
    pub toolbox_url: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateProjectParams {
    #[schemars(description = "Project UUID to update")]
    pub id: String,
    pub name: Option<String>,
    pub root_path: Option<String>,
    pub description: Option<String>,
    pub image_path: Option<String>,
    #[schemars(description = "Replace all tags")]
    pub tags: Option<Vec<String>>,
    #[schemars(description = "New status label")]
    pub status: Option<String>,
    #[schemars(description = "New toolbox documentation URL")]
    pub toolbox_url: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteProjectParams {
    #[schemars(description = "Project UUID to delete")]
    pub id: String,
}

// ============================================================================
// Services
// ============================================================================

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AddServiceParams {
    #[schemars(description = "Project UUID to add the service to")]
    pub project_id: String,
    #[schemars(description = "Service display name")]
    pub name: String,
    #[schemars(description = "Working directory (absolute path)")]
    pub working_dir: String,
    #[schemars(description = "Base command to start the service (e.g. 'npm run dev', 'docker compose up')")]
    pub command: String,
    #[schemars(
        description = "Named modes as {mode_name: command_suffix}. The suffix is appended to the base command. Example: {\"dev\": \"--watch\", \"prod\": \"--release\"}"
    )]
    pub modes: Option<HashMap<String, String>>,
    #[schemars(description = "Default mode name to use when starting without specifying a mode")]
    pub default_mode: Option<String>,
    #[schemars(description = "Extra arguments always appended to the command")]
    pub extra_args: Option<String>,
    #[schemars(
        description = "Named argument presets as {preset_name: args_string}. Example: {\"verbose\": \"--verbose --log-level debug\"}"
    )]
    pub arg_presets: Option<HashMap<String, String>>,
    #[schemars(description = "Default arg preset name")]
    pub default_arg_preset: Option<String>,
    #[schemars(description = "Display color as hex string (e.g. '#10b981')")]
    pub color: Option<String>,
    #[schemars(description = "Port number the service listens on (for display purposes)")]
    pub port: Option<u16>,
    #[schemars(description = "Environment variables injected at runtime")]
    pub env_vars: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateServiceParams {
    #[schemars(description = "Service UUID to update")]
    pub service_id: String,
    pub name: Option<String>,
    pub working_dir: Option<String>,
    pub command: Option<String>,
    #[schemars(description = "Replace all modes")]
    pub modes: Option<HashMap<String, String>>,
    pub default_mode: Option<String>,
    pub extra_args: Option<String>,
    #[schemars(description = "Replace all arg presets")]
    pub arg_presets: Option<HashMap<String, String>>,
    pub default_arg_preset: Option<String>,
    pub color: Option<String>,
    pub port: Option<u16>,
    #[schemars(description = "Replace environment variables")]
    pub env_vars: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteServiceParams {
    #[schemars(description = "Service UUID to delete")]
    pub service_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct StartServiceParams {
    #[schemars(description = "Service UUID to start. Use get_project to see available services.")]
    pub service_id: String,
    #[schemars(
        description = "Mode name to activate (appends mode's command suffix). Falls back to the service's default_mode if omitted."
    )]
    pub mode: Option<String>,
    #[schemars(
        description = "Arg preset name to use. Falls back to the service's default_arg_preset if omitted."
    )]
    pub arg_preset: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct StopServiceParams {
    #[schemars(description = "Service UUID of the running service to stop")]
    pub service_id: String,
}

// ============================================================================
// Project Scripts
// ============================================================================

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AddProjectScriptParams {
    #[schemars(description = "Project UUID to add the script to")]
    pub project_id: String,
    #[schemars(description = "Script display name")]
    pub name: String,
    #[schemars(description = "Shell command to execute")]
    pub command: String,
    #[schemars(description = "Working directory (absolute path)")]
    pub working_dir: String,
    #[schemars(description = "Human-readable description")]
    pub description: Option<String>,
    #[schemars(description = "Path to script file")]
    pub script_path: Option<String>,
    #[schemars(description = "Display color as hex string")]
    pub color: Option<String>,
    #[schemars(
        description = "UUIDs of services this script depends on (informational linking)"
    )]
    pub linked_service_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateProjectScriptParams {
    #[schemars(description = "Script UUID to update")]
    pub script_id: String,
    pub name: Option<String>,
    pub command: Option<String>,
    pub working_dir: Option<String>,
    pub description: Option<String>,
    pub script_path: Option<String>,
    pub color: Option<String>,
    pub linked_service_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteProjectScriptParams {
    #[schemars(description = "Script UUID to delete")]
    pub script_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RunProjectScriptParams {
    #[schemars(description = "Script UUID to run. Use get_project to see available scripts.")]
    pub script_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct StopProjectScriptParams {
    #[schemars(description = "Script UUID of the running script to stop")]
    pub script_id: String,
}

// ============================================================================
// Script Groups
// ============================================================================

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateScriptGroupParams {
    #[schemars(description = "Group display name")]
    pub name: String,
    #[schemars(
        description = "How to run the scripts: 'parallel' launches all at once, 'sequential' runs one after another"
    )]
    pub execution_mode: ExecutionMode,
    #[schemars(description = "Human-readable description")]
    pub description: Option<String>,
    #[schemars(description = "Ordered list of global script UUIDs to include in the group")]
    pub script_ids: Vec<String>,
    #[schemars(
        description = "In sequential mode, stop executing remaining scripts if one fails (default: true)"
    )]
    pub stop_on_failure: Option<bool>,
    #[schemars(description = "Tags for categorization")]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateScriptGroupParams {
    #[schemars(description = "Group UUID to update")]
    pub id: String,
    pub name: Option<String>,
    pub execution_mode: Option<ExecutionMode>,
    pub description: Option<String>,
    #[schemars(description = "Replace the script list")]
    pub script_ids: Option<Vec<String>>,
    pub stop_on_failure: Option<bool>,
    #[schemars(description = "Replace all tags")]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteScriptGroupParams {
    #[schemars(description = "Group UUID to delete")]
    pub id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RunScriptGroupParams {
    #[schemars(description = "Group UUID to run. Use list_script_groups to see available groups.")]
    pub id: String,
}

// ============================================================================
// Tags
// ============================================================================

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateTagDefinitionParams {
    #[schemars(description = "Tag name — must be unique (case-insensitive)")]
    pub name: String,
    #[schemars(description = "Display color as hex string (e.g. '#3b82f6')")]
    pub color: Option<String>,
    #[schemars(description = "Sort order — lower values appear first (default: appended at end)")]
    pub order: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateTagDefinitionParams {
    #[schemars(description = "Current tag name to look up")]
    pub name: String,
    #[schemars(description = "New tag name (renames the tag)")]
    pub new_name: Option<String>,
    #[schemars(description = "New display color as hex string")]
    pub color: Option<String>,
    #[schemars(description = "New sort order")]
    pub order: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteTagDefinitionParams {
    #[schemars(description = "Tag name to delete (case-insensitive)")]
    pub name: String,
}

// ============================================================================
// Tools Registry
// ============================================================================

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListToolsParams {
    #[schemars(description = "Filter by tag name (case-insensitive)")]
    pub tag: Option<String>,
    #[schemars(
        description = "Filter by status string (e.g. 'Active', 'Deprecated', 'Replaced')"
    )]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetToolInfoParams {
    #[schemars(description = "Tool UUID")]
    pub id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateToolParams {
    #[schemars(description = "Tool name (e.g. 'ripgrep', 'Docker Desktop')")]
    pub name: String,
    #[schemars(description = "What the tool does")]
    pub description: Option<String>,
    #[schemars(description = "Tags for categorization (e.g. ['cli', 'search'])")]
    pub tags: Option<Vec<String>>,
    #[schemars(
        description = "Current status (default: 'Active'). Common values: 'Active', 'Deprecated', 'Replaced', 'Evaluating'"
    )]
    pub status: Option<String>,
    #[schemars(description = "Name of the replacement tool if status is 'replaced'")]
    pub replaced_by: Option<String>,
    #[schemars(description = "How it was installed (e.g. 'scoop', 'chocolatey', 'manual', 'winget')")]
    pub install_method: Option<String>,
    #[schemars(description = "Installation directory path")]
    pub install_location: Option<String>,
    #[schemars(description = "Installed version string")]
    pub version: Option<String>,
    #[schemars(description = "Homepage or documentation URL")]
    pub homepage: Option<String>,
    #[schemars(description = "Configuration file/directory paths (e.g. config files, data dirs)")]
    pub config_paths: Option<Vec<ConfigPath>>,
    #[schemars(description = "Toolbox documentation page URL")]
    pub toolbox_url: Option<String>,
    #[schemars(description = "Free-form notes")]
    pub notes: Option<String>,
    #[schemars(description = "Display color as hex string")]
    pub color: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateToolParams {
    #[schemars(description = "Tool UUID to update")]
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    #[schemars(description = "Replace all tags")]
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub replaced_by: Option<String>,
    pub install_method: Option<String>,
    pub install_location: Option<String>,
    pub version: Option<String>,
    pub homepage: Option<String>,
    #[schemars(description = "Replace configuration file/directory paths")]
    pub config_paths: Option<Vec<ConfigPath>>,
    pub toolbox_url: Option<String>,
    pub notes: Option<String>,
    pub color: Option<String>,
}

// ============================================================================
// Process Management
// ============================================================================

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetProcessStatusParams {
    #[schemars(
        description = "UUID of the script or service whose process status to check"
    )]
    pub id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetProcessLogsParams {
    #[schemars(description = "UUID of the script or service whose logs to retrieve")]
    pub id: String,
    #[schemars(description = "Number of most recent log lines to return (default: 100, max: 500)")]
    pub tail: Option<usize>,
}

// ============================================================================
// Execution History
// ============================================================================

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetExecutionHistoryParams {
    #[schemars(description = "Global script UUID")]
    pub script_id: String,
    #[schemars(description = "Maximum number of history records to return (default: 20)")]
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ClearExecutionHistoryParams {
    #[schemars(description = "Global script UUID whose history will be cleared")]
    pub script_id: String,
}

// ============================================================================
// Discovery
// ============================================================================

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ScanScriptsFolderParams {
    #[schemars(
        description = "Absolute path to folder to scan for script files. If omitted, uses the configured main scripts folder from settings."
    )]
    pub folder: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DiscoverEnvFilesParams {
    #[schemars(
        description = "Project UUID — the project's root_path will be scanned for .env* files"
    )]
    pub project_id: String,
}

// ============================================================================
// Settings
// ============================================================================

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateSettingsParams {
    #[schemars(
        description = "Complete settings JSON object. Call get_settings first to retrieve the current structure, modify the fields you need, and pass the full object back."
    )]
    pub settings: serde_json::Value,
}

// ============================================================================
// Shell Aliases
// ============================================================================

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListAliasesParams {
    #[schemars(description = "Filter aliases by tag name (case-insensitive match)")]
    pub tag: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetAliasParams {
    #[schemars(description = "Alias UUID. Provide either 'id' or 'name'.")]
    pub id: Option<String>,
    #[schemars(description = "Alias name (case-insensitive). Used when 'id' is not provided.")]
    pub name: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateAliasParams {
    #[schemars(description = "Alias name — the shortcut you type in your shell (e.g. 'cc', 'gp'). Only alphanumeric, hyphens, underscores allowed. No spaces.")]
    pub name: String,
    #[schemars(description = "Command the alias expands to (e.g. 'claude --dangerously-skip-permissions', 'git push'). Required for 'function' type, ignored for 'script'/'init'.")]
    pub command: String,
    #[schemars(description = "Human-readable description of what the alias does")]
    pub description: Option<String>,
    #[schemars(description = "Tags for categorization")]
    pub tags: Option<Vec<String>>,
    #[schemars(description = "Status label (e.g. 'Active', 'WIP', 'Deprecated')")]
    pub status: Option<String>,
    #[schemars(description = "Alias type: 'function' (default, wraps command as shell function), 'script' (raw per-shell code), 'init' (eval command output, e.g. zoxide init)")]
    pub alias_type: Option<String>,
    #[schemars(description = "Per-shell setup code that runs before the alias definition. Keys: 'powershell', 'bash', 'zsh', 'fish'. Example: {\"powershell\": \"Remove-Alias ls -Force -ErrorAction SilentlyContinue\"}")]
    pub setup: Option<HashMap<String, String>>,
    #[schemars(description = "Per-shell script/init content. For 'script' type: raw code injected as-is. For 'init' type: command whose output is eval'd. Keys: 'powershell', 'bash', 'zsh', 'fish'.")]
    pub script: Option<HashMap<String, String>>,
    #[schemars(description = "UUID of a Tool entry to link this alias to")]
    pub tool_id: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateAliasParams {
    #[schemars(description = "Alias UUID to update")]
    pub id: String,
    #[schemars(description = "New alias name")]
    pub name: Option<String>,
    #[schemars(description = "New command")]
    pub command: Option<String>,
    #[schemars(description = "New description")]
    pub description: Option<String>,
    #[schemars(description = "Replace all tags")]
    pub tags: Option<Vec<String>>,
    #[schemars(description = "New status label")]
    pub status: Option<String>,
    #[schemars(description = "New alias type: 'function', 'script', or 'init'")]
    pub alias_type: Option<String>,
    #[schemars(description = "Replace per-shell setup code. Keys: 'powershell', 'bash', 'zsh', 'fish'.")]
    pub setup: Option<HashMap<String, String>>,
    #[schemars(description = "Replace per-shell script/init content. Keys: 'powershell', 'bash', 'zsh', 'fish'.")]
    pub script: Option<HashMap<String, String>>,
    #[schemars(description = "UUID of a Tool entry to link (empty string to unlink)")]
    pub tool_id: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteAliasParams {
    #[schemars(description = "Alias UUID to delete")]
    pub id: String,
}

// ============================================================================
// Status Definitions
// ============================================================================

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateStatusDefinitionParams {
    #[schemars(description = "Status name — must be unique (case-insensitive). E.g. 'Active', 'WIP', 'Deprecated'")]
    pub name: String,
    #[schemars(description = "Display color as hex string (e.g. '#22c55e')")]
    pub color: Option<String>,
    #[schemars(description = "Sort order — lower values appear first")]
    pub order: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateStatusDefinitionParams {
    #[schemars(description = "Current status name to look up")]
    pub name: String,
    #[schemars(description = "New status name (renames the status)")]
    pub new_name: Option<String>,
    #[schemars(description = "New display color as hex string")]
    pub color: Option<String>,
    #[schemars(description = "New sort order")]
    pub order: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteStatusDefinitionParams {
    #[schemars(description = "Status name to delete (case-insensitive)")]
    pub name: String,
}

// ============================================================================
// Apps (GUI Applications)
// ============================================================================

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListAppsParams {
    #[schemars(description = "Filter by tag name (case-insensitive)")]
    pub tag: Option<String>,
    #[schemars(description = "Filter by status string")]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetAppParams {
    #[schemars(description = "App UUID")]
    pub id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateAppParams {
    #[schemars(description = "App name (e.g. 'Blender', 'OBS Studio')")]
    pub name: String,
    #[schemars(description = "What the app does")]
    pub description: Option<String>,
    #[schemars(description = "Tags for categorization")]
    pub tags: Option<Vec<String>>,
    #[schemars(description = "Status label (e.g. 'Active', 'WIP')")]
    pub status: Option<String>,
    #[schemars(description = "Installed version string")]
    pub version: Option<String>,
    #[schemars(description = "Homepage or documentation URL")]
    pub homepage: Option<String>,
    #[schemars(description = "Absolute path to the application executable")]
    pub executable_path: Option<String>,
    #[schemars(description = "Command-line arguments to pass when launching")]
    pub launch_args: Option<String>,
    #[schemars(description = "Configuration file/directory paths")]
    pub config_paths: Option<Vec<ConfigPath>>,
    #[schemars(description = "Toolbox documentation page URL")]
    pub toolbox_url: Option<String>,
    #[schemars(description = "Free-form notes")]
    pub notes: Option<String>,
    #[schemars(description = "Display color as hex string")]
    pub color: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateAppParams {
    #[schemars(description = "App UUID to update")]
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    #[schemars(description = "Replace all tags")]
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub version: Option<String>,
    pub homepage: Option<String>,
    pub executable_path: Option<String>,
    pub launch_args: Option<String>,
    #[schemars(description = "Replace configuration file/directory paths")]
    pub config_paths: Option<Vec<ConfigPath>>,
    pub toolbox_url: Option<String>,
    pub notes: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteAppParams {
    #[schemars(description = "App UUID to delete")]
    pub id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct LaunchAppParams {
    #[schemars(description = "App UUID to launch")]
    pub id: String,
}
