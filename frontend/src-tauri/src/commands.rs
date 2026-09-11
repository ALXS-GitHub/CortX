use crate::models::{
    AddEnvFileInput, App, AppSettings, CreateAppInput, CreateGlobalScriptInput,
    CreateProjectInput, CreateScriptInput, CreateServiceInput,
    CreateShellAliasInput, CreateStatusDefinitionInput, CreateToolInput, CreateTagDefinitionInput,
    DiscoverEnvFilesInput, DiscoveredTool, EnvComparison, EnvFile, EnvFileVariant, EnvVariable,
    DiscoveredScript, ExecutionRecord, ExportSummary, GlobalScript, ImportOptions, ImportResult,
    LinkEnvToServiceInput, Project, Script,
    ScriptParameter, ScriptsConfig, Service, ShellAlias, StatusDefinition, TagDefinition, Tool,
    UpdateAppInput, UpdateTagDefinitionInput, UpdateGlobalScriptInput, UpdateProjectInput,
    UpdateScriptInput, UpdateServiceInput, UpdateShellAliasInput,
    UpdateStatusDefinitionInput, UpdateToolInput,
};
use crate::models::{opt_text, opt_text_patch};
use crate::process_manager::{ProcessEventEmitter, ProcessManager};
use crate::storage::Storage;
use crate::tauri_emitter::TauriEmitter;
use chrono::Utc;
use cortx_core::agents::{
    launch as agent_launch, AgentAnnotations, AgentIndex, AgentSession, AgentTranscriptPage,
    AgentTranscriptQuery, AgentsHealth, ListAgentSessionsOptions,
};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

pub struct AppState {
    pub storage: Arc<Storage>,
    pub process_manager: Arc<ProcessManager>,
    /// Agents section (DEV-11): discovered Claude Code / Codex sessions.
    pub agents: Arc<AgentIndex>,
    /// Set to true to opt out of "close = hide-to-tray" and run the real
    /// quit cleanup flow when the next CloseRequested event fires.
    pub quitting: Arc<std::sync::atomic::AtomicBool>,
    /// Terminal layout shared between the main window's dock and the
    /// Terminal window (DEV-13 P1). See `cortx_core::terminal::layout`.
    pub terminal_layout: Arc<cortx_core::terminal::LayoutStore>,
    /// Project scope requested for a Terminal window being created; the
    /// window takes it once on boot (`take_terminal_window_scope`).
    pub terminal_window_scope: std::sync::Mutex<Option<String>>,
    /// Launch configuration (`cortx terminal --layout <name>`) to run once
    /// the Terminal window is up (`take_terminal_window_launch`).
    pub terminal_window_launch: std::sync::Mutex<Option<String>>,
    /// `data/terminal/launch/*.yaml` (DEV-13 P2).
    pub launch_configs: Arc<cortx_core::terminal::LaunchStore>,
}

// Project commands

#[tauri::command]
pub fn get_all_projects(state: State<AppState>) -> Result<Vec<Project>, String> {
    Ok(state.storage.get_all_projects())
}

#[tauri::command]
pub fn get_project(state: State<AppState>, id: String) -> Result<Project, String> {
    state
        .storage
        .get_project(&id)
        .ok_or_else(|| format!("Project not found: {}", id))
}

#[tauri::command]
pub fn create_project(state: State<AppState>, input: CreateProjectInput) -> Result<Project, String> {
    // Validate path exists
    if !Path::new(&input.root_path).exists() {
        return Err(format!("Path does not exist: {}", input.root_path));
    }

    let mut project = Project::new(input.name, input.root_path);
    project.description = input.description;
    project.image_path = input.image_path;
    project.tags = input.tags;
    project.status = opt_text(input.status);
    project.toolbox_url = input.toolbox_url;

    state
        .storage
        .create_project(project)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_project(
    state: State<AppState>,
    id: String,
    input: UpdateProjectInput,
) -> Result<Project, String> {
    // Validate path if provided
    if let Some(ref path) = input.root_path {
        if !Path::new(path).exists() {
            return Err(format!("Path does not exist: {}", path));
        }
    }

    state
        .storage
        .update_project(&id, |project| {
            if let Some(name) = input.name {
                project.name = name;
            }
            if let Some(root_path) = input.root_path {
                project.root_path = root_path;
            }
            if input.description.is_some() {
                project.description = input.description;
            }
            if input.image_path.is_some() {
                project.image_path = input.image_path;
            }
            if let Some(tags) = input.tags {
                project.tags = tags;
            }
            if let Some(status) = opt_text_patch(input.status) {
                project.status = status;
            }
            if input.toolbox_url.is_some() {
                project.toolbox_url = input.toolbox_url;
            }
            if let Some(favorite) = input.favorite {
                project.favorite = favorite;
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_project(app_handle: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    // Stop any running services for this project
    let emitter = TauriEmitter::new(app_handle);
    if let Some(project) = state.storage.get_project(&id) {
        for service in &project.services {
            let _ = state.process_manager.stop_service(&emitter, &service.id);
        }
    }

    state.storage.delete_project(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_project_last_opened(state: State<AppState>, id: String) -> Result<(), String> {
    state
        .storage
        .update_project(&id, |project| {
            project.last_opened_at = Some(Utc::now());
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Service commands

#[tauri::command]
pub fn add_service(
    state: State<AppState>,
    project_id: String,
    input: CreateServiceInput,
) -> Result<Service, String> {
    let mut service = Service::new(input.name, input.working_dir, input.command);
    service.modes = input.modes;
    service.default_mode = input.default_mode;
    service.extra_args = input.extra_args;
    service.arg_presets = input.arg_presets;
    service.default_arg_preset = input.default_arg_preset;
    service.color = input.color;
    service.port = input.port;
    service.env_vars = input.env_vars;

    // Set order to be last
    if let Some(project) = state.storage.get_project(&project_id) {
        service.order = project.services.len() as u32;
    }

    state
        .storage
        .add_service(&project_id, service)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_service(
    state: State<AppState>,
    service_id: String,
    input: UpdateServiceInput,
) -> Result<Service, String> {
    state
        .storage
        .update_service(&service_id, |service| {
            if let Some(name) = input.name {
                service.name = name;
            }
            if let Some(working_dir) = input.working_dir {
                service.working_dir = working_dir;
            }
            if let Some(command) = input.command {
                service.command = command;
            }
            // Always update modes and default_mode to allow clearing them
            // The frontend sends these fields on every update
            service.modes = input.modes;
            service.default_mode = input.default_mode;
            // Same for arg presets - always update to allow clearing
            service.extra_args = input.extra_args;
            service.arg_presets = input.arg_presets;
            service.default_arg_preset = input.default_arg_preset;
            // Always assign so the user can clear these fields by submitting them empty.
            service.color = input.color;
            service.port = input.port;
            service.env_vars = input.env_vars;
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_service(app_handle: AppHandle, state: State<AppState>, service_id: String) -> Result<(), String> {
    // Stop if running
    let emitter = TauriEmitter::new(app_handle);
    let _ = state.process_manager.stop_service(&emitter, &service_id);

    state
        .storage
        .delete_service(&service_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_services(
    state: State<AppState>,
    project_id: String,
    service_ids: Vec<String>,
) -> Result<(), String> {
    state
        .storage
        .update_project(&project_id, |project| {
            for (order, id) in service_ids.iter().enumerate() {
                if let Some(service) = project.services.iter_mut().find(|s| &s.id == id) {
                    service.order = order as u32;
                }
            }
            project.services.sort_by_key(|s| s.order);
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Script commands

#[tauri::command]
pub fn add_script(
    state: State<AppState>,
    project_id: String,
    input: CreateScriptInput,
) -> Result<Script, String> {
    let mut script = Script::new(input.name, input.working_dir, input.command);
    script.description = input.description;
    script.script_path = input.script_path;
    script.color = input.color;
    script.linked_service_ids = input.linked_service_ids.unwrap_or_default();

    // Set order to be last
    if let Some(project) = state.storage.get_project(&project_id) {
        script.order = project.scripts.len() as u32;
    }

    state
        .storage
        .add_script(&project_id, script)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_script(
    state: State<AppState>,
    script_id: String,
    input: UpdateScriptInput,
) -> Result<Script, String> {
    state
        .storage
        .update_script(&script_id, |script| {
            if let Some(name) = input.name {
                script.name = name;
            }
            if input.description.is_some() {
                script.description = input.description;
            }
            if let Some(command) = input.command {
                script.command = command;
            }
            if input.script_path.is_some() {
                script.script_path = input.script_path;
            }
            if let Some(working_dir) = input.working_dir {
                script.working_dir = working_dir;
            }
            if input.color.is_some() {
                script.color = input.color;
            }
            if let Some(linked_service_ids) = input.linked_service_ids {
                script.linked_service_ids = linked_service_ids;
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_script(app_handle: AppHandle, state: State<AppState>, script_id: String) -> Result<(), String> {
    // Stop if running
    let emitter = TauriEmitter::new(app_handle);
    let _ = state.process_manager.stop_script(&emitter, &script_id);

    state
        .storage
        .delete_script(&script_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_scripts(
    state: State<AppState>,
    project_id: String,
    script_ids: Vec<String>,
) -> Result<(), String> {
    state
        .storage
        .update_project(&project_id, |project| {
            for (order, id) in script_ids.iter().enumerate() {
                if let Some(script) = project.scripts.iter_mut().find(|s| &s.id == id) {
                    script.order = order as u32;
                }
            }
            project.scripts.sort_by_key(|s| s.order);
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Launch commands

#[tauri::command]
pub fn get_launch_command(state: State<AppState>, service_id: String) -> Result<String, String> {
    let (project, service) = state
        .storage
        .get_service(&service_id)
        .ok_or_else(|| format!("Service not found: {}", service_id))?;

    let working_dir = if service.working_dir.is_empty() || service.working_dir == "." {
        project.root_path.clone()
    } else {
        let path = Path::new(&project.root_path).join(&service.working_dir);
        path.to_string_lossy().to_string()
    };

    #[cfg(target_os = "windows")]
    {
        Ok(format!("cd \"{}\" && {}", working_dir, service.command))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(format!("cd \"{}\" && {}", working_dir, service.command))
    }
}

#[tauri::command]
pub async fn launch_external_terminal(
    _app_handle: AppHandle,
    state: State<'_, AppState>,
    service_id: String,
) -> Result<(), String> {
    let (project, service) = state
        .storage
        .get_service(&service_id)
        .ok_or_else(|| format!("Service not found: {}", service_id))?;

    let settings = state.storage.get_settings();

    let working_dir = if service.working_dir.is_empty() || service.working_dir == "." {
        project.root_path.clone()
    } else {
        let path = Path::new(&project.root_path).join(&service.working_dir);
        path.to_string_lossy().to_string()
    };

    spawn_in_terminal(&settings, &working_dir, &service.command)
}

/// Open the configured external terminal (Settings > Terminal preset) in
/// `working_dir` and run `command` there. Shared by services and the Agents
/// section (`resume_agent_session`).
pub(crate) fn spawn_in_terminal(
    settings: &AppSettings,
    working_dir: &str,
    command: &str,
) -> Result<(), String> {
    use crate::models::TerminalPreset;

    let working_dir = working_dir.to_string();
    let command = command.to_string();

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x00000010;

        match settings.terminal.preset {
            TerminalPreset::CortxTerminal => {
                return Err("The CortX Terminal preset runs services inside CortX; use the integrated launch".to_string());
            }
            TerminalPreset::WindowsTerminal => {
                // Windows Terminal - use -d for directory and pass the command
                std::process::Command::new("wt.exe")
                    .args(["-d", &working_dir, "cmd", "/k", &command])
                    .spawn()
                    .map_err(|e| format!("Failed to launch Windows Terminal: {}", e))?;
            }
            TerminalPreset::PowerShell => {
                // PowerShell - needs CREATE_NEW_CONSOLE to show window
                let ps_command = format!(
                    "Set-Location '{}'; {}",
                    working_dir.replace("'", "''"),
                    command
                );
                std::process::Command::new("powershell.exe")
                    .args(["-NoExit", "-Command", &ps_command])
                    .creation_flags(CREATE_NEW_CONSOLE)
                    .spawn()
                    .map_err(|e| format!("Failed to launch PowerShell: {}", e))?;
            }
            TerminalPreset::Cmd => {
                // cmd.exe - needs CREATE_NEW_CONSOLE to show window
                let cmd_str = format!("cd /d \"{}\" && {}", working_dir, command);
                std::process::Command::new("cmd.exe")
                    .args(["/k", &cmd_str])
                    .creation_flags(CREATE_NEW_CONSOLE)
                    .spawn()
                    .map_err(|e| format!("Failed to launch Command Prompt: {}", e))?;
            }
            TerminalPreset::Warp => {
                // Warp uses URI scheme for opening with a specific path
                // warp://action/new_window?path=<path>
                let uri = format!("warp://action/new_window?path={}", urlencoding(&working_dir));
                std::process::Command::new("cmd")
                    .args(["/c", "start", "", &uri])
                    .creation_flags(0x08000000) // CREATE_NO_WINDOW for cmd wrapper
                    .spawn()
                    .map_err(|e| format!("Failed to launch Warp: {}", e))?;
            }
            TerminalPreset::Custom => {
                // Custom terminal with user-specified path and arguments
                if settings.terminal.custom_path.is_empty() {
                    return Err("Custom terminal path is not configured".to_string());
                }

                let full_command = format!("cd /d \"{}\" && {}", working_dir, command);
                let mut cmd = std::process::Command::new(&settings.terminal.custom_path);

                if settings.terminal.custom_args.is_empty() {
                    cmd.current_dir(&working_dir);
                } else {
                    for arg in &settings.terminal.custom_args {
                        let replaced = arg
                            .replace("{command}", &command)
                            .replace("{dir}", &working_dir)
                            .replace("{full_command}", &full_command);
                        cmd.arg(replaced);
                    }
                }

                cmd.creation_flags(CREATE_NEW_CONSOLE)
                    .spawn()
                    .map_err(|e| format!("Failed to launch custom terminal: {}", e))?;
            }
            // macOS presets on Windows - fallback to Windows Terminal
            TerminalPreset::MacTerminal | TerminalPreset::ITerm2 => {
                std::process::Command::new("wt.exe")
                    .args(["-d", &working_dir, "cmd", "/k", &command])
                    .spawn()
                    .map_err(|e| format!("Failed to launch Windows Terminal: {}", e))?;
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        match settings.terminal.preset {
            TerminalPreset::CortxTerminal => {
                return Err("The CortX Terminal preset runs services inside CortX; use the integrated launch".to_string());
            }
            TerminalPreset::MacTerminal => {
                let script = format!(
                    r#"tell application "Terminal"
                        activate
                        do script "cd '{}' && {}"
                    end tell"#,
                    working_dir.replace("'", "'\\''"),
                    command.replace("\"", "\\\"")
                );
                std::process::Command::new("osascript")
                    .args(["-e", &script])
                    .spawn()
                    .map_err(|e| format!("Failed to launch Terminal: {}", e))?;
            }
            TerminalPreset::ITerm2 => {
                let script = format!(
                    r#"tell application "iTerm"
                        activate
                        create window with default profile
                        tell current session of current window
                            write text "cd '{}' && {}"
                        end tell
                    end tell"#,
                    working_dir.replace("'", "'\\''"),
                    command.replace("\"", "\\\"")
                );
                std::process::Command::new("osascript")
                    .args(["-e", &script])
                    .spawn()
                    .map_err(|e| format!("Failed to launch iTerm2: {}", e))?;
            }
            TerminalPreset::Warp => {
                let script = format!(
                    r#"tell application "Warp"
                        activate
                    end tell
                    delay 0.5
                    tell application "System Events"
                        keystroke "cd '{}' && {}"
                        key code 36
                    end tell"#,
                    working_dir.replace("'", "'\\''"),
                    command.replace("\"", "\\\"")
                );
                std::process::Command::new("osascript")
                    .args(["-e", &script])
                    .spawn()
                    .map_err(|e| format!("Failed to launch Warp: {}", e))?;
            }
            TerminalPreset::Custom => {
                if settings.terminal.custom_path.is_empty() {
                    return Err("Custom terminal path is not configured".to_string());
                }
                std::process::Command::new("open")
                    .args(["-a", &settings.terminal.custom_path])
                    .current_dir(&working_dir)
                    .spawn()
                    .map_err(|e| format!("Failed to launch custom terminal: {}", e))?;
            }
            // Windows presets on macOS - fallback to Terminal.app
            TerminalPreset::WindowsTerminal | TerminalPreset::PowerShell | TerminalPreset::Cmd => {
                let script = format!(
                    r#"tell application "Terminal"
                        activate
                        do script "cd '{}' && {}"
                    end tell"#,
                    working_dir.replace("'", "'\\''"),
                    command.replace("\"", "\\\"")
                );
                std::process::Command::new("osascript")
                    .args(["-e", &script])
                    .spawn()
                    .map_err(|e| format!("Failed to launch Terminal: {}", e))?;
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let full_command = format!("cd \"{}\" && {}; exec $SHELL", working_dir, command);

        match settings.terminal.preset {
            TerminalPreset::CortxTerminal => {
                return Err("The CortX Terminal preset runs services inside CortX; use the integrated launch".to_string());
            }
            TerminalPreset::Custom => {
                if settings.terminal.custom_path.is_empty() {
                    // Try common terminal emulators
                    let xfce_arg = format!("bash -c '{}'", full_command);
                    let terminals = [
                        ("gnome-terminal", vec!["--", "bash", "-c", &full_command]),
                        ("konsole", vec!["-e", "bash", "-c", &full_command]),
                        ("xfce4-terminal", vec!["-e", &xfce_arg]),
                        ("alacritty", vec!["-e", "bash", "-c", &full_command]),
                        ("kitty", vec!["bash", "-c", &full_command]),
                        ("xterm", vec!["-e", "bash", "-c", &full_command]),
                    ];

                    let mut launched = false;
                    for (terminal, args) in terminals {
                        if std::process::Command::new(terminal)
                            .args(&args)
                            .spawn()
                            .is_ok()
                        {
                            launched = true;
                            break;
                        }
                    }

                    if !launched {
                        return Err("No supported terminal emulator found".to_string());
                    }
                } else {
                    let mut cmd = std::process::Command::new(&settings.terminal.custom_path);

                    if settings.terminal.custom_args.is_empty() {
                        cmd.args(["-e", "bash", "-c", &full_command]);
                    } else {
                        for arg in &settings.terminal.custom_args {
                            let replaced = arg
                                .replace("{command}", &command)
                                .replace("{dir}", &working_dir)
                                .replace("{full_command}", &full_command);
                            cmd.arg(replaced);
                        }
                    }

                    cmd.spawn()
                        .map_err(|e| format!("Failed to launch custom terminal: {}", e))?;
                }
            }
            // All presets fallback to auto-detection on Linux
            _ => {
                let xfce_arg = format!("bash -c '{}'", full_command);
                let terminals = [
                    ("gnome-terminal", vec!["--", "bash", "-c", &full_command]),
                    ("konsole", vec!["-e", "bash", "-c", &full_command]),
                    ("xfce4-terminal", vec!["-e", &xfce_arg]),
                    ("alacritty", vec!["-e", "bash", "-c", &full_command]),
                    ("kitty", vec!["bash", "-c", &full_command]),
                    ("xterm", vec!["-e", "bash", "-c", &full_command]),
                ];

                let mut launched = false;
                for (terminal, args) in terminals {
                    if std::process::Command::new(terminal)
                        .args(&args)
                        .spawn()
                        .is_ok()
                    {
                        launched = true;
                        break;
                    }
                }

                if !launched {
                    return Err("No supported terminal emulator found".to_string());
                }
            }
        }
    }

    Ok(())
}

/// Simple URL encoding for the path
#[cfg(target_os = "windows")]
fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => "%20".to_string(),
            ':' => "%3A".to_string(),
            '/' => "%2F".to_string(),
            '\\' => "%5C".to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

#[tauri::command]
pub fn start_integrated_service(
    app_handle: AppHandle,
    state: State<AppState>,
    service_id: String,
    mode: Option<String>,
    arg_preset: Option<String>,
) -> Result<u32, String> {
    let (project, service) = state
        .storage
        .get_service(&service_id)
        .ok_or_else(|| format!("Service not found: {}", service_id))?;

    let working_dir = if service.working_dir.is_empty() || service.working_dir == "." {
        project.root_path.clone()
    } else {
        let path = Path::new(&project.root_path).join(&service.working_dir);
        path.to_string_lossy().to_string()
    };

    // Resolve effective mode: explicit mode > default_mode > none
    let effective_mode = mode.or_else(|| service.default_mode.clone());

    // Resolve base command based on effective mode
    let base_command = if let Some(ref mode_name) = effective_mode {
        // Try to get command from modes map
        service
            .modes
            .as_ref()
            .and_then(|modes| modes.get(mode_name))
            .cloned()
            .ok_or_else(|| format!("Mode '{}' not found for service", mode_name))?
    } else {
        // Use default command
        service.command.clone()
    };

    // Resolve effective arg preset: explicit preset > default_arg_preset > none
    let effective_arg_preset = arg_preset.or_else(|| service.default_arg_preset.clone());

    // Get preset args if preset is specified
    let preset_args = if let Some(ref preset_name) = effective_arg_preset {
        service
            .arg_presets
            .as_ref()
            .and_then(|presets| presets.get(preset_name))
            .cloned()
    } else {
        None
    };

    // Build final command: baseCommand + extraArgs + presetArgs
    let mut final_command = base_command;

    if let Some(ref extra) = service.extra_args {
        let trimmed = extra.trim();
        if !trimmed.is_empty() {
            final_command = format!("{} {}", final_command, trimmed);
        }
    }

    if let Some(ref args) = preset_args {
        let trimmed = args.trim();
        if !trimmed.is_empty() {
            final_command = format!("{} {}", final_command, trimmed);
        }
    }

    let emitter: Arc<dyn ProcessEventEmitter> = Arc::new(TauriEmitter::new(app_handle));
    state.process_manager.start_service(
        emitter,
        service_id,
        working_dir,
        final_command,
        service.env_vars,
        effective_mode,
        effective_arg_preset,
        cortx_core::process_manager::RuntimeMeta::new(service.name.clone())
            .with_project(project.id.clone(), project.name.clone()),
    )
}

#[tauri::command]
pub fn stop_integrated_service(app_handle: AppHandle, state: State<AppState>, service_id: String) -> Result<(), String> {
    let emitter = TauriEmitter::new(app_handle);
    state.process_manager.stop_service(&emitter, &service_id)
}

#[tauri::command]
pub fn is_service_running(state: State<AppState>, service_id: String) -> bool {
    state.process_manager.is_running(&service_id)
}

#[tauri::command]
pub fn get_running_services(state: State<AppState>) -> Vec<String> {
    state.process_manager.get_running_services()
}

// Script execution commands

#[tauri::command]
pub fn run_script(
    app_handle: AppHandle,
    state: State<AppState>,
    script_id: String,
) -> Result<u32, String> {
    let (project, script) = state
        .storage
        .get_script(&script_id)
        .ok_or_else(|| format!("Script not found: {}", script_id))?;

    let working_dir = if script.working_dir.is_empty() || script.working_dir == "." {
        project.root_path.clone()
    } else {
        let path = Path::new(&project.root_path).join(&script.working_dir);
        path.to_string_lossy().to_string()
    };

    let emitter: Arc<dyn ProcessEventEmitter> = Arc::new(TauriEmitter::new(app_handle));
    state.process_manager.run_script(
        emitter,
        script_id,
        working_dir,
        script.command,
        cortx_core::process_manager::RuntimeMeta::new(script.name.clone())
            .with_project(project.id.clone(), project.name.clone()),
    )
}

#[tauri::command]
pub fn stop_script(app_handle: AppHandle, state: State<AppState>, script_id: String) -> Result<(), String> {
    let emitter = TauriEmitter::new(app_handle);
    state.process_manager.stop_script(&emitter, &script_id)
}

#[tauri::command]
pub fn is_script_running(state: State<AppState>, script_id: String) -> bool {
    state.process_manager.is_script_running(&script_id)
}

// Settings commands

/// Give the backend's per-terminal scrollback the size the user asked for
/// (#51).
///
/// `terminal.scrollbackLines` used to drive xterm.js alone, while the hub —
/// the only copy that survives a webview reload, since `attach` replays it —
/// stayed at a hard-coded 4 MB. Raising the setting therefore bought lines
/// that disappeared the moment the Terminal window was reopened. See
/// `cortx_core::terminal::scrollback_bytes_for_lines` for the budget and its
/// two bounds.
///
/// Called from both settings commands rather than from `setup`: writing them
/// is what changes the answer, and reading them is the first thing either
/// window does on boot, so the hub is in step before a terminal exists.
/// Push the two size caps the backend owns into the objects that enforce them.
///
/// Both are built before any setting has been read — `ProcessManager::new`
/// runs at startup — so they cannot take their value at construction. Called
/// from `get_settings` as well as `update_settings`: writing settings is what
/// changes the answer, but reading them is the first thing either window does,
/// so the caps are in step before a terminal exists.
fn sync_terminal_budgets(state: &AppState, settings: &AppSettings) {
    state
        .process_manager
        .terminal_hub()
        .set_max_bytes(cortx_core::terminal::scrollback_bytes_for_lines(
            settings.terminal.scrollback_lines,
        ));
    state
        .process_manager
        .command_history()
        .set_max_bytes(u64::from(settings.terminal.history_max_mb.clamp(1, 200)) * 1024 * 1024);
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> AppSettings {
    let settings = state.storage.get_settings();
    sync_terminal_budgets(&state, &settings);
    settings
}

#[tauri::command]
pub fn update_settings(state: State<AppState>, settings: AppSettings) -> Result<(), String> {
    state.agents.set_settings(settings.agents.clone());
    sync_terminal_budgets(&state, &settings);
    state
        .storage
        .update_settings(settings)
        .map_err(|e| e.to_string())
}

/// (Re-)register the global hotkey. Pass an empty string to unregister
/// (effectively disables "open palette from anywhere").
#[tauri::command]
pub fn set_global_hotkey(app: tauri::AppHandle, combo: String) -> Result<(), String> {
    crate::register_hotkey(&app, &combo)
}

/// Real quit (as opposed to the X button which now hides to tray).
/// Sets the quitting flag so the CloseRequested handler runs the cleanup
/// flow, then closes the window. The flag is checked again inside the
/// handler — see lib.rs::on_window_event.
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use tauri::Manager;
    if let Some(state) = app.try_state::<AppState>() {
        state.quitting.store(true, Ordering::SeqCst);
    }
    if let Some(w) = app.get_webview_window("main") {
        w.close().map_err(|e| e.to_string())
    } else {
        app.exit(0);
        Ok(())
    }
}

// Utility commands

#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn validate_path(path: String) -> bool {
    Path::new(&path).exists()
}

/// Launch VS Code with `args`, and fail loudly when it is not installed.
///
/// The Windows arm used to be `cmd /C code …`. `spawn` then reports on `cmd`,
/// which always starts — so a machine without `code` on its PATH got `Ok(())`,
/// a console window that blinked once, and nothing opened. A path clicked in
/// the terminal (ticket #31) looked like a dead link with no way to tell why.
/// Resolve the launcher ourselves instead: `resolve_in_path` already walks
/// PATH through PATHEXT, which is what finds the `code.cmd` shim the VS Code
/// installer actually drops. On Unix `spawn` reports NotFound by itself.
fn spawn_vscode(args: &[&str]) -> Result<(), String> {
    let not_installed =
        "VS Code was not found: no `code` on this machine's PATH. Install it, or run          \"Shell Command: Install 'code' command in PATH\" from VS Code's command palette."
            .to_string();

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let exe = cortx_core::terminal::spec::resolve_in_path("code").ok_or(not_installed)?;
        std::process::Command::new(exe)
            .args(args)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW — the .cmd shim would flash one
            .spawn()
            .map_err(|e| format!("Failed to open VS Code: {e}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("code")
            .args(args)
            .spawn()
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => not_installed,
                _ => format!("Failed to open VS Code: {e}"),
            })?;
    }

    Ok(())
}

#[tauri::command]
pub fn open_in_vscode(path: String) -> Result<(), String> {
    spawn_vscode(&[&path])
}

/// Open a file in VS Code **at a position**: `code -g <path>:<line>:<col>`.
///
/// `open_in_vscode` passes the path alone, which is all a project or a tool
/// needs. A file path clicked in a terminal usually carries the line a
/// compiler or a linter pointed at (`src/main.rs:42:7`, see `lib/terminalLinks`),
/// and landing on line 1 wastes exactly the information that made the link
/// worth clicking. Without a line this is `open_in_vscode`.
#[tauri::command]
pub fn open_in_editor(path: String, line: Option<u32>, column: Option<u32>) -> Result<(), String> {
    let Some(line) = line else {
        return open_in_vscode(path);
    };
    // `-g` takes one `path:line[:col]` argument; the path may hold spaces, and
    // `spawn` passes each arg through without a shell, so no quoting is needed.
    let target = match column {
        Some(col) => format!("{path}:{line}:{col}"),
        None => format!("{path}:{line}"),
    };
    spawn_vscode(&["-g", &target])
}

// Environment file commands

/// Directories to skip during env file discovery
const IGNORED_DIRECTORIES: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "__pycache__",
    "venv",
    ".venv",
    "vendor",
    ".cargo",
    ".cache",
];

/// Check if a filename is an env file
fn is_env_file(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower == ".env"
        || lower.starts_with(".env.")
        || lower == ".env.local"
        || lower == ".env.development"
        || lower == ".env.production"
        || lower == ".env.test"
        || lower == ".env.staging"
        || lower == ".env.example"
        || lower == ".env.sample"
}

/// Determine the variant type from filename
fn detect_variant(filename: &str) -> EnvFileVariant {
    let lower = filename.to_lowercase();
    match lower.as_str() {
        ".env" => EnvFileVariant::Base,
        ".env.local" => EnvFileVariant::Local,
        s if s.contains("development") || s.contains(".dev") => EnvFileVariant::Development,
        s if s.contains("production") || s.contains(".prod") => EnvFileVariant::Production,
        s if s.contains("test") => EnvFileVariant::Test,
        s if s.contains("staging") => EnvFileVariant::Staging,
        s if s.contains("example") || s.contains("sample") => EnvFileVariant::Example,
        _ => EnvFileVariant::Other,
    }
}

/// Strip surrounding quotes from a value
fn strip_quotes(s: &str) -> String {
    let trimmed = s.trim();
    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

/// Parse .env file contents into key-value pairs
fn parse_env_file(path: &Path) -> Result<Vec<EnvVariable>, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;
    let mut variables = Vec::new();

    for (line_num, line) in content.lines().enumerate() {
        let trimmed = line.trim();

        // Skip empty lines and comments
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Parse KEY=VALUE format
        if let Some(eq_pos) = trimmed.find('=') {
            let key = trimmed[..eq_pos].trim().to_string();
            let value = trimmed[eq_pos + 1..].trim().to_string();

            // Remove surrounding quotes if present
            let value = strip_quotes(&value);

            if !key.is_empty() {
                variables.push(EnvVariable {
                    key,
                    value,
                    line_number: (line_num + 1) as u32,
                });
            }
        }
    }

    Ok(variables)
}

/// Auto-link env file to service if in same directory
fn find_matching_service(env_file_dir: &Path, project: &Project) -> Option<String> {
    for service in &project.services {
        let service_dir = if service.working_dir.is_empty() || service.working_dir == "." {
            Path::new(&project.root_path).to_path_buf()
        } else {
            Path::new(&project.root_path).join(&service.working_dir)
        };

        // Check if the env file is in the service directory
        if let Ok(env_canonical) = env_file_dir.canonicalize() {
            if let Ok(service_canonical) = service_dir.canonicalize() {
                if env_canonical == service_canonical {
                    return Some(service.id.clone());
                }
            }
        }
    }

    None
}

/// Discover all .env files in a project directory
#[tauri::command]
pub fn discover_env_files(
    state: State<AppState>,
    project_id: String,
    input: DiscoverEnvFilesInput,
) -> Result<Vec<EnvFile>, String> {
    let project = state
        .storage
        .get_project(&project_id)
        .ok_or_else(|| format!("Project not found: {}", project_id))?;

    // Skip if already discovered and not forcing
    if project.env_files_discovered && !input.force {
        return Ok(project.env_files.clone());
    }

    let root_path = Path::new(&project.root_path);
    if !root_path.exists() {
        return Err(format!("Project root path does not exist: {}", project.root_path));
    }

    let mut discovered_files: Vec<EnvFile> = Vec::new();

    // Walk the directory tree
    for entry in WalkDir::new(root_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            // Skip ignored directories
            if e.file_type().is_dir() {
                if let Some(name) = e.file_name().to_str() {
                    return !IGNORED_DIRECTORIES.contains(&name);
                }
            }
            true
        })
    {
        if let Ok(entry) = entry {
            if entry.file_type().is_file() {
                if let Some(filename) = entry.file_name().to_str() {
                    if is_env_file(filename) {
                        let full_path = entry.path();
                        let relative_path = full_path
                            .strip_prefix(root_path)
                            .unwrap_or(full_path)
                            .to_string_lossy()
                            .to_string();

                        // Parse the env file
                        let variables = parse_env_file(full_path).unwrap_or_default();
                        let variant = detect_variant(filename);

                        let mut env_file = EnvFile::new(
                            full_path.to_string_lossy().to_string(),
                            relative_path,
                            filename.to_string(),
                            variant,
                            variables,
                            false, // not manually added
                        );

                        // Try to link to a service
                        if let Some(parent_dir) = full_path.parent() {
                            env_file.linked_service_id = find_matching_service(parent_dir, &project);
                        }

                        discovered_files.push(env_file);
                    }
                }
            }
        }
    }

    // If forcing, preserve manually added files
    let manually_added: Vec<EnvFile> = if input.force {
        project
            .env_files
            .iter()
            .filter(|f| f.is_manually_added)
            .cloned()
            .collect()
    } else {
        Vec::new()
    };

    // Merge manually added files with discovered files
    let mut final_files = discovered_files;
    for manual_file in manually_added {
        if !final_files.iter().any(|f| f.path == manual_file.path) {
            final_files.push(manual_file);
        }
    }

    // Update project with discovered files
    state
        .storage
        .update_project(&project_id, |p| {
            p.env_files = final_files.clone();
            p.env_files_discovered = true;
        })
        .map_err(|e| e.to_string())?;

    Ok(final_files)
}

/// Add a single .env file manually by path
#[tauri::command]
pub fn add_env_file(
    state: State<AppState>,
    project_id: String,
    input: AddEnvFileInput,
) -> Result<EnvFile, String> {
    let project = state
        .storage
        .get_project(&project_id)
        .ok_or_else(|| format!("Project not found: {}", project_id))?;

    let file_path = input.path.clone();
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    if !path.is_file() {
        return Err(format!("Path is not a file: {}", file_path));
    }

    // Check if already tracked
    if project.env_files.iter().any(|f| f.path == file_path) {
        return Err("File is already tracked".to_string());
    }

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(".env")
        .to_string();

    let root_path = Path::new(&project.root_path);
    let relative_path = path
        .strip_prefix(root_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| file_path.clone());

    let variables = parse_env_file(path)?;
    let variant = detect_variant(&filename);

    // Compute linked service before moving file_path
    let linked_service_id = path
        .parent()
        .and_then(|parent_dir| find_matching_service(parent_dir, &project));

    let mut env_file = EnvFile::new(
        file_path,
        relative_path,
        filename,
        variant,
        variables,
        true, // manually added
    );
    env_file.linked_service_id = linked_service_id;

    let env_file_clone = env_file.clone();

    state
        .storage
        .update_project(&project_id, |p| {
            p.env_files.push(env_file_clone);
        })
        .map_err(|e| e.to_string())?;

    Ok(env_file)
}

/// Remove an env file from tracking (does not delete the actual file)
#[tauri::command]
pub fn remove_env_file(
    state: State<AppState>,
    project_id: String,
    env_file_id: String,
) -> Result<(), String> {
    state
        .storage
        .update_project(&project_id, |p| {
            p.env_files.retain(|f| f.id != env_file_id);
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Refresh/re-read a single env file's contents
#[tauri::command]
pub fn refresh_env_file(
    state: State<AppState>,
    project_id: String,
    env_file_id: String,
) -> Result<EnvFile, String> {
    let project = state
        .storage
        .get_project(&project_id)
        .ok_or_else(|| format!("Project not found: {}", project_id))?;

    let env_file = project
        .env_files
        .iter()
        .find(|f| f.id == env_file_id)
        .ok_or_else(|| format!("Env file not found: {}", env_file_id))?;

    let path = Path::new(&env_file.path);
    if !path.exists() {
        return Err(format!("File no longer exists: {}", env_file.path));
    }

    let variables = parse_env_file(path)?;
    let updated_file_id = env_file_id.clone();

    let mut result_file: Option<EnvFile> = None;

    state
        .storage
        .update_project(&project_id, |p| {
            if let Some(f) = p.env_files.iter_mut().find(|f| f.id == updated_file_id) {
                f.variables = variables.clone();
                f.last_read_at = Utc::now();
                result_file = Some(f.clone());
            }
        })
        .map_err(|e| e.to_string())?;

    result_file.ok_or_else(|| "Failed to update env file".to_string())
}

/// Refresh all env files for a project
#[tauri::command]
pub fn refresh_all_env_files(
    state: State<AppState>,
    project_id: String,
) -> Result<Vec<EnvFile>, String> {
    let project = state
        .storage
        .get_project(&project_id)
        .ok_or_else(|| format!("Project not found: {}", project_id))?;

    let mut updated_files: Vec<EnvFile> = Vec::new();

    for env_file in &project.env_files {
        let path = Path::new(&env_file.path);
        if path.exists() {
            let variables = parse_env_file(path).unwrap_or_default();
            let mut updated = env_file.clone();
            updated.variables = variables;
            updated.last_read_at = Utc::now();
            updated_files.push(updated);
        } else {
            // Keep the file in the list but with empty variables
            let mut updated = env_file.clone();
            updated.variables = Vec::new();
            updated_files.push(updated);
        }
    }

    let files_clone = updated_files.clone();

    state
        .storage
        .update_project(&project_id, |p| {
            p.env_files = files_clone;
        })
        .map_err(|e| e.to_string())?;

    Ok(updated_files)
}

/// Get env files for a project
#[tauri::command]
pub fn get_env_files(state: State<AppState>, project_id: String) -> Result<Vec<EnvFile>, String> {
    let project = state
        .storage
        .get_project(&project_id)
        .ok_or_else(|| format!("Project not found: {}", project_id))?;

    Ok(project.env_files)
}

/// Get the raw content of an env file
#[tauri::command]
pub fn get_env_file_content(
    state: State<AppState>,
    project_id: String,
    env_file_id: String,
) -> Result<String, String> {
    let project = state
        .storage
        .get_project(&project_id)
        .ok_or_else(|| format!("Project not found: {}", project_id))?;

    let env_file = project
        .env_files
        .iter()
        .find(|f| f.id == env_file_id)
        .ok_or_else(|| format!("Env file not found: {}", env_file_id))?;

    let path = Path::new(&env_file.path);
    if !path.exists() {
        return Err(format!("File no longer exists: {}", env_file.path));
    }

    std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

/// Compare .env with .env.example in the same directory
#[tauri::command]
pub fn compare_env_files(
    state: State<AppState>,
    project_id: String,
    base_file_id: String,
    example_file_id: String,
) -> Result<EnvComparison, String> {
    let project = state
        .storage
        .get_project(&project_id)
        .ok_or_else(|| format!("Project not found: {}", project_id))?;

    let base_file = project
        .env_files
        .iter()
        .find(|f| f.id == base_file_id)
        .ok_or_else(|| format!("Base file not found: {}", base_file_id))?;

    let example_file = project
        .env_files
        .iter()
        .find(|f| f.id == example_file_id)
        .ok_or_else(|| format!("Example file not found: {}", example_file_id))?;

    let base_keys: std::collections::HashSet<&str> =
        base_file.variables.iter().map(|v| v.key.as_str()).collect();
    let example_keys: std::collections::HashSet<&str> = example_file
        .variables
        .iter()
        .map(|v| v.key.as_str())
        .collect();

    let missing_in_base: Vec<String> = example_keys
        .difference(&base_keys)
        .map(|s| s.to_string())
        .collect();

    let extra_in_base: Vec<String> = base_keys
        .difference(&example_keys)
        .map(|s| s.to_string())
        .collect();

    let common_keys: Vec<String> = base_keys
        .intersection(&example_keys)
        .map(|s| s.to_string())
        .collect();

    Ok(EnvComparison {
        base_file_id,
        example_file_id,
        missing_in_base,
        extra_in_base,
        common_keys,
    })
}

/// Link an env file to a service
#[tauri::command]
pub fn link_env_to_service(
    state: State<AppState>,
    project_id: String,
    env_file_id: String,
    input: LinkEnvToServiceInput,
) -> Result<EnvFile, String> {
    let mut result_file: Option<EnvFile> = None;

    state
        .storage
        .update_project(&project_id, |p| {
            if let Some(f) = p.env_files.iter_mut().find(|f| f.id == env_file_id) {
                f.linked_service_id = input.service_id.clone();
                result_file = Some(f.clone());
            }
        })
        .map_err(|e| e.to_string())?;

    result_file.ok_or_else(|| format!("Env file not found: {}", env_file_id))
}

// ============================================================================
// Global Script commands
// ============================================================================

#[tauri::command]
pub fn get_all_global_scripts(state: State<AppState>) -> Vec<GlobalScript> {
    state.storage.get_all_global_scripts()
}

#[tauri::command]
pub fn get_global_script(state: State<AppState>, id: String) -> Result<GlobalScript, String> {
    state
        .storage
        .get_global_script(&id)
        .ok_or_else(|| format!("Global script not found: {}", id))
}

#[tauri::command]
pub fn create_global_script(
    state: State<AppState>,
    input: CreateGlobalScriptInput,
) -> Result<GlobalScript, String> {
    let mut script = GlobalScript::new(input.name, input.command, input.working_dir);
    script.description = input.description;
    script.script_path = input.script_path;
    script.color = input.color;
    script.tags = input.tags.unwrap_or_default();
    script.parameters = input.parameters.unwrap_or_default();
    script.parameter_presets = input.parameter_presets.unwrap_or_default();
    script.env_vars = input.env_vars;
    script.status = opt_text(input.status);

    // Set order to be last
    let all = state.storage.get_all_global_scripts();
    script.order = all.len() as u32;

    state
        .storage
        .create_global_script(script)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_global_script(
    state: State<AppState>,
    id: String,
    input: UpdateGlobalScriptInput,
) -> Result<GlobalScript, String> {
    state
        .storage
        .update_global_script(&id, |script| {
            if let Some(name) = input.name {
                script.name = name;
            }
            if input.description.is_some() {
                script.description = input.description;
            }
            if let Some(command) = input.command {
                script.command = command;
            }
            if input.script_path.is_some() {
                script.script_path = input.script_path;
            }
            if input.working_dir.is_some() {
                script.working_dir = input.working_dir;
            }
            if input.color.is_some() {
                script.color = input.color;
            }
            if let Some(tags) = input.tags {
                script.tags = tags;
            }
            if let Some(parameters) = input.parameters {
                script.parameters = parameters;
            }
            if let Some(presets) = input.parameter_presets {
                script.parameter_presets = presets;
            }
            if input.default_preset_id.is_some() {
                script.default_preset_id = input.default_preset_id;
            }
            if input.env_vars.is_some() {
                script.env_vars = input.env_vars;
            }
            if let Some(status) = opt_text_patch(input.status) {
                script.status = status;
            }
            if let Some(favorite) = input.favorite {
                script.favorite = favorite;
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_global_script(
    app_handle: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<(), String> {
    // Stop if running
    let emitter = TauriEmitter::new(app_handle);
    let _ = state.process_manager.stop_global_script(&emitter, &id);

    state
        .storage
        .delete_global_script(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_global_scripts(
    state: State<AppState>,
    script_ids: Vec<String>,
) -> Result<(), String> {
    for (order, id) in script_ids.iter().enumerate() {
        state
            .storage
            .update_global_script(id, |script| {
                script.order = order as u32;
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// `working_dir` is an optional per-run override: blank or absent falls back to
/// the script's own working dir, then to its folder — see
/// `command_builder::resolve_working_dir`.
#[tauri::command]
pub fn run_global_script(
    app_handle: AppHandle,
    state: State<AppState>,
    script_id: String,
    working_dir: Option<String>,
    parameter_values: Option<std::collections::HashMap<String, String>>,
    extra_args: Option<String>,
) -> Result<u32, String> {
    let script = state
        .storage
        .get_global_script(&script_id)
        .ok_or_else(|| format!("Global script not found: {}", script_id))?;

    // Build program + args via shared builder
    let extra: Vec<String> = extra_args
        .as_deref()
        .map(cortx_core::command_builder::split_args)
        .unwrap_or_default();
    let param_map = parameter_values.clone().unwrap_or_default();

    let (program, args) = cortx_core::command_builder::build_command(&script, &param_map, &extra)
        .ok_or_else(|| "Empty command".to_string())?;

    let working_dir =
        cortx_core::command_builder::resolve_working_dir(&script, working_dir.as_deref());

    // Record execution start
    let mut record = ExecutionRecord::new(script_id.clone());
    if let Some(ref params) = parameter_values {
        record.parameters_used = params.clone();
    }
    let _ = state.storage.add_execution_record(record);

    let emitter: Arc<dyn ProcessEventEmitter> = Arc::new(TauriEmitter::new(app_handle));
    let script_name = script.name.clone();
    let pid = state.process_manager.run_global_script(
        emitter,
        script_id.clone(),
        working_dir,
        program,
        args,
        script.env_vars,
        cortx_core::process_manager::RuntimeMeta::new(script_name),
    )?;

    Ok(pid)
}

#[tauri::command]
pub fn stop_global_script(
    app_handle: AppHandle,
    state: State<AppState>,
    script_id: String,
) -> Result<(), String> {
    let emitter = TauriEmitter::new(app_handle);
    state
        .process_manager
        .stop_global_script(&emitter, &script_id)
}

#[tauri::command]
pub fn is_global_script_running(state: State<AppState>, script_id: String) -> bool {
    state.process_manager.is_global_script_running(&script_id)
}

// ============================================================================
// Tag Definition commands
// ============================================================================

#[tauri::command]
pub fn get_all_tag_definitions(state: State<AppState>) -> Vec<TagDefinition> {
    state.storage.get_all_tag_definitions()
}

#[tauri::command]
pub fn create_tag_definition(
    state: State<AppState>,
    input: CreateTagDefinitionInput,
) -> Result<TagDefinition, String> {
    let def = TagDefinition {
        name: input.name.to_lowercase(),
        color: input.color,
        order: input.order,
    };

    state
        .storage
        .create_tag_definition(def)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_tag_definition(
    state: State<AppState>,
    name: String,
    input: UpdateTagDefinitionInput,
) -> Result<TagDefinition, String> {
    state
        .storage
        .update_tag_definition(&name, |def| {
            if let Some(new_name) = input.name {
                def.name = new_name.to_lowercase();
            }
            if input.color.is_some() {
                def.color = input.color;
            }
            if input.order.is_some() {
                def.order = input.order;
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_tag_definition(state: State<AppState>, name: String) -> Result<(), String> {
    // Non-destructive: only removes the definition (color/order), tag strings stay on items
    state
        .storage
        .delete_tag_definition(&name)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Execution History commands
// ============================================================================

#[tauri::command]
pub fn get_execution_history(
    state: State<AppState>,
    script_id: String,
    limit: Option<usize>,
) -> Vec<ExecutionRecord> {
    state
        .storage
        .get_execution_history(&script_id, limit.unwrap_or(50))
}

#[tauri::command]
pub fn clear_execution_history(
    state: State<AppState>,
    script_id: String,
) -> Result<(), String> {
    state
        .storage
        .clear_execution_history(&script_id)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Scripts Config commands
// ============================================================================

#[tauri::command]
pub fn get_scripts_config(state: State<AppState>) -> ScriptsConfig {
    state.storage.get_settings().scripts_config
}

#[tauri::command]
pub fn update_scripts_config(
    state: State<AppState>,
    config: ScriptsConfig,
) -> Result<(), String> {
    let mut settings = state.storage.get_settings();
    settings.scripts_config = config;
    state
        .storage
        .update_settings(settings)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Script Discovery / Scan
// ============================================================================

#[tauri::command]
pub fn scan_scripts_folder(folder: String) -> Result<Vec<DiscoveredScript>, String> {
    if folder.is_empty() {
        return Err("No folder specified.".to_string());
    }
    let config = cortx_core::models::ScriptsConfig::default();
    Ok(cortx_core::script_discovery::scan_folder(
        &folder,
        &config.scan_extensions,
        &config.ignored_patterns,
    ))
}

// ============================================================================
// Tool Discovery / Scan Package Managers
// ============================================================================

#[tauri::command]
pub fn scan_installed_tools() -> Result<Vec<DiscoveredTool>, String> {
    Ok(cortx_core::tool_discovery::scan_installed_tools())
}

// ============================================================================
// Help Parser / Auto-detect Parameters
// ============================================================================

#[tauri::command]
pub fn auto_detect_script_params(command: String, script_path: Option<String>) -> Result<Vec<ScriptParameter>, String> {
    cortx_core::help_parser::detect_parameters(&command, script_path.as_deref())
}

// ============================================================================
// Tool commands
// ============================================================================

#[tauri::command]
pub fn get_all_tools(state: State<AppState>) -> Vec<Tool> {
    state.storage.get_all_tools()
}

#[tauri::command]
pub fn get_tool(state: State<AppState>, id: String) -> Result<Tool, String> {
    state
        .storage
        .get_tool(&id)
        .ok_or_else(|| format!("Tool not found: {}", id))
}

#[tauri::command]
pub fn create_tool(
    state: State<AppState>,
    input: CreateToolInput,
) -> Result<Tool, String> {
    let mut tool = Tool::new(
        input.name,
        opt_text(input.status).unwrap_or_else(|| "Active".to_string()),
    );
    tool.description = input.description;
    tool.tags = input.tags.unwrap_or_default();
    tool.replaced_by = input.replaced_by;
    tool.install_method = input.install_method;
    tool.install_location = input.install_location;
    tool.version = input.version;
    tool.homepage = input.homepage;
    tool.config_paths = input.config_paths.unwrap_or_default();
    tool.toolbox_url = input.toolbox_url;
    tool.notes = input.notes;
    tool.color = input.color;

    // Set order to be last
    let all = state.storage.get_all_tools();
    tool.order = all.len() as u32;

    state
        .storage
        .create_tool(tool)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_tool(
    state: State<AppState>,
    id: String,
    input: UpdateToolInput,
) -> Result<Tool, String> {
    state
        .storage
        .update_tool(&id, |tool| {
            if let Some(name) = input.name {
                tool.name = name;
            }
            if input.description.is_some() {
                tool.description = input.description;
            }
            if let Some(tags) = input.tags {
                tool.tags = tags;
            }
            if let Some(status) = opt_text_patch(input.status) {
                // Tool.status is a plain String: clearing it means "no status".
                tool.status = status.unwrap_or_default();
            }
            if input.replaced_by.is_some() {
                tool.replaced_by = input.replaced_by;
            }
            if input.install_method.is_some() {
                tool.install_method = input.install_method;
            }
            if input.install_location.is_some() {
                tool.install_location = input.install_location;
            }
            if input.version.is_some() {
                tool.version = input.version;
            }
            if input.homepage.is_some() {
                tool.homepage = input.homepage;
            }
            if let Some(config_paths) = input.config_paths {
                tool.config_paths = config_paths;
            }
            if input.toolbox_url.is_some() {
                tool.toolbox_url = input.toolbox_url;
            }
            if input.notes.is_some() {
                tool.notes = input.notes;
            }
            if input.color.is_some() {
                tool.color = input.color;
            }
            if let Some(favorite) = input.favorite {
                tool.favorite = favorite;
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_tool(state: State<AppState>, id: String) -> Result<(), String> {
    state.storage.delete_tool(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_tools(
    state: State<AppState>,
    tool_ids: Vec<String>,
) -> Result<(), String> {
    for (order, id) in tool_ids.iter().enumerate() {
        state
            .storage
            .update_tool(id, |tool| {
                tool.order = order as u32;
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_tool_config(state: State<AppState>, tool_id: String, config_index: usize) -> Result<(), String> {
    let tool = state
        .storage
        .get_tool(&tool_id)
        .ok_or_else(|| format!("Tool not found: {}", tool_id))?;

    let config = tool
        .config_paths
        .get(config_index)
        .ok_or_else(|| format!("Config path index {} out of range", config_index))?;

    open_in_vscode(config.path.clone())
}

#[tauri::command]
pub fn open_tool_location(state: State<AppState>, tool_id: String) -> Result<(), String> {
    let tool = state
        .storage
        .get_tool(&tool_id)
        .ok_or_else(|| format!("Tool not found: {}", tool_id))?;

    let location = tool
        .install_location
        .ok_or_else(|| "No install location set".to_string())?;

    open_in_explorer(location)
}

#[tauri::command]
pub fn open_tool_location_vscode(state: State<AppState>, tool_id: String) -> Result<(), String> {
    let tool = state
        .storage
        .get_tool(&tool_id)
        .ok_or_else(|| format!("Tool not found: {}", tool_id))?;

    let location = tool
        .install_location
        .ok_or_else(|| "No install location set".to_string())?;

    open_in_vscode(location)
}

#[tauri::command]
pub fn open_tool_url(_state: State<AppState>, url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ============================================================================
// Import / Export
// ============================================================================

#[tauri::command]
pub fn export_scripts_config(state: State<AppState>) -> Result<String, String> {
    state
        .storage
        .export_scripts_config()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn preview_import(json: String) -> Result<ExportSummary, String> {
    Storage::preview_import(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_scripts_config(
    state: State<AppState>,
    json: String,
    options: ImportOptions,
) -> Result<ImportResult, String> {
    state
        .storage
        .import_scripts_config(&json, &options)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Git Backup
// ============================================================================

#[tauri::command]
pub fn backup_to_git(state: State<AppState>) -> Result<String, String> {
    state
        .storage
        .backup_to_git()
        .map_err(|e| e.to_string())
}

// ============================================================================
// Execution History - Update Record on Exit
// ============================================================================

#[tauri::command]
pub fn update_execution_record(
    state: State<AppState>,
    script_id: String,
    exit_code: Option<i32>,
    success: bool,
) -> Result<(), String> {
    let records = state.storage.get_execution_history(&script_id, 1);
    if let Some(record) = records.first() {
        if record.finished_at.is_none() {
            let record_id = record.id.clone();
            let started_at = record.started_at;
            state
                .storage
                .update_execution_record(&record_id, |r| {
                    r.finished_at = Some(Utc::now());
                    r.success = success;
                    r.exit_code = exit_code;
                    r.duration_ms = Some(
                        (Utc::now() - started_at).num_milliseconds().max(0) as u64
                    );
                })
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ============================================================================
// Alias commands
// ============================================================================

#[tauri::command]
pub fn get_all_aliases(state: State<AppState>) -> Result<Vec<ShellAlias>, String> {
    Ok(state.storage.get_all_aliases())
}

#[tauri::command]
pub fn get_alias(state: State<AppState>, id: String) -> Result<ShellAlias, String> {
    state
        .storage
        .get_alias(&id)
        .ok_or_else(|| format!("Alias not found: {}", id))
}

#[tauri::command]
pub fn create_alias(state: State<AppState>, input: CreateShellAliasInput) -> Result<ShellAlias, String> {
    cortx_core::shell_init::validate_alias_name(&input.name).map_err(|e| e)?;
    if let Some(ref at) = input.alias_type {
        cortx_core::shell_init::validate_alias_type(at).map_err(|e| e)?;
    }

    let mut alias = ShellAlias::new(input.name, input.command);
    alias.description = input.description;
    if let Some(tags) = input.tags {
        alias.tags = tags;
    }
    alias.status = opt_text(input.status);
    if let Some(at) = input.alias_type {
        alias.alias_type = at;
    }
    alias.setup = input.setup;
    alias.script = input.script;
    alias.tool_id = input.tool_id;
    alias.execution_order = input.execution_order;
    alias.shim = input.shim.unwrap_or(false);
    let count = state.storage.get_all_aliases().len() as u32;
    alias.order = count;

    state.storage.create_alias(alias).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_alias(state: State<AppState>, id: String, input: UpdateShellAliasInput) -> Result<ShellAlias, String> {
    if let Some(ref name) = input.name {
        cortx_core::shell_init::validate_alias_name(name).map_err(|e| e)?;
    }
    if let Some(ref at) = input.alias_type {
        cortx_core::shell_init::validate_alias_type(at).map_err(|e| e)?;
    }

    state.storage.update_alias(&id, |alias| {
        if let Some(name) = input.name {
            alias.name = name;
        }
        if let Some(command) = input.command {
            alias.command = command;
        }
        if let Some(description) = input.description {
            alias.description = Some(description);
        }
        if let Some(tags) = input.tags {
            alias.tags = tags;
        }
        if let Some(status) = opt_text_patch(input.status) {
            alias.status = status;
        }
        if let Some(at) = input.alias_type {
            alias.alias_type = at;
        }
        if let Some(setup) = input.setup {
            alias.setup = Some(setup);
        }
        if let Some(script) = input.script {
            alias.script = Some(script);
        }
        if let Some(tool_id) = input.tool_id {
            alias.tool_id = if tool_id.is_empty() { None } else { Some(tool_id) };
        }
        if input.execution_order.is_some() {
            alias.execution_order = input.execution_order;
        }
        if let Some(shim) = input.shim {
            alias.shim = shim;
        }
        if let Some(favorite) = input.favorite {
            alias.favorite = favorite;
        }
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_alias(state: State<AppState>, id: String) -> Result<(), String> {
    state.storage.delete_alias(&id).map_err(|e| e.to_string())
}

/// Status of the alias shim system: directory, whether on PATH, shimmed names.
#[tauri::command]
pub fn get_shim_status(state: State<AppState>) -> cortx_core::shim::ShimStatus {
    state.storage.shim_status()
}

/// Reconcile the shim directory with current aliases (write/remove launchers).
#[tauri::command]
pub fn sync_shims(state: State<AppState>) -> Result<cortx_core::shim::SyncReport, String> {
    state.storage.sync_all_shims().map_err(|e| e.to_string())
}

/// Add the shim directory to the user's persistent PATH (one-click, idempotent).
#[tauri::command]
pub fn install_shim_path(state: State<AppState>) -> Result<cortx_core::shim::InstallOutcome, String> {
    state.storage.install_shim_path()
}

#[tauri::command]
pub fn reorder_aliases(state: State<AppState>, alias_ids: Vec<String>) -> Result<(), String> {
    for (i, id) in alias_ids.iter().enumerate() {
        state.storage.update_alias(id, |alias| {
            alias.order = i as u32;
        }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn generate_shell_init(state: State<AppState>, shell: String) -> Result<String, String> {
    let shell_type = cortx_core::shell_init::Shell::from_str(&shell)
        .ok_or_else(|| format!("Unknown shell: {}. Supported: powershell, bash, zsh, fish", shell))?;
    let aliases = state.storage.get_all_aliases();
    let tcfg = state.storage.get_settings().terminal;
    Ok(cortx_core::shell_init::generate_init_script_ext(
        &shell_type,
        &aliases,
        cortx_core::shell_init::InitOptions {
            shell_integration: tcfg.shell_integration,
            disable_shell_predictions: tcfg.shell_integration && tcfg.inline_suggestions,
        },
    ))
}

// ============================================================================
// Status Definition commands
// ============================================================================

#[tauri::command]
pub fn get_all_status_definitions(state: State<AppState>) -> Result<Vec<StatusDefinition>, String> {
    Ok(state.storage.get_all_status_definitions())
}

#[tauri::command]
pub fn create_status_definition(
    state: State<AppState>,
    input: CreateStatusDefinitionInput,
) -> Result<StatusDefinition, String> {
    let def = StatusDefinition {
        name: input.name,
        color: input.color,
        order: input.order,
    };
    state
        .storage
        .create_status_definition(def)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_status_definition(
    state: State<AppState>,
    name: String,
    input: UpdateStatusDefinitionInput,
) -> Result<StatusDefinition, String> {
    state
        .storage
        .update_status_definition(&name, |def| {
            if let Some(new_name) = input.name {
                def.name = new_name;
            }
            if input.color.is_some() {
                def.color = input.color;
            }
            if input.order.is_some() {
                def.order = input.order;
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_status_definition(state: State<AppState>, name: String) -> Result<(), String> {
    state
        .storage
        .delete_status_definition(&name)
        .map_err(|e| e.to_string())
}

// ============================================================================
// App commands
// ============================================================================

#[tauri::command]
pub fn get_all_apps(state: State<AppState>) -> Result<Vec<App>, String> {
    Ok(state.storage.get_all_apps())
}

#[tauri::command]
pub fn get_app(state: State<AppState>, id: String) -> Result<App, String> {
    state
        .storage
        .get_app(&id)
        .ok_or_else(|| format!("App not found: {}", id))
}

#[tauri::command]
pub fn create_app(state: State<AppState>, input: CreateAppInput) -> Result<App, String> {
    let mut app = App::new(input.name);
    app.description = input.description;
    app.tags = input.tags.unwrap_or_default();
    app.status = opt_text(input.status);
    app.version = input.version;
    app.homepage = input.homepage;
    app.executable_path = input.executable_path;
    app.launch_args = input.launch_args;
    app.config_paths = input.config_paths.unwrap_or_default();
    app.toolbox_url = input.toolbox_url;
    app.notes = input.notes;
    app.color = input.color;

    let count = state.storage.get_all_apps().len() as u32;
    app.order = count;

    state.storage.create_app(app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_app(
    state: State<AppState>,
    id: String,
    input: UpdateAppInput,
) -> Result<App, String> {
    state
        .storage
        .update_app(&id, |app| {
            if let Some(name) = input.name {
                app.name = name;
            }
            if input.description.is_some() {
                app.description = input.description;
            }
            if let Some(tags) = input.tags {
                app.tags = tags;
            }
            if let Some(status) = opt_text_patch(input.status) {
                app.status = status;
            }
            if input.version.is_some() {
                app.version = input.version;
            }
            if input.homepage.is_some() {
                app.homepage = input.homepage;
            }
            if input.executable_path.is_some() {
                app.executable_path = input.executable_path;
            }
            if input.launch_args.is_some() {
                app.launch_args = input.launch_args;
            }
            if let Some(config_paths) = input.config_paths {
                app.config_paths = config_paths;
            }
            if input.toolbox_url.is_some() {
                app.toolbox_url = input.toolbox_url;
            }
            if input.notes.is_some() {
                app.notes = input.notes;
            }
            if input.color.is_some() {
                app.color = input.color;
            }
            if let Some(favorite) = input.favorite {
                app.favorite = favorite;
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_app(state: State<AppState>, id: String) -> Result<(), String> {
    state.storage.delete_app(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_apps(state: State<AppState>, app_ids: Vec<String>) -> Result<(), String> {
    for (i, id) in app_ids.iter().enumerate() {
        state
            .storage
            .update_app(id, |app| {
                app.order = i as u32;
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn launch_app(state: State<AppState>, app_id: String) -> Result<(), String> {
    let app = state
        .storage
        .get_app(&app_id)
        .ok_or_else(|| format!("App not found: {}", app_id))?;

    let path = app
        .executable_path
        .ok_or_else(|| "No executable path set".to_string())?;

    let extra_args: Vec<String> = app
        .launch_args
        .as_deref()
        .map(cortx_core::command_builder::split_args)
        .unwrap_or_default();

    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "start", "", &path]);
        for arg in &extra_args {
            cmd.arg(arg);
        }
        cmd.spawn().map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        // .app bundles must be launched via `open -a`; raw executables can be
        // spawned directly so they get their own process and inherit the GUI session.
        if path.ends_with(".app") || path.contains(".app/") {
            let mut cmd = std::process::Command::new("open");
            // -n: open a new instance even if already running
            cmd.args(["-n", "-a", &path]);
            if !extra_args.is_empty() {
                cmd.arg("--args");
                for arg in &extra_args {
                    cmd.arg(arg);
                }
            }
            cmd.spawn().map_err(|e| e.to_string())?;
        } else {
            let mut cmd = std::process::Command::new(&path);
            for arg in &extra_args {
                cmd.arg(arg);
            }
            cmd.spawn().map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        let mut cmd = std::process::Command::new(&path);
        for arg in &extra_args {
            cmd.arg(arg);
        }
        cmd.spawn().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn open_app_config(state: State<AppState>, app_id: String, config_index: usize) -> Result<(), String> {
    let app = state
        .storage
        .get_app(&app_id)
        .ok_or_else(|| format!("App not found: {}", app_id))?;

    let config = app
        .config_paths
        .get(config_index)
        .ok_or_else(|| "Config path not found".to_string())?;

    let path = &config.path;

    #[cfg(target_os = "windows")]
    {
        if config.is_directory {
            std::process::Command::new("explorer")
                .arg(path)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", path])
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        // `open` handles both directories (Finder) and files (default app)
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn open_app_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}


// ============================================================================
// Agents section (DEV-11) — see plans/agents_section.md
// ============================================================================

fn agent_projects(storage: &Storage) -> Vec<(String, String)> {
    storage
        .get_all_projects()
        .into_iter()
        .map(|p| (p.id, p.root_path))
        .collect()
}

fn agent_session(state: &AppState, session_id: &str) -> Result<AgentSession, String> {
    state
        .agents
        .session(
            session_id,
            &agent_projects(&state.storage),
            &state.storage.get_agent_annotations(),
        )
        .ok_or_else(|| format!("Agent session not found: {}", session_id))
}

#[tauri::command]
pub fn list_agent_sessions(
    state: State<AppState>,
    options: Option<ListAgentSessionsOptions>,
) -> Result<Vec<AgentSession>, String> {
    let options = options.unwrap_or_default();
    Ok(state.agents.list(
        &options,
        &agent_projects(&state.storage),
        &state.storage.get_agent_annotations(),
    ))
}

/// Full rescan (blocking work runs off the async runtime), then the default list.
#[tauri::command]
pub async fn refresh_agent_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<AgentSession>, String> {
    let index = state.agents.clone();
    let storage = state.storage.clone();
    tokio::task::spawn_blocking(move || {
        index.refresh_all();
        index.list(
            &ListAgentSessionsOptions::default(),
            &agent_projects(&storage),
            &storage.get_agent_annotations(),
        )
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_agent_transcript(
    state: State<'_, AppState>,
    session_id: String,
    query: Option<AgentTranscriptQuery>,
) -> Result<AgentTranscriptPage, String> {
    let index = state.agents.clone();
    let query = query.unwrap_or_default();
    tokio::task::spawn_blocking(move || index.transcript(&session_id, &query))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn update_agent_annotations(
    state: State<AppState>,
    session_id: String,
    annotations: AgentAnnotations,
) -> Result<AgentSession, String> {
    if session_id.trim().is_empty() {
        return Err("Session id is required".to_string());
    }
    state
        .storage
        .update_agent_annotations(&session_id, annotations)
        .map_err(|e| e.to_string())?;
    agent_session(&state, &session_id)
}

#[tauri::command]
pub fn get_agent_resume_command(
    state: State<AppState>,
    session_id: String,
    fork: bool,
) -> Result<String, String> {
    Ok(state
        .agents
        .resume_command(&session_id, fork)?
        .command_line())
}

/// Open the external terminal in the session folder running the resume
/// command. Warp on Windows cannot run a command through its URI scheme, so a
/// launch configuration is generated and opened instead.
#[tauri::command]
pub async fn resume_agent_session(
    state: State<'_, AppState>,
    session_id: String,
    fork: bool,
) -> Result<(), String> {
    let session = agent_session(&state, &session_id)?;
    let cmd = state.agents.resume_command(&session_id, fork)?;
    if cmd.cwd.is_empty() || !Path::new(&cmd.cwd).is_dir() {
        return Err(format!(
            "The session folder no longer exists: {}",
            if cmd.cwd.is_empty() { "(unknown)" } else { &cmd.cwd }
        ));
    }
    let settings = state.storage.get_settings();

    #[cfg(target_os = "windows")]
    {
        use crate::models::TerminalPreset;
        use std::os::windows::process::CommandExt;
        if matches!(settings.terminal.preset, TerminalPreset::Warp) {
            let name = agent_launch::warp_config_name(&session_id);
            let path = agent_launch::write_warp_launch_config(
                &name,
                &[agent_launch::WarpTab {
                    title: &session.title,
                    cwd: &cmd.cwd,
                    exec: &cmd.command_line(),
                }],
            )?;
            log::info!("Warp launch configuration written: {}", path.display());
            let uri = format!("warp://launch/{}", name);
            std::process::Command::new("cmd")
                .args(["/c", "start", "", &uri])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .spawn()
                .map_err(|e| format!("Failed to launch Warp: {}", e))?;
            return Ok(());
        }
    }

    let _ = &session;
    spawn_in_terminal(&settings, &cmd.cwd, &cmd.command_line())
}

/// `git rev-parse --show-toplevel` in `cwd`, with a timeout and no console
/// window. `None` when not a git repo / git missing / too slow.
fn git_toplevel(cwd: &str) -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    let mut cmd = Command::new("git");
    cmd.args(["-C", cwd, "rev-parse", "--show-toplevel"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().ok()?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                break;
            }
            Ok(None) => {
                if std::time::Instant::now() > deadline {
                    let _ = child.kill();
                    return None;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Err(_) => return None,
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    let line = out.lines().next()?.trim();
    if line.is_empty() {
        return None;
    }
    Some(cortx_core::agents::display_path(line))
}

/// Create a CortX project from a session's folder (git toplevel when
/// available). Returns the existing project if one already covers that root.
#[tauri::command]
pub fn create_project_from_session(
    state: State<AppState>,
    session_id: String,
) -> Result<Project, String> {
    let (_, cwd) = state
        .agents
        .session_cwd(&session_id)
        .ok_or_else(|| format!("Agent session not found: {}", session_id))?;
    if cwd.is_empty() || !Path::new(&cwd).is_dir() {
        return Err(format!("The session folder no longer exists: {}", cwd));
    }
    let root = git_toplevel(&cwd).unwrap_or_else(|| cwd.clone());
    let root = if Path::new(&root).is_dir() { root } else { cwd.clone() };

    let normalized = cortx_core::agents::normalize_path(&root);
    if let Some(existing) = state
        .storage
        .get_all_projects()
        .into_iter()
        .find(|p| cortx_core::agents::normalize_path(&p.root_path) == normalized)
    {
        return Ok(existing);
    }

    let name = Path::new(&root)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| root.clone());
    let project = Project::new(name, root);
    state
        .storage
        .create_project(project)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_agents_health(state: State<AppState>) -> Result<AgentsHealth, String> {
    Ok(state.agents.health())
}

/// Which terminal is running which agent right now (DEV-13). Seeds the GUI
/// after a reload; live updates arrive through the `terminal-agents` event.
#[tauri::command]
pub fn get_terminal_agents(
    state: State<AppState>,
) -> Vec<cortx_core::agents::terminal_link::TerminalAgent> {
    compute_terminal_agents(&state)
}

/// Shared by the command and the background poller in `lib.rs`.
pub fn compute_terminal_agents(
    state: &AppState,
) -> Vec<cortx_core::agents::terminal_link::TerminalAgent> {
    let terminals = state.process_manager.pty_processes();
    state.agents.terminal_agents(&terminals)
}

/// Bring the main window up and ask it to open a session in the Agents
/// section (bridge from the Terminal window). The GUI listens for
/// `open-agent-session`.
#[tauri::command]
pub fn reveal_agent_session(app_handle: AppHandle, session_id: String) {
    crate::show_main_window(&app_handle);
    let _ = app_handle.emit("open-agent-session", session_id);
}

// ============================================================================
// Integrated terminal (PTY) commands
// ============================================================================
//
// Every process the GUI starts runs in a PTY (see cortx_core::process_manager).
// The xterm.js view for a terminal id (`service:<id>`, `script:<id>`,
// `global-script:<id>`, `shell:<id>`) attaches a Channel here, receives the
// raw scrollback as its first message, then live bytes as they arrive.

use tauri::ipc::{Channel, InvokeResponseBody};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCapabilities {
    /// Windows only: true when the bundled `conpty.dll` (Windows Terminal's
    /// ConPTY, which passes Sixel / iTerm2 image sequences through) sits next
    /// to the executable and will be picked over the inbox one.
    pub conpty_sideloaded: bool,
    pub platform: &'static str,
}

#[tauri::command]
pub fn get_terminal_capabilities() -> TerminalCapabilities {
    let conpty_sideloaded = if cfg!(target_os = "windows") {
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|d| d.join("conpty.dll").is_file()))
            .unwrap_or(false)
    } else {
        false
    };
    TerminalCapabilities {
        conpty_sideloaded,
        platform: std::env::consts::OS,
    }
}

/// Subscribe a view to a terminal's output. The current scrollback is sent
/// through `on_data` before any live bytes, so the view can simply write
/// everything it receives in order. Returns a token for `detach_terminal`.
#[tauri::command]
pub fn attach_terminal(
    state: State<AppState>,
    terminal_id: String,
    on_data: Channel<InvokeResponseBody>,
) -> u64 {
    let hub = state.process_manager.terminal_hub();
    hub.attach(
        &terminal_id,
        Box::new(move |bytes: &[u8]| {
            on_data
                .send(InvokeResponseBody::Raw(bytes.to_vec()))
                .is_ok()
        }),
    )
}

#[tauri::command]
pub fn detach_terminal(state: State<AppState>, terminal_id: String, token: u64) {
    state.process_manager.terminal_hub().detach(&terminal_id, token);
}

/// Keyboard input from the view. `data` is whatever xterm.js produced
/// (UTF-8 text, control bytes, escape sequences for special keys).
#[tauri::command]
pub fn write_terminal(state: State<AppState>, terminal_id: String, data: String) -> Result<(), String> {
    state
        .process_manager
        .write_terminal(&terminal_id, data.as_bytes())
}

#[tauri::command]
pub fn resize_terminal(
    state: State<AppState>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // A view can exist for a process that already exited (or hasn't started
    // yet); resizing then is meaningless, not an error.
    if !state.process_manager.has_terminal(&terminal_id) {
        return Ok(());
    }
    state.process_manager.resize_terminal(&terminal_id, cols, rows)
}

/// Drop the stored scrollback (the "Clear" button). Live output keeps flowing.
#[tauri::command]
pub fn clear_terminal_scrollback(state: State<AppState>, terminal_id: String) {
    state.process_manager.terminal_hub().clear(&terminal_id);
}

/// Forget a terminal completely (tab closed for good).
#[tauri::command]
pub fn remove_terminal(state: State<AppState>, terminal_id: String) {
    state.process_manager.terminal_hub().remove(&terminal_id);
    state.process_manager.forget_terminal_state(&terminal_id);
}

/// Shell-integration state (cwd, running command, last exit code) of every
/// terminal that reported one. Used to seed the GUI after a reload; live
/// updates arrive through the `terminal-state` event.
#[tauri::command]
pub fn get_terminal_states(state: State<AppState>) -> Vec<cortx_core::terminal::TerminalShellState> {
    state.process_manager.all_terminal_states()
}

/// Finished commands across all CortX terminals, newest first — the whole
/// history view (#39) and the input editor's history both come through here.
///
/// `query` carries the filters (text, project, directory, failures only,
/// minimum duration, paging); without one this is just "the last `limit`
/// records", which is what the older callers ask for. The filtering happens in
/// Rust on purpose: `command-history.jsonl` is capped at 10 MB, which is more
/// than a webview should ever hold, and one streamed pass answers the page,
/// the match count and the filter dropdowns at once. Runs off the UI thread —
/// a full pass over a large file is tens of milliseconds.
#[tauri::command]
pub async fn get_command_history(
    state: State<'_, AppState>,
    limit: Option<usize>,
    query: Option<cortx_core::terminal::history::HistoryQuery>,
) -> Result<cortx_core::terminal::history::HistoryPage, String> {
    let history = state.process_manager.command_history().clone();
    let mut query = query.unwrap_or_default();
    if query.limit == 0 {
        query.limit = limit.unwrap_or(200);
    }
    tauri::async_runtime::spawn_blocking(move || history.query(&query))
        .await
        .map_err(|e| e.to_string())
}

/// `TerminalConfig::default()`, as serde writes it — the defaults the settings
/// panel's "changed" markers compare against (ticket #39).
///
/// Why a command rather than a constant in the frontend: there were two
/// answers to "what is this setting worth untouched?", one here and one in
/// TypeScript, and nothing stopped them drifting. This is the one that reaches
/// `settings.json`, so it is the one that counts, and the frontend now reads
/// it from the process that writes the file.
///
/// **What this does not answer.** The `Option` fields are
/// `skip_serializing_if = "Option::is_none"`, so they are simply absent from
/// the object — `font_size` is `None` here and a terminal opens at 13. That
/// effective default is the frontend's (`terminalDefaults.ts` holds the
/// seventeen of them, and `checkTerminalDefaults` verifies at runtime that the
/// two sets do not overlap). Serialising the `None`s as `null` instead would
/// hand the frontend a value that is wrong rather than a field that is
/// missing, which is worse: absent is unambiguous.
///
/// Cheap and synchronous on purpose — it builds a struct and touches no disk,
/// and the frontend calls it once at startup alongside `get_settings`.
#[tauri::command]
pub fn terminal_default_settings() -> cortx_core::models::TerminalConfig {
    cortx_core::models::TerminalConfig::default()
}

/// Run the secret filter over the command history that is **already on disk**
/// (ticket #41's other half).
///
/// `redact_secrets` masks every new line on its way into
/// `command-history.jsonl`, but a file written before that existed still holds
/// whatever was typed. This puts the existing file — and its `.jsonl.1`
/// archive — through the same filter.
///
/// It is deliberately a lever and not a reflex: nothing calls it at startup,
/// and the only caller is a button behind a confirmation. The rewrite is
/// **irreversible by design** — see `CommandHistory::redact_existing`, which
/// writes no `.bak`, because a backup with the secrets still in it would
/// defeat the whole exercise. Only lines that actually change are rewritten;
/// everything else is copied byte for byte.
///
/// Off the UI thread like [`get_command_history`]: the file is capped at
/// `history_max_mb` (10 MB by default) and this is a full read-and-rewrite
/// pass over it.
#[tauri::command]
pub async fn redact_command_history(
    state: State<'_, AppState>,
) -> Result<cortx_core::terminal::history::RedactionReport, String> {
    let history = state.process_manager.command_history().clone();
    tauri::async_runtime::spawn_blocking(move || history.redact_existing())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Completions and suggestions (#17)
// ---------------------------------------------------------------------------

/// How many history records the ranking looks at. `recent` reads backwards
/// from the end of the file and stops here, so this bounds the work *and* the
/// bytes touched (~1 MB), whatever the history has grown to.
const SUGGEST_SCAN: usize = 4000;

/// Commands from the shared history, ranked for one terminal's context.
///
/// The score mixes frequency, recency, "ran in this very directory" and "ran
/// in this project", and sinks commands that never once exited 0 — see
/// `cortx_core::terminal::rank_commands`. Every component is independent of
/// what the user has typed so far, which is what lets the frontend fetch the
/// list once per prompt and filter it locally without touching the disk on
/// each keystroke.
///
/// Off the UI thread like `get_command_history`: this is disk work, called
/// again every 10 s per directory, and the IPC thread has a whole GUI waiting
/// behind it.
#[tauri::command]
pub async fn suggest_history(
    state: State<'_, AppState>,
    cwd: Option<String>,
    project_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<cortx_core::terminal::CommandSuggestion>, String> {
    let ctx = cortx_core::terminal::SuggestContext {
        cwd,
        project_id,
        now_ms: Utc::now().timestamp_millis(),
    };
    let history = state.process_manager.command_history().clone();
    let limit = limit.unwrap_or(400).min(2000);
    tauri::async_runtime::spawn_blocking(move || history.suggestions(&ctx, SUGGEST_SCAN, limit))
        .await
        .map_err(|e| e.to_string())
}

/// Flags and subcommands of `command`, learned from its own `--help` page the
/// first time and remembered under `runtime/command-specs/`.
///
/// Returns `None` when the name may not be probed at all (see the safety
/// policy on `cortx_core::terminal::spec`): it must be a bare, well-formed
/// program name that already resolves on the PATH and isn't on the deny list.
/// Runs off the UI thread; the `--help` child is killed after 5 s and its
/// output capped.
#[tauri::command]
pub async fn get_command_spec(
    state: State<'_, AppState>,
    command: String,
    refresh: Option<bool>,
) -> Result<Option<cortx_core::terminal::CommandSpec>, String> {
    let store = cortx_core::terminal::SpecStore::new(state.process_manager.runtime_store().dir());
    let refresh = refresh.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || store.get_or_learn(&command, refresh))
        .await
        .map_err(|e| e.to_string())
}

/// Branches, remotes and tags of the repository at `cwd` (`git for-each-ref`).
/// Empty when it isn't a repository or git isn't installed.
#[tauri::command]
pub async fn complete_git_refs(cwd: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        cortx_core::terminal::git_refs(Path::new(&cwd))
    })
    .await
    .map_err(|e| e.to_string())
}

/// `scripts` of the `package.json` in `cwd` (for `npm run <TAB>`).
#[tauri::command]
pub fn complete_npm_scripts(cwd: String) -> Vec<cortx_core::terminal::SpecItem> {
    cortx_core::terminal::npm_scripts(Path::new(&cwd))
}

/// Directory entries matching a half-typed path, resolved against `cwd`.
#[tauri::command]
pub fn complete_paths(
    cwd: String,
    fragment: String,
    limit: Option<usize>,
) -> Vec<cortx_core::terminal::PathCompletion> {
    cortx_core::terminal::complete_path(Path::new(&cwd), &fragment, limit.unwrap_or(60))
}

// ---------------------------------------------------------------------------
// Terminal layout + Terminal window (DEV-13 P1)
// ---------------------------------------------------------------------------

/// The shared layout document and its revision.
#[tauri::command]
pub fn get_terminal_layout(state: State<AppState>) -> cortx_core::terminal::LayoutDoc {
    state.terminal_layout.get()
}

/// Payload of the `terminal-layout` broadcast.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalLayoutEvent {
    revision: u64,
    layout: serde_json::Value,
    /// Label of the window that wrote it, so it can ignore its own echo.
    source: String,
}

/// Replace the shared layout. `source` is the writing window's label.
/// Returns the new revision; every window (including the writer) receives
/// the `terminal-layout` event.
#[tauri::command]
pub fn set_terminal_layout(
    app_handle: AppHandle,
    state: State<AppState>,
    layout: serde_json::Value,
    source: String,
) -> u64 {
    let revision = state.terminal_layout.set(layout.clone());
    let _ = app_handle.emit(
        "terminal-layout",
        TerminalLayoutEvent {
            revision,
            layout,
            source,
        },
    );
    revision
}

/// Open (or focus) the dedicated Terminal window, optionally scoped to a
/// project. If the window already exists the scope is sent as the
/// `terminal-scope` event instead.
///
/// `async` on purpose: a synchronous command runs on the main thread, and on
/// Windows creating a webview from there deadlocks its initialisation (the
/// window shows up but stays on about:blank).
#[tauri::command]
pub async fn open_terminal_window(
    app_handle: AppHandle,
    project_id: Option<String>,
    launch: Option<String>,
) -> Result<(), String> {
    crate::open_terminal_window(&app_handle, project_id.as_deref(), launch.as_deref())
}

/// Open (or focus) one Terminal window by label — `terminal`, `terminal-2`…
/// `x` / `y` (logical screen pixels) place a brand-new window where a tab was
/// dropped. `async` for the same reason as `open_terminal_window`: a
/// synchronous window build leaves the WebView on about:blank under Windows.
#[tauri::command]
pub async fn open_terminal_window_labelled(
    app_handle: AppHandle,
    label: String,
    project_id: Option<String>,
    launch: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<(), String> {
    let position = match (x, y) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    };
    crate::open_terminal_window_labelled(
        &app_handle,
        &label,
        project_id.as_deref(),
        launch.as_deref(),
        position,
    )
}

/// The one line to type into a sub-shell so it reports its directory and its
/// commands to CortX (ticket #16). Self-contained: it carries the integration
/// block base64-encoded and sets `CORTX_TERMINAL_ID` itself, so it also works
/// over ssh or inside a container, where neither the variable nor the `cortx`
/// binary exists.
#[tauri::command]
pub fn terminal_subshell_snippet(
    state: State<AppState>,
    shell: String,
    terminal_id: String,
) -> Result<String, String> {
    let shell_type = cortx_core::shell_init::Shell::from_str(&shell)
        .ok_or_else(|| format!("Unknown shell: {}", shell))?;
    let tcfg = state.storage.get_settings().terminal;
    if !tcfg.shell_integration {
        return Err("Shell integration is turned off".into());
    }
    Ok(cortx_core::shell_init::subshell_injection(
        &shell_type,
        &terminal_id,
        cortx_core::shell_init::InitOptions {
            shell_integration: true,
            disable_shell_predictions: tcfg.inline_suggestions,
        },
    ))
}

/// What there is to say about the shell a terminal is actually running, or
/// `None` when it is one CortX has an integration for
/// (`cortx_core::shell_init::unsupported_shell_note`).
///
/// A pure lookup on a program name — no state, no side effect — because the
/// decision of *when* to say it belongs to the UI: the sentence is shown once
/// per program name, as a dismissible banner over the terminal surface
/// (`ShellNoteBanner`), never as a toast and never once per terminal. Without
/// it, a user running `xonsh` or `csh` gets a CortX with its blocks, enriched
/// history, completion notifications, input editor, live tab title and block
/// spacing all quietly missing, and no way to find out why.
#[tauri::command]
pub fn terminal_shell_note(program: String) -> Option<String> {
    cortx_core::shell_init::unsupported_shell_note(&program)
}

/// Show / focus the main window (from the Terminal window).
#[tauri::command]
pub fn show_main_window(app_handle: AppHandle) {
    crate::show_main_window(&app_handle);
}

/// The project scope a freshly created Terminal window was asked for, if
/// any. Cleared on read so a later reload does not re-apply it.
#[tauri::command]
pub fn take_terminal_window_scope(state: State<AppState>) -> Option<String> {
    state.terminal_window_scope.lock().ok().and_then(|mut s| s.take())
}

/// Launch configuration name/id requested by `cortx terminal --layout`,
/// cleared on read.
#[tauri::command]
pub fn take_terminal_window_launch(state: State<AppState>) -> Option<String> {
    state.terminal_window_launch.lock().ok().and_then(|mut s| s.take())
}

// ---------------------------------------------------------------------------
// Session restore + launch configurations (DEV-13 P2)
// ---------------------------------------------------------------------------

/// Write the scrollback tail of every live terminal to
/// `runtime/terminal-snapshots/`. The backend also does this at quit and
/// every minute; the GUI calls it before it recreates shells.
#[tauri::command]
pub fn save_terminal_snapshots(state: State<AppState>, terminal_ids: Option<Vec<String>>) {
    let settings = state.storage.get_settings().terminal;
    if !settings.restore_scrollback {
        return;
    }
    cortx_core::terminal::snapshot::save_all(
        state.process_manager.terminal_hub(),
        state.storage.app_dir().join("runtime").as_path(),
        terminal_ids.as_deref(),
        settings.restore_scrollback_lines as usize,
    );
}

/// Snapshot produced by the GUI: the xterm buffer serialised as plain lines
/// with colours (no cursor movement), which replays cleanly at any width.
/// Preferred over the backend's raw PTY tail when fresh.
#[tauri::command]
pub fn store_terminal_snapshot(state: State<AppState>, terminal_id: String, text: String) {
    if !state.storage.get_settings().terminal.restore_scrollback {
        return;
    }
    cortx_core::terminal::snapshot::store(
        state.storage.app_dir().join("runtime").as_path(),
        &terminal_id,
        text.as_bytes(),
    );
}

/// Drop snapshots of terminals that are no longer in the layout.
#[tauri::command]
pub fn prune_terminal_snapshots(state: State<AppState>, keep: Vec<String>) {
    cortx_core::terminal::snapshot::prune_except(state.storage.app_dir().join("runtime").as_path(), &keep);
}

#[tauri::command]
pub fn list_launch_configs(state: State<AppState>) -> Vec<cortx_core::terminal::LaunchConfig> {
    state.launch_configs.list()
}

#[tauri::command]
pub fn get_launch_config(state: State<AppState>, id: String) -> Option<cortx_core::terminal::LaunchConfig> {
    state.launch_configs.get(&id)
}

/// Raw YAML of a configuration (for the editor); a fresh template when `id`
/// is unknown.
#[tauri::command]
pub fn read_launch_config_yaml(state: State<AppState>, id: String) -> Option<String> {
    state.launch_configs.read_yaml(&id)
}

#[tauri::command]
pub fn save_launch_config(
    state: State<AppState>,
    config: cortx_core::terminal::LaunchConfig,
) -> Result<cortx_core::terminal::LaunchConfig, String> {
    state.launch_configs.save(&config)?;
    Ok(config)
}

/// Validate and store YAML as typed by the user. `expected_id` is the file
/// being edited (renamed ids replace it).
#[tauri::command]
pub fn save_launch_config_yaml(
    state: State<AppState>,
    expected_id: Option<String>,
    yaml: String,
) -> Result<cortx_core::terminal::LaunchConfig, String> {
    state.launch_configs.save_yaml(expected_id.as_deref(), &yaml)
}

#[tauri::command]
pub fn delete_launch_config(state: State<AppState>, id: String) -> Result<(), String> {
    state.launch_configs.delete(&id)
}

/// Serialise a configuration to YAML without saving (editor preview).
#[tauri::command]
pub fn launch_config_to_yaml(config: cortx_core::terminal::LaunchConfig) -> Result<String, String> {
    config.validate()?;
    config.to_yaml()
}

/// OS-level notification (toast centre). The GUI decides *when*; this only
/// wraps the plugin so the frontend needs no extra JS dependency.
#[tauri::command]
pub fn send_os_notification(app_handle: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app_handle
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn spawn_shell(
    app_handle: AppHandle,
    state: State<AppState>,
    cwd: Option<String>,
    project_id: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    restore_from: Option<String>,
) -> Result<cortx_core::process_manager::ShellInfo, String> {
    // Default cwd: the project's root when a project is given.
    let cwd = match (cwd, &project_id) {
        (Some(c), _) if !c.trim().is_empty() => c,
        (_, Some(pid)) => state
            .storage
            .get_project(pid)
            .map(|p| p.root_path)
            .unwrap_or_default(),
        _ => String::new(),
    };
    let tcfg = state.storage.get_settings().terminal;
    let shell = tcfg.integrated_shell.clone();
    // Shell integration is injected by the app itself (start-up code after
    // the profile), so it does not depend on the CLI in the user's profile.
    let integration = tcfg.shell_integration.then_some(cortx_core::shell_init::InitOptions {
        shell_integration: true,
        disable_shell_predictions: tcfg.inline_suggestions,
    });
    let emitter: Arc<dyn ProcessEventEmitter> = Arc::new(TauriEmitter::new(app_handle));
    state.process_manager.spawn_shell(
        emitter,
        cortx_core::process_manager::ShellSpawnRequest {
            cwd,
            project_id,
            shell,
            cols: cols.unwrap_or(0),
            rows: rows.unwrap_or(0),
            restore_from: restore_from.filter(|s| !s.is_empty()),
            integration,
        },
    )
}

#[tauri::command]
pub fn kill_shell(app_handle: AppHandle, state: State<AppState>, shell_id: String) -> Result<(), String> {
    let emitter = TauriEmitter::new(app_handle);
    state.process_manager.kill_shell(&emitter, &shell_id)
}

#[tauri::command]
pub fn list_shells(state: State<AppState>) -> Vec<cortx_core::process_manager::ShellInfo> {
    state.process_manager.list_shells()
}

// ============================================================================
// Terminal themes (DEV-13 P3) — data/terminal/themes/*.yaml in Warp's format
// ============================================================================

fn theme_store(state: &State<AppState>) -> cortx_core::terminal::ThemeStore {
    cortx_core::terminal::ThemeStore::new(&state.storage.terminal_dir())
}

/// Payload of the `terminal-themes-changed` broadcast: the theme keys whose
/// file (or wallpaper) was touched on disk. Emitted to **every** window (like
/// `terminal-layout`) by the watcher started in `lib.rs`'s `setup`, so a
/// `.yaml` dropped in the folder — or imported from the other window — needs
/// no restart.
#[derive(Clone, serde::Serialize)]
pub struct TerminalThemesChangedEvent {
    keys: Vec<String>,
}

pub fn terminal_themes_changed(keys: Vec<String>) -> TerminalThemesChangedEvent {
    TerminalThemesChangedEvent { keys }
}

/// Where the theme files live, so the picker can open the folder rather than
/// rebuild the path per platform on the frontend.
#[tauri::command]
pub fn terminal_themes_dir(state: State<AppState>) -> String {
    theme_store(&state).dir().display().to_string()
}

#[tauri::command]
pub fn list_terminal_themes(state: State<AppState>) -> Vec<cortx_core::terminal::ThemeSummary> {
    theme_store(&state).list()
}

#[tauri::command]
pub fn get_terminal_theme(state: State<AppState>, name: String) -> Option<cortx_core::terminal::TerminalTheme> {
    theme_store(&state).get(&name)
}

#[tauri::command]
pub fn import_terminal_theme_file(
    state: State<AppState>,
    path: String,
) -> Result<cortx_core::terminal::TerminalTheme, String> {
    theme_store(&state).import_file(Path::new(&path))
}

#[tauri::command]
pub fn import_terminal_theme_folder(
    state: State<AppState>,
    path: String,
) -> Result<cortx_core::terminal::themes::ImportReport, String> {
    theme_store(&state).import_folder(Path::new(&path))
}

#[tauri::command]
pub fn delete_terminal_theme(state: State<AppState>, name: String) -> Result<(), String> {
    theme_store(&state).delete(&name)
}

#[tauri::command]
pub fn save_terminal_theme(
    state: State<AppState>,
    theme: cortx_core::terminal::TerminalTheme,
) -> Result<cortx_core::terminal::TerminalTheme, String> {
    theme_store(&state).save(theme)
}

/// The theme's wallpaper as a `data:` URL (`None` when the theme has none).
#[tauri::command]
pub fn read_terminal_theme_image(state: State<AppState>, name: String) -> Result<Option<String>, String> {
    theme_store(&state).read_image(&name)
}

/// Apply a backdrop effect to the Terminal window (`window-vibrancy`).
///
/// - Windows: `acrylic` (tinted blur, Windows 10 1809+) or `mica` (Windows
///   11). Both need the window to be transparent, which `open_terminal_window`
///   guarantees. `opacity` (50–100) only feeds the acrylic tint's alpha — the
///   real window opacity is done in CSS (`--terminal-window-alpha`), Tauri has
///   no per-window alpha on Windows.
/// - macOS: `vibrancy` (NSVisualEffectView, hud / under-window material).
/// - `none`: clear every effect; the transparent window then shows the
///   desktop through whatever alpha the CSS leaves.
///
/// `tint` is the theme background (`#rrggbb`) used as the acrylic tint, and
/// `dark` picks the mica / vibrancy material.
pub fn apply_terminal_window_effect(
    window: &tauri::WebviewWindow,
    effect: cortx_core::models::WindowEffect,
    opacity: u8,
    tint: Option<&str>,
    dark: bool,
) -> Result<(), String> {
    use cortx_core::models::WindowEffect;
    let opacity = opacity.clamp(50, 100);
    let _ = (opacity, tint, dark);

    #[cfg(target_os = "windows")]
    {
        // Always clear first: switching acrylic ↔ mica needs a clean slate.
        let _ = window_vibrancy::clear_acrylic(window);
        let _ = window_vibrancy::clear_mica(window);
        match effect {
            WindowEffect::None | WindowEffect::Vibrancy => Ok(()),
            WindowEffect::Acrylic => {
                let (r, g, b) = tint.and_then(parse_rgb).unwrap_or(if dark { (18, 18, 18) } else { (240, 240, 240) });
                // The tint alpha is what makes acrylic look opaque-ish; map 50–100 % to 40–200.
                let a = (40.0 + (opacity as f32 - 50.0) / 50.0 * 160.0).round() as u8;
                window_vibrancy::apply_acrylic(window, Some((r, g, b, a))).map_err(|e| e.to_string())
            }
            WindowEffect::Mica => window_vibrancy::apply_mica(window, Some(dark)).map_err(|e| e.to_string()),
        }
    }
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState};
        let _ = window_vibrancy::clear_vibrancy(window);
        match effect {
            WindowEffect::None | WindowEffect::Acrylic | WindowEffect::Mica => Ok(()),
            WindowEffect::Vibrancy => window_vibrancy::apply_vibrancy(
                window,
                if dark { NSVisualEffectMaterial::HudWindow } else { NSVisualEffectMaterial::UnderWindowBackground },
                Some(NSVisualEffectState::Active),
                None,
            )
            .map_err(|e| e.to_string()),
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (window, effect);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn parse_rgb(hex: &str) -> Option<(u8, u8, u8)> {
    let h = hex.trim().strip_prefix('#')?;
    let full: String = match h.len() {
        3 | 4 => h.chars().take(3).flat_map(|c| [c, c]).collect(),
        6 | 8 => h[..6].to_string(),
        _ => return None,
    };
    let v = u32::from_str_radix(&full, 16).ok()?;
    Some(((v >> 16) as u8, (v >> 8 & 0xff) as u8, (v & 0xff) as u8))
}

/// Set the Terminal window's backdrop effect from the GUI (see
/// [`apply_terminal_window_effect`]). No-op when the window is not open.
#[tauri::command]
pub fn set_terminal_window_effect(
    app_handle: AppHandle,
    effect: String,
    opacity: u8,
    tint: Option<String>,
    dark: Option<bool>,
) -> Result<(), String> {
    use cortx_core::models::WindowEffect;
    use tauri::Manager;
    let effect = match effect.as_str() {
        "acrylic" => WindowEffect::Acrylic,
        "mica" => WindowEffect::Mica,
        "vibrancy" => WindowEffect::Vibrancy,
        _ => WindowEffect::None,
    };
    // Every Terminal window, not just the first: a window a tab was detached
    // into (`terminal-2`…) wears the same theme (ticket #20).
    for (label, window) in app_handle.webview_windows() {
        if !crate::is_terminal_window_label(&label) {
            continue;
        }
        apply_terminal_window_effect(&window, effect, opacity, tint.as_deref(), dark.unwrap_or(true))?;
    }
    Ok(())
}
