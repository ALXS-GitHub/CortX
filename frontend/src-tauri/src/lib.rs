mod commands;
mod models;
mod process_manager;
mod storage;

use commands::AppState;
use process_manager::ProcessManager;
use storage::Storage;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize storage
    let storage = Storage::new().expect("Failed to initialize storage");
    let process_manager = ProcessManager::new();

    let app_state = AppState {
        storage: Arc::new(storage),
        process_manager: Arc::new(process_manager),
    };

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init());

    // Only initialize updater in release builds
    #[cfg(not(debug_assertions))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Prevent the window from closing immediately
                api.prevent_close();

                let app_handle = window.app_handle().clone();
                let window_clone = window.clone();

                // Spawn a thread to handle cleanup
                std::thread::spawn(move || {
                    // Get the process manager and stop all services
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        log::info!("Window close requested - stopping all services...");
                        state.process_manager.stop_all();
                        log::info!("All services stopped, closing window...");
                    }

                    // Now destroy the window (not close, which would trigger another CloseRequested)
                    let _ = window_clone.destroy();
                });
            }
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
            // Script commands
            commands::add_script,
            commands::update_script,
            commands::delete_script,
            commands::reorder_scripts,
            commands::run_script,
            commands::stop_script,
            commands::is_script_running,
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
            commands::open_in_vscode,
            commands::validate_path,
            // Environment file commands
            commands::discover_env_files,
            commands::add_env_file,
            commands::remove_env_file,
            commands::refresh_env_file,
            commands::refresh_all_env_files,
            commands::get_env_files,
            commands::get_env_file_content,
            commands::compare_env_files,
            commands::link_env_to_service,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
