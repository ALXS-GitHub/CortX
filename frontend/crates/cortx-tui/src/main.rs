mod app;
mod event;
mod input;
mod tui_emitter;
mod ui;
mod util;

use std::io;
use std::sync::{mpsc, Arc};

use clap::Parser;
use crossterm::{
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;

use cortx_core::process_manager::ProcessManager;
use cortx_core::storage::Storage;

use app::{App, ProcessEvent};
use tui_emitter::TuiEmitter;

#[derive(Parser)]
#[command(name = "cortx", version, about = "CortX TUI - Manage and run scripts")]
struct Cli {
    /// Script name to run directly (without entering TUI)
    script: Option<String>,

    /// Extra arguments to pass to the script
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    args: Vec<String>,

    /// List all scripts and exit
    #[arg(short, long)]
    list: bool,

    /// Use a specific parameter preset when running a script
    #[arg(short, long)]
    preset: Option<String>,
}

fn main() -> anyhow::Result<()> {
    env_logger::init();

    let cli = Cli::parse();

    let storage = Arc::new(Storage::new()?);
    let process_manager = Arc::new(ProcessManager::new());

    if cli.list {
        return cmd_list(&storage);
    }

    if let Some(script_name) = &cli.script {
        return cmd_run(&storage, &process_manager, script_name, cli.preset.as_deref(), &cli.args);
    }

    // Interactive TUI mode
    run_tui(storage, process_manager)
}

/// List all global scripts, sorted by folder (matching TUI display)
fn cmd_list(storage: &Storage) -> anyhow::Result<()> {
    let scripts = storage.get_all_global_scripts();
    if scripts.is_empty() {
        println!("No global scripts configured.");
        return Ok(());
    }

    let folders = storage.get_all_folders();

    // Sort scripts by folder order (no-folder first, None order = last), then alphabetically by name
    let mut sorted: Vec<&cortx_core::models::GlobalScript> = scripts.iter().collect();
    sorted.sort_by(|a, b| {
        let fa = a.folder_id.as_ref().and_then(|fid| folders.iter().find(|f| f.id == *fid));
        let fb = b.folder_id.as_ref().and_then(|fid| folders.iter().find(|f| f.id == *fid));
        let folder_ord = match (fa, fb) {
            (None, None) => std::cmp::Ordering::Equal,
            (None, Some(_)) => std::cmp::Ordering::Less,
            (Some(_), None) => std::cmp::Ordering::Greater,
            (Some(fa), Some(fb)) => match (fa.order, fb.order) {
                (Some(ao), Some(bo)) => ao.cmp(&bo),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            }.then_with(|| fa.name.to_lowercase().cmp(&fb.name.to_lowercase())),
        };
        folder_ord.then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    println!("{:<40} {:<15} {}", "NAME", "TAGS", "COMMAND");
    println!("{}", "-".repeat(75));

    for s in &sorted {
        let folder = s
            .folder_id
            .as_ref()
            .and_then(|fid| folders.iter().find(|f| f.id == *fid));

        // Build display name with colored folder prefix using ANSI truecolor
        let display_name = if let Some(f) = folder {
            let colored_prefix = if let Some(ref hex) = f.color {
                let hex = hex.trim_start_matches('#');
                if hex.len() == 6 {
                    if let (Ok(r), Ok(g), Ok(b)) = (
                        u8::from_str_radix(&hex[0..2], 16),
                        u8::from_str_radix(&hex[2..4], 16),
                        u8::from_str_radix(&hex[4..6], 16),
                    ) {
                        format!("\x1b[38;2;{};{};{}m[{}]\x1b[0m ", r, g, b, f.name)
                    } else {
                        format!("[{}] ", f.name)
                    }
                } else {
                    format!("[{}] ", f.name)
                }
            } else {
                format!("[{}] ", f.name)
            };
            format!("{}{}", colored_prefix, s.name)
        } else {
            s.name.clone()
        };

        let tags = if s.tags.is_empty() {
            String::from("-")
        } else {
            s.tags.join(", ")
        };
        let display_cmd = util::format_command_display(&s.command, s.script_path.as_deref());
        // Pad using visible width (ANSI escapes are invisible but count in String length)
        let visible_len = if let Some(f) = folder {
            format!("[{}] {}", f.name, s.name).len()
        } else {
            s.name.len()
        };
        let pad = if visible_len < 40 { 40 - visible_len } else { 1 };
        println!("{}{:pad$} {:<15} {}", display_name, "", tags, display_cmd, pad = pad);
    }
    println!("\n{} script(s)", scripts.len());
    Ok(())
}

/// Run a script directly by name
fn cmd_run(
    storage: &Storage,
    process_manager: &ProcessManager,
    name: &str,
    preset_name: Option<&str>,
    extra_args: &[String],
) -> anyhow::Result<()> {
    let scripts = storage.get_all_global_scripts();
    let script = scripts
        .iter()
        .find(|s| s.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| anyhow::anyhow!("Script '{}' not found", name))?;

    // Build param_values HashMap from preset (if any)
    let mut param_values = std::collections::HashMap::new();
    if let Some(preset_name) = preset_name {
        let preset = script
            .parameter_presets
            .iter()
            .find(|p| p.name.eq_ignore_ascii_case(preset_name))
            .ok_or_else(|| anyhow::anyhow!("Preset '{}' not found", preset_name))?;

        for param in &script.parameters {
            let is_enabled = if !preset.enabled.is_empty() {
                preset.enabled.get(&param.name).copied().unwrap_or(false) || param.required
            } else {
                preset.values.contains_key(&param.name)
            };
            if !is_enabled {
                continue;
            }
            if let Some(value) = preset.values.get(&param.name) {
                param_values.insert(param.name.clone(), value.clone());
            }
        }
    }

    let (program, args) = cortx_core::command_builder::build_command(script, &param_values, extra_args)
        .ok_or_else(|| anyhow::anyhow!("Empty command"))?;

    // Use a simple channel-based emitter that prints to stdout
    let (tx, rx) = mpsc::channel::<ProcessEvent>();
    let emitter = Arc::new(TuiEmitter::new(tx));

    let working_dir = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    println!("Running: {} {}", program, args.join(" "));
    println!("Working dir: {}", working_dir);
    println!("{}", "-".repeat(50));

    let _pid = process_manager
        .run_global_script(
            emitter,
            script.id.clone(),
            working_dir,
            program,
            args,
            script.env_vars.clone(),
        )
        .map_err(|e| anyhow::anyhow!(e))?;

    // Print output until script exits
    loop {
        match rx.recv() {
            Ok(ProcessEvent::Log { content, stream, .. }) => {
                match stream {
                    cortx_core::models::LogStream::Stdout => println!("{}", content),
                    cortx_core::models::LogStream::Stderr => eprintln!("{}", content),
                }
            }
            Ok(ProcessEvent::Exit { exit_code, success, .. }) => {
                println!("{}", "-".repeat(50));
                if success {
                    println!("Completed successfully (exit code: {})", exit_code.unwrap_or(0));
                } else {
                    println!("Failed (exit code: {})", exit_code.unwrap_or(-1));
                }
                break;
            }
            Ok(ProcessEvent::Status { .. }) => {}
            Err(_) => break,
        }
    }

    process_manager.stop_all();
    Ok(())
}

/// Run the interactive TUI
fn run_tui(storage: Arc<Storage>, process_manager: Arc<ProcessManager>) -> anyhow::Result<()> {
    // Setup channels
    let (process_tx, process_rx) = mpsc::channel::<ProcessEvent>();
    let (event_tx, event_rx) = mpsc::channel::<event::Event>();

    let emitter = Arc::new(TuiEmitter::new(process_tx));

    // Create app
    let mut app = App::new(storage, process_manager.clone(), emitter);

    // Start event loop thread
    let event_tx_clone = event_tx.clone();
    std::thread::spawn(move || {
        event::event_loop(process_rx, event_tx_clone);
    });

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Main loop
    let result = main_loop(&mut terminal, &mut app, &event_rx);

    // Cleanup
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    // Stop all running processes
    process_manager.stop_all();

    result
}

fn main_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &mut App,
    event_rx: &mpsc::Receiver<event::Event>,
) -> anyhow::Result<()> {
    loop {
        // Draw
        terminal.draw(|f| ui::draw(f, app))?;

        // Wait for first event (blocking)
        let first = match event_rx.recv() {
            Ok(ev) => ev,
            Err(_) => break,
        };
        handle_event(app, first);

        // Drain all remaining pending events before redrawing.
        // This prevents the TUI from freezing when a script produces
        // lots of output — we batch-process all queued events, then
        // draw once instead of drawing after every single event.
        loop {
            match event_rx.try_recv() {
                Ok(ev) => handle_event(app, ev),
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    app.should_quit = true;
                    break;
                }
            }
        }

        if app.should_quit {
            break;
        }
    }

    Ok(())
}

fn handle_event(app: &mut App, ev: event::Event) {
    match ev {
        event::Event::Key(key) => input::handle_key(app, key),
        event::Event::Process(pe) => app.handle_process_event(pe),
        event::Event::Tick => {}
    }
}
