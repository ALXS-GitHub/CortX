mod app;
mod event;
mod input;
mod os_open;
mod tui_emitter;
mod ui;
mod util;

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};

use clap::{Parser, Subcommand};
use crossterm::{
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;

use cortx_core::file_watcher;
use cortx_core::models::{
    App as CoreApp, GlobalScript, ImportOptions, Project,
    Script, Service, ShellAlias, StatusDefinition, TagDefinition, Tool,
};
use cortx_core::process_manager::{ProcessManager, RuntimeMeta};
use cortx_core::runtime_state::{
    self, EntityKind, RuntimeEntry, RuntimeStore,
};
use cortx_core::storage::Storage;

use app::{App, ProcessEvent};
use tui_emitter::TuiEmitter;

// ============================================================================
// Color control (#17)
// ============================================================================

/// Whether the current run should emit ANSI color escapes. Set once at
/// startup by `init_color()` from the CLI flag + env vars + isatty check,
/// then read by every truecolor formatter.
static SHOULD_COLORIZE: AtomicBool = AtomicBool::new(false);

/// Resolve color preference using the standard precedence:
/// 1. `--no-color` flag → off
/// 2. `CLICOLOR_FORCE` env var (any non-empty value) → on (escape hatch)
/// 3. `NO_COLOR` env var (any non-empty value, https://no-color.org) → off
/// 4. stdout isatty → on; otherwise off
fn init_color(no_color_flag: bool) {
    use std::io::IsTerminal;
    let enabled = if no_color_flag {
        false
    } else if std::env::var_os("CLICOLOR_FORCE").is_some_and(|v| !v.is_empty()) {
        true
    } else if std::env::var_os("NO_COLOR").is_some_and(|v| !v.is_empty()) {
        false
    } else {
        std::io::stdout().is_terminal()
    };
    SHOULD_COLORIZE.store(enabled, Ordering::SeqCst);
}

fn should_colorize() -> bool {
    SHOULD_COLORIZE.load(Ordering::SeqCst)
}

// ============================================================================
// CLI definition
// ============================================================================

#[derive(Parser)]
#[command(
    name = "cortx",
    version,
    about = "CortX - Manage and run scripts, tools, projects & more",
    after_help = "Tip: `cortx <script_name>` is a shortcut for `cortx run <script_name>`"
)]
struct Cli {
    /// Output JSON instead of formatted tables
    #[arg(long, global = true)]
    json: bool,

    /// Disable ANSI color output regardless of terminal type.
    /// Color is also auto-disabled when stdout is not a TTY or when the
    /// NO_COLOR environment variable is set. Use CLICOLOR_FORCE=1 to
    /// force color even in non-TTY contexts.
    #[arg(long, global = true)]
    no_color: bool,

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
        /// Run detached in the background and return immediately with the PID.
        /// Logs are written to <app_dir>/runtime/<script_id>.log and can be
        /// followed with `cortx logs <name>` or stopped with `cortx stop <name>`.
        #[arg(short = 'd', long)]
        detach: bool,
    },

    /// Stop a global script that was started with `cortx run --detach`.
    Stop {
        /// Script name
        script: String,
    },

    /// Tail the log of a global script that was started with `cortx run --detach`.
    /// Use `cortx ps` to see all running detached scripts.
    Logs {
        /// Script name
        script: String,
        #[arg(long, default_value_t = 100)]
        tail: usize,
        #[arg(short, long)]
        follow: bool,
    },

    /// List all scripts (shortcut for `script list`)
    Scripts,

    /// List or scan tools (shortcut for `tool list`)
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

    /// Manage global scripts
    Script {
        #[command(subcommand)]
        action: ScriptAction,
    },

    /// Manage projects
    Project {
        #[command(subcommand)]
        action: ProjectAction,
    },

    /// Manage project services
    Service {
        #[command(subcommand)]
        action: ServiceAction,
    },

    /// Manage tools & config registry
    Tool {
        #[command(subcommand)]
        action: ToolAction,
    },

    /// Manage shell aliases / config
    Alias {
        #[command(subcommand)]
        command: AliasCommand,
    },

    /// Manage GUI applications
    App {
        #[command(subcommand)]
        action: AppAction,
    },

    /// Manage tag definitions
    Tag {
        #[command(subcommand)]
        action: TagAction,
    },

    /// Manage status definitions
    Status {
        #[command(subcommand)]
        action: StatusAction,
    },

    /// Manage settings
    Settings {
        #[command(subcommand)]
        action: SettingsAction,
    },

    /// Export all CortX data
    Export {
        /// Output file path (default: stdout)
        #[arg(long)]
        file: Option<String>,
    },

    /// Import CortX data from file
    Import {
        /// Path to the export JSON file
        file: String,
        /// Import all categories without prompting
        #[arg(long)]
        all: bool,
    },

    /// Backup data to configured git repo
    Backup,

    /// List CLI-managed running processes (services, project scripts, global scripts).
    Ps,

    /// Print full CLI documentation — if you're an AI agent, read this first
    Docs,

    /// Fallback: bare `cortx <name>` still runs a script
    #[command(external_subcommand)]
    External(Vec<String>),
}

// ---------------------------------------------------------------------------
// Script subcommands
// ---------------------------------------------------------------------------

#[derive(Subcommand)]
enum ScriptAction {
    /// List all global scripts
    List {
        /// Filter by tag (exact, case-insensitive)
        #[arg(long)]
        tag: Option<String>,
        /// Filter by name (case-insensitive substring)
        #[arg(long)]
        name: Option<String>,
    },
    /// Show details for a script
    Get {
        /// Script name or ID
        name_or_id: String,
    },
    /// Create a new global script
    Create {
        /// Script name
        name: String,
        /// Command to run
        command: String,
        /// Working directory
        #[arg(long)]
        dir: Option<String>,
        /// Tags
        #[arg(long)]
        tag: Option<Vec<String>>,
        /// Description
        #[arg(long)]
        description: Option<String>,
        /// Status
        #[arg(long)]
        status: Option<String>,
    },
    /// Update an existing global script
    Update {
        /// Script name or ID
        name_or_id: String,
        /// New name
        #[arg(long)]
        name: Option<String>,
        /// New command
        #[arg(long)]
        command: Option<String>,
        /// Working directory
        #[arg(long)]
        dir: Option<String>,
        /// Tags (replaces all)
        #[arg(long)]
        tag: Option<Vec<String>>,
        /// Description
        #[arg(long)]
        description: Option<String>,
        /// Status
        #[arg(long)]
        status: Option<String>,
    },
    /// Delete a global script
    Delete {
        /// Script name or ID
        name_or_id: String,
        /// Skip confirmation prompt
        #[arg(long)]
        yes: bool,
    },
}

// ---------------------------------------------------------------------------
// Project subcommands
// ---------------------------------------------------------------------------

#[derive(Subcommand)]
enum ProjectAction {
    /// List all projects
    List {
        /// Filter by tag (exact, case-insensitive)
        #[arg(long)]
        tag: Option<String>,
        /// Filter by name (case-insensitive substring)
        #[arg(long)]
        name: Option<String>,
        /// Filter by root path (case-insensitive substring)
        #[arg(long)]
        path: Option<String>,
        /// Include subcollections in --json output. Comma-separated subset of
        /// {services, scripts, envFiles}, or "all". Default is shallow:
        /// scalar fields plus serviceCount / scriptCount / envFileCount.
        #[arg(long, value_delimiter = ',')]
        include: Vec<String>,
    },
    /// Show project details
    Get {
        /// Project name or ID
        name_or_id: String,
    },
    /// Create a new project
    Create {
        /// Project name
        name: String,
        /// Root path
        path: String,
        /// Description
        #[arg(long)]
        description: Option<String>,
        /// Tags
        #[arg(long)]
        tag: Option<Vec<String>>,
        /// Status
        #[arg(long)]
        status: Option<String>,
        /// Toolbox documentation URL
        #[arg(long)]
        toolbox_url: Option<String>,
    },
    /// Update an existing project
    Update {
        /// Project name or ID
        name_or_id: String,
        /// New name
        #[arg(long)]
        name: Option<String>,
        /// New root path
        #[arg(long)]
        path: Option<String>,
        /// Description
        #[arg(long)]
        description: Option<String>,
        /// Tags (replaces all)
        #[arg(long)]
        tag: Option<Vec<String>>,
        /// Status
        #[arg(long)]
        status: Option<String>,
        /// Toolbox documentation URL
        #[arg(long)]
        toolbox_url: Option<String>,
    },
    /// Delete a project
    Delete {
        /// Project name or ID
        name_or_id: String,
        /// Skip confirmation prompt
        #[arg(long)]
        yes: bool,
    },
    /// Run a project-scoped script detached. Returns the PID immediately;
    /// logs stream to `<app_dir>/runtime/<script_id>.log`.
    Run {
        /// Project name or ID
        project: String,
        /// Script name or ID (within the project)
        script: String,
        /// Extra arguments to pass to the script
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Stop a running project script (kills the process tree).
    Stop {
        project: String,
        script: String,
    },
    /// Show the runtime state of a project script: PID, uptime, command.
    Status {
        project: String,
        script: String,
    },
    /// Print buffered logs for a project script.
    Logs {
        project: String,
        script: String,
        #[arg(long, default_value_t = 100)]
        tail: usize,
        #[arg(short, long)]
        follow: bool,
    },
}

// ---------------------------------------------------------------------------
// Service subcommands
// ---------------------------------------------------------------------------

#[derive(Subcommand)]
enum ServiceAction {
    /// List services for a project
    List {
        /// Project name or ID
        project: String,
    },
    /// Add a service to a project
    Add {
        /// Project name or ID
        project: String,
        /// Service name
        name: String,
        /// Working directory (relative to project root)
        dir: String,
        /// Command to run
        command: String,
        /// Mode definitions as name=cmd pairs
        #[arg(long)]
        mode: Option<Vec<String>>,
        /// Default mode name
        #[arg(long)]
        default_mode: Option<String>,
        /// Port number
        #[arg(long)]
        port: Option<u16>,
        /// Color hex
        #[arg(long)]
        color: Option<String>,
    },
    /// Update a service
    Update {
        /// Service ID
        id: String,
        /// New name
        #[arg(long)]
        name: Option<String>,
        /// New command
        #[arg(long)]
        command: Option<String>,
        /// Working directory
        #[arg(long)]
        dir: Option<String>,
    },
    /// Delete a service
    Delete {
        /// Service ID
        id: String,
        /// Skip confirmation prompt
        #[arg(long)]
        yes: bool,
    },
    /// Start a service detached. Returns the PID immediately; logs stream
    /// to `<app_dir>/runtime/<service_id>.log`.
    Start {
        /// Project name or ID
        project: String,
        /// Service name or ID (within the project)
        service: String,
        /// Mode name (overrides the service's default_mode)
        #[arg(long)]
        mode: Option<String>,
        /// Arg preset name (overrides the service's default_arg_preset)
        #[arg(long)]
        arg_preset: Option<String>,
    },
    /// Stop a running service (kills the process tree).
    Stop {
        project: String,
        service: String,
    },
    /// Show the runtime state of a service: PID, uptime, last log lines.
    Status {
        project: String,
        service: String,
    },
    /// Print buffered logs for a service.
    Logs {
        project: String,
        service: String,
        /// Tail the last N lines (default 100)
        #[arg(long, default_value_t = 100)]
        tail: usize,
        /// Follow the log file and print new lines as they arrive
        #[arg(short, long)]
        follow: bool,
    },
}

// ---------------------------------------------------------------------------
// Tool subcommands
// ---------------------------------------------------------------------------

#[derive(Subcommand)]
enum ToolAction {
    /// List all tools
    List {
        /// Filter by tag (exact, case-insensitive)
        #[arg(long)]
        tag: Option<String>,
        /// Filter by name (case-insensitive substring)
        #[arg(long)]
        name: Option<String>,
        /// Scan system for installed tools (Scoop/Chocolatey)
        #[arg(long)]
        scan: bool,
    },
    /// Show details for a tool
    Get {
        /// Tool name or ID
        name_or_id: String,
    },
    /// Register a new tool
    Create {
        /// Tool name
        name: String,
        /// Description
        #[arg(long)]
        description: Option<String>,
        /// Tags
        #[arg(long)]
        tag: Option<Vec<String>>,
        /// Status (default: Active)
        #[arg(long)]
        status: Option<String>,
        /// Install method (e.g. scoop, choco, winget, manual)
        #[arg(long)]
        install_method: Option<String>,
        /// Install location path
        #[arg(long)]
        install_location: Option<String>,
        /// Version string
        #[arg(long)]
        version: Option<String>,
        /// Homepage URL
        #[arg(long)]
        homepage: Option<String>,
        /// Color hex
        #[arg(long)]
        color: Option<String>,
        /// Config paths as "label=path" or "label=path:dir" for directories
        #[arg(long)]
        config_path: Option<Vec<String>>,
    },
    /// Update an existing tool
    Update {
        /// Tool name or ID
        name_or_id: String,
        /// New name
        #[arg(long)]
        name: Option<String>,
        /// Description
        #[arg(long)]
        description: Option<String>,
        /// Tags (replaces all)
        #[arg(long)]
        tag: Option<Vec<String>>,
        /// Status
        #[arg(long)]
        status: Option<String>,
        /// Version string
        #[arg(long)]
        version: Option<String>,
        /// Homepage URL
        #[arg(long)]
        homepage: Option<String>,
        /// Config paths as "label=path" or "label=path:dir" for directories (replaces all)
        #[arg(long)]
        config_path: Option<Vec<String>>,
    },
    /// Delete a tool
    Delete {
        /// Tool name or ID
        name_or_id: String,
        /// Skip confirmation prompt
        #[arg(long)]
        yes: bool,
    },
}

// ---------------------------------------------------------------------------
// Alias subcommands
// ---------------------------------------------------------------------------

#[derive(Subcommand)]
enum AliasCommand {
    /// List all aliases
    List {
        /// Filter by name (case-insensitive substring)
        #[arg(long)]
        name: Option<String>,
    },
    /// Show details for an alias
    Get {
        /// Alias name
        name: String,
    },
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
    /// Update an existing alias
    Update {
        /// Alias name or ID
        name_or_id: String,
        /// New name
        #[arg(long)]
        name: Option<String>,
        /// New command
        #[arg(long)]
        command: Option<String>,
        /// Description
        #[arg(long)]
        description: Option<String>,
        /// Alias type
        #[arg(short = 't', long = "type")]
        alias_type: Option<String>,
        /// Execution order for init script
        #[arg(long)]
        execution_order: Option<u32>,
        /// Tags (replaces all)
        #[arg(long)]
        tag: Option<Vec<String>>,
    },
    /// Remove an alias by name
    Remove {
        /// Alias name to remove
        name: String,
    },
}

// ---------------------------------------------------------------------------
// App subcommands
// ---------------------------------------------------------------------------

#[derive(Subcommand)]
enum AppAction {
    /// List all apps
    List {
        /// Filter by name (case-insensitive substring)
        #[arg(long)]
        name: Option<String>,
    },
    /// Show details for an app
    Get {
        /// App name or ID
        name_or_id: String,
    },
    /// Register a new app
    Create {
        /// App name
        name: String,
        /// Description
        #[arg(long)]
        description: Option<String>,
        /// Path to executable
        #[arg(long)]
        executable: Option<String>,
        /// Tags
        #[arg(long)]
        tag: Option<Vec<String>>,
        /// Status
        #[arg(long)]
        status: Option<String>,
        /// Homepage URL
        #[arg(long)]
        homepage: Option<String>,
        /// Launch arguments
        #[arg(long)]
        launch_args: Option<String>,
        /// Color hex
        #[arg(long)]
        color: Option<String>,
        /// Config paths as "label=path" or "label=path:dir" for directories
        #[arg(long)]
        config_path: Option<Vec<String>>,
    },
    /// Update an existing app
    Update {
        /// App name or ID
        name_or_id: String,
        /// New name
        #[arg(long)]
        name: Option<String>,
        /// Description
        #[arg(long)]
        description: Option<String>,
        /// Path to executable
        #[arg(long)]
        executable: Option<String>,
        /// Tags (replaces all)
        #[arg(long)]
        tag: Option<Vec<String>>,
        /// Status
        #[arg(long)]
        status: Option<String>,
        /// Homepage URL
        #[arg(long)]
        homepage: Option<String>,
        /// Config paths as "label=path" or "label=path:dir" for directories (replaces all)
        #[arg(long)]
        config_path: Option<Vec<String>>,
    },
    /// Delete an app
    Delete {
        /// App name or ID
        name_or_id: String,
        /// Skip confirmation prompt
        #[arg(long)]
        yes: bool,
    },
    /// Launch an app by name
    Launch {
        /// App name (case-insensitive partial match)
        name: String,
    },
}

// ---------------------------------------------------------------------------
// Tag subcommands
// ---------------------------------------------------------------------------

#[derive(Subcommand)]
enum TagAction {
    /// List all tag definitions
    List,
    /// Create a new tag definition
    Create {
        /// Tag name
        name: String,
        /// Color hex (e.g. "#ff5500")
        #[arg(long)]
        color: Option<String>,
        /// Sort order
        #[arg(long)]
        order: Option<u32>,
    },
    /// Update a tag definition
    Update {
        /// Current tag name
        name: String,
        /// New name
        #[arg(long = "name")]
        new_name: Option<String>,
        /// Color hex
        #[arg(long)]
        color: Option<String>,
        /// Sort order
        #[arg(long)]
        order: Option<u32>,
    },
    /// Delete a tag definition
    Delete {
        /// Tag name
        name: String,
        /// Skip confirmation prompt
        #[arg(long)]
        yes: bool,
    },
}

// ---------------------------------------------------------------------------
// Status subcommands
// ---------------------------------------------------------------------------

#[derive(Subcommand)]
enum StatusAction {
    /// List all status definitions
    List,
    /// Create a new status definition
    Create {
        /// Status name
        name: String,
        /// Color hex (e.g. "#22c55e")
        #[arg(long)]
        color: Option<String>,
        /// Sort order
        #[arg(long)]
        order: Option<u32>,
    },
    /// Update a status definition
    Update {
        /// Current status name
        name: String,
        /// New name
        #[arg(long = "name")]
        new_name: Option<String>,
        /// Color hex
        #[arg(long)]
        color: Option<String>,
        /// Sort order
        #[arg(long)]
        order: Option<u32>,
    },
    /// Delete a status definition
    Delete {
        /// Status name
        name: String,
        /// Skip confirmation prompt
        #[arg(long)]
        yes: bool,
    },
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Settings subcommands
// ---------------------------------------------------------------------------

#[derive(Subcommand)]
enum SettingsAction {
    /// Display all settings
    Get,
    /// Set a settings value
    Set {
        /// Setting key path (e.g. terminal.preset, toolboxBaseUrl)
        key: String,
        /// Value to set
        value: String,
    },
}

// ============================================================================
// Name/ID resolver
// ============================================================================

fn resolve_by_name_or_id<'a, T>(
    items: &'a [T],
    name_or_id: &str,
    get_id: impl Fn(&T) -> &str,
    get_name: impl Fn(&T) -> &str,
) -> Result<&'a T, String> {
    // Try exact ID first
    if let Some(item) = items.iter().find(|i| get_id(i) == name_or_id) {
        return Ok(item);
    }
    // Then case-insensitive name
    let lower = name_or_id.to_lowercase();
    items
        .iter()
        .find(|i| get_name(i).to_lowercase() == lower)
        .ok_or_else(|| format!("'{}' not found", name_or_id))
}

/// Case-insensitive substring match. Returns true when `needle` is `None`
/// (no filter active) or when `haystack` contains `needle`. Used by every
/// `list` subcommand's `--name` / `--path` filter (#19).
fn matches_substr(haystack: &str, needle: Option<&str>) -> bool {
    match needle {
        None => true,
        Some(n) => haystack.to_lowercase().contains(&n.to_lowercase()),
    }
}

// ============================================================================
// Delete confirmation
// ============================================================================

/// Parse config path entries from CLI: "label=path" or "label=path:dir"
fn parse_config_paths(entries: &[String]) -> Vec<cortx_core::models::ToolConfigPath> {
    entries.iter().filter_map(|entry| {
        let (main_part, is_dir) = if entry.ends_with(":dir") {
            (&entry[..entry.len() - 4], true)
        } else {
            (entry.as_str(), false)
        };
        if let Some(pos) = main_part.find('=') {
            Some(cortx_core::models::ToolConfigPath {
                label: main_part[..pos].to_string(),
                path: main_part[pos + 1..].to_string(),
                is_directory: is_dir,
            })
        } else {
            None
        }
    }).collect()
}

fn confirm_delete(entity: &str, name: &str, skip: bool) -> bool {
    if skip {
        return true;
    }
    eprint!("Delete {} '{}'? [y/N] ", entity, name);
    let mut input = String::new();
    if io::stdin().read_line(&mut input).is_err() {
        return false;
    }
    matches!(input.trim().to_lowercase().as_str(), "y" | "yes")
}

// ============================================================================
// main
// ============================================================================

fn main() -> anyhow::Result<()> {
    env_logger::init();

    let cli = Cli::parse();
    let json = cli.json;
    init_color(cli.no_color);

    let storage = Arc::new(Storage::new()?);
    let runtime_store = Arc::new(RuntimeStore::new(storage.app_dir())?);
    let process_manager = Arc::new(ProcessManager::new(runtime_store.clone()));

    match cli.command {
        // Legacy shortcuts
        Some(Command::Scripts) => cmd_script_list(&storage, None, None, json),
        Some(Command::Tools { scan }) => cmd_tool_list(&storage, None, None, scan, json),

        Some(Command::Init { shell }) => cmd_init(&storage, &shell),

        // Script group
        Some(Command::Script { action }) => match action {
            ScriptAction::List { tag, name } => {
                cmd_script_list(&storage, tag.as_deref(), name.as_deref(), json)
            }
            ScriptAction::Get { name_or_id } => cmd_script_get(&storage, &name_or_id, json),
            ScriptAction::Create { name, command, dir, tag, description, status } => {
                cmd_script_create(&storage, &name, &command, dir.as_deref(), tag, description.as_deref(), status.as_deref(), json)
            }
            ScriptAction::Update { name_or_id, name, command, dir, tag, description, status } => {
                cmd_script_update(&storage, &name_or_id, name, command, dir, tag, description, status, json)
            }
            ScriptAction::Delete { name_or_id, yes } => cmd_script_delete(&storage, &name_or_id, yes),
        },

        // Project group
        Some(Command::Project { action }) => match action {
            ProjectAction::List { tag, name, path, include } => cmd_project_list(
                &storage,
                tag.as_deref(),
                name.as_deref(),
                path.as_deref(),
                &include,
                json,
            ),
            ProjectAction::Get { name_or_id } => cmd_project_get(&storage, &name_or_id, json),
            ProjectAction::Create { name, path, description, tag, status, toolbox_url } => {
                cmd_project_create(&storage, &name, &path, description.as_deref(), tag, status.as_deref(), toolbox_url.as_deref(), json)
            }
            ProjectAction::Update { name_or_id, name, path, description, tag, status, toolbox_url } => {
                cmd_project_update(&storage, &name_or_id, name, path, description, tag, status, toolbox_url, json)
            }
            ProjectAction::Delete { name_or_id, yes } => cmd_project_delete(&storage, &name_or_id, yes),
            ProjectAction::Run { project, script, args } => {
                cmd_project_run(&storage, &project, &script, &args, json)
            }
            ProjectAction::Stop { project, script } => {
                cmd_project_script_stop(&storage, &project, &script, json)
            }
            ProjectAction::Status { project, script } => {
                cmd_project_script_status(&storage, &project, &script, json)
            }
            ProjectAction::Logs { project, script, tail, follow } => {
                cmd_project_script_logs(&storage, &project, &script, tail, follow)
            }
        },

        // Service group
        Some(Command::Service { action }) => match action {
            ServiceAction::List { project } => cmd_service_list(&storage, &project, json),
            ServiceAction::Add { project, name, dir, command, mode, default_mode, port, color } => {
                cmd_service_add(&storage, &project, &name, &dir, &command, mode, default_mode, port, color, json)
            }
            ServiceAction::Update { id, name, command, dir } => {
                cmd_service_update(&storage, &id, name, command, dir, json)
            }
            ServiceAction::Delete { id, yes } => cmd_service_delete(&storage, &id, yes),
            ServiceAction::Start { project, service, mode, arg_preset } => {
                cmd_service_start(&storage, &project, &service, mode.as_deref(), arg_preset.as_deref(), json)
            }
            ServiceAction::Stop { project, service } => {
                cmd_service_stop(&storage, &project, &service, json)
            }
            ServiceAction::Status { project, service } => {
                cmd_service_status(&storage, &project, &service, json)
            }
            ServiceAction::Logs { project, service, tail, follow } => {
                cmd_service_logs(&storage, &project, &service, tail, follow)
            }
        },

        // Tool group
        Some(Command::Tool { action }) => match action {
            ToolAction::List { tag, name, scan } => {
                cmd_tool_list(&storage, tag.as_deref(), name.as_deref(), scan, json)
            }
            ToolAction::Get { name_or_id } => cmd_tool_get(&storage, &name_or_id, json),
            ToolAction::Create { name, description, tag, status, install_method, install_location, version, homepage, color, config_path } => {
                cmd_tool_create(&storage, &name, description.as_deref(), tag, status.as_deref(), install_method.as_deref(), install_location.as_deref(), version.as_deref(), homepage.as_deref(), color.as_deref(), config_path, json)
            }
            ToolAction::Update { name_or_id, name, description, tag, status, version, homepage, config_path } => {
                cmd_tool_update(&storage, &name_or_id, name, description, tag, status, version, homepage, config_path, json)
            }
            ToolAction::Delete { name_or_id, yes } => cmd_tool_delete(&storage, &name_or_id, yes),
        },

        // Alias group
        Some(Command::Alias { command: alias_cmd }) => match alias_cmd {
            AliasCommand::List { name } => cmd_alias_list(&storage, name.as_deref(), json),
            AliasCommand::Get { name } => cmd_alias_get(&storage, &name, json),
            AliasCommand::Add { name, command, description, alias_type, setup, script, tool_id } => {
                cmd_alias_add(&storage, &name, &command, description.as_deref(), alias_type.as_deref(), setup, script, tool_id)
            }
            AliasCommand::Update { name_or_id, name, command, description, alias_type, execution_order, tag } => {
                cmd_alias_update(&storage, &name_or_id, name, command, description, alias_type, execution_order, tag, json)
            }
            AliasCommand::Remove { name } => cmd_alias_remove(&storage, &name),
        },

        // App group
        Some(Command::App { action }) => match action {
            AppAction::List { name } => cmd_app_list(&storage, name.as_deref(), json),
            AppAction::Get { name_or_id } => cmd_app_get(&storage, &name_or_id, json),
            AppAction::Create { name, description, executable, tag, status, homepage, launch_args, color, config_path } => {
                cmd_app_create(&storage, &name, description.as_deref(), executable.as_deref(), tag, status.as_deref(), homepage.as_deref(), launch_args.as_deref(), color.as_deref(), config_path, json)
            }
            AppAction::Update { name_or_id, name, description, executable, tag, status, homepage, config_path } => {
                cmd_app_update(&storage, &name_or_id, name, description, executable, tag, status, homepage, config_path, json)
            }
            AppAction::Delete { name_or_id, yes } => cmd_app_delete(&storage, &name_or_id, yes),
            AppAction::Launch { name } => cmd_app_launch(&storage, &name),
        },

        // Tag group
        Some(Command::Tag { action }) => match action {
            TagAction::List => cmd_tag_list(&storage, json),
            TagAction::Create { name, color, order } => cmd_tag_create(&storage, &name, color.as_deref(), order, json),
            TagAction::Update { name, new_name, color, order } => cmd_tag_update(&storage, &name, new_name, color, order, json),
            TagAction::Delete { name, yes } => cmd_tag_delete(&storage, &name, yes),
        },

        // Status group
        Some(Command::Status { action }) => match action {
            StatusAction::List => cmd_status_list(&storage, json),
            StatusAction::Create { name, color, order } => cmd_status_create(&storage, &name, color.as_deref(), order, json),
            StatusAction::Update { name, new_name, color, order } => cmd_status_update(&storage, &name, new_name, color, order, json),
            StatusAction::Delete { name, yes } => cmd_status_delete(&storage, &name, yes),
        },

        // Settings
        Some(Command::Settings { action }) => match action {
            SettingsAction::Get => cmd_settings_get(&storage, json),
            SettingsAction::Set { key, value } => cmd_settings_set(&storage, &key, &value),
        },

        // Data commands
        Some(Command::Export { file }) => cmd_export(&storage, file.as_deref()),
        Some(Command::Import { file, all }) => cmd_import(&storage, &file, all),
        Some(Command::Backup) => cmd_backup(&storage),
        Some(Command::Docs) => cmd_docs(),
        Some(Command::Ps) => cmd_ps(&storage, json),

        // Run shortcuts
        Some(Command::Run { script, args, preset, detach }) => {
            if detach {
                cmd_run_detached(&storage, &script, preset.as_deref(), &args, json)
            } else {
                cmd_run(&storage, &process_manager, &script, preset.as_deref(), &args)
            }
        }
        Some(Command::Stop { script }) => cmd_global_script_stop(&storage, &script, json),
        Some(Command::Logs { script, tail, follow }) => {
            cmd_global_script_logs(&storage, &script, tail, follow)
        }
        Some(Command::External(args)) => {
            cmd_run(&storage, &process_manager, &args[0], None, &args[1..].to_vec())
        }

        // TUI
        None => run_tui(storage, process_manager),
    }
}

// ============================================================================
// Script commands
// ============================================================================

fn cmd_script_list(
    storage: &Storage,
    tag_filter: Option<&str>,
    name_filter: Option<&str>,
    json: bool,
) -> anyhow::Result<()> {
    let scripts = storage.get_all_global_scripts();

    let tag_lower = tag_filter.map(|t| t.to_lowercase());
    let filtered: Vec<&GlobalScript> = scripts
        .iter()
        .filter(|s| match tag_lower.as_deref() {
            Some(t) => s.tags.iter().any(|tg| tg.to_lowercase() == t),
            None => true,
        })
        .filter(|s| matches_substr(&s.name, name_filter))
        .collect();

    if json {
        let items: Vec<&GlobalScript> = filtered;
        println!("{}", serde_json::to_string_pretty(&items)?);
        return Ok(());
    }

    if filtered.is_empty() {
        println!("No global scripts configured.");
        return Ok(());
    }

    let tag_defs = storage.get_all_tag_definitions();

    // Sort scripts by primary tag order, then alphabetically by name
    let mut sorted = filtered;
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
    println!("\n{} script(s)", sorted.len());
    Ok(())
}

fn cmd_script_get(storage: &Storage, name_or_id: &str, json: bool) -> anyhow::Result<()> {
    let scripts = storage.get_all_global_scripts();
    let script = resolve_by_name_or_id(&scripts, name_or_id, |s| &s.id, |s| &s.name)
        .map_err(|e| anyhow::anyhow!("Script {}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(script)?);
        return Ok(());
    }

    println!("Name:        {}", script.name);
    println!("ID:          {}", script.id);
    println!("Command:     {}", util::format_command_display(&script.command, script.script_path.as_deref()));
    if let Some(ref dir) = script.working_dir {
        println!("Directory:   {}", dir);
    }
    if let Some(ref desc) = script.description {
        println!("Description: {}", desc);
    }
    if !script.tags.is_empty() {
        println!("Tags:        {}", script.tags.join(", "));
    }
    if let Some(ref status) = script.status {
        println!("Status:      {}", status);
    }
    if !script.parameters.is_empty() {
        println!("Parameters:  {} defined", script.parameters.len());
    }
    if !script.parameter_presets.is_empty() {
        println!("Presets:     {}", script.parameter_presets.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", "));
    }
    println!("Created:     {}", script.created_at.format("%Y-%m-%d %H:%M:%S"));
    println!("Updated:     {}", script.updated_at.format("%Y-%m-%d %H:%M:%S"));
    Ok(())
}

fn cmd_script_create(
    storage: &Storage,
    name: &str,
    command: &str,
    dir: Option<&str>,
    tags: Option<Vec<String>>,
    description: Option<&str>,
    status: Option<&str>,
    json: bool,
) -> anyhow::Result<()> {
    let mut script = GlobalScript::new(name.to_string(), command.to_string(), dir.map(|s| s.to_string()));
    script.description = description.map(|s| s.to_string());
    if let Some(tags) = tags {
        script.tags = tags;
    }
    script.status = status.map(|s| s.to_string());

    let created = storage.create_global_script(script).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&created)?);
    } else {
        println!("Script '{}' created (ID: {}).", created.name, created.id);
    }
    Ok(())
}

fn cmd_script_update(
    storage: &Storage,
    name_or_id: &str,
    name: Option<String>,
    command: Option<String>,
    dir: Option<String>,
    tags: Option<Vec<String>>,
    description: Option<String>,
    status: Option<String>,
    json: bool,
) -> anyhow::Result<()> {
    let scripts = storage.get_all_global_scripts();
    let existing = resolve_by_name_or_id(&scripts, name_or_id, |s| &s.id, |s| &s.name)
        .map_err(|e| anyhow::anyhow!("Script {}", e))?;
    let id = existing.id.clone();

    let updated = storage.update_global_script(&id, |s| {
        if let Some(ref n) = name { s.name = n.clone(); }
        if let Some(ref c) = command { s.command = c.clone(); }
        if let Some(ref d) = dir { s.working_dir = Some(d.clone()); }
        if let Some(ref t) = tags { s.tags = t.clone(); }
        if let Some(ref d) = description { s.description = Some(d.clone()); }
        if let Some(ref st) = status { s.status = Some(st.clone()); }
    }).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&updated)?);
    } else {
        println!("Script '{}' updated.", updated.name);
    }
    Ok(())
}

fn cmd_script_delete(storage: &Storage, name_or_id: &str, yes: bool) -> anyhow::Result<()> {
    let scripts = storage.get_all_global_scripts();
    let script = resolve_by_name_or_id(&scripts, name_or_id, |s| &s.id, |s| &s.name)
        .map_err(|e| anyhow::anyhow!("Script {}", e))?;

    if !confirm_delete("script", &script.name, yes) {
        println!("Cancelled.");
        return Ok(());
    }

    storage.delete_global_script(&script.id).map_err(|e| anyhow::anyhow!("{}", e))?;
    println!("Script '{}' deleted.", script.name);
    Ok(())
}

// ============================================================================
// Project commands
// ============================================================================

/// Which subcollections to embed in `cortx project list --json`.
/// Defaults to all-false → shallow output with counts only.
#[derive(Debug, Default, Clone, Copy)]
struct ProjectListIncludes {
    services: bool,
    scripts: bool,
    env_files: bool,
}

fn parse_project_list_includes(items: &[String]) -> anyhow::Result<ProjectListIncludes> {
    let mut inc = ProjectListIncludes::default();
    for raw in items {
        for part in raw.split(',') {
            match part.trim() {
                "" => continue,
                "all" => {
                    return Ok(ProjectListIncludes {
                        services: true,
                        scripts: true,
                        env_files: true,
                    })
                }
                "services" => inc.services = true,
                "scripts" => inc.scripts = true,
                "envFiles" | "env_files" | "env-files" => inc.env_files = true,
                other => {
                    return Err(anyhow::anyhow!(
                        "Unknown --include value '{}'. Valid: services, scripts, envFiles, all",
                        other
                    ))
                }
            }
        }
    }
    Ok(inc)
}

/// Build the JSON shape for one project, honoring the include set.
/// Always uses sanitized env-file values (no secrets in output, see #15).
/// Optional fields are omitted when None to match the rest of the JSON
/// output's `skip_serializing_if` conventions.
fn project_to_list_json(p: &Project, inc: ProjectListIncludes) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    map.insert("id".into(), serde_json::Value::String(p.id.clone()));
    map.insert("name".into(), serde_json::Value::String(p.name.clone()));
    map.insert(
        "rootPath".into(),
        serde_json::Value::String(p.root_path.clone()),
    );
    if let Some(ref v) = p.description {
        map.insert("description".into(), serde_json::Value::String(v.clone()));
    }
    if let Some(ref v) = p.image_path {
        map.insert("imagePath".into(), serde_json::Value::String(v.clone()));
    }
    map.insert("tags".into(), serde_json::to_value(&p.tags).unwrap());
    if let Some(ref v) = p.status {
        map.insert("status".into(), serde_json::Value::String(v.clone()));
    }
    if let Some(ref v) = p.toolbox_url {
        map.insert("toolboxUrl".into(), serde_json::Value::String(v.clone()));
    }
    map.insert("createdAt".into(), serde_json::to_value(p.created_at).unwrap());
    map.insert("updatedAt".into(), serde_json::to_value(p.updated_at).unwrap());
    if let Some(ts) = p.last_opened_at {
        map.insert("lastOpenedAt".into(), serde_json::to_value(ts).unwrap());
    }
    map.insert(
        "serviceCount".into(),
        serde_json::Value::from(p.services.len()),
    );
    map.insert(
        "scriptCount".into(),
        serde_json::Value::from(p.scripts.len()),
    );
    map.insert(
        "envFileCount".into(),
        serde_json::Value::from(p.env_files.len()),
    );

    if inc.services {
        map.insert("services".into(), serde_json::to_value(&p.services).unwrap());
    }
    if inc.scripts {
        map.insert("scripts".into(), serde_json::to_value(&p.scripts).unwrap());
    }
    if inc.env_files {
        let sanitized = p.sanitized_for_output();
        map.insert(
            "envFiles".into(),
            serde_json::to_value(&sanitized.env_files).unwrap(),
        );
        map.insert(
            "envFilesDiscovered".into(),
            serde_json::Value::Bool(p.env_files_discovered),
        );
    }
    serde_json::Value::Object(map)
}

fn cmd_project_list(
    storage: &Storage,
    tag_filter: Option<&str>,
    name_filter: Option<&str>,
    path_filter: Option<&str>,
    include: &[String],
    json: bool,
) -> anyhow::Result<()> {
    let projects = storage.get_all_projects();

    let tag_lower = tag_filter.map(|t| t.to_lowercase());
    let filtered: Vec<&Project> = projects
        .iter()
        .filter(|p| match tag_lower.as_deref() {
            Some(t) => p.tags.iter().any(|tg| tg.to_lowercase() == t),
            None => true,
        })
        .filter(|p| matches_substr(&p.name, name_filter))
        .filter(|p| matches_substr(&p.root_path, path_filter))
        .collect();

    if json {
        let includes = parse_project_list_includes(include)?;
        let payload: Vec<serde_json::Value> = filtered
            .iter()
            .map(|p| project_to_list_json(p, includes))
            .collect();
        println!("{}", serde_json::to_string_pretty(&payload)?);
        return Ok(());
    }

    if filtered.is_empty() {
        println!("No projects configured.");
        return Ok(());
    }

    let tag_defs = storage.get_all_tag_definitions();

    let mut sorted = filtered;
    sorted.sort_by(|a, b| {
        let ta = a.tags.first().map(|s| s.to_lowercase()).unwrap_or_default();
        let tb = b.tags.first().map(|s| s.to_lowercase()).unwrap_or_default();
        ta.cmp(&tb).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    println!("{:<30} {:<12} {:<15} {}", "NAME", "STATUS", "TAGS", "PATH");
    println!("{}", "-".repeat(80));

    for p in &sorted {
        let status = p.status.as_deref().unwrap_or("-");
        let tags_display = if p.tags.is_empty() {
            String::from("-")
        } else {
            colorize_tags(&p.tags, &tag_defs)
        };
        let tags_visible = if p.tags.is_empty() { 1 } else { p.tags.join(", ").len() };
        let tags_pad = if tags_visible < 15 { 15 - tags_visible } else { 1 };
        println!("{:<30} {:<12} {}{:tags_pad$} {}", p.name, status, tags_display, "", p.root_path, tags_pad = tags_pad);
    }
    println!("\n{} project(s)", sorted.len());
    Ok(())
}

fn cmd_project_get(storage: &Storage, name_or_id: &str, json: bool) -> anyhow::Result<()> {
    let projects = storage.get_all_projects();
    let project = resolve_by_name_or_id(&projects, name_or_id, |p| &p.id, |p| &p.name)
        .map_err(|e| anyhow::anyhow!("Project {}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&project.sanitized_for_output())?);
        return Ok(());
    }

    println!("Name:        {}", project.name);
    println!("ID:          {}", project.id);
    println!("Path:        {}", project.root_path);
    if let Some(ref desc) = project.description {
        println!("Description: {}", desc);
    }
    if !project.tags.is_empty() {
        println!("Tags:        {}", project.tags.join(", "));
    }
    if let Some(ref status) = project.status {
        println!("Status:      {}", status);
    }
    if let Some(ref url) = project.toolbox_url {
        println!("Toolbox URL: {}", url);
    }
    println!("Services:    {}", project.services.len());
    println!("Scripts:     {}", project.scripts.len());
    println!("Created:     {}", project.created_at.format("%Y-%m-%d %H:%M:%S"));
    println!("Updated:     {}", project.updated_at.format("%Y-%m-%d %H:%M:%S"));
    Ok(())
}

fn cmd_project_create(
    storage: &Storage,
    name: &str,
    path: &str,
    description: Option<&str>,
    tags: Option<Vec<String>>,
    status: Option<&str>,
    toolbox_url: Option<&str>,
    json: bool,
) -> anyhow::Result<()> {
    let mut project = Project::new(name.to_string(), path.to_string());
    project.description = description.map(|s| s.to_string());
    if let Some(tags) = tags {
        project.tags = tags;
    }
    project.status = status.map(|s| s.to_string());
    project.toolbox_url = toolbox_url.map(|s| s.to_string());

    let created = storage.create_project(project).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&created)?);
    } else {
        println!("Project '{}' created (ID: {}).", created.name, created.id);
    }
    Ok(())
}

fn cmd_project_update(
    storage: &Storage,
    name_or_id: &str,
    name: Option<String>,
    path: Option<String>,
    description: Option<String>,
    tags: Option<Vec<String>>,
    status: Option<String>,
    toolbox_url: Option<String>,
    json: bool,
) -> anyhow::Result<()> {
    let projects = storage.get_all_projects();
    let existing = resolve_by_name_or_id(&projects, name_or_id, |p| &p.id, |p| &p.name)
        .map_err(|e| anyhow::anyhow!("Project {}", e))?;
    let id = existing.id.clone();

    let updated = storage.update_project(&id, |p| {
        if let Some(ref n) = name { p.name = n.clone(); }
        if let Some(ref pa) = path { p.root_path = pa.clone(); }
        if let Some(ref d) = description { p.description = Some(d.clone()); }
        if let Some(ref t) = tags { p.tags = t.clone(); }
        if let Some(ref s) = status { p.status = Some(s.clone()); }
        if let Some(ref u) = toolbox_url { p.toolbox_url = Some(u.clone()); }
    }).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&updated)?);
    } else {
        println!("Project '{}' updated.", updated.name);
    }
    Ok(())
}

fn cmd_project_delete(storage: &Storage, name_or_id: &str, yes: bool) -> anyhow::Result<()> {
    let projects = storage.get_all_projects();
    let project = resolve_by_name_or_id(&projects, name_or_id, |p| &p.id, |p| &p.name)
        .map_err(|e| anyhow::anyhow!("Project {}", e))?;

    if !confirm_delete("project", &project.name, yes) {
        println!("Cancelled.");
        return Ok(());
    }

    storage.delete_project(&project.id).map_err(|e| anyhow::anyhow!("{}", e))?;
    println!("Project '{}' deleted.", project.name);
    Ok(())
}

// ============================================================================
// Service commands
// ============================================================================

fn cmd_service_list(storage: &Storage, project_ref: &str, json: bool) -> anyhow::Result<()> {
    let projects = storage.get_all_projects();
    let project = resolve_by_name_or_id(&projects, project_ref, |p| &p.id, |p| &p.name)
        .map_err(|e| anyhow::anyhow!("Project {}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&project.services)?);
        return Ok(());
    }

    if project.services.is_empty() {
        println!("No services in project '{}'.", project.name);
        return Ok(());
    }

    println!("Services in '{}' ({}):\n", project.name, project.id);
    println!("{:<30} {:<40} {:<8} {}", "NAME", "COMMAND", "PORT", "DIR");
    println!("{}", "-".repeat(90));

    for s in &project.services {
        let port = s.port.map(|p| p.to_string()).unwrap_or_else(|| "-".to_string());
        println!("{:<30} {:<40} {:<8} {}", s.name, s.command, port, s.working_dir);
    }
    println!("\n{} service(s)", project.services.len());
    Ok(())
}

fn cmd_service_add(
    storage: &Storage,
    project_ref: &str,
    name: &str,
    dir: &str,
    command: &str,
    modes: Option<Vec<String>>,
    default_mode: Option<String>,
    port: Option<u16>,
    color: Option<String>,
    json: bool,
) -> anyhow::Result<()> {
    let projects = storage.get_all_projects();
    let project = resolve_by_name_or_id(&projects, project_ref, |p| &p.id, |p| &p.name)
        .map_err(|e| anyhow::anyhow!("Project {}", e))?;
    let project_id = project.id.clone();

    let mut service = Service::new(name.to_string(), dir.to_string(), command.to_string());
    if let Some(mode_entries) = modes {
        let map = parse_shell_map(&mode_entries);
        if !map.is_empty() {
            service.modes = Some(map);
        }
    }
    service.default_mode = default_mode;
    service.port = port;
    service.color = color;

    let created = storage.add_service(&project_id, service).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&created)?);
    } else {
        println!("Service '{}' added to project (ID: {}).", created.name, created.id);
    }
    Ok(())
}

fn cmd_service_update(
    storage: &Storage,
    id: &str,
    name: Option<String>,
    command: Option<String>,
    dir: Option<String>,
    json: bool,
) -> anyhow::Result<()> {
    let updated = storage.update_service(id, |s| {
        if let Some(ref n) = name { s.name = n.clone(); }
        if let Some(ref c) = command { s.command = c.clone(); }
        if let Some(ref d) = dir { s.working_dir = d.clone(); }
    }).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&updated)?);
    } else {
        println!("Service '{}' updated.", updated.name);
    }
    Ok(())
}

fn cmd_service_delete(storage: &Storage, id: &str, yes: bool) -> anyhow::Result<()> {
    // Look up service name for confirmation prompt
    let svc = storage.get_service(id);
    let name = svc.as_ref().map(|(_, s)| s.name.as_str()).unwrap_or(id);

    if !confirm_delete("service", name, yes) {
        println!("Cancelled.");
        return Ok(());
    }

    storage.delete_service(id).map_err(|e| anyhow::anyhow!("{}", e))?;
    println!("Service deleted.");
    Ok(())
}

// ----- Process control -----------------------------------------------------

/// Look up `(project, service)` by accepting either UUIDs or names for both.
fn resolve_project_service(
    storage: &Storage,
    project_ref: &str,
    service_ref: &str,
) -> anyhow::Result<(Project, Service)> {
    let projects = storage.get_all_projects();
    let project = resolve_by_name_or_id(&projects, project_ref, |p| &p.id, |p| &p.name)
        .map_err(|e| anyhow::anyhow!("Project {}", e))?
        .clone();
    let service = resolve_by_name_or_id(
        &project.services,
        service_ref,
        |s| &s.id,
        |s| &s.name,
    )
    .map_err(|e| anyhow::anyhow!("Service {}", e))?
    .clone();
    Ok((project, service))
}

/// Build the shell command string for a service, honoring mode + arg preset
/// + extra_args the same way `cortx-mcp` does.
fn build_service_command_string(
    service: &Service,
    mode: Option<&str>,
    arg_preset: Option<&str>,
) -> (String, Option<String>, Option<String>) {
    let mut command = service.command.clone();
    let active_mode = mode
        .map(String::from)
        .or_else(|| service.default_mode.clone());
    if let (Some(ref name), Some(ref modes)) = (&active_mode, &service.modes) {
        if let Some(suffix) = modes.get(name) {
            command = format!("{} {}", command, suffix);
        }
    }

    let active_preset = arg_preset
        .map(String::from)
        .or_else(|| service.default_arg_preset.clone());
    if let (Some(ref name), Some(ref presets)) = (&active_preset, &service.arg_presets) {
        if let Some(args) = presets.get(name) {
            command = format!("{} {}", command, args);
        }
    }

    if let Some(ref extra) = service.extra_args {
        if !extra.is_empty() {
            command = format!("{} {}", command, extra);
        }
    }

    (command, active_mode, active_preset)
}

fn resolve_service_working_dir(project: &Project, service: &Service) -> String {
    let dir = service.working_dir.trim();
    if dir.is_empty() || dir == "." {
        project.root_path.clone()
    } else {
        let path = std::path::Path::new(dir);
        if path.is_absolute() {
            dir.to_string()
        } else {
            std::path::Path::new(&project.root_path)
                .join(dir)
                .to_string_lossy()
                .to_string()
        }
    }
}

fn cmd_service_start(
    storage: &Storage,
    project_ref: &str,
    service_ref: &str,
    mode: Option<&str>,
    arg_preset: Option<&str>,
    json: bool,
) -> anyhow::Result<()> {
    let (project, service) = resolve_project_service(storage, project_ref, service_ref)?;
    let store = RuntimeStore::new(storage.app_dir())?;

    // Prune any stale entry under this service id so a fresh start can register.
    if let Some(existing) = store.get(&service.id) {
        if runtime_state::is_pid_alive(existing.pid) {
            return Err(anyhow::anyhow!(
                "Service '{}' already running (PID {})",
                service.name,
                existing.pid
            ));
        }
        store.unregister(&service.id)?;
    }

    let (command, active_mode, active_preset) =
        build_service_command_string(&service, mode, arg_preset);
    let working_dir = resolve_service_working_dir(&project, &service);
    let (program, args) = runtime_state::shell_wrap(&command);
    let log_path = store.log_path(&service.id);

    let pid = runtime_state::spawn_detached(
        &program,
        &args,
        &working_dir,
        service.env_vars.as_ref(),
        &log_path,
    )
    .map_err(|e| anyhow::anyhow!("Failed to spawn service: {}", e))?;

    let entry = RuntimeEntry {
        id: service.id.clone(),
        kind: EntityKind::Service,
        pid,
        display_name: service.name.clone(),
        command: command.clone(),
        working_dir,
        started_at: chrono::Utc::now(),
        project_id: Some(project.id.clone()),
        project_name: Some(project.name.clone()),
        mode: active_mode,
        arg_preset: active_preset,
    };
    store.register(&entry)?;

    if json {
        println!("{}", serde_json::to_string_pretty(&entry)?);
    } else {
        println!(
            "Started service '{}' (PID {}). Logs: {}",
            service.name,
            pid,
            log_path.display()
        );
    }
    Ok(())
}

fn cmd_service_stop(
    storage: &Storage,
    project_ref: &str,
    service_ref: &str,
    json: bool,
) -> anyhow::Result<()> {
    let (_project, service) = resolve_project_service(storage, project_ref, service_ref)?;
    let store = RuntimeStore::new(storage.app_dir())?;

    let entry = store
        .get(&service.id)
        .ok_or_else(|| anyhow::anyhow!("Service '{}' is not running", service.name))?;

    if runtime_state::is_pid_alive(entry.pid) {
        runtime_state::kill_pid_tree(entry.pid)
            .map_err(|e| anyhow::anyhow!("Failed to stop: {}", e))?;
    }
    store.unregister(&service.id)?;

    if json {
        println!(
            "{}",
            serde_json::json!({
                "stopped": true,
                "service_id": service.id,
                "pid": entry.pid,
            })
        );
    } else {
        println!("Stopped service '{}' (PID {}).", service.name, entry.pid);
    }
    Ok(())
}

fn cmd_service_status(
    storage: &Storage,
    project_ref: &str,
    service_ref: &str,
    json: bool,
) -> anyhow::Result<()> {
    let (_project, service) = resolve_project_service(storage, project_ref, service_ref)?;
    let store = RuntimeStore::new(storage.app_dir())?;

    match store.get(&service.id) {
        Some(entry) => {
            let alive = runtime_state::is_pid_alive(entry.pid);
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "service_id": entry.id,
                        "service_name": entry.display_name,
                        "project_name": entry.project_name,
                        "status": if alive { "running" } else { "stopped" },
                        "pid": entry.pid,
                        "started_at": entry.started_at,
                        "mode": entry.mode,
                        "arg_preset": entry.arg_preset,
                        "command": entry.command,
                        "working_dir": entry.working_dir,
                        "log_path": store.log_path(&entry.id),
                    })
                );
            } else {
                println!("Service:    {}", entry.display_name);
                println!("Status:     {}", if alive { "running" } else { "stopped (stale)" });
                println!("PID:        {}", entry.pid);
                println!("Started:    {}", entry.started_at.format("%Y-%m-%d %H:%M:%S"));
                if let Some(ref m) = entry.mode {
                    println!("Mode:       {}", m);
                }
                if let Some(ref p) = entry.arg_preset {
                    println!("Arg preset: {}", p);
                }
                println!("Command:    {}", entry.command);
                println!("Log:        {}", store.log_path(&entry.id).display());
            }
            Ok(())
        }
        None => {
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "service_id": service.id,
                        "service_name": service.name,
                        "status": "stopped",
                    })
                );
            } else {
                println!("Service '{}' is not running.", service.name);
            }
            Ok(())
        }
    }
}

fn cmd_service_logs(
    storage: &Storage,
    project_ref: &str,
    service_ref: &str,
    tail: usize,
    follow: bool,
) -> anyhow::Result<()> {
    let (_project, service) = resolve_project_service(storage, project_ref, service_ref)?;
    let store = RuntimeStore::new(storage.app_dir())?;
    let log_path = store.log_path(&service.id);
    if !log_path.exists() {
        return Err(anyhow::anyhow!(
            "No log file for service '{}'. Has it ever been started via the CLI?",
            service.name
        ));
    }

    print_log_tail(&log_path, tail)?;
    if follow {
        follow_log(&log_path)?;
    }
    Ok(())
}

/// Print the last `n` lines of `path`.
fn print_log_tail(path: &std::path::Path, n: usize) -> anyhow::Result<()> {
    let content = std::fs::read_to_string(path)?;
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(n);
    for line in &lines[start..] {
        println!("{}", line);
    }
    Ok(())
}

/// Tail the file forever, polling for new bytes. Exits on Ctrl-C.
fn follow_log(path: &std::path::Path) -> anyhow::Result<()> {
    use std::io::{BufRead, BufReader, Seek, SeekFrom};
    let file = std::fs::File::open(path)?;
    let mut pos = file.metadata()?.len();
    loop {
        let mut file = std::fs::File::open(path)?;
        let cur_len = file.metadata()?.len();
        if cur_len < pos {
            // File was truncated — restart from the beginning.
            pos = 0;
        }
        if cur_len > pos {
            file.seek(SeekFrom::Start(pos))?;
            let reader = BufReader::new(&file);
            for line in reader.lines().flatten() {
                println!("{}", line);
            }
            pos = cur_len;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
}

// ----- Project script process control --------------------------------------

fn resolve_project_script(
    storage: &Storage,
    project_ref: &str,
    script_ref: &str,
) -> anyhow::Result<(Project, Script)> {
    let projects = storage.get_all_projects();
    let project = resolve_by_name_or_id(&projects, project_ref, |p| &p.id, |p| &p.name)
        .map_err(|e| anyhow::anyhow!("Project {}", e))?
        .clone();
    let script = resolve_by_name_or_id(
        &project.scripts,
        script_ref,
        |s| &s.id,
        |s| &s.name,
    )
    .map_err(|e| anyhow::anyhow!("Project script {}", e))?
    .clone();
    Ok((project, script))
}

fn resolve_script_working_dir(project: &Project, script: &Script) -> String {
    let dir = script.working_dir.trim();
    if dir.is_empty() || dir == "." {
        project.root_path.clone()
    } else {
        let path = std::path::Path::new(dir);
        if path.is_absolute() {
            dir.to_string()
        } else {
            std::path::Path::new(&project.root_path)
                .join(dir)
                .to_string_lossy()
                .to_string()
        }
    }
}

fn cmd_project_run(
    storage: &Storage,
    project_ref: &str,
    script_ref: &str,
    extra_args: &[String],
    json: bool,
) -> anyhow::Result<()> {
    let (project, script) = resolve_project_script(storage, project_ref, script_ref)?;
    let store = RuntimeStore::new(storage.app_dir())?;

    if let Some(existing) = store.get(&script.id) {
        if runtime_state::is_pid_alive(existing.pid) {
            return Err(anyhow::anyhow!(
                "Project script '{}' already running (PID {})",
                script.name,
                existing.pid
            ));
        }
        store.unregister(&script.id)?;
    }

    let mut command = if let Some(ref path) = script.script_path {
        script.command.replace("{{SCRIPT_FILE}}", path)
    } else {
        script.command.clone()
    };
    if !extra_args.is_empty() {
        command = format!("{} {}", command, extra_args.join(" "));
    }

    let working_dir = resolve_script_working_dir(&project, &script);
    let (program, args) = runtime_state::shell_wrap(&command);
    let log_path = store.log_path(&script.id);

    let pid = runtime_state::spawn_detached(
        &program,
        &args,
        &working_dir,
        None,
        &log_path,
    )
    .map_err(|e| anyhow::anyhow!("Failed to spawn project script: {}", e))?;

    let entry = RuntimeEntry {
        id: script.id.clone(),
        kind: EntityKind::ProjectScript,
        pid,
        display_name: script.name.clone(),
        command: command.clone(),
        working_dir,
        started_at: chrono::Utc::now(),
        project_id: Some(project.id.clone()),
        project_name: Some(project.name.clone()),
        mode: None,
        arg_preset: None,
    };
    store.register(&entry)?;

    if json {
        println!("{}", serde_json::to_string_pretty(&entry)?);
    } else {
        println!(
            "Running project script '{}' (PID {}). Logs: {}",
            script.name,
            pid,
            log_path.display()
        );
    }
    Ok(())
}

fn cmd_project_script_stop(
    storage: &Storage,
    project_ref: &str,
    script_ref: &str,
    json: bool,
) -> anyhow::Result<()> {
    let (_project, script) = resolve_project_script(storage, project_ref, script_ref)?;
    let store = RuntimeStore::new(storage.app_dir())?;

    let entry = store
        .get(&script.id)
        .ok_or_else(|| anyhow::anyhow!("Project script '{}' is not running", script.name))?;

    if runtime_state::is_pid_alive(entry.pid) {
        runtime_state::kill_pid_tree(entry.pid)
            .map_err(|e| anyhow::anyhow!("Failed to stop: {}", e))?;
    }
    store.unregister(&script.id)?;

    if json {
        println!(
            "{}",
            serde_json::json!({
                "stopped": true,
                "script_id": script.id,
                "pid": entry.pid,
            })
        );
    } else {
        println!(
            "Stopped project script '{}' (PID {}).",
            script.name, entry.pid
        );
    }
    Ok(())
}

fn cmd_project_script_status(
    storage: &Storage,
    project_ref: &str,
    script_ref: &str,
    json: bool,
) -> anyhow::Result<()> {
    let (_project, script) = resolve_project_script(storage, project_ref, script_ref)?;
    let store = RuntimeStore::new(storage.app_dir())?;

    match store.get(&script.id) {
        Some(entry) => {
            let alive = runtime_state::is_pid_alive(entry.pid);
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "script_id": entry.id,
                        "script_name": entry.display_name,
                        "project_name": entry.project_name,
                        "status": if alive { "running" } else { "stopped" },
                        "pid": entry.pid,
                        "started_at": entry.started_at,
                        "command": entry.command,
                        "working_dir": entry.working_dir,
                        "log_path": store.log_path(&entry.id),
                    })
                );
            } else {
                println!("Script:    {}", entry.display_name);
                println!("Status:    {}", if alive { "running" } else { "stopped (stale)" });
                println!("PID:       {}", entry.pid);
                println!("Started:   {}", entry.started_at.format("%Y-%m-%d %H:%M:%S"));
                println!("Command:   {}", entry.command);
                println!("Log:       {}", store.log_path(&entry.id).display());
            }
            Ok(())
        }
        None => {
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "script_id": script.id,
                        "script_name": script.name,
                        "status": "stopped",
                    })
                );
            } else {
                println!("Project script '{}' is not running.", script.name);
            }
            Ok(())
        }
    }
}

fn cmd_project_script_logs(
    storage: &Storage,
    project_ref: &str,
    script_ref: &str,
    tail: usize,
    follow: bool,
) -> anyhow::Result<()> {
    let (_project, script) = resolve_project_script(storage, project_ref, script_ref)?;
    let store = RuntimeStore::new(storage.app_dir())?;
    let log_path = store.log_path(&script.id);
    if !log_path.exists() {
        return Err(anyhow::anyhow!(
            "No log file for project script '{}'. Has it ever been run via the CLI?",
            script.name
        ));
    }
    print_log_tail(&log_path, tail)?;
    if follow {
        follow_log(&log_path)?;
    }
    Ok(())
}

fn cmd_ps(storage: &Storage, json: bool) -> anyhow::Result<()> {
    let store = RuntimeStore::new(storage.app_dir())?;
    store.prune_stale();
    let entries = store.list();

    if json {
        let payload: Vec<_> = entries
            .iter()
            .map(|(e, alive)| {
                serde_json::json!({
                    "id": e.id,
                    "kind": e.kind.as_str(),
                    "pid": e.pid,
                    "status": if *alive { "running" } else { "stopped" },
                    "display_name": e.display_name,
                    "project_name": e.project_name,
                    "started_at": e.started_at,
                    "mode": e.mode,
                    "arg_preset": e.arg_preset,
                })
            })
            .collect();
        println!("{}", serde_json::to_string_pretty(&payload)?);
        return Ok(());
    }

    if entries.is_empty() {
        println!("No CLI-managed processes running.");
        return Ok(());
    }

    println!(
        "{:<12} {:<25} {:<25} {:<8} {}",
        "KIND", "NAME", "PROJECT", "PID", "STARTED"
    );
    println!("{}", "-".repeat(90));
    for (entry, _alive) in &entries {
        println!(
            "{:<12} {:<25} {:<25} {:<8} {}",
            entry.kind.as_str(),
            entry.display_name,
            entry.project_name.as_deref().unwrap_or("-"),
            entry.pid,
            entry.started_at.format("%Y-%m-%d %H:%M:%S"),
        );
    }
    Ok(())
}

// ============================================================================
// Tool commands
// ============================================================================

fn cmd_tool_list(
    storage: &Storage,
    tag_filter: Option<&str>,
    name_filter: Option<&str>,
    scan: bool,
    json: bool,
) -> anyhow::Result<()> {
    if scan {
        let mut tools = cortx_core::tool_discovery::scan_installed_tools();
        tools.retain(|t| matches_substr(&t.name, name_filter));

        if json {
            println!("{}", serde_json::to_string_pretty(&tools)?);
            return Ok(());
        }

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

        let tag_lower = tag_filter.map(|t| t.to_lowercase());
        let filtered: Vec<&Tool> = tools
            .iter()
            .filter(|t| match tag_lower.as_deref() {
                Some(t_l) => t.tags.iter().any(|tg| tg.to_lowercase() == t_l),
                None => true,
            })
            .filter(|t| matches_substr(&t.name, name_filter))
            .collect();

        if json {
            println!("{}", serde_json::to_string_pretty(&filtered)?);
            return Ok(());
        }

        if filtered.is_empty() {
            println!("No tools registered.");
            return Ok(());
        }

        let tag_defs = storage.get_all_tag_definitions();

        // Sort by primary tag then name
        let mut sorted = filtered;
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
        println!("\n{} tool(s)", sorted.len());
    }
    Ok(())
}

fn cmd_tool_get(storage: &Storage, name_or_id: &str, json: bool) -> anyhow::Result<()> {
    let tools = storage.get_all_tools();
    let tool = resolve_by_name_or_id(&tools, name_or_id, |t| &t.id, |t| &t.name)
        .map_err(|e| anyhow::anyhow!("Tool {}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(tool)?);
        return Ok(());
    }

    println!("Name:            {}", tool.name);
    println!("ID:              {}", tool.id);
    println!("Status:          {}", tool.status);
    if let Some(ref desc) = tool.description {
        println!("Description:     {}", desc);
    }
    if !tool.tags.is_empty() {
        println!("Tags:            {}", tool.tags.join(", "));
    }
    if let Some(ref v) = tool.version {
        println!("Version:         {}", v);
    }
    if let Some(ref m) = tool.install_method {
        println!("Install method:  {}", m);
    }
    if let Some(ref l) = tool.install_location {
        println!("Install location:{}", l);
    }
    if let Some(ref h) = tool.homepage {
        println!("Homepage:        {}", h);
    }
    if !tool.config_paths.is_empty() {
        println!("Config paths:");
        for cp in &tool.config_paths {
            println!("  {} -> {}", cp.label, cp.path);
        }
    }
    println!("Created:         {}", tool.created_at.format("%Y-%m-%d %H:%M:%S"));
    println!("Updated:         {}", tool.updated_at.format("%Y-%m-%d %H:%M:%S"));
    Ok(())
}

fn cmd_tool_create(
    storage: &Storage,
    name: &str,
    description: Option<&str>,
    tags: Option<Vec<String>>,
    status: Option<&str>,
    install_method: Option<&str>,
    install_location: Option<&str>,
    version: Option<&str>,
    homepage: Option<&str>,
    color: Option<&str>,
    config_path: Option<Vec<String>>,
    json: bool,
) -> anyhow::Result<()> {
    let mut tool = Tool::new(name.to_string(), status.unwrap_or("Active").to_string());
    tool.description = description.map(|s| s.to_string());
    if let Some(tags) = tags {
        tool.tags = tags;
    }
    tool.install_method = install_method.map(|s| s.to_string());
    tool.install_location = install_location.map(|s| s.to_string());
    tool.version = version.map(|s| s.to_string());
    tool.homepage = homepage.map(|s| s.to_string());
    tool.color = color.map(|s| s.to_string());
    if let Some(entries) = config_path {
        tool.config_paths = parse_config_paths(&entries);
    }

    let created = storage.create_tool(tool).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&created)?);
    } else {
        println!("Tool '{}' created (ID: {}).", created.name, created.id);
    }
    Ok(())
}

fn cmd_tool_update(
    storage: &Storage,
    name_or_id: &str,
    name: Option<String>,
    description: Option<String>,
    tags: Option<Vec<String>>,
    status: Option<String>,
    version: Option<String>,
    homepage: Option<String>,
    config_path: Option<Vec<String>>,
    json: bool,
) -> anyhow::Result<()> {
    let tools = storage.get_all_tools();
    let existing = resolve_by_name_or_id(&tools, name_or_id, |t| &t.id, |t| &t.name)
        .map_err(|e| anyhow::anyhow!("Tool {}", e))?;
    let id = existing.id.clone();

    let parsed_configs = config_path.map(|entries| parse_config_paths(&entries));
    let updated = storage.update_tool(&id, |t| {
        if let Some(ref n) = name { t.name = n.clone(); }
        if let Some(ref d) = description { t.description = Some(d.clone()); }
        if let Some(ref tg) = tags { t.tags = tg.clone(); }
        if let Some(ref s) = status { t.status = s.clone(); }
        if let Some(ref v) = version { t.version = Some(v.clone()); }
        if let Some(ref h) = homepage { t.homepage = Some(h.clone()); }
        if let Some(ref cp) = parsed_configs { t.config_paths = cp.clone(); }
    }).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&updated)?);
    } else {
        println!("Tool '{}' updated.", updated.name);
    }
    Ok(())
}

fn cmd_tool_delete(storage: &Storage, name_or_id: &str, yes: bool) -> anyhow::Result<()> {
    let tools = storage.get_all_tools();
    let tool = resolve_by_name_or_id(&tools, name_or_id, |t| &t.id, |t| &t.name)
        .map_err(|e| anyhow::anyhow!("Tool {}", e))?;

    if !confirm_delete("tool", &tool.name, yes) {
        println!("Cancelled.");
        return Ok(());
    }

    storage.delete_tool(&tool.id).map_err(|e| anyhow::anyhow!("{}", e))?;
    println!("Tool '{}' deleted.", tool.name);
    Ok(())
}

// ============================================================================
// Alias commands
// ============================================================================

fn cmd_alias_list(
    storage: &Storage,
    name_filter: Option<&str>,
    json: bool,
) -> anyhow::Result<()> {
    let mut aliases = storage.get_all_aliases();
    aliases.retain(|a| matches_substr(&a.name, name_filter));

    if json {
        println!("{}", serde_json::to_string_pretty(&aliases)?);
        return Ok(());
    }

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

fn cmd_alias_get(storage: &Storage, name: &str, json: bool) -> anyhow::Result<()> {
    let aliases = storage.get_all_aliases();
    let alias = resolve_by_name_or_id(&aliases, name, |a| &a.id, |a| &a.name)
        .map_err(|e| anyhow::anyhow!("Alias {}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(alias)?);
        return Ok(());
    }

    println!("Name:            {}", alias.name);
    println!("ID:              {}", alias.id);
    println!("Type:            {}", alias.alias_type);
    println!("Command:         {}", alias.command);
    if let Some(ref desc) = alias.description {
        println!("Description:     {}", desc);
    }
    if !alias.tags.is_empty() {
        println!("Tags:            {}", alias.tags.join(", "));
    }
    if let Some(ref tool_id) = alias.tool_id {
        println!("Linked Tool ID:  {}", tool_id);
    }
    if let Some(order) = alias.execution_order {
        println!("Execution Order: {}", order);
    }
    if let Some(ref setup) = alias.setup {
        println!("Setup:");
        for (shell, code) in setup {
            println!("  {}: {}", shell, code);
        }
    }
    if let Some(ref script) = alias.script {
        println!("Script:");
        for (shell, code) in script {
            let display = if code.len() > 60 { format!("{}...", &code[..60]) } else { code.clone() };
            println!("  {}: {}", shell, display);
        }
    }
    println!("Created:         {}", alias.created_at.format("%Y-%m-%d %H:%M:%S"));
    println!("Updated:         {}", alias.updated_at.format("%Y-%m-%d %H:%M:%S"));
    Ok(())
}

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

fn cmd_alias_update(
    storage: &Storage,
    name_or_id: &str,
    name: Option<String>,
    command: Option<String>,
    description: Option<String>,
    alias_type: Option<String>,
    execution_order: Option<u32>,
    tags: Option<Vec<String>>,
    json: bool,
) -> anyhow::Result<()> {
    let aliases = storage.get_all_aliases();
    let existing = resolve_by_name_or_id(&aliases, name_or_id, |a| &a.id, |a| &a.name)
        .map_err(|e| anyhow::anyhow!("Alias {}", e))?;
    let id = existing.id.clone();

    let updated = storage.update_alias(&id, |a| {
        if let Some(ref n) = name { a.name = n.clone(); }
        if let Some(ref c) = command { a.command = c.clone(); }
        if let Some(ref d) = description { a.description = Some(d.clone()); }
        if let Some(ref at) = alias_type { a.alias_type = at.clone(); }
        if let Some(eo) = execution_order { a.execution_order = Some(eo); }
        if let Some(ref t) = tags { a.tags = t.clone(); }
    }).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&updated)?);
    } else {
        println!("Alias '{}' updated.", updated.name);
    }
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

// ============================================================================
// App commands
// ============================================================================

fn cmd_app_list(
    storage: &Storage,
    name_filter: Option<&str>,
    json: bool,
) -> anyhow::Result<()> {
    let mut apps = storage.get_all_apps();
    apps.retain(|a| matches_substr(&a.name, name_filter));

    if json {
        println!("{}", serde_json::to_string_pretty(&apps)?);
        return Ok(());
    }

    if apps.is_empty() {
        println!("No apps configured.");
        return Ok(());
    }

    let tag_defs = storage.get_all_tag_definitions();

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

fn cmd_app_get(storage: &Storage, name_or_id: &str, json: bool) -> anyhow::Result<()> {
    let apps = storage.get_all_apps();
    let app = resolve_by_name_or_id(&apps, name_or_id, |a| &a.id, |a| &a.name)
        .map_err(|e| anyhow::anyhow!("App {}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(app)?);
        return Ok(());
    }

    println!("Name:        {}", app.name);
    println!("ID:          {}", app.id);
    if let Some(ref desc) = app.description {
        println!("Description: {}", desc);
    }
    if let Some(ref status) = app.status {
        println!("Status:      {}", status);
    }
    if !app.tags.is_empty() {
        println!("Tags:        {}", app.tags.join(", "));
    }
    if let Some(ref exe) = app.executable_path {
        println!("Executable:  {}", exe);
    }
    if let Some(ref args) = app.launch_args {
        println!("Launch Args: {}", args);
    }
    if let Some(ref hp) = app.homepage {
        println!("Homepage:    {}", hp);
    }
    if !app.config_paths.is_empty() {
        println!("Config paths:");
        for cp in &app.config_paths {
            println!("  {} -> {}", cp.label, cp.path);
        }
    }
    println!("Created:     {}", app.created_at.format("%Y-%m-%d %H:%M:%S"));
    println!("Updated:     {}", app.updated_at.format("%Y-%m-%d %H:%M:%S"));
    Ok(())
}

fn cmd_app_create(
    storage: &Storage,
    name: &str,
    description: Option<&str>,
    executable: Option<&str>,
    tags: Option<Vec<String>>,
    status: Option<&str>,
    homepage: Option<&str>,
    launch_args: Option<&str>,
    color: Option<&str>,
    config_path: Option<Vec<String>>,
    json: bool,
) -> anyhow::Result<()> {
    let mut app = CoreApp::new(name.to_string());
    app.description = description.map(|s| s.to_string());
    app.executable_path = executable.map(|s| s.to_string());
    if let Some(tags) = tags {
        app.tags = tags;
    }
    app.status = status.map(|s| s.to_string());
    app.homepage = homepage.map(|s| s.to_string());
    app.launch_args = launch_args.map(|s| s.to_string());
    app.color = color.map(|s| s.to_string());
    if let Some(entries) = config_path {
        app.config_paths = parse_config_paths(&entries);
    }

    let created = storage.create_app(app).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&created)?);
    } else {
        println!("App '{}' created (ID: {}).", created.name, created.id);
    }
    Ok(())
}

fn cmd_app_update(
    storage: &Storage,
    name_or_id: &str,
    name: Option<String>,
    description: Option<String>,
    executable: Option<String>,
    tags: Option<Vec<String>>,
    status: Option<String>,
    homepage: Option<String>,
    config_path: Option<Vec<String>>,
    json: bool,
) -> anyhow::Result<()> {
    let apps = storage.get_all_apps();
    let existing = resolve_by_name_or_id(&apps, name_or_id, |a| &a.id, |a| &a.name)
        .map_err(|e| anyhow::anyhow!("App {}", e))?;
    let id = existing.id.clone();

    let parsed_configs = config_path.map(|entries| parse_config_paths(&entries));
    let updated = storage.update_app(&id, |a| {
        if let Some(ref n) = name { a.name = n.clone(); }
        if let Some(ref d) = description { a.description = Some(d.clone()); }
        if let Some(ref e) = executable { a.executable_path = Some(e.clone()); }
        if let Some(ref t) = tags { a.tags = t.clone(); }
        if let Some(ref s) = status { a.status = Some(s.clone()); }
        if let Some(ref h) = homepage { a.homepage = Some(h.clone()); }
        if let Some(ref cp) = parsed_configs { a.config_paths = cp.clone(); }
    }).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&updated)?);
    } else {
        println!("App '{}' updated.", updated.name);
    }
    Ok(())
}

fn cmd_app_delete(storage: &Storage, name_or_id: &str, yes: bool) -> anyhow::Result<()> {
    let apps = storage.get_all_apps();
    let app = resolve_by_name_or_id(&apps, name_or_id, |a| &a.id, |a| &a.name)
        .map_err(|e| anyhow::anyhow!("App {}", e))?;

    if !confirm_delete("app", &app.name, yes) {
        println!("Cancelled.");
        return Ok(());
    }

    storage.delete_app(&app.id).map_err(|e| anyhow::anyhow!("{}", e))?;
    println!("App '{}' deleted.", app.name);
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

    let extra_args: Vec<String> = app
        .launch_args
        .as_deref()
        .map(|s| s.split_whitespace().map(String::from).collect())
        .unwrap_or_default();

    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "start", "", exe]);
        for arg in &extra_args {
            cmd.arg(arg);
        }
        cmd.spawn()
            .map_err(|e| anyhow::anyhow!("Failed to launch '{}': {}", app.name, e))?;
    }

    #[cfg(target_os = "macos")]
    {
        if exe.ends_with(".app") || exe.contains(".app/") {
            let mut cmd = std::process::Command::new("open");
            cmd.args(["-n", "-a", exe]);
            if !extra_args.is_empty() {
                cmd.arg("--args");
                for arg in &extra_args {
                    cmd.arg(arg);
                }
            }
            cmd.spawn()
                .map_err(|e| anyhow::anyhow!("Failed to launch '{}': {}", app.name, e))?;
        } else {
            let mut cmd = std::process::Command::new(exe);
            for arg in &extra_args {
                cmd.arg(arg);
            }
            cmd.spawn()
                .map_err(|e| anyhow::anyhow!("Failed to launch '{}': {}", app.name, e))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        let mut cmd = std::process::Command::new(exe);
        for arg in &extra_args {
            cmd.arg(arg);
        }
        cmd.spawn()
            .map_err(|e| anyhow::anyhow!("Failed to launch '{}': {}", app.name, e))?;
    }

    Ok(())
}

// ============================================================================
// Tag commands
// ============================================================================

fn cmd_tag_list(storage: &Storage, json: bool) -> anyhow::Result<()> {
    let defs = storage.get_all_tag_definitions();

    if json {
        println!("{}", serde_json::to_string_pretty(&defs)?);
        return Ok(());
    }

    if defs.is_empty() {
        println!("No tag definitions.");
        return Ok(());
    }

    let mut sorted = defs.clone();
    sorted.sort_by(|a, b| {
        let ao = a.order.unwrap_or(u32::MAX);
        let bo = b.order.unwrap_or(u32::MAX);
        ao.cmp(&bo).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    println!("{:<25} {:<12} {}", "NAME", "COLOR", "ORDER");
    println!("{}", "-".repeat(45));

    for d in &sorted {
        let color = d.color.as_deref().unwrap_or("-");
        let order = d.order.map(|o| o.to_string()).unwrap_or_else(|| "-".to_string());
        let name_display = colorize_tags(&[d.name.clone()], &sorted);
        let name_visible = d.name.len();
        let name_pad = if name_visible < 25 { 25 - name_visible } else { 1 };
        println!("{}{:name_pad$} {:<12} {}", name_display, "", color, order, name_pad = name_pad);
    }
    println!("\n{} tag(s)", sorted.len());
    Ok(())
}

fn cmd_tag_create(storage: &Storage, name: &str, color: Option<&str>, order: Option<u32>, json: bool) -> anyhow::Result<()> {
    let def = TagDefinition {
        name: name.to_string(),
        color: color.map(|s| s.to_string()),
        order,
    };

    let created = storage.create_tag_definition(def).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&created)?);
    } else {
        println!("Tag '{}' created.", created.name);
    }
    Ok(())
}

fn cmd_tag_update(storage: &Storage, name: &str, new_name: Option<String>, color: Option<String>, order: Option<u32>, json: bool) -> anyhow::Result<()> {
    let updated = storage.update_tag_definition(name, |d| {
        if let Some(ref n) = new_name { d.name = n.clone(); }
        if let Some(ref c) = color { d.color = Some(c.clone()); }
        if let Some(o) = order { d.order = Some(o); }
    }).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&updated)?);
    } else {
        println!("Tag '{}' updated.", updated.name);
    }
    Ok(())
}

fn cmd_tag_delete(storage: &Storage, name: &str, yes: bool) -> anyhow::Result<()> {
    if !confirm_delete("tag", name, yes) {
        println!("Cancelled.");
        return Ok(());
    }

    storage.delete_tag_definition(name).map_err(|e| anyhow::anyhow!("{}", e))?;
    println!("Tag '{}' deleted.", name);
    Ok(())
}

// ============================================================================
// Status commands
// ============================================================================

fn cmd_status_list(storage: &Storage, json: bool) -> anyhow::Result<()> {
    let defs = storage.get_all_status_definitions();

    if json {
        println!("{}", serde_json::to_string_pretty(&defs)?);
        return Ok(());
    }

    if defs.is_empty() {
        println!("No status definitions.");
        return Ok(());
    }

    let mut sorted = defs.clone();
    sorted.sort_by(|a, b| {
        let ao = a.order.unwrap_or(u32::MAX);
        let bo = b.order.unwrap_or(u32::MAX);
        ao.cmp(&bo).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    println!("{:<25} {:<12} {}", "NAME", "COLOR", "ORDER");
    println!("{}", "-".repeat(45));

    for d in &sorted {
        let color = d.color.as_deref().unwrap_or("-");
        let order = d.order.map(|o| o.to_string()).unwrap_or_else(|| "-".to_string());
        // Colorize status name with its own color (only when color is enabled)
        let name_display = if let (true, Some(hex)) = (should_colorize(), d.color.as_deref()) {
            let hex = hex.trim_start_matches('#');
            if hex.len() == 6 {
                if let (Ok(r), Ok(g), Ok(b)) = (
                    u8::from_str_radix(&hex[0..2], 16),
                    u8::from_str_radix(&hex[2..4], 16),
                    u8::from_str_radix(&hex[4..6], 16),
                ) {
                    format!("\x1b[38;2;{};{};{}m{}\x1b[0m", r, g, b, d.name)
                } else {
                    d.name.clone()
                }
            } else {
                d.name.clone()
            }
        } else {
            d.name.clone()
        };
        let name_visible = d.name.len();
        let name_pad = if name_visible < 25 { 25 - name_visible } else { 1 };
        println!("{}{:name_pad$} {:<12} {}", name_display, "", color, order, name_pad = name_pad);
    }
    println!("\n{} status(es)", sorted.len());
    Ok(())
}

fn cmd_status_create(storage: &Storage, name: &str, color: Option<&str>, order: Option<u32>, json: bool) -> anyhow::Result<()> {
    let def = StatusDefinition {
        name: name.to_string(),
        color: color.map(|s| s.to_string()),
        order,
    };

    let created = storage.create_status_definition(def).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&created)?);
    } else {
        println!("Status '{}' created.", created.name);
    }
    Ok(())
}

fn cmd_status_update(storage: &Storage, name: &str, new_name: Option<String>, color: Option<String>, order: Option<u32>, json: bool) -> anyhow::Result<()> {
    let updated = storage.update_status_definition(name, |d| {
        if let Some(ref n) = new_name { d.name = n.clone(); }
        if let Some(ref c) = color { d.color = Some(c.clone()); }
        if let Some(o) = order { d.order = Some(o); }
    }).map_err(|e| anyhow::anyhow!("{}", e))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&updated)?);
    } else {
        println!("Status '{}' updated.", updated.name);
    }
    Ok(())
}

fn cmd_status_delete(storage: &Storage, name: &str, yes: bool) -> anyhow::Result<()> {
    if !confirm_delete("status", name, yes) {
        println!("Cancelled.");
        return Ok(());
    }

    storage.delete_status_definition(name).map_err(|e| anyhow::anyhow!("{}", e))?;
    println!("Status '{}' deleted.", name);
    Ok(())
}

// ============================================================================
// Settings commands
// ============================================================================

fn cmd_settings_get(storage: &Storage, json: bool) -> anyhow::Result<()> {
    let settings = storage.get_settings();

    if json {
        println!("{}", serde_json::to_string_pretty(&settings)?);
        return Ok(());
    }

    println!("terminal.preset:       {:?}", settings.terminal.preset);
    println!("terminal.customPath:   {}", if settings.terminal.custom_path.is_empty() { "-" } else { &settings.terminal.custom_path });
    println!("appearance.theme:      {:?}", settings.appearance.theme);
    println!("defaults.launchMethod: {:?}", settings.defaults.launch_method);
    println!("toolboxBaseUrl:        {}", if settings.toolbox_base_url.is_empty() { "-" } else { &settings.toolbox_base_url });
    println!("backupRepoPath:        {}", settings.backup_repo_path.as_deref().unwrap_or("-"));
    Ok(())
}

fn cmd_settings_set(storage: &Storage, key: &str, value: &str) -> anyhow::Result<()> {
    let mut settings = storage.get_settings();

    match key {
        "terminal.preset" => {
            let preset = match value.to_lowercase().as_str() {
                "windowsterminal" | "windows-terminal" | "wt" => cortx_core::models::TerminalPreset::WindowsTerminal,
                "powershell" | "pwsh" => cortx_core::models::TerminalPreset::PowerShell,
                "cmd" => cortx_core::models::TerminalPreset::Cmd,
                "warp" => cortx_core::models::TerminalPreset::Warp,
                "macterminal" | "mac-terminal" => cortx_core::models::TerminalPreset::MacTerminal,
                "iterm2" | "iterm" => cortx_core::models::TerminalPreset::ITerm2,
                "custom" => cortx_core::models::TerminalPreset::Custom,
                _ => return Err(anyhow::anyhow!("Unknown terminal preset '{}'. Options: windowsterminal, powershell, cmd, warp, macterminal, iterm2, custom", value)),
            };
            settings.terminal.preset = preset;
        }
        "toolboxBaseUrl" | "toolbox_base_url" => {
            settings.toolbox_base_url = value.to_string();
        }
        "backupRepoPath" | "backup_repo_path" => {
            settings.backup_repo_path = Some(value.to_string());
        }
        "defaults.launchMethod" | "defaults.launch_method" => {
            let method = match value.to_lowercase().as_str() {
                "clipboard" => cortx_core::models::LaunchMethod::Clipboard,
                "external" => cortx_core::models::LaunchMethod::External,
                "integrated" => cortx_core::models::LaunchMethod::Integrated,
                _ => return Err(anyhow::anyhow!("Unknown launch method '{}'. Options: clipboard, external, integrated", value)),
            };
            settings.defaults.launch_method = method;
        }
        "appearance.theme" => {
            let theme = match value.to_lowercase().as_str() {
                "light" => cortx_core::models::Theme::Light,
                "dark" => cortx_core::models::Theme::Dark,
                "system" => cortx_core::models::Theme::System,
                _ => return Err(anyhow::anyhow!("Unknown theme '{}'. Options: light, dark, system", value)),
            };
            settings.appearance.theme = theme;
        }
        _ => {
            return Err(anyhow::anyhow!(
                "Unknown setting key '{}'. Valid keys: terminal.preset, toolboxBaseUrl, backupRepoPath, defaults.launchMethod, appearance.theme",
                key
            ));
        }
    }

    storage.update_settings(settings).map_err(|e| anyhow::anyhow!("{}", e))?;
    println!("Setting '{}' updated to '{}'.", key, value);
    Ok(())
}

// ============================================================================
// Data commands: export, import, backup
// ============================================================================

fn cmd_export(storage: &Storage, file: Option<&str>) -> anyhow::Result<()> {
    let json = storage.export_scripts_config().map_err(|e| anyhow::anyhow!("{}", e))?;

    match file {
        Some(path) => {
            std::fs::write(path, &json)?;
            println!("Exported to '{}'.", path);
        }
        None => {
            print!("{}", json);
        }
    }
    Ok(())
}

fn cmd_import(storage: &Storage, file: &str, all: bool) -> anyhow::Result<()> {
    let content = std::fs::read_to_string(file)
        .map_err(|e| anyhow::anyhow!("Failed to read '{}': {}", file, e))?;

    // Preview
    let summary = Storage::preview_import(&content).map_err(|e| anyhow::anyhow!("{}", e))?;
    println!("Import preview (v{}, exported {}):", summary.version, summary.exported_at.format("%Y-%m-%d %H:%M:%S"));
    println!("  Projects:           {}", summary.projects_count);
    println!("  Scripts:            {}", summary.scripts_count);
    println!("  Tools:              {}", summary.tools_count);
    println!("  Apps:               {}", summary.apps_count);
    println!("  Aliases:            {}", summary.aliases_count);
    println!("  Tag definitions:    {}", summary.tag_definitions_count);
    println!("  Status definitions: {}", summary.status_definitions_count);
    println!("  Settings:           {}", if summary.has_settings { "yes" } else { "no" });

    let options = if all {
        ImportOptions::default()
    } else {
        // Ask for confirmation
        eprint!("\nImport all categories? [y/N] ");
        let mut input = String::new();
        io::stdin().read_line(&mut input)?;
        if !matches!(input.trim().to_lowercase().as_str(), "y" | "yes") {
            println!("Cancelled.");
            return Ok(());
        }
        ImportOptions::default()
    };

    let result = storage.import_scripts_config(&content, &options).map_err(|e| anyhow::anyhow!("{}", e))?;
    println!("\nImport results:");
    println!("  Projects added:           {}", result.projects_added);
    println!("  Scripts added:            {}", result.scripts_added);
    println!("  Tools added:              {}", result.tools_added);
    println!("  Apps added:               {}", result.apps_added);
    println!("  Aliases added:            {}", result.aliases_added);
    println!("  Tag definitions added:    {}", result.tag_definitions_added);
    println!("  Status definitions added: {}", result.status_definitions_added);
    println!("  Settings imported:        {}", result.settings_imported);
    println!("  Skipped (duplicates):     {}", result.skipped);
    Ok(())
}

fn cmd_backup(storage: &Storage) -> anyhow::Result<()> {
    let result = storage.backup_to_git().map_err(|e| anyhow::anyhow!("{}", e))?;
    println!("{}", result);
    Ok(())
}

/// Print full CLI documentation — intended to be read by AI agents first
fn cmd_docs() -> anyhow::Result<()> {
    print!("{}", include_str!("docs.md"));
    Ok(())
}

// ============================================================================
// Colorize tags (unchanged)
// ============================================================================

/// Colorize a list of tags using ANSI truecolor from tag definitions.
/// Falls back to plain text when color is disabled (see [`should_colorize`]).
fn colorize_tags(tags: &[String], tag_defs: &[TagDefinition]) -> String {
    if !should_colorize() {
        return tags.join(", ");
    }
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

// ============================================================================
// Run script (unchanged)
// ============================================================================

// ----- Global script process control --------------------------------------

/// Look up a global script by case-insensitive name.
fn resolve_global_script(storage: &Storage, name: &str) -> anyhow::Result<GlobalScript> {
    let scripts = storage.get_all_global_scripts();
    scripts
        .into_iter()
        .find(|s| s.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| anyhow::anyhow!("Script '{}' not found", name))
}

/// Build the `(program, args)` for a global script, applying a preset if
/// requested. Extracted so `cmd_run` and `cmd_run_detached` stay in sync.
fn build_global_command(
    script: &GlobalScript,
    preset_name: Option<&str>,
    extra_args: &[String],
) -> anyhow::Result<(String, Vec<String>)> {
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
    cortx_core::command_builder::build_command(script, &param_values, extra_args)
        .ok_or_else(|| anyhow::anyhow!("Empty command"))
}

fn cmd_run_detached(
    storage: &Storage,
    name: &str,
    preset_name: Option<&str>,
    extra_args: &[String],
    json: bool,
) -> anyhow::Result<()> {
    let script = resolve_global_script(storage, name)?;
    let store = RuntimeStore::new(storage.app_dir())?;

    if let Some(existing) = store.get(&script.id) {
        if runtime_state::is_pid_alive(existing.pid) {
            return Err(anyhow::anyhow!(
                "Global script '{}' already running (PID {})",
                script.name,
                existing.pid
            ));
        }
        store.unregister(&script.id)?;
    }

    let (program, args) = build_global_command(&script, preset_name, extra_args)?;
    let working_dir = script
        .working_dir
        .clone()
        .unwrap_or_else(|| {
            std::env::current_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| ".".to_string())
        });
    let log_path = store.log_path(&script.id);
    let command_display = format!("{} {}", program, args.join(" "));

    let pid = runtime_state::spawn_detached(
        &program,
        &args,
        &working_dir,
        script.env_vars.as_ref(),
        &log_path,
    )
    .map_err(|e| anyhow::anyhow!("Failed to spawn global script: {}", e))?;

    let entry = RuntimeEntry {
        id: script.id.clone(),
        kind: EntityKind::GlobalScript,
        pid,
        display_name: script.name.clone(),
        command: command_display,
        working_dir,
        started_at: chrono::Utc::now(),
        project_id: None,
        project_name: None,
        mode: None,
        arg_preset: preset_name.map(String::from),
    };
    store.register(&entry)?;

    if json {
        println!("{}", serde_json::to_string_pretty(&entry)?);
    } else {
        println!(
            "Started '{}' detached (PID {}). Logs: {}",
            script.name,
            pid,
            log_path.display()
        );
    }
    Ok(())
}

fn cmd_global_script_stop(storage: &Storage, name: &str, json: bool) -> anyhow::Result<()> {
    let script = resolve_global_script(storage, name)?;
    let store = RuntimeStore::new(storage.app_dir())?;

    let entry = store
        .get(&script.id)
        .ok_or_else(|| anyhow::anyhow!("'{}' is not running detached", script.name))?;

    if runtime_state::is_pid_alive(entry.pid) {
        runtime_state::kill_pid_tree(entry.pid)
            .map_err(|e| anyhow::anyhow!("Failed to stop: {}", e))?;
    }
    store.unregister(&script.id)?;

    if json {
        println!(
            "{}",
            serde_json::json!({
                "stopped": true,
                "script_id": script.id,
                "pid": entry.pid,
            })
        );
    } else {
        println!("Stopped '{}' (PID {}).", script.name, entry.pid);
    }
    Ok(())
}

fn cmd_global_script_logs(
    storage: &Storage,
    name: &str,
    tail: usize,
    follow: bool,
) -> anyhow::Result<()> {
    let script = resolve_global_script(storage, name)?;
    let store = RuntimeStore::new(storage.app_dir())?;
    let log_path = store.log_path(&script.id);
    if !log_path.exists() {
        return Err(anyhow::anyhow!(
            "No log file for '{}'. Run with `cortx run --detach {}` first.",
            script.name,
            script.name
        ));
    }
    print_log_tail(&log_path, tail)?;
    if follow {
        follow_log(&log_path)?;
    }
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
            RuntimeMeta::new(script.name.clone()),
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
            // Service events are not surfaced by `cortx run` (it runs global
            // scripts only). Ignore them if any slip through.
            Ok(ProcessEvent::ServiceLog { .. })
            | Ok(ProcessEvent::ServiceStatus { .. })
            | Ok(ProcessEvent::ServiceExit { .. }) => {}
            Err(_) => break,
        }
    }

    process_manager.stop_all();
    Ok(())
}

// ============================================================================
// Shell init (unchanged)
// ============================================================================

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

// ============================================================================
// TUI (unchanged)
// ============================================================================

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
