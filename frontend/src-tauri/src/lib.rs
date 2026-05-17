mod commands;
mod models;
mod process_manager;
mod storage;
mod tauri_emitter;

use commands::AppState;
use cortx_core::file_watcher;
use process_manager::ProcessManager;
use storage::Storage;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

pub const DEFAULT_GLOBAL_HOTKEY: &str = "CmdOrCtrl+Shift+Space";

/// Show / unminimize / focus the main window. No-op if it's missing.
fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Toggle the main window's visibility. Used by left-clicks on the tray icon.
fn toggle_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        match w.is_visible() {
            Ok(true) => {
                let _ = w.hide();
            }
            _ => {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
    }
}

/// Trigger the real quit flow: set the `quitting` flag and close the window.
/// The on_window_event handler observes the flag and runs the cleanup path.
fn trigger_quit(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        state.quitting.store(true, Ordering::SeqCst);
    }
    if let Some(w) = app.get_webview_window("main") {
        // Surface the window so the ClosingModal is visible during cleanup.
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.close();
    } else {
        // No window left — there's nothing for CloseRequested to fire on,
        // so just exit the app directly.
        app.exit(0);
    }
}

/// (Re-)register the global palette hotkey. Empty / blank `combo` unregisters.
pub fn register_hotkey(app: &AppHandle, combo: &str) -> Result<(), String> {
    // Always clear before registering — keeps state consistent across calls.
    let _ = app.global_shortcut().unregister_all();
    let trimmed = combo.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let shortcut: Shortcut = trimmed.parse().map_err(|e| format!("Invalid hotkey '{}': {}", trimmed, e))?;
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize storage
    let storage = Storage::new().expect("Failed to initialize storage");
    let process_manager = ProcessManager::new();

    let app_state = AppState {
        storage: Arc::new(storage),
        process_manager: Arc::new(process_manager),
        quitting: Arc::new(AtomicBool::new(false)),
    };

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                        let _ = app.emit("open-command-palette", ());
                    }
                })
                .build(),
        );

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

            // Window chrome is platform-specific and can't be expressed in
            // tauri.conf.json directly. The config sets:
            //   - decorations: true        (required for macOS Overlay style)
            //   - titleBarStyle: Overlay   (hides macOS title bar but keeps traffic lights)
            //   - visible: false           (we show after fixing Win/Linux below)
            // On Windows/Linux we don't want native chrome at all because we
            // ship a custom TitleBar component, so we drop decorations here
            // before showing the window.
            if let Some(main) = app.get_webview_window("main") {
                #[cfg(any(target_os = "windows", target_os = "linux"))]
                {
                    let _ = main.set_decorations(false);
                }
                let _ = main.show();
            }

            // Start file watcher for cross-process data sync
            let app_handle = app.handle().clone();
            let state: tauri::State<AppState> = app.state();
            let storage_ref = state.storage.clone();
            let watch_dir = storage_ref.app_dir().to_path_buf();

            let watcher_handle = file_watcher::start_watching(watch_dir, move |_changed| {
                if storage_ref.is_watcher_suppressed() {
                    return;
                }
                if let Err(e) = storage_ref.reload_all() {
                    log::error!("File watcher reload failed: {}", e);
                    return;
                }
                let _ = app_handle.emit("data-changed", ());
            })?;

            // Keep watcher alive for the lifetime of the app
            app.manage(watcher_handle);

            // Register the global hotkey from persisted settings (or default).
            let combo = state
                .storage
                .get_settings()
                .global_hotkey
                .unwrap_or_else(|| DEFAULT_GLOBAL_HOTKEY.to_string());
            if let Err(e) = register_hotkey(app.handle(), &combo) {
                log::warn!("Could not register global hotkey '{}': {}", combo, e);
            }

            // System tray icon — keeps the app alive after the window is
            // hidden via X, and provides Show / Open Palette / Quit actions.
            let show_item = MenuItem::with_id(app, "tray-show", "Show CortX", true, None::<&str>)?;
            let palette_item =
                MenuItem::with_id(app, "tray-palette", "Open Command Palette", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "tray-quit", "Quit CortX", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &palette_item, &sep, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("CortX")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray-show" => show_main_window(app),
                    "tray-palette" => {
                        show_main_window(app);
                        let _ = app.emit("open-command-palette", ());
                    }
                    "tray-quit" => trigger_quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button,
                        button_state,
                        ..
                    } = event
                    {
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            toggle_main_window(tray.app_handle());
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            let _tray = tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app_handle = window.app_handle().clone();
                let is_quitting = app_handle
                    .try_state::<AppState>()
                    .map(|s| s.quitting.load(Ordering::SeqCst))
                    .unwrap_or(false);

                // Default behaviour: clicking the X (or any close request that
                // didn't go through trigger_quit / quit_app) just hides the
                // window. The tray icon keeps the app alive and the hotkey
                // active. Services stay running.
                if !is_quitting {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }

                // Real quit path — same flow as before: stop_all -> destroy.
                // We additionally call app.exit(0) at the end because the
                // tray icon would otherwise keep the process alive.
                api.prevent_close();
                let window_clone = window.clone();
                std::thread::spawn(move || {
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        let has_running = state.process_manager.has_running_processes();
                        if has_running {
                            log::info!("Quit requested - notifying frontend of cleanup...");
                            let _ = window_clone.emit("app-closing", true);
                            std::thread::sleep(std::time::Duration::from_millis(100));
                        }
                        log::info!("Stopping all services...");
                        state.process_manager.stop_all();
                        log::info!("All services stopped, closing window...");
                    }
                    let _ = window_clone.destroy();
                    app_handle.exit(0);
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
            commands::set_global_hotkey,
            commands::quit_app,
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
            // Global script commands
            commands::get_all_global_scripts,
            commands::get_global_script,
            commands::create_global_script,
            commands::update_global_script,
            commands::delete_global_script,
            commands::reorder_global_scripts,
            commands::run_global_script,
            commands::stop_global_script,
            commands::is_global_script_running,
            // Tag definition commands
            commands::get_all_tag_definitions,
            commands::create_tag_definition,
            commands::update_tag_definition,
            commands::delete_tag_definition,
            // Execution history commands
            commands::get_execution_history,
            commands::clear_execution_history,
            // Scripts config commands
            commands::get_scripts_config,
            commands::update_scripts_config,
            commands::scan_scripts_folder,
            // Help parser commands
            commands::auto_detect_script_params,
            // Import / Export / Backup
            commands::export_scripts_config,
            commands::preview_import,
            commands::import_scripts_config,
            commands::backup_to_git,
            // Tool commands
            commands::get_all_tools,
            commands::get_tool,
            commands::create_tool,
            commands::update_tool,
            commands::delete_tool,
            commands::reorder_tools,
            commands::open_tool_config,
            commands::open_tool_location,
            commands::open_tool_location_vscode,
            commands::open_tool_url,
            // Tool discovery
            commands::scan_installed_tools,
            // Execution history update
            commands::update_execution_record,
            // Alias commands
            commands::get_all_aliases,
            commands::get_alias,
            commands::create_alias,
            commands::update_alias,
            commands::delete_alias,
            commands::reorder_aliases,
            commands::generate_shell_init,
            // Status definition commands
            commands::get_all_status_definitions,
            commands::create_status_definition,
            commands::update_status_definition,
            commands::delete_status_definition,
            // App commands
            commands::get_all_apps,
            commands::get_app,
            commands::create_app,
            commands::update_app,
            commands::delete_app,
            commands::reorder_apps,
            commands::launch_app,
            commands::open_app_config,
            commands::open_app_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
