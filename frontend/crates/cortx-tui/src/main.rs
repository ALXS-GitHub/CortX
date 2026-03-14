mod app;
mod event;
mod input;
mod tui_emitter;
mod ui;
mod util;

use std::io;
use std::sync::{mpsc, Arc};

use clap::{Parser, Subcommand};
use crossterm::{
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;

use cortx_core::file_watcher;
use cortx_core::models::{ShellAlias, App as CoreApp};
use cortx_core::process_manager::ProcessManager;
use cortx_core::storage::Storage;

use app::{App, ProcessEvent};
use tui_emitter::TuiEmitter;

#[derive(Parser)]
#[command(
    name = "cortx",
    version,
    about = "CortX - Manage and run scripts & tools",
    after_help = "Tip: `cortx <script_name>` is a shortcut for `cortx run <script_name>`"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Run a script by name
    Run {
        /// Script name
        script: String,
        /// Extra arguments to pass to the script
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
        /// Use a specific parameter preset
        #[arg(short, long)]
        preset: Option<String>,
    },
    /// List all scripts
    Scripts,
    /// List or scan tools
    Tools {
        /// Scan system for installed tools (Scoop/Chocolatey)
        #[arg(long)]
        scan: bool,
    },
    /// Generate shell init script
    Init {
        /// Shell name: powershell, bash, zsh, fish
        shell: String,
    },
    /// Manage shell aliases
    Alias {
        #[command(subcommand)]
        command: AliasCommand,
    },
    /// Manage GUI applications
    App {
        #[command(subcommand)]
        action: AppAction,
    },
    /// Fallback: bare `cortx <name>` still runs a script
    #[command(external_subcommand)]
    External(Vec<String>),
}

#[derive(Subcommand)]
enum AppAction {
    /// List all apps
    List,
    /// Launch an app by name
    Launch {
        /// App name (case-insensitive partial match)
        name: String,
    },
}

#[derive(Subcommand)]
enum AliasCommand {
    /// List all aliases
    List,
    /// Add a new alias
    Add {
        /// Alias name (e.g. "cc")
        name: String,
        /// Command to alias (e.g. "claude --dangerously-skip-permissions")
        command: String,
        /// Optional description
        #[arg(short, long)]
        description: Option<String>,
        /// Alias type: function (default), script, init
        #[arg(short = 't', long = "type")]
        alias_type: Option<String>,
        /// Per-shell setup code as shell=code (e.g. "powershell=Remove-Alias ls -Force")
        #[arg(long)]
        setup: Option<Vec<String>>,
        /// Per-shell script content as shell=code (for script/init types)
        #[arg(long)]
        script: Option<Vec<String>>,
        /// Tool UUID to link
        #[arg(long)]
        tool_id: Option<String>,
    },
    /// Remove an alias by name
    Remove {
        /// Alias name to remove
        name: String,
    },
}

fn main() -> anyhow::Result<()> {
    env_logger::init();

    let cli = Cli::parse();

    let storage = Arc::new(Storage::new()?);
    let process_manager = Arc::new(ProcessManager::new());

    match cli.command {
        Some(Command::Scripts) => cmd_list(&storage),
        Some(Command::Tools { scan }) => cmd_tools(&storage, scan),
        Some(Command::Init { shell }) => cmd_init(&storage, &shell),
        Some(Command::Alias { command }) => match command {
            AliasCommand::List => cmd_alias_list(&storage),
            AliasCommand::Add { name, command, description, alias_type, setup, script, tool_id } => {
                cmd_alias_add(&storage, &name, &command, description.as_deref(), alias_type.as_deref(), setup, script, tool_id)
            }
            AliasCommand::Remove { name } => cmd_alias_remove(&storage, &name),
        },
        Some(Command::App { action }) => match action {
            AppAction::List => cmd_app_list(&storage),
            AppAction::Launch { name } => cmd_app_launch(&storage, &name),
        },
        Some(Command::Run { script, args, preset }) => {
            cmd_run(&storage, &process_manager, &script, preset.as_deref(), &args)
        }
        Some(Command::External(args)) => {
            cmd_run(&storage, &process_manager, &args[0], None, &args[1..].to_vec())
        }
        None => run_tui(storage, process_manager),
    }
}

/// List all global scripts, sorted by primary tag (matching TUI display)
fn cmd_list(storage: &Storage) -> anyhow::Result<()> {
    let scripts = storage.get_all_global_scripts();
    if scripts.is_empty() {
        println!("No global scripts configured.");
        return Ok(());
    }

    let tag_defs = storage.get_all_tag_definitions();

    // Sort scripts by primary tag order, then alphabetically by name
    let mut sorted: Vec<&cortx_core::models::GlobalScript> = scripts.iter().collect();
    sorted.sort_by(|a, b| {
        let ta = a.tags.first().and_then(|t| {
            let tl = t.to_lowercase();
            tag_defs.iter().find(|d| d.name.to_lowercase() == tl)
        });
        let tb = b.tags.first().and_then(|t| {
            let tl = t.to_lowercase();
            tag_defs.iter().find(|d| d.name.to_lowercase() == tl)
        });
        let tag_ord = match (a.tags.first(), b.tags.first()) {
            (None, None) => std::cmp::Ordering::Equal,
            (None, Some(_)) => std::cmp::Ordering::Less,
            (Some(_), None) => std::cmp::Ordering::Greater,
            (Some(at), Some(bt)) => {
                let ao = ta.and_then(|d| d.order);
                let bo = tb.and_then(|d| d.order);
                match (ao, bo) {
                    (Some(ao), Some(bo)) => ao.cmp(&bo),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => std::cmp::Ordering::Equal,
                }
                .then_with(|| at.to_lowercase().cmp(&bt.to_lowercase()))
            }
        };
        tag_ord.then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    println!("{:<40} {:<15} {}", "NAME", "TAGS", "COMMAND");
    println!("{}", "-".repeat(75));

    for s in &sorted {
        let tags_display = if s.tags.is_empty() {
            String::from("-")
        } else {
            colorize_tags(&s.tags, &tag_defs)
        };
        let tags_visible = if s.tags.is_empty() {
            1 // "-"
        } else {
            s.tags.join(", ").len()
        };
        let display_cmd = util::format_command_display(&s.command, s.script_path.as_deref());
        let tags_pad = if tags_visible < 15 { 15 - tags_visible } else { 1 };
        println!("{:<40} {}{:tags_pad$} {}", s.name, tags_display, "", display_cmd, tags_pad = tags_pad);
    }
    println!("\n{} script(s)", scripts.len());
    Ok(())
}

/// List or scan tools
fn cmd_tools(storage: &Storage, scan: bool) -> anyhow::Result<()> {
    if scan {
        let tools = cortx_core::tool_discovery::scan_installed_tools();
        if tools.is_empty() {
            println!("No tools discovered from Scoop/Chocolatey.");
            return Ok(());
        }

        println!("{:<30} {:<15} {:<12} {}", "NAME", "VERSION", "SOURCE", "LOCATION");
        println!("{}", "-".repeat(80));

        for t in &tools {
            println!(
                "{:<30} {:<15} {:<12} {}",
                t.name,
                t.version.as_deref().unwrap_or("-"),
                t.source,
                t.install_location.as_deref().unwrap_or("-"),
            );
        }
        println!("\n{} tool(s) discovered", tools.len());
    } else {
        let tools = storage.get_all_tools();
        if tools.is_empty() {
            println!("No tools registered.");
            return Ok(());
        }

        let tag_defs = storage.get_all_tag_definitions();

        // Sort by primary tag then name
        let mut sorted: Vec<&cortx_core::models::Tool> = tools.iter().collect();
        sorted.sort_by(|a, b| {
            let ta = a.tags.first().map(|s| s.to_lowercase()).unwrap_or_default();
            let tb = b.tags.first().map(|s| s.to_lowercase()).unwrap_or_default();
            ta.cmp(&tb)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        println!("{:<30} {:<12} {:<15} {}", "NAME", "STATUS", "TAGS", "VERSION");
        println!("{}", "-".repeat(75));

        for t in &sorted {
            let tags_display = if t.tags.is_empty() {
                String::from("-")
            } else {
                colorize_tags(&t.tags, &tag_defs)
            };
            let tags_visible = if t.tags.is_empty() {
                1
            } else {
                t.tags.join(", ").len()
            };
            let tags_pad = if tags_visible < 15 { 15 - tags_visible } else { 1 };
            println!(
                "{:<30} {:<12} {}{:tags_pad$} {}",
                t.name,
                t.status,
                tags_display,
                "",
                t.version.as_deref().unwrap_or("-"),
                tags_pad = tags_pad,
            );
        }
        println!("\n{} tool(s)", tools.len());
    }
    Ok(())
}

/// Generate shell init script
fn cmd_init(storage: &Storage, shell_name: &str) -> anyhow::Result<()> {
    let shell = cortx_core::shell_init::Shell::from_str(shell_name)
        .ok_or_else(|| anyhow::anyhow!(
            "Unknown shell '{}'. Supported: powershell, pwsh, ps, bash, zsh, fish",
            shell_name,
        ))?;
    let aliases = storage.get_all_aliases();
    let script = cortx_core::shell_init::generate_init_script(&shell, &aliases);
    print!("{}", script);
    Ok(())
}

/// List all aliases
fn cmd_alias_list(storage: &Storage) -> anyhow::Result<()> {
    let aliases = storage.get_all_aliases();
    if aliases.is_empty() {
        println!("No aliases configured.");
        return Ok(());
    }

    let tag_defs = storage.get_all_tag_definitions();

    // Sort by primary tag then name
    let mut sorted: Vec<&ShellAlias> = aliases.iter().collect();
    sorted.sort_by(|a, b| {
        let ta = a.tags.first().map(|s| s.to_lowercase()).unwrap_or_default();
        let tb = b.tags.first().map(|s| s.to_lowercase()).unwrap_or_default();
        ta.cmp(&tb)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    println!("{:<20} {:<10} {:<40} {}", "NAME", "TYPE", "COMMAND", "TAGS");
    println!("{}", "-".repeat(85));

    for a in &sorted {
        let tags_display = if a.tags.is_empty() {
            String::from("-")
        } else {
            colorize_tags(&a.tags, &tag_defs)
        };
        let alias_type = a.alias_type.as_str();
        let cmd_display = if alias_type == "function" {
            a.command.clone()
        } else {
            // For script/init, show first non-empty shell entry or "-"
            a.script.as_ref()
                .and_then(|m| m.values().find(|v| !v.trim().is_empty()))
                .map(|v| {
                    let trimmed = v.trim();
                    if trimmed.len() > 37 { format!("{}...", &trimmed[..37]) } else { trimmed.to_string() }
                })
                .unwrap_or_else(|| "-".to_string())
        };
        println!("{:<20} {:<10} {:<40} {}", a.name, alias_type, cmd_display, tags_display);
    }
    println!("\n{} alias(es)", aliases.len());
    Ok(())
}

/// Add a new alias
/// Parse "shell=code" pairs into a HashMap
fn parse_shell_map(entries: &[String]) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for entry in entries {
        if let Some(pos) = entry.find('=') {
            let key = entry[..pos].to_string();
            let val = entry[pos + 1..].to_string();
            map.insert(key, val);
        }
    }
    map
}

fn cmd_alias_add(
    storage: &Storage,
    name: &str,
    command: &str,
    description: Option<&str>,
    alias_type: Option<&str>,
    setup: Option<Vec<String>>,
    script: Option<Vec<String>>,
    tool_id: Option<String>,
) -> anyhow::Result<()> {
    // Validate name
    cortx_core::shell_init::validate_alias_name(name)
        .map_err(|e| anyhow::anyhow!(e))?;

    // Validate alias type
    if let Some(at) = alias_type {
        cortx_core::shell_init::validate_alias_type(at)
            .map_err(|e| anyhow::anyhow!(e))?;
    }

    // Check for builtin
    if cortx_core::shell_init::is_shell_builtin(name) {
        eprintln!("Warning: '{}' shadows a common shell builtin", name);
    }

    // Check for duplicate name
    if storage.get_alias_by_name(name).is_some() {
        return Err(anyhow::anyhow!("Alias '{}' already exists", name));
    }

    let mut alias = ShellAlias::new(name.to_string(), command.to_string());
    alias.description = description.map(|s| s.to_string());
    if let Some(at) = alias_type {
        alias.alias_type = at.to_string();
    }
    if let Some(entries) = setup {
        let map = parse_shell_map(&entries);
        if !map.is_empty() {
            alias.setup = Some(map);
        }
    }
    if let Some(entries) = script {
        let map = parse_shell_map(&entries);
        if !map.is_empty() {
            alias.script = Some(map);
        }
    }
    alias.tool_id = tool_id;

    storage.create_alias(alias).map_err(|e| anyhow::anyhow!("{}", e))?;
    println!("Alias '{}' added.", name);
    Ok(())
}

/// Remove an alias by name
fn cmd_alias_remove(storage: &Storage, name: &str) -> anyhow::Result<()> {
    let alias = storage.get_alias_by_name(name)
        .ok_or_else(|| anyhow::anyhow!("Alias '{}' not found", name))?;
    storage.delete_alias(&alias.id).map_err(|e| anyhow::anyhow!("{}", e))?;
    println!("Alias '{}' removed.", name);
    Ok(())
}

/// List all apps
fn cmd_app_list(storage: &Storage) -> anyhow::Result<()> {
    let apps = storage.get_all_apps();
    if apps.is_empty() {
        println!("No apps configured.");
        return Ok(());
    }

    let tag_defs = storage.get_all_tag_definitions();
    let _status_defs = storage.get_all_status_definitions();

    let mut sorted: Vec<&CoreApp> = apps.iter().collect();
    sorted.sort_by(|a, b| {
        let ta = a.tags.first().map(|s| s.to_lowercase()).unwrap_or_default();
        let tb = b.tags.first().map(|s| s.to_lowercase()).unwrap_or_default();
        ta.cmp(&tb)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    println!("{:<30} {:<15} {:<15} {}", "NAME", "STATUS", "TAGS", "PATH");
    println!("{}", "-".repeat(80));

    for a in &sorted {
        let status_display = a.status.as_deref().unwrap_or("-");
        let tags_display = if a.tags.is_empty() {
            String::from("-")
        } else {
            colorize_tags(&a.tags, &tag_defs)
        };
        let tags_visible = if a.tags.is_empty() {
            1
        } else {
            a.tags.join(", ").len()
        };
        let tags_pad = if tags_visible < 15 { 15 - tags_visible } else { 1 };
        let path_display = a.executable_path.as_deref().unwrap_or("-");
        println!(
            "{:<30} {:<15} {}{:tags_pad$} {}",
            a.name,
            status_display,
            tags_display,
            "",
            path_display,
            tags_pad = tags_pad,
        );
    }
    println!("\n{} app(s)", apps.len());
    Ok(())
}

/// Launch an app by name (case-insensitive partial match)
fn cmd_app_launch(storage: &Storage, name: &str) -> anyhow::Result<()> {
    let apps = storage.get_all_apps();
    let name_lower = name.to_lowercase();

    // Try exact match first, then partial
    let app = apps
        .iter()
        .find(|a| a.name.to_lowercase() == name_lower)
        .or_else(|| apps.iter().find(|a| a.name.to_lowercase().contains(&name_lower)))
        .ok_or_else(|| anyhow::anyhow!("App '{}' not found", name))?;

    let exe = app.executable_path.as_deref()
        .ok_or_else(|| anyhow::anyhow!("App '{}' has no executable path set", app.name))?;

    println!("Launching: {} ({})", app.name, exe);

    let mut cmd = std::process::Command::new("cmd");
    cmd.args(["/C", "start", "", exe]);

    if let Some(ref args) = app.launch_args {
        if !args.is_empty() {
            for arg in args.split_whitespace() {
                cmd.arg(arg);
            }
        }
    }

    cmd.spawn()
        .map_err(|e| anyhow::anyhow!("Failed to launch '{}': {}", app.name, e))?;

    Ok(())
}

/// Colorize a list of tags using ANSI truecolor from tag definitions
fn colorize_tags(tags: &[String], tag_defs: &[cortx_core::models::TagDefinition]) -> String {
    tags.iter()
        .map(|tag| {
            let def = tag_defs.iter().find(|d| d.name.eq_ignore_ascii_case(tag));
            if let Some(hex) = def.and_then(|d| d.color.as_deref()) {
                let hex = hex.trim_start_matches('#');
                if hex.len() == 6 {
                    if let (Ok(r), Ok(g), Ok(b)) = (
                        u8::from_str_radix(&hex[0..2], 16),
                        u8::from_str_radix(&hex[2..4], 16),
                        u8::from_str_radix(&hex[4..6], 16),
                    ) {
                        return format!("\x1b[38;2;{};{};{}m{}\x1b[0m", r, g, b, tag);
                    }
                }
            }
            tag.clone()
        })
        .collect::<Vec<_>>()
        .join(", ")
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
    let mut app = App::new(storage.clone(), process_manager.clone(), emitter);

    // Start file watcher
    let watch_dir = storage.app_dir().to_path_buf();
    let storage_for_watcher = storage.clone();
    let event_tx_watcher = event_tx.clone();
    let _watcher = file_watcher::start_watching(watch_dir, move |_changed| {
        if storage_for_watcher.is_watcher_suppressed() {
            return;
        }
        let _ = event_tx_watcher.send(event::Event::DataChanged);
    })
    .map_err(|e| anyhow::anyhow!("Failed to start file watcher: {}", e))?;

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
        event::Event::DataChanged => {
            if let Err(e) = app.storage.reload_all() {
                log::error!("File watcher reload failed: {}", e);
                return;
            }
            app.refresh_data();
        }
        event::Event::Tick => {}
    }
}
