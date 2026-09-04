//! Process lifecycle for everything CortX runs on the user's behalf: services,
//! project scripts, global scripts and interactive shells.
//!
//! Every process is spawned inside a real PTY (ConPTY on Windows, openpty
//! elsewhere) so it behaves exactly as it would in a terminal: colours, `\r`
//! progress bars, interactive prompts, TUIs and inline images all work. The
//! raw byte stream goes to the [`TerminalHub`] (consumed by the GUI's xterm.js
//! views) while a de-ANSI'd, line-based copy feeds the on-disk `<id>.log` file
//! and the `emit_*_log` events used by the TUI, the MCP server and the sidebar.

use crate::models::{LogStream, ScriptStatus, ServiceStatus};
use crate::runtime_state::{self, EntityKind, RuntimeEntry, RuntimeStore};
use crate::terminal::{terminal_id, AnsiLineSplitter, TerminalHub, TerminalKind};
use crate::terminal::{
    CommandHistory, CommandRecord, OscScanner, ShellPhase, TerminalShellState, TerminalStateTracker,
};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Read, Write as IoWrite};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Size a PTY starts with before the GUI view attaches and sends its real
/// dimensions. Wide enough that early output isn't wrapped awkwardly.
pub const DEFAULT_PTY_COLS: u16 = 120;
pub const DEFAULT_PTY_ROWS: u16 = 30;

/// How long `stop_*` waits after sending Ctrl+C before force-killing the
/// process tree. Long enough for a dev server to release its port cleanly,
/// short enough that "Stop" still feels immediate.
const GRACEFUL_STOP_TIMEOUT: Duration = Duration::from_millis(800);

/// Display-only metadata that the caller knows but ProcessManager doesn't,
/// passed through to the RuntimeStore entry written on spawn.
#[derive(Debug, Clone, Default)]
pub struct RuntimeMeta {
    pub display_name: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
}

impl RuntimeMeta {
    pub fn new(display_name: impl Into<String>) -> Self {
        Self {
            display_name: display_name.into(),
            project_id: None,
            project_name: None,
        }
    }

    pub fn with_project(mut self, id: impl Into<String>, name: impl Into<String>) -> Self {
        self.project_id = Some(id.into());
        self.project_name = Some(name.into());
        self
    }
}

/// Trait for emitting process events.
/// Implemented by TauriEmitter (GUI), TuiEmitter (TUI) and McpEmitter (MCP).
pub trait ProcessEventEmitter: Send + Sync {
    fn emit_service_log(&self, service_id: &str, stream: LogStream, content: String);
    fn emit_service_status(
        &self,
        service_id: &str,
        status: ServiceStatus,
        pid: Option<u32>,
        active_mode: Option<String>,
        active_arg_preset: Option<String>,
    );
    fn emit_service_exit(&self, service_id: &str, exit_code: Option<i32>);
    fn emit_script_log(&self, script_id: &str, stream: LogStream, content: String);
    fn emit_script_status(&self, script_id: &str, status: ScriptStatus, pid: Option<u32>);
    fn emit_script_exit(&self, script_id: &str, exit_code: Option<i32>, success: bool);
    fn emit_global_script_log(&self, script_id: &str, stream: LogStream, content: String);
    fn emit_global_script_status(&self, script_id: &str, status: ScriptStatus, pid: Option<u32>);
    fn emit_global_script_exit(&self, script_id: &str, exit_code: Option<i32>, success: bool);

    /// Emit the latest list of TCP ports that `service_id` (or any of its
    /// descendant processes) currently has in LISTEN state. Called periodically
    /// by the port poller while the service is running, and once with an empty
    /// list when the service stops.
    ///
    /// Default no-op for emitters that don't surface port info (TUI / MCP).
    fn emit_service_ports(&self, _service_id: &str, _ports: Vec<u16>) {}

    /// An interactive shell opened from the GUI exited (or was killed).
    /// Default no-op: only the GUI hosts shells.
    fn emit_shell_exit(&self, _shell_id: &str, _exit_code: Option<i32>) {}

    /// Shell integration (OSC 7 / OSC 133 emitted by `cortx init`) changed
    /// what we know about a terminal: cwd, running command, exit code.
    /// Default no-op: only the GUI displays it.
    fn emit_terminal_state(&self, _state: &TerminalShellState) {}
}

/// Who to tell about shell-integration events for one PTY, plus the project
/// the terminal belongs to (recorded in the command history).
pub struct PtyObserver {
    pub emitter: Arc<dyn ProcessEventEmitter>,
    pub project_id: Option<String>,
}

pub struct ProcessInfo {
    pub child: Box<dyn Child + Send + Sync>,
    pub service_id: String,
    pub pid: u32,
    pub active_mode: Option<String>,
    pub active_arg_preset: Option<String>,
}

/// Public description of an interactive shell session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    pub id: String,
    pub pid: u32,
    pub cwd: String,
    pub project_id: Option<String>,
    /// Program that was launched (e.g. `pwsh.exe`, `/bin/zsh`).
    pub program: String,
    pub started_at: chrono::DateTime<chrono::Utc>,
}

/// What the GUI asks for when opening a new shell tab.
#[derive(Debug, Clone, Default)]
pub struct ShellSpawnRequest {
    pub cwd: String,
    pub project_id: Option<String>,
    /// Explicit shell command line from settings (`pwsh -NoLogo`, `/bin/zsh -l`).
    /// `None`/empty = auto-detect.
    pub shell: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Session restore: terminal id of the shell this one replaces. Its
    /// scrollback snapshot (if any) is pushed into the hub before the PTY
    /// starts, then deleted.
    pub restore_from: Option<String>,
    /// Inject the shell integration at start-up (see
    /// `shell_init::shell_integration_startup`), independently of whether the
    /// user's profile calls `cortx init`. `None` = leave the shell alone.
    pub integration: Option<crate::shell_init::InitOptions>,
}

struct ShellEntry {
    child: Box<dyn Child + Send + Sync>,
    info: ShellInfo,
}

/// A terminal that is busy right now, as reported by the shell integration.
/// Feeds the "these commands are still running" confirmation before a close
/// or a quit kills them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningTerminal {
    pub terminal_id: String,
    /// The command line, when the shell reported one.
    pub command: Option<String>,
    /// Epoch millis the command started at.
    pub started_at: Option<i64>,
}

/// The two halves of a PTY we keep after spawning: the master (for resize)
/// and its writer (for keyboard input). The reader lives in its own thread.
struct PtyIo {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn IoWrite + Send>,
}

pub struct ProcessManager {
    /// Local Child handles for processes WE spawned, used for `.try_wait()` and
    /// `.kill()`. Authoritative process metadata (PID, started_at, mode, ...)
    /// lives in `runtime_store` so other CortX instances can see them.
    processes: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    scripts: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    global_scripts: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    /// Interactive shells are GUI-only and never enter the runtime store.
    shells: Arc<Mutex<HashMap<String, ShellEntry>>>,
    /// PTY master + writer per terminal id (`service:<id>`, `shell:<id>`, ...).
    ptys: Arc<Mutex<HashMap<String, PtyIo>>>,
    terminal_hub: Arc<TerminalHub>,
    /// Latest shell-integration state per terminal id (see `terminal::osc`).
    terminal_states: Arc<Mutex<HashMap<String, TerminalShellState>>>,
    command_history: Arc<CommandHistory>,
    shutdown_flag: Arc<AtomicBool>,
    runtime_store: Arc<RuntimeStore>,
}

impl ProcessManager {
    pub fn new(runtime_store: Arc<RuntimeStore>) -> Self {
        let command_history = Arc::new(CommandHistory::new(runtime_store.dir()));
        Self {
            terminal_states: Arc::new(Mutex::new(HashMap::new())),
            command_history,
            processes: Arc::new(Mutex::new(HashMap::new())),
            scripts: Arc::new(Mutex::new(HashMap::new())),
            global_scripts: Arc::new(Mutex::new(HashMap::new())),
            shells: Arc::new(Mutex::new(HashMap::new())),
            ptys: Arc::new(Mutex::new(HashMap::new())),
            terminal_hub: Arc::new(TerminalHub::new()),
            shutdown_flag: Arc::new(AtomicBool::new(false)),
            runtime_store,
        }
    }

    /// Borrow the underlying RuntimeStore (e.g. for `cortx ps` queries from
    /// the same process, or for MCP `list_running_processes`).
    pub fn runtime_store(&self) -> &Arc<RuntimeStore> {
        &self.runtime_store
    }

    /// Raw scrollback + live subscribers for every terminal this manager runs.
    pub fn terminal_hub(&self) -> &Arc<TerminalHub> {
        &self.terminal_hub
    }

    /// Shell-integration state of one terminal, if its shell ever reported any.
    pub fn terminal_state(&self, terminal_id: &str) -> Option<TerminalShellState> {
        self.terminal_states.lock().get(terminal_id).cloned()
    }

    /// Every known shell-integration state (GUI reload after a refresh).
    pub fn all_terminal_states(&self) -> Vec<TerminalShellState> {
        self.terminal_states.lock().values().cloned().collect()
    }

    /// Drop the state of a terminal the GUI closed.
    pub fn forget_terminal_state(&self, terminal_id: &str) {
        self.terminal_states.lock().remove(terminal_id);
    }

    /// Is a command running in this terminal right now? Only shells with the
    /// shell integration report this; without it the answer is always `false`
    /// (we never make the user wait on a terminal we know nothing about).
    pub fn is_terminal_running(&self, terminal_id: &str) -> bool {
        terminal_is_running(&self.terminal_states, terminal_id)
    }

    /// Every terminal whose shell says a command is running, with that
    /// command. Used by "you are about to kill these" prompts on quit.
    pub fn running_terminals(&self) -> Vec<RunningTerminal> {
        let mut out: Vec<RunningTerminal> = self
            .terminal_states
            .lock()
            .values()
            .filter(|s| s.phase == ShellPhase::Running)
            .map(|s| RunningTerminal {
                terminal_id: s.terminal_id.clone(),
                command: s.command.clone(),
                started_at: s.started_at,
            })
            .collect();
        out.sort_by(|a, b| a.terminal_id.cmp(&b.terminal_id));
        out
    }

    pub fn command_history(&self) -> &CommandHistory {
        &self.command_history
    }

    /// Get a clone of the shutdown flag for monitoring threads
    pub fn get_shutdown_flag(&self) -> Arc<AtomicBool> {
        self.shutdown_flag.clone()
    }

    // ========================================================================
    // Terminal I/O (used by the GUI's xterm.js views)
    // ========================================================================

    /// Send keyboard input to the process behind `terminal_id`.
    pub fn write_terminal(&self, terminal_id: &str, data: &[u8]) -> Result<(), String> {
        let mut ptys = self.ptys.lock();
        let io = ptys
            .get_mut(terminal_id)
            .ok_or_else(|| format!("No running terminal for {}", terminal_id))?;
        io.writer
            .write_all(data)
            .and_then(|_| io.writer.flush())
            .map_err(|e| format!("Failed to write to terminal: {}", e))
    }

    /// Tell the PTY (and therefore the child) that the view has a new size.
    pub fn resize_terminal(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if cols == 0 || rows == 0 {
            return Ok(());
        }
        let ptys = self.ptys.lock();
        let io = ptys
            .get(terminal_id)
            .ok_or_else(|| format!("No running terminal for {}", terminal_id))?;
        io.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize terminal: {}", e))
    }

    /// Is there a live PTY behind this terminal id?
    pub fn has_terminal(&self, terminal_id: &str) -> bool {
        self.ptys.lock().contains_key(terminal_id)
    }

    // ========================================================================
    // Shared spawn / watch machinery
    // ========================================================================

    /// Spawn `cmd` inside a fresh PTY. Starts the reader thread that fans raw
    /// bytes out to the hub and de-ANSI'd lines to the log file + `on_line`.
    fn spawn_in_pty(
        &self,
        terminal_id: &str,
        cmd: CommandBuilder,
        size: PtySize,
        log_path: Option<PathBuf>,
        on_line: Box<dyn Fn(String) + Send>,
        observer: Option<PtyObserver>,
    ) -> Result<Box<dyn Child + Send + Sync>, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(size)
            .map_err(|e| format!("Failed to open PTY: {}", e))?;
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to start process: {}", e))?;
        // The slave end must be closed in this process so the reader sees EOF
        // when the child (and its descendants) go away.
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to open PTY reader: {}", e))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to open PTY writer: {}", e))?;

        // Replace any stale I/O for this id (e.g. a service restarted after a
        // crash whose watcher hasn't cleaned up yet).
        let stale = self.ptys.lock().insert(
            terminal_id.to_string(),
            PtyIo {
                master: pair.master,
                writer,
            },
        );
        drop(stale);

        // A fresh shell state for this id: a restarted service must not
        // inherit the previous run's cwd / exit code.
        self.terminal_states
            .lock()
            .insert(terminal_id.to_string(), TerminalShellState::new(terminal_id));

        spawn_pty_reader(
            reader,
            self.terminal_hub.clone(),
            terminal_id.to_string(),
            log_path,
            on_line,
            ShellTracking {
                observer,
                states: self.terminal_states.clone(),
                history: self.command_history.clone(),
            },
        );

        Ok(child)
    }

    /// Ctrl+C first, then a bounded wait, then the hammer.
    fn terminate(&self, terminal_id: &str, child: &mut Box<dyn Child + Send + Sync>, pid: u32) {
        let _ = self.write_terminal(terminal_id, b"\x03");
        let deadline = Instant::now() + GRACEFUL_STOP_TIMEOUT;
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_)) | Err(_)) {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let _ = kill_process_tree(pid);
        let _ = child.kill();
        let _ = child.wait();
        self.drop_pty(terminal_id);
    }

    /// Close the PTY behind `terminal_id`. On Windows this is what makes the
    /// reader thread see EOF, so it must happen once the child is gone.
    fn drop_pty(&self, terminal_id: &str) {
        let io = self.ptys.lock().remove(terminal_id);
        drop(io);
    }

    // ========================================================================
    // Services
    // ========================================================================

    pub fn start_service(
        &self,
        emitter: Arc<dyn ProcessEventEmitter>,
        service_id: String,
        working_dir: String,
        command: String,
        env_vars: Option<HashMap<String, String>>,
        mode: Option<String>,
        arg_preset: Option<String>,
        meta: RuntimeMeta,
    ) -> Result<u32, String> {
        // Check if already running anywhere on the host (this process or
        // another instance — store is the canonical view).
        if let Some(existing) = self.runtime_store.get(&service_id) {
            if runtime_state::is_pid_alive(existing.pid) {
                return Err(format!(
                    "Service is already running (PID {})",
                    existing.pid
                ));
            }
            // Stale entry from a crashed instance — let register() overwrite it.
        }

        emitter.emit_service_status(
            &service_id,
            ServiceStatus::Starting,
            None,
            mode.clone(),
            arg_preset.clone(),
        );

        let tid = terminal_id(TerminalKind::Service, &service_id);
        let cmd = build_shell_command(&command, &working_dir, &tid, env_vars.as_ref());
        let log_path = self.runtime_store.log_path(&service_id);
        let line_emitter = emitter.clone();
        let line_id = service_id.clone();
        let child = self.spawn_in_pty(
            &tid,
            cmd,
            default_size(),
            Some(log_path),
            Box::new(move |line| {
                line_emitter.emit_service_log(&line_id, LogStream::Stdout, line)
            }),
            Some(PtyObserver {
                emitter: emitter.clone(),
                project_id: meta.project_id.clone(),
            }),
        )?;
        let pid = child.process_id().unwrap_or(0);

        // Register the canonical runtime entry BEFORE storing the Child
        // handle, so even if the wait-thread races us we never observe a
        // running PID without an entry.
        let entry = RuntimeEntry {
            id: service_id.clone(),
            kind: EntityKind::Service,
            pid,
            display_name: meta.display_name.clone(),
            command: command.clone(),
            working_dir: working_dir.clone(),
            started_at: chrono::Utc::now(),
            project_id: meta.project_id.clone(),
            project_name: meta.project_name.clone(),
            mode: mode.clone(),
            arg_preset: arg_preset.clone(),
        };
        if let Err(e) = self.runtime_store.register(&entry) {
            log::warn!("Failed to register service {} in runtime store: {}", service_id, e);
        }

        self.processes.lock().insert(
            service_id.clone(),
            ProcessInfo {
                child,
                service_id: service_id.clone(),
                pid,
                active_mode: mode.clone(),
                active_arg_preset: arg_preset.clone(),
            },
        );

        emitter.emit_service_status(
            &service_id,
            ServiceStatus::Running,
            Some(pid),
            mode.clone(),
            arg_preset.clone(),
        );

        self.spawn_port_poller(emitter.clone(), service_id.clone());

        // Exit watcher
        let exit_emitter = emitter.clone();
        let exit_mode = mode.clone();
        let exit_arg_preset = arg_preset.clone();
        let exit_id = service_id.clone();
        watch_exit(
            self.processes.clone(),
            service_id.clone(),
            |info| &mut info.child,
            self.ptys.clone(),
            tid,
            self.shutdown_flag.clone(),
            Some(self.runtime_store.clone()),
            Box::new(move |exit_code| {
                exit_emitter.emit_service_status(
                    &exit_id,
                    ServiceStatus::Stopped,
                    None,
                    exit_mode,
                    exit_arg_preset,
                );
                exit_emitter.emit_service_exit(&exit_id, exit_code);
            }),
        );

        Ok(pid)
    }

    /// Queries the OS for TCP ports the service (and its descendants) are
    /// listening on, emits when the set changes. Fast cadence for the first 15
    /// seconds (catch services that bind shortly after spawn), then slower
    /// cadence (catch rebinds / late-bound ports without burning CPU).
    fn spawn_port_poller(&self, emitter: Arc<dyn ProcessEventEmitter>, service_id: String) {
        let processes = self.processes.clone();
        let shutdown = self.shutdown_flag.clone();
        thread::spawn(move || {
            let start = Instant::now();
            let mut last_ports: Vec<u16> = Vec::new();
            let mut emitted_at_least_once = false;
            loop {
                if shutdown.load(Ordering::SeqCst) {
                    break;
                }
                // If the service is gone from the processes map, the wait-thread
                // already cleaned up — exit silently and emit empty ports below.
                let pid_opt = processes.lock().get(&service_id).map(|p| p.pid);
                let Some(pid) = pid_opt else {
                    break;
                };

                let ports = crate::port_detector::get_listening_ports_for_pid_tree(pid)
                    .unwrap_or_default();

                if !emitted_at_least_once || ports != last_ports {
                    emitter.emit_service_ports(&service_id, ports.clone());
                    last_ports = ports;
                    emitted_at_least_once = true;
                }

                let interval_ms = if start.elapsed().as_secs() < 15 { 1500 } else { 5000 };
                thread::sleep(Duration::from_millis(interval_ms));
            }
            // Service is no longer running — emit an empty port list to clear UI.
            if !shutdown.load(Ordering::SeqCst) {
                emitter.emit_service_ports(&service_id, Vec::new());
            }
        });
    }

    pub fn stop_service(
        &self,
        emitter: &dyn ProcessEventEmitter,
        service_id: &str,
    ) -> Result<(), String> {
        // First, try the in-memory path (we spawned this process).
        let owned = self.processes.lock().remove(service_id);

        let (stopped_mode, stopped_arg_preset) = if let Some(mut info) = owned {
            let mode = info.active_mode.clone();
            let preset = info.active_arg_preset.clone();
            let tid = terminal_id(TerminalKind::Service, service_id);
            self.terminate(&tid, &mut info.child, info.pid);
            (mode, preset)
        } else {
            // Not in our in-memory map — maybe started by another CortX
            // instance (CLI, another GUI). Fall back to PID-from-store kill.
            let entry = self
                .runtime_store
                .get(service_id)
                .ok_or_else(|| "Service is not running".to_string())?;
            if matches!(entry.kind, EntityKind::Service)
                && runtime_state::is_pid_alive(entry.pid)
            {
                runtime_state::kill_pid_tree(entry.pid)?;
            }
            (entry.mode, entry.arg_preset)
        };

        let _ = self.runtime_store.unregister(service_id);

        emitter.emit_service_status(
            service_id,
            ServiceStatus::Stopped,
            None,
            stopped_mode,
            stopped_arg_preset,
        );

        Ok(())
    }

    pub fn is_running(&self, service_id: &str) -> bool {
        self.runtime_store
            .get(service_id)
            .filter(|e| matches!(e.kind, EntityKind::Service))
            .map(|e| runtime_state::is_pid_alive(e.pid))
            .unwrap_or(false)
    }

    pub fn get_running_services(&self) -> Vec<String> {
        self.runtime_store
            .list()
            .into_iter()
            .filter(|(e, alive)| *alive && matches!(e.kind, EntityKind::Service))
            .map(|(e, _)| e.id)
            .collect()
    }

    // ========================================================================
    // Project Scripts
    // ========================================================================

    pub fn run_script(
        &self,
        emitter: Arc<dyn ProcessEventEmitter>,
        script_id: String,
        working_dir: String,
        command: String,
        meta: RuntimeMeta,
    ) -> Result<u32, String> {
        if let Some(existing) = self.runtime_store.get(&script_id) {
            if runtime_state::is_pid_alive(existing.pid) {
                return Err(format!(
                    "Script is already running (PID {})",
                    existing.pid
                ));
            }
        }

        emitter.emit_script_status(&script_id, ScriptStatus::Running, None);

        let tid = terminal_id(TerminalKind::Script, &script_id);
        let cmd = build_shell_command(&command, &working_dir, &tid, None);
        let log_path = self.runtime_store.log_path(&script_id);
        let line_emitter = emitter.clone();
        let line_id = script_id.clone();
        let child = self.spawn_in_pty(
            &tid,
            cmd,
            default_size(),
            Some(log_path),
            Box::new(move |line| {
                line_emitter.emit_script_log(&line_id, LogStream::Stdout, line)
            }),
            Some(PtyObserver {
                emitter: emitter.clone(),
                project_id: meta.project_id.clone(),
            }),
        )?;
        let pid = child.process_id().unwrap_or(0);

        let entry = RuntimeEntry {
            id: script_id.clone(),
            kind: EntityKind::ProjectScript,
            pid,
            display_name: meta.display_name.clone(),
            command: command.clone(),
            working_dir: working_dir.clone(),
            started_at: chrono::Utc::now(),
            project_id: meta.project_id.clone(),
            project_name: meta.project_name.clone(),
            mode: None,
            arg_preset: None,
        };
        if let Err(e) = self.runtime_store.register(&entry) {
            log::warn!("Failed to register project script {} in runtime store: {}", script_id, e);
        }

        self.scripts.lock().insert(
            script_id.clone(),
            ProcessInfo {
                child,
                service_id: script_id.clone(),
                pid,
                active_mode: None,
                active_arg_preset: None,
            },
        );

        emitter.emit_script_status(&script_id, ScriptStatus::Running, Some(pid));

        let exit_emitter = emitter.clone();
        let exit_id = script_id.clone();
        watch_exit(
            self.scripts.clone(),
            script_id.clone(),
            |info| &mut info.child,
            self.ptys.clone(),
            tid,
            self.shutdown_flag.clone(),
            Some(self.runtime_store.clone()),
            Box::new(move |exit_code| {
                let success = exit_code.map(|c| c == 0).unwrap_or(false);
                exit_emitter.emit_script_status(
                    &exit_id,
                    if success { ScriptStatus::Completed } else { ScriptStatus::Failed },
                    None,
                );
                exit_emitter.emit_script_exit(&exit_id, exit_code, success);
            }),
        );

        Ok(pid)
    }

    pub fn stop_script(
        &self,
        emitter: &dyn ProcessEventEmitter,
        script_id: &str,
    ) -> Result<(), String> {
        let owned = self.scripts.lock().remove(script_id);

        if let Some(mut info) = owned {
            let tid = terminal_id(TerminalKind::Script, script_id);
            self.terminate(&tid, &mut info.child, info.pid);
        } else {
            // Cross-instance fallback: kill by PID from the store.
            let entry = self
                .runtime_store
                .get(script_id)
                .ok_or_else(|| "Script is not running".to_string())?;
            if matches!(entry.kind, EntityKind::ProjectScript)
                && runtime_state::is_pid_alive(entry.pid)
            {
                runtime_state::kill_pid_tree(entry.pid)?;
            }
        }

        let _ = self.runtime_store.unregister(script_id);
        emitter.emit_script_status(script_id, ScriptStatus::Failed, None);
        Ok(())
    }

    pub fn is_script_running(&self, script_id: &str) -> bool {
        self.runtime_store
            .get(script_id)
            .filter(|e| matches!(e.kind, EntityKind::ProjectScript))
            .map(|e| runtime_state::is_pid_alive(e.pid))
            .unwrap_or(false)
    }

    // ========================================================================
    // Global Scripts
    // ========================================================================

    pub fn run_global_script(
        &self,
        emitter: Arc<dyn ProcessEventEmitter>,
        script_id: String,
        working_dir: String,
        program: String,
        args: Vec<String>,
        env_vars: Option<HashMap<String, String>>,
        meta: RuntimeMeta,
    ) -> Result<u32, String> {
        if let Some(existing) = self.runtime_store.get(&script_id) {
            if runtime_state::is_pid_alive(existing.pid) {
                return Err(format!(
                    "Global script is already running (PID {})",
                    existing.pid
                ));
            }
        }

        emitter.emit_global_script_status(&script_id, ScriptStatus::Running, None);

        let tid = terminal_id(TerminalKind::GlobalScript, &script_id);
        let mut cmd = CommandBuilder::new(&program);
        cmd.args(&args);
        cmd.cwd(&working_dir);
        apply_pty_env(&mut cmd, &tid, env_vars.as_ref());
        let log_path = self.runtime_store.log_path(&script_id);
        let line_emitter = emitter.clone();
        let line_id = script_id.clone();
        let child = self
            .spawn_in_pty(
                &tid,
                cmd,
                default_size(),
                Some(log_path),
                Box::new(move |line| {
                    line_emitter.emit_global_script_log(&line_id, LogStream::Stdout, line)
                }),
                Some(PtyObserver {
                    emitter: emitter.clone(),
                    project_id: meta.project_id.clone(),
                }),
            )
            .map_err(|e| e.replace("Failed to start process", "Failed to start global script"))?;
        let pid = child.process_id().unwrap_or(0);

        let command_display = format!("{} {}", program, args.join(" "));
        let entry = RuntimeEntry {
            id: script_id.clone(),
            kind: EntityKind::GlobalScript,
            pid,
            display_name: meta.display_name.clone(),
            command: command_display,
            working_dir: working_dir.clone(),
            started_at: chrono::Utc::now(),
            project_id: meta.project_id.clone(),
            project_name: meta.project_name.clone(),
            mode: None,
            arg_preset: None,
        };
        if let Err(e) = self.runtime_store.register(&entry) {
            log::warn!("Failed to register global script {} in runtime store: {}", script_id, e);
        }

        self.global_scripts.lock().insert(
            script_id.clone(),
            ProcessInfo {
                child,
                service_id: script_id.clone(),
                pid,
                active_mode: None,
                active_arg_preset: None,
            },
        );

        emitter.emit_global_script_status(&script_id, ScriptStatus::Running, Some(pid));

        let exit_emitter = emitter.clone();
        let exit_id = script_id.clone();
        watch_exit(
            self.global_scripts.clone(),
            script_id.clone(),
            |info| &mut info.child,
            self.ptys.clone(),
            tid,
            self.shutdown_flag.clone(),
            Some(self.runtime_store.clone()),
            Box::new(move |exit_code| {
                let success = exit_code.map(|c| c == 0).unwrap_or(false);
                exit_emitter.emit_global_script_status(
                    &exit_id,
                    if success { ScriptStatus::Completed } else { ScriptStatus::Failed },
                    None,
                );
                exit_emitter.emit_global_script_exit(&exit_id, exit_code, success);
            }),
        );

        Ok(pid)
    }

    pub fn stop_global_script(
        &self,
        emitter: &dyn ProcessEventEmitter,
        script_id: &str,
    ) -> Result<(), String> {
        let owned = self.global_scripts.lock().remove(script_id);

        if let Some(mut info) = owned {
            let tid = terminal_id(TerminalKind::GlobalScript, script_id);
            self.terminate(&tid, &mut info.child, info.pid);
        } else {
            let entry = self
                .runtime_store
                .get(script_id)
                .ok_or_else(|| "Global script is not running".to_string())?;
            if matches!(entry.kind, EntityKind::GlobalScript)
                && runtime_state::is_pid_alive(entry.pid)
            {
                runtime_state::kill_pid_tree(entry.pid)?;
            }
        }

        let _ = self.runtime_store.unregister(script_id);
        emitter.emit_global_script_status(script_id, ScriptStatus::Failed, None);
        Ok(())
    }

    pub fn is_global_script_running(&self, script_id: &str) -> bool {
        self.runtime_store
            .get(script_id)
            .filter(|e| matches!(e.kind, EntityKind::GlobalScript))
            .map(|e| runtime_state::is_pid_alive(e.pid))
            .unwrap_or(false)
    }

    // ========================================================================
    // Interactive shells (GUI terminal tabs)
    // ========================================================================

    /// Open an interactive shell in a PTY. Returns its description; output
    /// flows through the hub under `shell:<id>`.
    pub fn spawn_shell(
        &self,
        emitter: Arc<dyn ProcessEventEmitter>,
        request: ShellSpawnRequest,
    ) -> Result<ShellInfo, String> {
        let cwd = if request.cwd.trim().is_empty() {
            home_dir_string()
        } else {
            request.cwd.clone()
        };
        if !Path::new(&cwd).is_dir() {
            return Err(format!("Directory does not exist: {}", cwd));
        }

        let shell_id = uuid::Uuid::new_v4().to_string();
        let tid = terminal_id(TerminalKind::Shell, &shell_id);

        // Session restore: replay the previous shell's tail before anything
        // the new one prints.
        if let Some(old_id) = request.restore_from.as_deref() {
            let runtime_dir = self.runtime_store.dir();
            if let Some(bytes) = crate::terminal::snapshot::load(runtime_dir, old_id) {
                // Reset attributes on both sides so a colour left open in the
                // tail can't bleed into the separator or the new prompt.
                self.terminal_hub.push(&tid, b"\x1b[0m");
                self.terminal_hub.push(&tid, &bytes);
                self.terminal_hub.push(&tid, b"\x1b[0m");
                self.terminal_hub.push(&tid, crate::terminal::snapshot::RESTORE_SEPARATOR);
                // Move the replay off the screen and into the scrollback, then
                // put the cursor home.
                //
                // The shell about to start gets a fresh, empty ConPTY screen and
                // writes from its top-left. If our screen still holds the
                // restored lines, the two disagree by however many rows the
                // replay took: every absolute cursor move ConPTY sends lands
                // that far off, and the line editor redraws what you type above
                // the prompt instead of on it. Going to the last row and feeding
                // one screenful of newlines scrolls each restored line into the
                // scrollback (still there, just scroll up) and leaves a blank
                // screen that matches ConPTY's.
                let rows = if request.rows == 0 { DEFAULT_PTY_ROWS } else { request.rows };
                let mut align = format!("\x1b[{};1H", rows).into_bytes();
                align.extend(std::iter::repeat(b'\n').take(rows as usize));
                align.extend_from_slice(b"\x1b[H");
                self.terminal_hub.push(&tid, &align);
            }
            crate::terminal::snapshot::remove(runtime_dir, old_id);
        }

        let (program, mut args) = resolve_shell(request.shell.as_deref());
        // App-side shell integration: the shell gets the OSC 7 / 133 block as
        // start-up code (after its own profile), so cwd, command status and
        // suggestions work without the deployed CLI being in the profile.
        let extra_env = match request.integration {
            Some(opts) => inject_shell_integration(&program, &mut args, opts, self.runtime_store.dir()),
            None => Vec::new(),
        };
        let mut cmd = CommandBuilder::new(&program);
        cmd.args(&args);
        cmd.cwd(&cwd);
        apply_pty_env(&mut cmd, &tid, None);
        for (key, value) in extra_env {
            cmd.env(key, value);
        }
        let size = PtySize {
            rows: if request.rows == 0 { DEFAULT_PTY_ROWS } else { request.rows },
            cols: if request.cols == 0 { DEFAULT_PTY_COLS } else { request.cols },
            pixel_width: 0,
            pixel_height: 0,
        };
        let child = self
            .spawn_in_pty(
                &tid,
                cmd,
                size,
                None,
                Box::new(|_| {}),
                Some(PtyObserver {
                    emitter: emitter.clone(),
                    project_id: request.project_id.clone(),
                }),
            )
            .map_err(|e| format!("{} ({})", e, program))?;
        let pid = child.process_id().unwrap_or(0);

        let info = ShellInfo {
            id: shell_id.clone(),
            pid,
            cwd,
            project_id: request.project_id,
            program,
            started_at: chrono::Utc::now(),
        };

        self.shells.lock().insert(
            shell_id.clone(),
            ShellEntry {
                child,
                info: info.clone(),
            },
        );

        let exit_id = shell_id.clone();
        watch_exit(
            self.shells.clone(),
            shell_id,
            |entry| &mut entry.child,
            self.ptys.clone(),
            tid,
            self.shutdown_flag.clone(),
            None,
            Box::new(move |exit_code| emitter.emit_shell_exit(&exit_id, exit_code)),
        );

        Ok(info)
    }

    /// Kill a shell (the tab was closed). No-op if it already exited.
    ///
    /// Same courtesy a service gets in `stop_service`: when a command is
    /// running it is interrupted first and given [`GRACEFUL_STOP_TIMEOUT`] to
    /// wind down (a dev server releases its port, `claude` saves its session),
    /// then the whole process tree goes — killing the shell alone would leave
    /// its grandchildren (`node`, `cargo`, …) orphaned and running on Windows.
    pub fn kill_shell(&self, emitter: &dyn ProcessEventEmitter, shell_id: &str) -> Result<(), String> {
        let Some(mut entry) = self.shells.lock().remove(shell_id) else {
            return Ok(());
        };
        let tid = terminal_id(TerminalKind::Shell, shell_id);
        let pid = entry.info.pid;
        let busy = self.is_terminal_running(&tid);
        // The terminal is gone as far as everyone else is concerned: it leaves
        // the maps and the GUI hears about it right away. Only the wind-down
        // is deferred, so the grace period never freezes the caller (Tauri runs
        // synchronous commands on the main thread).
        let mut io = self.ptys.lock().remove(&tid);
        emitter.emit_shell_exit(shell_id, None);
        let states = self.terminal_states.clone();
        let label = shell_id.to_string();
        thread::spawn(move || {
            if busy {
                if let Some(io) = io.as_mut() {
                    let _ = io.writer.write_all(b"\x03").and_then(|_| io.writer.flush());
                }
                wait_until_idle(&states, &tid);
            }
            if let Err(e) = kill_process_tree_robust(pid) {
                log::warn!("Shell {} tree may have survived: {}", label, e);
            }
            let _ = entry.child.kill();
            let _ = entry.child.wait();
            // Closing the PTY is what makes the reader thread see EOF, so it
            // has to come after the child is really gone.
            drop(io);
        });
        Ok(())
    }

    /// Shells still alive (for the GUI to re-attach after a reload).
    pub fn list_shells(&self) -> Vec<ShellInfo> {
        let mut shells: Vec<ShellInfo> = self
            .shells
            .lock()
            .values()
            .map(|e| e.info.clone())
            .collect();
        shells.sort_by(|a, b| a.started_at.cmp(&b.started_at));
        shells
    }

    // ========================================================================
    // Shutdown
    // ========================================================================

    pub fn stop_all(&self) {
        // Quit is not an excuse for a brutal kill: whatever is running in a
        // terminal gets a Ctrl+C and one shared grace period (they wind down
        // in parallel) before the process trees are torn down. Done before the
        // shutdown flag so the PTY readers are still folding OSC 133 into the
        // terminal states and we can tell when a command has actually stopped.
        let busy: Vec<String> = self
            .running_terminals()
            .into_iter()
            .map(|t| t.terminal_id)
            .collect();
        if !busy.is_empty() {
            log::info!("Interrupting {} running terminal(s) before shutdown", busy.len());
            for tid in &busy {
                let _ = self.write_terminal(tid, b"\x03");
            }
            let deadline = Instant::now() + GRACEFUL_STOP_TIMEOUT;
            while Instant::now() < deadline
                && busy.iter().any(|tid| self.is_terminal_running(tid))
            {
                thread::sleep(Duration::from_millis(50));
            }
        }

        // Set shutdown flag to stop monitoring threads
        self.shutdown_flag.store(true, Ordering::SeqCst);

        // Give monitoring threads a moment to see the flag
        thread::sleep(Duration::from_millis(50));

        // Collect all processes to kill
        let processes_to_kill: Vec<(String, u32)> = self
            .processes
            .lock()
            .iter()
            .map(|(id, info)| (id.clone(), info.pid))
            .collect();
        let scripts_to_kill: Vec<(String, u32)> = self
            .scripts
            .lock()
            .iter()
            .map(|(id, info)| (id.clone(), info.pid))
            .collect();
        let global_scripts_to_kill: Vec<(String, u32)> = self
            .global_scripts
            .lock()
            .iter()
            .map(|(id, info)| (id.clone(), info.pid))
            .collect();
        let shells_to_kill: Vec<(String, u32)> = self
            .shells
            .lock()
            .iter()
            .map(|(id, e)| (id.clone(), e.info.pid))
            .collect();

        // Unregister everything we own from the canonical store so a fresh
        // `cortx ps` doesn't see stale entries pointing at our soon-to-die
        // PIDs. Self-healing prune would catch them later, but cleaning up
        // proactively avoids any race window.
        for (id, _) in processes_to_kill
            .iter()
            .chain(scripts_to_kill.iter())
            .chain(global_scripts_to_kill.iter())
        {
            let _ = self.runtime_store.unregister(id);
        }

        for (service_id, pid) in &processes_to_kill {
            log::info!("Stopping service {} (PID: {})", service_id, pid);
            if let Err(e) = kill_process_tree_robust(*pid) {
                log::error!("Failed to kill process tree for PID {}: {}", pid, e);
            }
        }
        for (script_id, pid) in &scripts_to_kill {
            log::info!("Stopping script {} (PID: {})", script_id, pid);
            if let Err(e) = kill_process_tree_robust(*pid) {
                log::error!("Failed to kill script process tree for PID {}: {}", pid, e);
            }
        }
        for (script_id, pid) in &global_scripts_to_kill {
            log::info!("Stopping global script {} (PID: {})", script_id, pid);
            if let Err(e) = kill_process_tree_robust(*pid) {
                log::error!(
                    "Failed to kill global script process tree for PID {}: {}",
                    pid,
                    e
                );
            }
        }
        for (shell_id, pid) in &shells_to_kill {
            log::info!("Closing shell {} (PID: {})", shell_id, pid);
            if let Err(e) = kill_process_tree_robust(*pid) {
                log::error!("Failed to kill shell process tree for PID {}: {}", pid, e);
            }
        }

        // Drain and cleanup child handles
        for (_, mut info) in self.processes.lock().drain() {
            let _ = info.child.kill();
            let _ = info.child.wait();
        }
        for (_, mut info) in self.scripts.lock().drain() {
            let _ = info.child.kill();
            let _ = info.child.wait();
        }
        for (_, mut info) in self.global_scripts.lock().drain() {
            let _ = info.child.kill();
            let _ = info.child.wait();
        }
        for (_, mut entry) in self.shells.lock().drain() {
            let _ = entry.child.kill();
            let _ = entry.child.wait();
        }

        // Close every PTY now that the children are gone. Take them out of
        // the map first so the lock isn't held while ConPTY tears down.
        let ptys: Vec<PtyIo> = self.ptys.lock().drain().map(|(_, io)| io).collect();
        drop(ptys);

        // Final verification - try to kill any remaining processes
        for (_, pid) in processes_to_kill
            .iter()
            .chain(scripts_to_kill.iter())
            .chain(global_scripts_to_kill.iter())
            .chain(shells_to_kill.iter())
        {
            let _ = kill_process_tree_robust(*pid);
        }

        log::info!("All services, scripts and shells stopped");
    }

    /// Check if any processes are still running
    pub fn has_running_processes(&self) -> bool {
        !self.processes.lock().is_empty()
            || !self.scripts.lock().is_empty()
            || !self.global_scripts.lock().is_empty()
            || !self.shells.lock().is_empty()
    }
}

impl Drop for ProcessManager {
    fn drop(&mut self) {
        if !self.shutdown_flag.load(Ordering::SeqCst) {
            self.stop_all();
        }
    }
}

// ============================================================================
// Graceful terminal shutdown helpers
// ============================================================================

/// Does the shell integration say a command is running in this terminal?
/// Terminals we know nothing about (integration off, service PTYs) count as
/// idle: we never make the user wait on a guess.
fn terminal_is_running(
    states: &Mutex<HashMap<String, TerminalShellState>>,
    terminal_id: &str,
) -> bool {
    matches!(
        states.lock().get(terminal_id).map(|s| s.phase),
        Some(ShellPhase::Running)
    )
}

/// Wait (bounded by [`GRACEFUL_STOP_TIMEOUT`]) for a terminal to report it is
/// back at its prompt. Returns whether it got there in time.
///
/// This is the shell counterpart of what `stop_service` does through
/// `ProcessManager::terminate`: a shell never exits on Ctrl+C, so we watch the
/// *command* instead of the child process.
fn wait_until_idle(
    states: &Mutex<HashMap<String, TerminalShellState>>,
    terminal_id: &str,
) -> bool {
    let deadline = Instant::now() + GRACEFUL_STOP_TIMEOUT;
    while Instant::now() < deadline {
        thread::sleep(Duration::from_millis(25));
        if !terminal_is_running(states, terminal_id) {
            return true;
        }
    }
    false
}

// ============================================================================
// Exit watcher (shared by every kind of process)
// ============================================================================

/// Poll `try_wait` on the entry stored under `key` in `map`. When it exits:
/// remove it from the map, unregister it from the runtime store, close its
/// PTY, and run `on_exit` (unless we're shutting down). If the entry vanishes
/// from the map first (stopped manually or during shutdown) the watcher just
/// ends.
#[allow(clippy::too_many_arguments)]
fn watch_exit<T: Send + 'static>(
    map: Arc<Mutex<HashMap<String, T>>>,
    key: String,
    child_of: fn(&mut T) -> &mut Box<dyn Child + Send + Sync>,
    ptys: Arc<Mutex<HashMap<String, PtyIo>>>,
    terminal_id: String,
    shutdown_flag: Arc<AtomicBool>,
    runtime_store: Option<Arc<RuntimeStore>>,
    on_exit: Box<dyn FnOnce(Option<i32>) + Send>,
) {
    thread::spawn(move || loop {
        if shutdown_flag.load(Ordering::SeqCst) {
            break;
        }
        thread::sleep(Duration::from_millis(100));

        let outcome = {
            let mut guard = map.lock();
            match guard.get_mut(&key) {
                Some(entry) => match child_of(entry).try_wait() {
                    Ok(Some(status)) => Some(Some(status.exit_code() as i32)),
                    Ok(None) => None,
                    Err(_) => Some(None),
                },
                // Removed by stop_* / stop_all — nothing left to do.
                None => break,
            }
        };

        if let Some(exit_code) = outcome {
            map.lock().remove(&key);
            if let Some(store) = &runtime_store {
                let _ = store.unregister(&key);
            }
            // Closing the PTY is what lets the reader thread finish on
            // Windows; do it outside the map lock.
            let io = ptys.lock().remove(&terminal_id);
            drop(io);

            if !shutdown_flag.load(Ordering::SeqCst) {
                on_exit(exit_code);
            }
            break;
        }
    });
}

// ============================================================================
// PTY reader: raw bytes → hub, de-ANSI'd lines → log file + emitter
// ============================================================================

/// Shell-integration plumbing handed to the reader thread.
struct ShellTracking {
    observer: Option<PtyObserver>,
    states: Arc<Mutex<HashMap<String, TerminalShellState>>>,
    history: Arc<CommandHistory>,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn spawn_pty_reader(
    mut reader: Box<dyn Read + Send>,
    hub: Arc<TerminalHub>,
    terminal_id: String,
    log_path: Option<PathBuf>,
    on_line: Box<dyn Fn(String) + Send>,
    tracking: ShellTracking,
) {
    thread::spawn(move || {
        let mut log = log_path.and_then(|p| {
            OpenOptions::new().create(true).append(true).open(p).ok()
        });
        let mut splitter = AnsiLineSplitter::new();
        let mut scanner = OscScanner::new();
        let mut tracker = TerminalStateTracker::new(&terminal_id);
        let mut buf = vec![0u8; 64 * 1024];

        let deliver = |line: String, log: &mut Option<std::fs::File>| {
            if let Some(file) = log.as_mut() {
                let _ = writeln!(file, "{}", line);
            }
            on_line(line);
        };

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = &buf[..n];
                    hub.push(&terminal_id, chunk);
                    for line in splitter.feed(chunk) {
                        deliver(line, &mut log);
                    }
                    for event in scanner.feed(chunk) {
                        let update = tracker.apply(event, now_ms());
                        if let Some(done) = update.finished {
                            tracking.history.append(&CommandRecord {
                                ts: done.finished_at,
                                terminal_id: terminal_id.clone(),
                                project_id: tracking
                                    .observer
                                    .as_ref()
                                    .and_then(|o| o.project_id.clone()),
                                cwd: done.cwd,
                                command: done.command,
                                exit_code: done.exit_code,
                                duration_ms: done.duration_ms,
                            });
                        }
                        if update.changed {
                            tracking
                                .states
                                .lock()
                                .insert(terminal_id.clone(), tracker.state().clone());
                            if let Some(obs) = &tracking.observer {
                                obs.emitter.emit_terminal_state(tracker.state());
                            }
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        if let Some(rest) = splitter.finish() {
            deliver(rest, &mut log);
        }
    });
}

// ============================================================================
// Command construction
// ============================================================================

fn default_size() -> PtySize {
    PtySize {
        rows: DEFAULT_PTY_ROWS,
        cols: DEFAULT_PTY_COLS,
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Wrap a free-form command line in the platform shell (`cmd /C` or `sh -c`)
/// so pipes, `&&`, env expansion etc. keep working.
fn build_shell_command(
    command: &str,
    working_dir: &str,
    terminal_id: &str,
    env_vars: Option<&HashMap<String, String>>,
) -> CommandBuilder {
    let (program, args) = parse_command(command);
    let mut cmd = CommandBuilder::new(program);
    cmd.args(args);
    cmd.cwd(working_dir);
    apply_pty_env(&mut cmd, terminal_id, env_vars);
    cmd
}

/// Give an interactive shell the CortX integration as start-up code, after
/// its own profile (`shell_init::shell_integration_startup`):
///
/// - PowerShell: `-NoExit -Command "<stmt>; <stmt>"` (the block is a single
///   base64 `Invoke-Expression` line, so it survives the command line).
/// - bash: `--rcfile <file>` where the file sources the user's own rc (or
///   profile when the shell was a login one) and then the block.
/// - zsh: a private `ZDOTDIR` whose rc files chain to `$HOME`'s and add the block.
/// - fish: `-C 'source <file>'`.
///
/// The files live under `runtime/shell-init/` and are rewritten on every
/// spawn so setting changes apply to the next shell. Unknown shells are left
/// alone (the profile's `cortx init`, if any, still applies).
fn inject_shell_integration(
    program: &str,
    args: &mut Vec<String>,
    opts: crate::shell_init::InitOptions,
    runtime_dir: &Path,
) -> Vec<(String, String)> {
    use crate::shell_init::{shell_for_program, shell_integration_startup, Shell};
    let Some(shell) = shell_for_program(program) else {
        return Vec::new();
    };
    let block = shell_integration_startup(&shell, opts);
    if block.trim().is_empty() {
        return Vec::new();
    }
    let dir = runtime_dir.join("shell-init");
    if std::fs::create_dir_all(&dir).is_err() {
        return Vec::new();
    }
    let write = |name: &str, content: &str| -> Option<PathBuf> {
        let path = dir.join(name);
        std::fs::write(&path, content).ok().map(|_| path)
    };
    match shell {
        Shell::PowerShell => {
            // Respect an explicit -Command / -File from the user's shell setting.
            if args.iter().any(|a| {
                let l = a.to_ascii_lowercase();
                l == "-command" || l == "-c" || l == "-file" || l == "-f"
            }) {
                return Vec::new();
            }
            let stmt = block
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty() && !l.starts_with('#'))
                .collect::<Vec<_>>()
                .join("; ");
            if !args.iter().any(|a| a.eq_ignore_ascii_case("-noexit")) {
                args.push("-NoExit".into());
            }
            args.push("-Command".into());
            args.push(stmt);
            Vec::new()
        }
        Shell::Bash => {
            let login = args.iter().any(|a| a == "-l" || a == "--login");
            args.retain(|a| a != "-l" && a != "--login");
            let content = if login {
                format!(
                    "# CortX shell integration bootstrap (login shell)\n\
                     if [ -f \"$HOME/.bash_profile\" ]; then . \"$HOME/.bash_profile\"; \
                     elif [ -f \"$HOME/.bash_login\" ]; then . \"$HOME/.bash_login\"; \
                     elif [ -f \"$HOME/.profile\" ]; then . \"$HOME/.profile\"; fi\n{}",
                    block
                )
            } else {
                format!(
                    "# CortX shell integration bootstrap\n[ -f \"$HOME/.bashrc\" ] && . \"$HOME/.bashrc\"\n{}",
                    block
                )
            };
            if let Some(path) = write("cortx.bash", &content) {
                args.push("--rcfile".into());
                args.push(path.to_string_lossy().into_owned());
            }
            Vec::new()
        }
        Shell::Zsh => {
            let zdot = dir.join("zdotdir");
            if std::fs::create_dir_all(&zdot).is_err() {
                return Vec::new();
            }
            let chain = |file: &str| -> String {
                format!("[ -f \"$HOME/{f}\" ] && . \"$HOME/{f}\"\n", f = file)
            };
            let _ = std::fs::write(&zdot.join(".zshenv"), chain(".zshenv"));
            let _ = std::fs::write(&zdot.join(".zprofile"), chain(".zprofile"));
            let _ = std::fs::write(&zdot.join(".zlogin"), chain(".zlogin"));
            let zshrc = format!(
                "# CortX shell integration bootstrap\nZDOTDIR=\"$HOME\"\n{}{}",
                chain(".zshrc"),
                block
            );
            if std::fs::write(zdot.join(".zshrc"), zshrc).is_err() {
                return Vec::new();
            }
            vec![("ZDOTDIR".to_string(), zdot.to_string_lossy().into_owned())]
        }
        Shell::Fish => {
            if let Some(path) = write("cortx.fish", &block) {
                args.push("-C".into());
                args.push(format!("source '{}'", path.to_string_lossy().replace('\'', "\\'")));
            }
            Vec::new()
        }
    }
}

/// Environment every PTY child gets: terminal identification so programs
/// enable colours / truecolor, UTF-8 on Windows, plus the caller's own vars.
fn apply_pty_env(
    cmd: &mut CommandBuilder,
    terminal_id: &str,
    env_vars: Option<&HashMap<String, String>>,
) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "CortX");
    // `cortx init` only turns on shell integration (OSC 7 / 133) when this
    // is set, so external terminals stay untouched.
    cmd.env("CORTX_TERMINAL_ID", terminal_id);
    // Whoever launched CortX (a Claude Code session in dev, a script…) must
    // not leak its own session markers into every terminal: a nested
    // `claude` would otherwise believe it is a child session.
    for var in ["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT"] {
        cmd.env_remove(var);
    }
    // Force UTF-8 output on Windows to avoid cp1252 encoding errors
    #[cfg(target_os = "windows")]
    {
        cmd.env("PYTHONUTF8", "1");
        cmd.env("PYTHONIOENCODING", "utf-8");
    }
    if let Some(env) = env_vars {
        for (key, value) in env {
            cmd.env(key, value);
        }
    }
}

fn parse_command(command: &str) -> (String, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        // On Windows, run through cmd
        (
            "cmd".to_string(),
            vec!["/C".to_string(), command.to_string()],
        )
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On Unix, run through sh
        (
            "sh".to_string(),
            vec!["-c".to_string(), command.to_string()],
        )
    }
}

/// Pick the interactive shell for a new terminal tab.
///
/// An explicit command line from settings wins. Otherwise: PowerShell 7 if
/// installed, else Windows PowerShell; `$SHELL` (login shell on macOS so PATH
/// matches Terminal.app) else bash/sh.
pub fn resolve_shell(explicit: Option<&str>) -> (String, Vec<String>) {
    if let Some(spec) = explicit.map(str::trim).filter(|s| !s.is_empty()) {
        let mut parts = crate::command_builder::split_args(spec);
        if !parts.is_empty() {
            let program = parts.remove(0);
            return (program, parts);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if find_on_path("pwsh.exe").is_some() {
            return ("pwsh.exe".to_string(), vec!["-NoLogo".to_string()]);
        }
        ("powershell.exe".to_string(), vec!["-NoLogo".to_string()])
    }

    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                if Path::new("/bin/bash").exists() {
                    "/bin/bash".to_string()
                } else {
                    "/bin/sh".to_string()
                }
            });
        let args = if cfg!(target_os = "macos") {
            vec!["-l".to_string()]
        } else {
            Vec::new()
        };
        (shell, args)
    }
}

/// Locate an executable on PATH.
pub fn find_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

fn home_dir_string() -> String {
    directories::UserDirs::new()
        .map(|u| u.home_dir().to_string_lossy().into_owned())
        .unwrap_or_else(|| ".".to_string())
}

// ============================================================================
// Platform-specific process kill helpers
// ============================================================================

/// Kill a process and all its child processes on Windows (basic version)
#[cfg(target_os = "windows")]
fn kill_process_tree(pid: u32) -> Result<(), std::io::Error> {
    Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()?;
    Ok(())
}

/// Kill a process tree robustly on Windows with retries and verification
#[cfg(target_os = "windows")]
fn kill_process_tree_robust(pid: u32) -> Result<(), String> {
    // First attempt with taskkill
    let output = Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| format!("Failed to execute taskkill: {}", e))?;

    // Give Windows time to actually terminate the processes
    thread::sleep(Duration::from_millis(100));

    // Check if process still exists using tasklist
    let check = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH"])
        .creation_flags(0x08000000)
        .output();

    if let Ok(check_output) = check {
        let output_str = String::from_utf8_lossy(&check_output.stdout);
        if output_str.contains(&pid.to_string()) {
            // Process still exists, try again
            log::warn!(
                "Process {} still running after first kill attempt, retrying...",
                pid
            );
            thread::sleep(Duration::from_millis(200));
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(0x08000000)
                .output();
            thread::sleep(Duration::from_millis(100));
        }
    }

    // Also try to kill by process name pattern as a fallback
    let _ = Command::new("wmic")
        .args([
            "process",
            "where",
            &format!("ParentProcessId={}", pid),
            "delete",
        ])
        .creation_flags(0x08000000)
        .output();

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Don't treat "not found" as an error - the process might have already exited
        if !stderr.contains("not found") && !stderr.contains("No tasks") {
            return Err(format!("taskkill failed: {}", stderr));
        }
    }

    Ok(())
}

/// Kill a process and all its child processes on Unix (basic version)
#[cfg(not(target_os = "windows"))]
fn kill_process_tree(pid: u32) -> Result<(), std::io::Error> {
    // The PTY child is a session leader, so its pid is also its pgid.
    let _ = Command::new("kill")
        .args(["-TERM", &format!("-{}", pid)])
        .output();

    // Give it a moment, then force kill
    thread::sleep(Duration::from_millis(100));

    let _ = Command::new("kill")
        .args(["-KILL", &format!("-{}", pid)])
        .output();

    Ok(())
}

/// Kill a process tree robustly on Unix with retries
#[cfg(not(target_os = "windows"))]
fn kill_process_tree_robust(pid: u32) -> Result<(), String> {
    // First try SIGTERM to the process group
    let _ = Command::new("kill")
        .args(["-TERM", &format!("-{}", pid)])
        .output();

    thread::sleep(Duration::from_millis(100));

    // Check if still running
    let check = Command::new("kill")
        .args(["-0", &pid.to_string()])
        .output();

    if check.map(|o| o.status.success()).unwrap_or(false) {
        // Still running, force kill
        log::warn!(
            "Process {} still running after SIGTERM, sending SIGKILL...",
            pid
        );

        let _ = Command::new("kill")
            .args(["-KILL", &format!("-{}", pid)])
            .output();

        // Also try killing the process directly
        let _ = Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .output();

        thread::sleep(Duration::from_millis(100));
    }

    // Use pkill as a fallback to kill any children that might have escaped
    let _ = Command::new("pkill")
        .args(["-KILL", "-P", &pid.to_string()])
        .output();

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_shell_honours_explicit_command_line() {
        let (program, args) = resolve_shell(Some("  /usr/bin/fish --login  "));
        assert_eq!(program, "/usr/bin/fish");
        assert_eq!(args, vec!["--login".to_string()]);
    }

    #[test]
    fn resolve_shell_falls_back_when_explicit_is_blank() {
        let (program, _) = resolve_shell(Some("   "));
        assert!(!program.is_empty());
    }

    #[test]
    fn build_shell_command_sets_terminal_env_and_cwd() {
        let mut env = HashMap::new();
        env.insert("FOO".to_string(), "bar".to_string());
        let cmd = build_shell_command("echo hi", ".", "service:test", Some(&env));
        assert_eq!(cmd.get_env("CORTX_TERMINAL_ID").unwrap(), "service:test");
        assert_eq!(cmd.get_env("TERM").unwrap(), "xterm-256color");
        assert_eq!(cmd.get_env("FOO").unwrap(), "bar");
        assert_eq!(cmd.get_cwd().unwrap(), ".");
    }
}

/// End-to-end: spawn a real process in a real PTY on this machine and check
/// the three outputs (raw hub scrollback, de-ANSI'd line events, log file).
#[cfg(test)]
mod pty_integration_tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    #[derive(Default)]
    struct RecordingEmitter {
        script_lines: StdMutex<Vec<String>>,
        script_exits: StdMutex<Vec<(Option<i32>, bool)>>,
        shell_exits: StdMutex<Vec<Option<i32>>>,
    }

    impl ProcessEventEmitter for RecordingEmitter {
        fn emit_service_log(&self, _: &str, _: LogStream, _: String) {}
        fn emit_service_status(&self, _: &str, _: ServiceStatus, _: Option<u32>, _: Option<String>, _: Option<String>) {}
        fn emit_service_exit(&self, _: &str, _: Option<i32>) {}
        fn emit_script_log(&self, _: &str, _: LogStream, content: String) {
            self.script_lines.lock().unwrap().push(content);
        }
        fn emit_script_status(&self, _: &str, _: ScriptStatus, _: Option<u32>) {}
        fn emit_script_exit(&self, _: &str, exit_code: Option<i32>, success: bool) {
            self.script_exits.lock().unwrap().push((exit_code, success));
        }
        fn emit_global_script_log(&self, _: &str, _: LogStream, _: String) {}
        fn emit_global_script_status(&self, _: &str, _: ScriptStatus, _: Option<u32>) {}
        fn emit_global_script_exit(&self, _: &str, _: Option<i32>, _: bool) {}
        fn emit_shell_exit(&self, _: &str, exit_code: Option<i32>) {
            self.shell_exits.lock().unwrap().push(exit_code);
        }
    }

    fn wait_until(timeout: Duration, mut cond: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if cond() {
                return true;
            }
            thread::sleep(Duration::from_millis(50));
        }
        cond()
    }

    #[test]
    fn script_runs_in_a_pty_and_feeds_hub_lines_and_log_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(RuntimeStore::new(dir.path()).unwrap());
        let pm = ProcessManager::new(store.clone());
        let emitter = Arc::new(RecordingEmitter::default());

        let pid = pm
            .run_script(
                emitter.clone(),
                "script-1".to_string(),
                dir.path().to_string_lossy().into_owned(),
                "echo hello-from-pty".to_string(),
                RuntimeMeta::new("test"),
            )
            .expect("spawn in pty");
        assert!(pid > 0);

        assert!(
            wait_until(Duration::from_secs(15), || !emitter.script_exits.lock().unwrap().is_empty()),
            "script never reported exit"
        );
        let (code, success) = emitter.script_exits.lock().unwrap()[0];
        assert_eq!(code, Some(0));
        assert!(success);

        // Raw bytes reached the hub under the canonical terminal id...
        let tid = terminal_id(TerminalKind::Script, "script-1");
        assert!(
            wait_until(Duration::from_secs(5), || String::from_utf8_lossy(&pm.terminal_hub().scrollback(&tid)).contains("hello-from-pty")),
            "hub scrollback: {:?}",
            String::from_utf8_lossy(&pm.terminal_hub().scrollback(&tid))
        );
        // ...the line splitter produced a clean line for the TUI / MCP...
        assert!(
            wait_until(Duration::from_secs(5), || emitter.script_lines.lock().unwrap().iter().any(|l| l.trim() == "hello-from-pty")),
            "lines: {:?}",
            emitter.script_lines.lock().unwrap()
        );
        // ...and the on-disk log has it too, without escape sequences.
        let log = std::fs::read_to_string(store.log_path("script-1")).unwrap();
        assert!(log.contains("hello-from-pty"), "log: {log:?}");
        assert!(!log.contains('\x1b'), "log has escapes: {log:?}");

        // The PTY is closed once the process is gone.
        assert!(wait_until(Duration::from_secs(5), || !pm.has_terminal(&tid)));
        assert!(!pm.is_script_running("script-1"));
        pm.stop_all();
    }

    #[test]
    fn shell_accepts_input_and_dies_on_kill() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(RuntimeStore::new(dir.path()).unwrap());
        let pm = ProcessManager::new(store);
        let emitter = Arc::new(RecordingEmitter::default());

        // A plain `cmd` / `sh` is the most portable interactive shell.
        let shell = if cfg!(windows) { "cmd.exe" } else { "sh" };
        let info = pm
            .spawn_shell(
                emitter.clone(),
                ShellSpawnRequest {
                    cwd: dir.path().to_string_lossy().into_owned(),
                    project_id: None,
                    shell: Some(shell.to_string()),
                    cols: 100,
                    rows: 30,
                    restore_from: None,
                    integration: None,
                },
            )
            .expect("spawn shell");
        let tid = terminal_id(TerminalKind::Shell, &info.id);
        assert!(pm.has_terminal(&tid));
        assert_eq!(pm.list_shells().len(), 1);

        pm.write_terminal(&tid, b"echo marker-42\r\n").unwrap();
        assert!(
            wait_until(Duration::from_secs(15), || {
                // The echoed command line also contains the marker; require the
                // output line itself (a whole line, once titles/colours are gone).
                let out = crate::terminal::strip_ansi(&String::from_utf8_lossy(&pm.terminal_hub().scrollback(&tid)));
                out.lines().any(|l| l.trim() == "marker-42")
            }),
            "scrollback: {:?}",
            String::from_utf8_lossy(&pm.terminal_hub().scrollback(&tid))
        );
        pm.resize_terminal(&tid, 80, 24).unwrap();

        pm.kill_shell(&*emitter, &info.id).unwrap();
        assert!(!pm.has_terminal(&tid));
        assert!(pm.list_shells().is_empty());
        assert_eq!(emitter.shell_exits.lock().unwrap().len(), 1);
        assert!(pm.write_terminal(&tid, b"x").is_err());
        pm.stop_all();
    }
}

/// Windows-only probe: does the ConPTY in use pass an iTerm2 OSC 1337 image
/// sequence through unchanged? (The inbox conhost drops it; the sideloaded
/// Windows Terminal `conpty.dll` keeps it.) Ignored by default because the
/// answer depends on which DLL sits next to the test binary.
#[cfg(all(test, target_os = "windows"))]
mod conpty_passthrough_probe {
    use super::*;

    #[test]
    #[ignore]
    fn osc_1337_survives_conpty() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(RuntimeStore::new(dir.path()).unwrap());
        let pm = ProcessManager::new(store);
        struct Nop;
        impl ProcessEventEmitter for Nop {
            fn emit_service_log(&self, _: &str, _: LogStream, _: String) {}
            fn emit_service_status(&self, _: &str, _: ServiceStatus, _: Option<u32>, _: Option<String>, _: Option<String>) {}
            fn emit_service_exit(&self, _: &str, _: Option<i32>) {}
            fn emit_script_log(&self, _: &str, _: LogStream, _: String) {}
            fn emit_script_status(&self, _: &str, _: ScriptStatus, _: Option<u32>) {}
            fn emit_script_exit(&self, _: &str, _: Option<i32>, _: bool) {}
            fn emit_global_script_log(&self, _: &str, _: LogStream, _: String) {}
            fn emit_global_script_status(&self, _: &str, _: ScriptStatus, _: Option<u32>) {}
            fn emit_global_script_exit(&self, _: &str, _: Option<i32>, _: bool) {}
        }
        // Quoting through `cmd /C` is hopeless; use a script file instead.
        let script = dir.path().join("probe.ps1");
        std::fs::write(
            &script,
            // Windows PowerShell 5.1 has no `e escape; build ESC from its code.
            "$e=[char]27
[Console]::Write(\"$e]1337;File=inline=1:AAAA`a\")
[Console]::Write(\"${e}Pq#0;2;0;0;0#0~~@@vv@@~~@@~~-$e\\\")
'done'
",
        )
        .unwrap();
        pm.run_global_script(
            Arc::new(Nop),
            "probe".into(),
            dir.path().to_string_lossy().into_owned(),
            "powershell".into(),
            vec!["-NoProfile".into(), "-ExecutionPolicy".into(), "Bypass".into(), "-File".into(), script.to_string_lossy().into_owned()],
            None,
            RuntimeMeta::new("p"),
        )
        .unwrap();
        let tid = terminal_id(TerminalKind::GlobalScript, "probe");
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline && pm.has_terminal(&tid) {
            thread::sleep(Duration::from_millis(100));
        }
        let out = String::from_utf8_lossy(&pm.terminal_hub().scrollback(&tid)).into_owned();
        eprintln!("PROBE OUTPUT: {:?}", out);
        eprintln!("OSC1337 passed: {}", out.contains("1337;File=inline=1:AAAA"));
        eprintln!("SIXEL passed: {}", out.contains("\x1bPq"));
        assert!(out.contains("done"));
    }
}
