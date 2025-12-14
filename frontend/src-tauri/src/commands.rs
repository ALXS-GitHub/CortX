use crate::models::{
    AppSettings, CreateProjectInput, CreateServiceInput, Project, Service,
    UpdateProjectInput, UpdateServiceInput,
};
use crate::process_manager::ProcessManager;
use crate::storage::Storage;
use chrono::Utc;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, State};

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
pub fn delete_project(state: State<AppState>, id: String) -> Result<(), String> {
    // Stop any running services for this project
    if let Some(project) = state.storage.get_project(&id) {
        for service in &project.services {
            let _ = state.process_manager.stop_service(&service.id);
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
pub fn delete_service(state: State<AppState>, service_id: String) -> Result<(), String> {
    // Stop if running
    let _ = state.process_manager.stop_service(&service_id);

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
    app_handle: AppHandle,
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

    let full_command = format!("cd \"{}\" && {}", working_dir, service.command);

    // Build the command based on terminal configuration
    let mut args = settings.terminal.arguments.clone();
    args.push(full_command);

    // Use tauri-plugin-shell to open the terminal
    use tauri_plugin_shell::ShellExt;

    app_handle
        .shell()
        .command(&settings.terminal.executable_path)
        .args(args)
        .spawn()
        .map_err(|e| format!("Failed to launch terminal: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn start_integrated_service(
    app_handle: AppHandle,
    state: State<AppState>,
    service_id: String,
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

    state.process_manager.start_service(
        app_handle,
        service_id,
        working_dir,
        service.command,
        service.env_vars,
    )
}

#[tauri::command]
pub fn stop_integrated_service(state: State<AppState>, service_id: String) -> Result<(), String> {
    state.process_manager.stop_service(&service_id)
}

#[tauri::command]
pub fn is_service_running(state: State<AppState>, service_id: String) -> bool {
    state.process_manager.is_running(&service_id)
}

#[tauri::command]
pub fn get_running_services(state: State<AppState>) -> Vec<String> {
    state.process_manager.get_running_services()
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
