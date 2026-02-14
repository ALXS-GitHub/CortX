use crate::models::{
    AddEnvFileInput, AppSettings, CreateFolderInput, CreateGlobalScriptInput,
    CreateProjectInput, CreateScriptGroupInput, CreateScriptInput, CreateServiceInput,
    DiscoverEnvFilesInput, EnvComparison, EnvFile, EnvFileVariant, EnvVariable,
    DiscoveredScript, ExecutionRecord, GlobalScript, ImportResult, LinkEnvToServiceInput, Project, Script,
    ScriptGroup, ScriptParameter, ScriptsConfig, Service, UpdateFolderInput,
    UpdateGlobalScriptInput, UpdateProjectInput, UpdateScriptGroupInput, UpdateScriptInput,
    UpdateServiceInput, VirtualFolder,
};
use crate::process_manager::{ProcessEventEmitter, ProcessManager};
use crate::storage::Storage;
use crate::tauri_emitter::TauriEmitter;
use chrono::Utc;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, State};
use walkdir::WalkDir;

pub struct AppState {
    pub storage: Arc<Storage>,
    pub process_manager: Arc<ProcessManager>,
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
            if input.color.is_some() {
                service.color = input.color;
            }
            if input.port.is_some() {
                service.port = input.port;
            }
            if input.env_vars.is_some() {
                service.env_vars = input.env_vars;
            }
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
    use crate::models::TerminalPreset;

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

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x00000010;

        match settings.terminal.preset {
            TerminalPreset::WindowsTerminal => {
                // Windows Terminal - use -d for directory and pass the command
                std::process::Command::new("wt.exe")
                    .args(["-d", &working_dir, "cmd", "/k", &service.command])
                    .spawn()
                    .map_err(|e| format!("Failed to launch Windows Terminal: {}", e))?;
            }
            TerminalPreset::PowerShell => {
                // PowerShell - needs CREATE_NEW_CONSOLE to show window
                let ps_command = format!(
                    "Set-Location '{}'; {}",
                    working_dir.replace("'", "''"),
                    service.command
                );
                std::process::Command::new("powershell.exe")
                    .args(["-NoExit", "-Command", &ps_command])
                    .creation_flags(CREATE_NEW_CONSOLE)
                    .spawn()
                    .map_err(|e| format!("Failed to launch PowerShell: {}", e))?;
            }
            TerminalPreset::Cmd => {
                // cmd.exe - needs CREATE_NEW_CONSOLE to show window
                let cmd_str = format!("cd /d \"{}\" && {}", working_dir, service.command);
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

                let full_command = format!("cd /d \"{}\" && {}", working_dir, service.command);
                let mut cmd = std::process::Command::new(&settings.terminal.custom_path);

                if settings.terminal.custom_args.is_empty() {
                    cmd.current_dir(&working_dir);
                } else {
                    for arg in &settings.terminal.custom_args {
                        let replaced = arg
                            .replace("{command}", &service.command)
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
                    .args(["-d", &working_dir, "cmd", "/k", &service.command])
                    .spawn()
                    .map_err(|e| format!("Failed to launch Windows Terminal: {}", e))?;
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        match settings.terminal.preset {
            TerminalPreset::MacTerminal => {
                let script = format!(
                    r#"tell application "Terminal"
                        activate
                        do script "cd '{}' && {}"
                    end tell"#,
                    working_dir.replace("'", "'\\''"),
                    service.command.replace("\"", "\\\"")
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
                    service.command.replace("\"", "\\\"")
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
                    service.command.replace("\"", "\\\"")
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
                    service.command.replace("\"", "\\\"")
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
        let full_command = format!("cd \"{}\" && {}; exec $SHELL", working_dir, service.command);

        match settings.terminal.preset {
            TerminalPreset::Custom => {
                if settings.terminal.custom_path.is_empty() {
                    // Try common terminal emulators
                    let terminals = [
                        ("gnome-terminal", vec!["--", "bash", "-c", &full_command]),
                        ("konsole", vec!["-e", "bash", "-c", &full_command]),
                        ("xfce4-terminal", vec!["-e", &format!("bash -c '{}'", full_command)]),
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
                                .replace("{command}", &service.command)
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
                let terminals = [
                    ("gnome-terminal", vec!["--", "bash", "-c", &full_command]),
                    ("konsole", vec!["-e", "bash", "-c", &full_command]),
                    ("xfce4-terminal", vec!["-e", &format!("bash -c '{}'", full_command)]),
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

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> AppSettings {
    state.storage.get_settings()
}

#[tauri::command]
pub fn update_settings(state: State<AppState>, settings: AppSettings) -> Result<(), String> {
    state
        .storage
        .update_settings(settings)
        .map_err(|e| e.to_string())
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

#[tauri::command]
pub fn open_in_vscode(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // On Windows, try 'code' command (requires VSCode in PATH)
        std::process::Command::new("cmd")
            .args(["/C", "code", &path])
            .spawn()
            .map_err(|e| format!("Failed to open VSCode: {}. Make sure VSCode is installed and 'code' command is in PATH.", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("code")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open VSCode: {}. Make sure VSCode is installed and 'code' command is in PATH.", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("code")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open VSCode: {}. Make sure VSCode is installed and 'code' command is in PATH.", e))?;
    }

    Ok(())
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
    script.folder_id = input.folder_id;
    script.tags = input.tags.unwrap_or_default();
    script.parameters = input.parameters.unwrap_or_default();
    script.parameter_presets = input.parameter_presets.unwrap_or_default();
    script.env_vars = input.env_vars;

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
            if input.folder_id.is_some() {
                script.folder_id = input.folder_id;
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

#[tauri::command]
pub fn run_global_script(
    app_handle: AppHandle,
    state: State<AppState>,
    script_id: String,
    working_dir: String,
    parameter_values: Option<std::collections::HashMap<String, String>>,
    extra_args: Option<String>,
) -> Result<u32, String> {
    let script = state
        .storage
        .get_global_script(&script_id)
        .ok_or_else(|| format!("Global script not found: {}", script_id))?;

    // Replace {{SCRIPT_FILE}} placeholder with absolute script path
    let mut final_command = if let Some(ref script_path) = script.script_path {
        script.command.replace("{{SCRIPT_FILE}}", script_path)
    } else {
        script.command.clone()
    };

    if let Some(params) = &parameter_values {
        for param_def in &script.parameters {
            if let Some(value) = params.get(&param_def.name) {
                if value.is_empty() {
                    continue;
                }
                // For bool params, only add the flag if true
                if param_def.param_type == crate::models::ScriptParamType::Bool {
                    if value == "true" {
                        if let Some(ref flag) = param_def.long_flag {
                            final_command = format!("{} {}", final_command, flag);
                        } else if let Some(ref flag) = param_def.short_flag {
                            final_command = format!("{} {}", final_command, flag);
                        }
                    }
                } else {
                    // For other types, add flag + value
                    if let Some(ref flag) = param_def.long_flag {
                        final_command = format!("{} {} {}", final_command, flag, value);
                    } else if let Some(ref flag) = param_def.short_flag {
                        final_command = format!("{} {} {}", final_command, flag, value);
                    } else {
                        // Positional argument
                        final_command = format!("{} {}", final_command, value);
                    }
                }
            }
        }
    }

    // Append extra args if provided
    if let Some(ref args) = extra_args {
        let trimmed = args.trim();
        if !trimmed.is_empty() {
            final_command = format!("{} {}", final_command, trimmed);
        }
    }

    // Record execution start
    let mut record = ExecutionRecord::new(script_id.clone());
    if let Some(ref params) = parameter_values {
        record.parameters_used = params.clone();
    }
    let _ = state.storage.add_execution_record(record);

    let emitter: Arc<dyn ProcessEventEmitter> = Arc::new(TauriEmitter::new(app_handle));
    let pid = state.process_manager.run_global_script(
        emitter,
        script_id.clone(),
        working_dir,
        final_command,
        script.env_vars,
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
// Virtual Folder commands
// ============================================================================

#[tauri::command]
pub fn get_all_folders(state: State<AppState>) -> Vec<VirtualFolder> {
    state.storage.get_all_folders()
}

#[tauri::command]
pub fn create_folder(
    state: State<AppState>,
    input: CreateFolderInput,
) -> Result<VirtualFolder, String> {
    let mut folder = VirtualFolder::new(input.name, input.folder_type);
    folder.color = input.color;
    folder.icon = input.icon;
    folder.order = input.order;

    state
        .storage
        .create_folder(folder)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_folder(
    state: State<AppState>,
    id: String,
    input: UpdateFolderInput,
) -> Result<VirtualFolder, String> {
    state
        .storage
        .update_folder(&id, |folder| {
            if let Some(name) = input.name {
                folder.name = name;
            }
            if input.color.is_some() {
                folder.color = input.color;
            }
            if input.icon.is_some() {
                folder.icon = input.icon;
            }
            folder.order = input.order;
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_folder(state: State<AppState>, id: String) -> Result<(), String> {
    // Unlink all scripts/projects from this folder
    let scripts = state.storage.get_all_global_scripts();
    for script in scripts {
        if script.folder_id.as_deref() == Some(&id) {
            let _ = state.storage.update_global_script(&script.id, |s| {
                s.folder_id = None;
            });
        }
    }

    let projects = state.storage.get_all_projects();
    for project in projects {
        if project.folder_id.as_deref() == Some(&id) {
            let _ = state.storage.update_project(&project.id, |p| {
                p.folder_id = None;
            });
        }
    }

    state.storage.delete_folder(&id).map_err(|e| e.to_string())
}

// ============================================================================
// Script Group commands
// ============================================================================

#[tauri::command]
pub fn get_all_script_groups(state: State<AppState>) -> Vec<ScriptGroup> {
    state.storage.get_all_script_groups()
}

#[tauri::command]
pub fn create_script_group(
    state: State<AppState>,
    input: CreateScriptGroupInput,
) -> Result<ScriptGroup, String> {
    let mut group = ScriptGroup::new(input.name, input.execution_mode);
    group.description = input.description;
    group.script_ids = input.script_ids;
    group.stop_on_failure = input.stop_on_failure.unwrap_or(true);
    group.folder_id = input.folder_id;

    let all = state.storage.get_all_script_groups();
    group.order = all.len() as u32;

    state
        .storage
        .create_script_group(group)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_script_group(
    state: State<AppState>,
    id: String,
    input: UpdateScriptGroupInput,
) -> Result<ScriptGroup, String> {
    state
        .storage
        .update_script_group(&id, |group| {
            if let Some(name) = input.name {
                group.name = name;
            }
            if input.description.is_some() {
                group.description = input.description;
            }
            if let Some(script_ids) = input.script_ids {
                group.script_ids = script_ids;
            }
            if let Some(mode) = input.execution_mode {
                group.execution_mode = mode;
            }
            if let Some(stop) = input.stop_on_failure {
                group.stop_on_failure = stop;
            }
            if input.folder_id.is_some() {
                group.folder_id = input.folder_id;
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_script_group(state: State<AppState>, id: String) -> Result<(), String> {
    state
        .storage
        .delete_script_group(&id)
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
// Help Parser / Auto-detect Parameters
// ============================================================================

#[tauri::command]
pub fn auto_detect_script_params(command: String, script_path: Option<String>) -> Result<Vec<ScriptParameter>, String> {
    // Resolve {{SCRIPT_FILE}} placeholder before running --help
    let resolved = if let Some(ref path) = script_path {
        command.replace("{{SCRIPT_FILE}}", path)
    } else {
        command
    };
    cortx_core::help_parser::detect_parameters(&resolved)
}

// ============================================================================
// Script Group Execution
// ============================================================================

#[tauri::command]
pub fn run_script_group(
    app_handle: AppHandle,
    state: State<AppState>,
    group_id: String,
) -> Result<Vec<(String, Result<u32, String>)>, String> {
    let group = state
        .storage
        .get_all_script_groups()
        .into_iter()
        .find(|g| g.id == group_id)
        .ok_or_else(|| format!("Script group not found: {}", group_id))?;

    let scripts = state.storage.get_all_global_scripts();

    let script_data: Vec<(String, String, String, Option<std::collections::HashMap<String, String>>)> = group
        .script_ids
        .iter()
        .filter_map(|sid| {
            scripts.iter().find(|s| s.id == *sid).map(|s| {
                (
                    s.id.clone(),
                    s.working_dir.clone().unwrap_or_else(|| ".".to_string()),
                    s.command.clone(),
                    s.env_vars.clone(),
                )
            })
        })
        .collect();

    let sequential = group.execution_mode == crate::models::GroupExecutionMode::Sequential;
    let emitter: Arc<dyn ProcessEventEmitter> = Arc::new(TauriEmitter::new(app_handle));

    Ok(state.process_manager.run_script_group(
        emitter,
        script_data,
        sequential,
        group.stop_on_failure,
    ))
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
pub fn import_scripts_config(
    state: State<AppState>,
    json: String,
) -> Result<ImportResult, String> {
    state
        .storage
        .import_scripts_config(&json)
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
