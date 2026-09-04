mod commands;
mod models;
mod process_manager;
mod storage;
mod tauri_emitter;

use commands::AppState;
use cortx_core::agents::{terminal_link::TerminalAgent, watcher as agent_watcher, AgentIndex};
use cortx_core::file_watcher;
use cortx_core::runtime_state::RuntimeStore;
use process_manager::ProcessManager;
use storage::Storage;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener, Manager};
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

/// Recompute which terminal runs which agent and broadcast it, but only when
/// the answer changed — the payload lands in both windows and feeds the tab
/// titles, so a needless event is a needless re-render everywhere.
fn emit_terminal_agents(app: &AppHandle, last: &Arc<std::sync::Mutex<Vec<TerminalAgent>>>) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let current = commands::compute_terminal_agents(&state);
    let Ok(mut previous) = last.lock() else {
        return;
    };
    if *previous == current {
        return;
    }
    *previous = current.clone();
    drop(previous);
    let _ = app.emit("terminal-agents", current);
}

/// Label of the dedicated Terminal window (DEV-13 P1).
pub const TERMINAL_WINDOW_LABEL: &str = "terminal";

/// Open the Terminal window, or focus it if it already exists. The window
/// loads the same bundle as the main one with `?window=terminal` so the
/// frontend picks the terminal root. A project scope travels in the URL on
/// creation, or as the `terminal-scope` event when the window is already up.
pub fn open_terminal_window(app: &AppHandle, project_id: Option<&str>, launch: Option<&str>) -> Result<(), String> {
    open_terminal_window_labelled(app, TERMINAL_WINDOW_LABEL, project_id, launch, None)
}

/// Is this a Terminal window? The first one keeps the bare label; a window a
/// tab was detached into is `terminal-2`, `terminal-3`… (ticket #20).
pub fn is_terminal_window_label(label: &str) -> bool {
    label == TERMINAL_WINDOW_LABEL || label.starts_with("terminal-")
}

/// Open, or focus, one Terminal window. `position` (logical screen pixels)
/// places a brand-new window where a dragged tab was dropped.
pub fn open_terminal_window_labelled(
    app: &AppHandle,
    label: &str,
    project_id: Option<&str>,
    launch: Option<&str>,
    position: Option<(f64, f64)>,
) -> Result<(), String> {
    if !is_terminal_window_label(label) {
        return Err(format!("Not a Terminal window label: {}", label));
    }
    // Remembered in the layout document so the next start reopens the window.
    set_terminal_window_open(app, true);
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        if let Some(pid) = project_id {
            let _ = app.emit("terminal-scope", pid.to_string());
        }
        if let Some(name) = launch {
            let _ = app.emit("terminal-launch", name.to_string());
        }
        return Ok(());
    }
    // The frontend picks its root from the window label; the requested scope
    // and launch configuration are parked in AppState and fetched by
    // `take_terminal_window_scope` / `take_terminal_window_launch` on boot (a
    // query string on the App URL does not survive the dev server).
    if let Some(state) = app.try_state::<AppState>() {
        *state.terminal_window_scope.lock().unwrap() = project_id.map(|s| s.to_string());
        *state.terminal_window_launch.lock().unwrap() = launch.map(|s| s.to_string());
    }
    // "CortX Terminal" for the first, "CortX Terminal 2" for a detached one.
    let title = if label == TERMINAL_WINDOW_LABEL {
        "CortX Terminal".to_string()
    } else {
        format!("CortX Terminal {}", label.trim_start_matches("terminal-"))
    };
    let builder = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(1180.0, 760.0)
        .min_inner_size(720.0, 460.0)
        .resizable(true)
        // Transparent at the OS level so the window opacity and the acrylic /
        // mica effects work without recreating the window. The frontend paints
        // an opaque background whenever the opacity is 100 (and falls back to
        // an opaque surface colour if the theme is still loading), so this can
        // never leave the window see-through by accident.
        .transparent(true)
        .visible(false);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);
    let builder = match position {
        Some((x, y)) => builder.position(x, y),
        None => builder,
    };
    let window = builder.build().map_err(|e| e.to_string())?;
    // Backdrop effect + opacity from the settings, before the first paint.
    if let Some(state) = app.try_state::<AppState>() {
        let terminal = state.storage.get_settings().terminal;
        let dark = !matches!(state.storage.get_settings().appearance.theme, cortx_core::models::Theme::Light);
        if let Err(e) = commands::apply_terminal_window_effect(
            &window,
            terminal.window_effect,
            terminal.window_opacity,
            None,
            dark,
        ) {
            log::warn!("Terminal window effect not applied: {}", e);
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

/// Record whether the Terminal window is up in the shared layout document
/// (`windowOpen`), and tell the webviews. Session restore reopens the window
/// when it was open at the last quit.
pub fn set_terminal_window_open(app: &AppHandle, open: bool) {
    if let Some(state) = app.try_state::<AppState>() {
        let current = state
            .terminal_layout
            .get()
            .layout
            .get("windowOpen")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if current == open {
            return;
        }
        let doc = state.terminal_layout.patch("windowOpen", serde_json::Value::Bool(open));
        let _ = app.emit(
            "terminal-layout",
            serde_json::json!({ "revision": doc.revision, "layout": doc.layout, "source": "backend" }),
        );
    }
}

fn arg_value(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned()
}

/// `cortx-app --terminal [--project <id>] [--layout <name>]` — from a second
/// launch (forwarded by the single-instance plugin) or the first one.
fn handle_cli_args(app: &AppHandle, args: &[String]) {
    let wants_terminal = args.iter().any(|a| a == "--terminal");
    let project = arg_value(args, "--project");
    let launch = arg_value(args, "--layout");
    if wants_terminal {
        if let Err(e) = open_terminal_window(app, project.as_deref(), launch.as_deref()) {
            log::error!("Could not open the terminal window: {}", e);
        }
    } else {
        show_main_window(app);
    }
}

/// How long the quit path waits for the main window to answer the "these
/// commands are still running" prompt. On timeout the quit goes through: a
/// broken or missing webview must never be able to lock the app open.
const CONFIRM_QUIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Ask the main window to confirm a quit that is about to kill running
/// terminals (DEV-13, ticket "services actifs terminal"). Returns whether the
/// quit should go ahead.
///
/// The prompt itself lives in the frontend (design system, and it is the side
/// that knows the `confirmCloseRunning` setting — when it is off the webview
/// answers `true` straight away). Nothing running = nothing to ask.
fn confirm_quit_with_running_terminals(app: &AppHandle, state: &AppState) -> bool {
    let running = state.process_manager.running_terminals();
    if running.is_empty() {
        return true;
    }
    let Some(main) = app.get_webview_window("main") else {
        // No main window to ask (e.g. `cortx terminal` cold start): don't
        // block the quit on a prompt nobody can see.
        return true;
    };
    let _ = main.show();
    let _ = main.unminimize();
    let _ = main.set_focus();

    let (tx, rx) = std::sync::mpsc::channel::<bool>();
    // Registered before the request so an instant answer can't be missed.
    let handler = app.listen_any("app-quit-decision", move |event| {
        let _ = tx.send(event.payload().trim() != "false");
    });
    let _ = app.emit_to("main", "app-quit-confirm", &running);
    let decision = rx.recv_timeout(CONFIRM_QUIT_TIMEOUT).unwrap_or(true);
    app.unlisten(handler);
    decision
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
    let runtime_store = Arc::new(
        RuntimeStore::new(storage.app_dir()).expect("Failed to initialize runtime store"),
    );
    let process_manager = ProcessManager::new(runtime_store);
    // Agents section (DEV-11): index of Claude Code / Codex sessions. The
    // first scan runs in a background thread from `setup` so the UI never waits.
    let agent_index = Arc::new(AgentIndex::new(
        storage.get_settings().agents,
        &storage.app_dir().join("runtime"),
    ));

    let terminal_dir = storage.terminal_dir();
    let app_state = AppState {
        storage: Arc::new(storage),
        process_manager: Arc::new(process_manager),
        agents: agent_index,
        quitting: Arc::new(AtomicBool::new(false)),
        // Persisted under data/terminal/sessions.json (synced by the git backup).
        terminal_layout: Arc::new(cortx_core::terminal::LayoutStore::new(Some(
            terminal_dir.join("sessions.json"),
        ))),
        terminal_window_scope: std::sync::Mutex::new(None),
        terminal_window_launch: std::sync::Mutex::new(None),
        launch_configs: Arc::new(cortx_core::terminal::LaunchStore::new(&terminal_dir)),
    };

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Must be registered first: a second `cortx-app` launch (e.g. `cortx
    // terminal`) hands its args to the running instance and exits. Release
    // only — the lock is keyed on the app identifier, so a dev build would
    // otherwise forward to (or be swallowed by) the installed CortX.
    #[cfg(not(debug_assertions))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            handle_cli_args(app, &args);
        }));
    }

    #[allow(unused_mut)]
    let mut builder = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
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
            let launch_args: Vec<String> = std::env::args().skip(1).collect();
            let terminal_launch = launch_args.iter().any(|a| a == "--terminal");
            if let Some(main) = app.get_webview_window("main") {
                #[cfg(any(target_os = "windows", target_os = "linux"))]
                {
                    let _ = main.set_decorations(false);
                }
                // `cortx terminal` on a cold start: only the Terminal window
                // comes up; the main window waits in the tray.
                if !terminal_launch {
                    let _ = main.show();
                }
            }
            if terminal_launch {
                handle_cli_args(app.handle(), &launch_args);
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

            // Terminal themes: a `.yaml` (or a wallpaper) dropped into
            // `data/terminal/themes/` shows up in the picker of every window
            // without a restart. `ThemeStore::list()` first, so the folder the
            // watcher needs exists and the bundled themes are materialised.
            let theme_store = cortx_core::terminal::ThemeStore::new(&state.storage.terminal_dir());
            theme_store.list();
            let themes_app = app.handle().clone();
            match cortx_core::terminal::themes::watch(theme_store.dir().to_path_buf(), move |keys| {
                let _ = themes_app.emit("terminal-themes-changed", commands::terminal_themes_changed(keys));
            }) {
                Ok(handle) => {
                    app.manage(handle);
                }
                Err(e) => log::warn!("Terminal theme watcher could not start: {}", e),
            }

            // Agents section: watch the provider roots (transcripts, live
            // registry, Codex sqlite) and refresh incrementally.
            // Terminal ↔ agent link (DEV-13): the last payload sent, so the
            // event only fires when something actually changed.
            let terminal_agents: Arc<std::sync::Mutex<Vec<TerminalAgent>>> =
                Arc::new(std::sync::Mutex::new(Vec::new()));

            let agents = state.agents.clone();
            let agents_app = app.handle().clone();
            let ta_watch = terminal_agents.clone();
            match agent_watcher::start_agent_watching(agents.watch_roots(), move |changed| {
                if agents.refresh_paths(&changed) {
                    let _ = agents_app.emit("agent-sessions-changed", ());
                    // The Claude live registry is rewritten on every
                    // busy/idle flip: react to it right away instead of
                    // waiting for the next poll.
                    emit_terminal_agents(&agents_app, &ta_watch);
                }
            }) {
                Ok(handle) => {
                    app.manage(handle);
                }
                Err(e) => log::warn!("Agent watcher could not start: {}", e),
            }

            // First full scan in the background (cheap when the index cache
            // is warm; a few seconds on a cold cache with GBs of transcripts).
            let agents = state.agents.clone();
            let agents_app = app.handle().clone();
            std::thread::Builder::new()
                .name("cortx-agents-scan".into())
                .spawn(move || {
                    agents.refresh_all();
                    let _ = agents_app.emit("agent-sessions-changed", ());
                })
                .ok();

            // Agent detection needs the OS process table, which no watcher
            // reports: poll it, cheaply, and only while terminals exist.
            let ta_app = app.handle().clone();
            let ta_poll = terminal_agents.clone();
            std::thread::Builder::new()
                .name("cortx-terminal-agents".into())
                .spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_secs(4));
                    emit_terminal_agents(&ta_app, &ta_poll);
                })
                .ok();

            // Session restore: refresh the scrollback snapshots every minute
            // so a crash loses at most that much (quit saves them too).
            let snap_state_app = app.handle().clone();
            std::thread::Builder::new()
                .name("cortx-terminal-snapshots".into())
                .spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_secs(60));
                    let Some(state) = snap_state_app.try_state::<AppState>() else {
                        continue;
                    };
                    let tcfg = state.storage.get_settings().terminal;
                    if !tcfg.restore_scrollback {
                        continue;
                    }
                    cortx_core::terminal::snapshot::save_all(
                        state.process_manager.terminal_hub(),
                        &state.storage.app_dir().join("runtime"),
                        None,
                        tcfg.restore_scrollback_lines as usize,
                    );
                })
                .ok();

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
                    // `windowOpen` says "reopen a Terminal window next time",
                    // so it may only be cleared once the *last* one is gone —
                    // a tab detached into `terminal-2` still counts.
                    if is_terminal_window_label(window.label()) {
                        let still_open = app_handle
                            .webview_windows()
                            .iter()
                            .any(|(l, w)| {
                                l != window.label()
                                    && is_terminal_window_label(l)
                                    && w.is_visible().unwrap_or(false)
                            });
                        if !still_open {
                            set_terminal_window_open(&app_handle, false);
                        }
                    }
                    return;
                }

                // Real quit path — same flow as before: stop_all -> destroy.
                // We additionally call app.exit(0) at the end because the
                // tray icon would otherwise keep the process alive.
                api.prevent_close();
                let window_clone = window.clone();
                std::thread::spawn(move || {
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        // Warp-style guard: never kill a terminal that is in
                        // the middle of something without asking first.
                        if !confirm_quit_with_running_terminals(&app_handle, &state) {
                            log::info!("Quit cancelled - terminals are still running");
                            state.quitting.store(false, Ordering::SeqCst);
                            return;
                        }
                        // Every webview gets `app-closing`: the ClosingModal
                        // shows when processes are running, and each window
                        // stores its restore snapshots — give them a moment.
                        log::info!("Quit requested - notifying frontend of cleanup...");
                        let _ = app_handle.emit("app-closing", state.process_manager.has_running_processes());
                        std::thread::sleep(std::time::Duration::from_millis(600));
                        // Session restore: keep the tail of every scrollback
                        // before the processes go away.
                        let tcfg = state.storage.get_settings().terminal;
                        if tcfg.restore_scrollback {
                            cortx_core::terminal::snapshot::save_all(
                                state.process_manager.terminal_hub(),
                                &state.storage.app_dir().join("runtime"),
                                None,
                                tcfg.restore_scrollback_lines as usize,
                            );
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
            // Integrated terminal (PTY) commands
            commands::get_terminal_capabilities,
            commands::attach_terminal,
            commands::detach_terminal,
            commands::write_terminal,
            commands::resize_terminal,
            commands::clear_terminal_scrollback,
            commands::remove_terminal,
            commands::get_terminal_states,
            commands::get_command_history,
            commands::suggest_history,
            commands::get_command_spec,
            commands::complete_git_refs,
            commands::complete_npm_scripts,
            commands::complete_paths,
            commands::send_os_notification,
            commands::get_terminal_layout,
            commands::set_terminal_layout,
            commands::open_terminal_window,
            commands::open_terminal_window_labelled,
            commands::terminal_subshell_snippet,
            commands::show_main_window,
            commands::take_terminal_window_scope,
            commands::take_terminal_window_launch,
            commands::save_terminal_snapshots,
            commands::store_terminal_snapshot,
            commands::prune_terminal_snapshots,
            commands::list_launch_configs,
            commands::get_launch_config,
            commands::read_launch_config_yaml,
            commands::save_launch_config,
            commands::save_launch_config_yaml,
            commands::delete_launch_config,
            commands::launch_config_to_yaml,
            commands::list_terminal_themes,
            commands::terminal_themes_dir,
            commands::get_terminal_theme,
            commands::import_terminal_theme_file,
            commands::import_terminal_theme_folder,
            commands::delete_terminal_theme,
            commands::save_terminal_theme,
            commands::read_terminal_theme_image,
            commands::set_terminal_window_effect,
            commands::spawn_shell,
            commands::kill_shell,
            commands::list_shells,
            // Settings commands
            commands::get_settings,
            commands::update_settings,
            commands::set_global_hotkey,
            commands::quit_app,
            // Utility commands
            commands::open_in_explorer,
            commands::open_in_vscode,
            commands::open_in_editor,
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
            // Shim commands
            commands::get_shim_status,
            commands::sync_shims,
            commands::install_shim_path,
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
            // Agents section (DEV-11)
            commands::list_agent_sessions,
            commands::refresh_agent_sessions,
            commands::get_agent_transcript,
            commands::update_agent_annotations,
            commands::resume_agent_session,
            commands::get_agent_resume_command,
            commands::create_project_from_session,
            commands::get_agents_health,
            commands::get_terminal_agents,
            commands::reveal_agent_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
