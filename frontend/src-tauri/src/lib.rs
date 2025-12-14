mod commands;
mod models;
mod process_manager;
mod storage;

use commands::AppState;
use process_manager::ProcessManager;
use storage::Storage;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize storage
    let storage = Storage::new().expect("Failed to initialize storage");
    let process_manager = ProcessManager::new();

    let app_state = AppState {
        storage: Arc::new(storage),
        process_manager: Arc::new(process_manager),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // Project commands
            commands::get_all_projects,
            commands::get_project,
            commands::create_project,
            commands::update_project,
            commands::delete_project,
            commands::update_project_last_opened,
            // Service commands
            commands::add_service,
            commands::update_service,
            commands::delete_service,
            commands::reorder_services,
            // Launch commands
            commands::get_launch_command,
            commands::launch_external_terminal,
            commands::start_integrated_service,
            commands::stop_integrated_service,
            commands::is_service_running,
            commands::get_running_services,
            // Settings commands
            commands::get_settings,
            commands::update_settings,
            // Utility commands
            commands::open_in_explorer,
            commands::validate_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
