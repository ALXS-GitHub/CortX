use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub name: String,
    pub working_dir: String,
    pub command: String,
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
            color: None,
            port: None,
            env_vars: None,
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
        }
    }
}

/// Predefined terminal presets with known configurations
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TerminalPreset {
    /// Windows Terminal (wt.exe)
    WindowsTerminal,
    /// PowerShell
    PowerShell,
    /// Command Prompt (cmd.exe)
    Cmd,
    /// Warp Terminal
    Warp,
    /// macOS Terminal.app
    MacTerminal,
    /// iTerm2
    ITerm2,
    /// Custom terminal with user-specified path and arguments
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
    /// The selected terminal preset
    pub preset: TerminalPreset,
    /// Custom executable path (only used when preset is Custom)
    #[serde(default)]
    pub custom_path: String,
    /// Custom arguments (only used when preset is Custom)
    /// Supports placeholders: {dir}, {command}, {full_command}
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
}

// Input types for commands

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    pub root_path: String,
    pub description: Option<String>,
    pub image_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub root_path: Option<String>,
    pub description: Option<String>,
    pub image_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateServiceInput {
    pub name: String,
    pub working_dir: String,
    pub command: String,
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
    pub color: Option<String>,
    pub port: Option<u16>,
    pub env_vars: Option<HashMap<String, String>>,
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

// Event payloads for Tauri events

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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceExitPayload {
    pub service_id: String,
    pub exit_code: Option<i32>,
}
