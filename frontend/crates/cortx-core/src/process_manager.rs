use crate::models::{LogStream, ScriptStatus, ServiceStatus};
use crate::runtime_state::{
    self, EntityKind, RuntimeEntry, RuntimeStore,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write as IoWrite};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

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

/// Apply platform-specific spawn config that must be set on every spawned process:
/// - Windows: hide the console window (CREATE_NO_WINDOW).
/// - Unix:   put the child in its own process group so `kill -PGID` reaches the
///           whole tree (the shell wrapper from `parse_command` and any descendants).
fn apply_spawn_flags(cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
}

/// Trait for emitting process events.
/// Implemented by TauriEmitter (GUI) and TuiEmitter (TUI).
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
}

pub struct ProcessInfo {
    pub child: Child,
    pub service_id: String,
    pub pid: u32,
    pub active_mode: Option<String>,
    pub active_arg_preset: Option<String>,
}

pub struct ProcessManager {
    /// Local Child handles for processes WE spawned, used for `.try_wait()` and
    /// `.kill()`. Authoritative process metadata (PID, started_at, mode, ...)
    /// lives in `runtime_store` so other CortX instances can see them.
    processes: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    scripts: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    global_scripts: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    shutdown_flag: Arc<AtomicBool>,
    runtime_store: Arc<RuntimeStore>,
}

impl ProcessManager {
    pub fn new(runtime_store: Arc<RuntimeStore>) -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            scripts: Arc::new(Mutex::new(HashMap::new())),
            global_scripts: Arc::new(Mutex::new(HashMap::new())),
            shutdown_flag: Arc::new(AtomicBool::new(false)),
            runtime_store,
        }
    }

    /// Borrow the underlying RuntimeStore (e.g. for `cortx ps` queries from
    /// the same process, or for MCP `list_running_processes`).
    pub fn runtime_store(&self) -> &Arc<RuntimeStore> {
        &self.runtime_store
    }

    /// Get a clone of the shutdown flag for monitoring threads
    pub fn get_shutdown_flag(&self) -> Arc<AtomicBool> {
        self.shutdown_flag.clone()
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

        // Emit starting status
        emitter.emit_service_status(
            &service_id,
            ServiceStatus::Starting,
            None,
            mode.clone(),
            arg_preset.clone(),
        );

        // Parse command
        let (program, args) = parse_command(&command);

        // Build command
        let mut cmd = Command::new(&program);
        cmd.args(&args)
            .current_dir(&working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Force UTF-8 output on Windows to avoid cp1252 encoding errors
        #[cfg(target_os = "windows")]
        {
            cmd.env("PYTHONUTF8", "1");
            cmd.env("PYTHONIOENCODING", "utf-8");
        }

        // Set environment variables
        if let Some(env) = env_vars {
            for (key, value) in env {
                cmd.env(key, value);
            }
        }

        apply_spawn_flags(&mut cmd);

        // Spawn the process
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start process: {}", e))?;

        let pid = child.id();

        // Set up stdout/stderr readers
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let log_path = self.runtime_store.log_path(&service_id);

        // Spawn thread to read stdout (tee → log file + emitter)
        if let Some(stdout) = stdout {
            spawn_tee_reader(
                stdout,
                log_path.clone(),
                emitter.clone(),
                service_id.clone(),
                LogStream::Stdout,
                LogTarget::Service,
            );
        }

        // Spawn thread to read stderr
        if let Some(stderr) = stderr {
            spawn_tee_reader(
                stderr,
                log_path.clone(),
                emitter.clone(),
                service_id.clone(),
                LogStream::Stderr,
                LogTarget::Service,
            );
        }

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

        // Store the process
        {
            let mut processes = self.processes.lock();
            processes.insert(
                service_id.clone(),
                ProcessInfo {
                    child,
                    service_id: service_id.clone(),
                    pid,
                    active_mode: mode.clone(),
                    active_arg_preset: arg_preset.clone(),
                },
            );
        }

        // Emit running status
        emitter.emit_service_status(
            &service_id,
            ServiceStatus::Running,
            Some(pid),
            mode.clone(),
            arg_preset.clone(),
        );

        // Spawn port poller — queries the OS for TCP ports the service (and its
        // descendants) are listening on, emits when the set changes. Fast cadence
        // for the first 15 seconds (catch services that bind shortly after spawn),
        // then slower cadence (catch rebinds / late-bound ports without burning CPU).
        {
            let processes_pp = self.processes.clone();
            let shutdown_pp = self.shutdown_flag.clone();
            let emitter_pp = emitter.clone();
            let service_id_pp = service_id.clone();
            thread::spawn(move || {
                let start = std::time::Instant::now();
                let mut last_ports: Vec<u16> = Vec::new();
                let mut emitted_at_least_once = false;
                loop {
                    if shutdown_pp.load(Ordering::SeqCst) {
                        break;
                    }

                    // If the service is gone from the processes map, the wait-thread
                    // already cleaned up — exit silently and emit empty ports below.
                    let pid_opt = {
                        let processes = processes_pp.lock();
                        processes.get(&service_id_pp).map(|p| p.pid)
                    };
                    let Some(pid) = pid_opt else {
                        break;
                    };

                    let ports = crate::port_detector::get_listening_ports_for_pid_tree(pid)
                        .unwrap_or_default();

                    if !emitted_at_least_once || ports != last_ports {
                        emitter_pp.emit_service_ports(&service_id_pp, ports.clone());
                        last_ports = ports;
                        emitted_at_least_once = true;
                    }

                    let elapsed_secs = start.elapsed().as_secs();
                    let interval_ms = if elapsed_secs < 15 { 1500 } else { 5000 };
                    thread::sleep(std::time::Duration::from_millis(interval_ms));
                }
                // Service is no longer running — emit an empty port list to clear UI.
                if !shutdown_pp.load(Ordering::SeqCst) {
                    emitter_pp.emit_service_ports(&service_id_pp, Vec::new());
                }
            });
        }

        // Spawn thread to wait for process exit
        let processes = self.processes.clone();
        let shutdown_flag = self.shutdown_flag.clone();
        let service_id_exit = service_id.clone();
        let exit_mode = mode.clone();
        let exit_arg_preset = arg_preset.clone();
        let runtime_store = self.runtime_store.clone();
        thread::spawn(move || {
            loop {
                if shutdown_flag.load(Ordering::SeqCst) {
                    break;
                }

                thread::sleep(std::time::Duration::from_millis(100));

                let mut should_remove = false;
                let mut exit_code = None;

                {
                    let mut processes_guard = processes.lock();
                    if let Some(info) = processes_guard.get_mut(&service_id_exit) {
                        match info.child.try_wait() {
                            Ok(Some(status)) => {
                                exit_code = status.code();
                                should_remove = true;
                            }
                            Ok(None) => {
                                // Still running
                            }
                            Err(_) => {
                                should_remove = true;
                            }
                        }
                    } else {
                        // Process was removed (stopped manually or during shutdown)
                        break;
                    }
                }

                if should_remove {
                    {
                        let mut processes_guard = processes.lock();
                        processes_guard.remove(&service_id_exit);
                    }
                    let _ = runtime_store.unregister(&service_id_exit);

                    // Don't emit events during shutdown
                    if !shutdown_flag.load(Ordering::SeqCst) {
                        emitter.emit_service_status(
                            &service_id_exit,
                            ServiceStatus::Stopped,
                            None,
                            exit_mode.clone(),
                            exit_arg_preset.clone(),
                        );

                        emitter.emit_service_exit(&service_id_exit, exit_code);
                    }

                    break;
                }
            }
        });

        Ok(pid)
    }

    pub fn stop_service(
        &self,
        emitter: &dyn ProcessEventEmitter,
        service_id: &str,
    ) -> Result<(), String> {
        // First, try the in-memory path (we spawned this process).
        let owned = {
            let mut processes = self.processes.lock();
            processes.remove(service_id)
        };

        let (stopped_mode, stopped_arg_preset) = if let Some(mut info) = owned {
            let mode = info.active_mode.clone();
            let preset = info.active_arg_preset.clone();
            let _ = kill_process_tree(info.pid);
            let _ = info.child.kill();
            let _ = info.child.wait();
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

        // Emit running status
        emitter.emit_script_status(&script_id, ScriptStatus::Running, None);

        // Parse command
        let (program, args) = parse_command(&command);

        // Build command
        let mut cmd = Command::new(&program);
        cmd.args(&args)
            .current_dir(&working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Force UTF-8 output on Windows to avoid cp1252 encoding errors
        #[cfg(target_os = "windows")]
        {
            cmd.env("PYTHONUTF8", "1");
            cmd.env("PYTHONIOENCODING", "utf-8");
        }

        apply_spawn_flags(&mut cmd);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start script: {}", e))?;

        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let log_path = self.runtime_store.log_path(&script_id);

        if let Some(stdout) = stdout {
            spawn_tee_reader(
                stdout,
                log_path.clone(),
                emitter.clone(),
                script_id.clone(),
                LogStream::Stdout,
                LogTarget::ProjectScript,
            );
        }
        if let Some(stderr) = stderr {
            spawn_tee_reader(
                stderr,
                log_path.clone(),
                emitter.clone(),
                script_id.clone(),
                LogStream::Stderr,
                LogTarget::ProjectScript,
            );
        }

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

        // Store the process
        {
            let mut scripts = self.scripts.lock();
            scripts.insert(
                script_id.clone(),
                ProcessInfo {
                    child,
                    service_id: script_id.clone(),
                    pid,
                    active_mode: None,
                    active_arg_preset: None,
                },
            );
        }

        // Update status with PID
        emitter.emit_script_status(&script_id, ScriptStatus::Running, Some(pid));

        // Spawn exit watcher
        let scripts = self.scripts.clone();
        let shutdown_flag = self.shutdown_flag.clone();
        let script_id_exit = script_id.clone();
        let runtime_store = self.runtime_store.clone();
        thread::spawn(move || {
            loop {
                if shutdown_flag.load(Ordering::SeqCst) {
                    break;
                }

                thread::sleep(std::time::Duration::from_millis(100));

                let mut should_remove = false;
                let mut exit_code = None;

                {
                    let mut scripts_guard = scripts.lock();
                    if let Some(info) = scripts_guard.get_mut(&script_id_exit) {
                        match info.child.try_wait() {
                            Ok(Some(status)) => {
                                exit_code = status.code();
                                should_remove = true;
                            }
                            Ok(None) => {}
                            Err(_) => {
                                should_remove = true;
                            }
                        }
                    } else {
                        break;
                    }
                }

                if should_remove {
                    {
                        let mut scripts_guard = scripts.lock();
                        scripts_guard.remove(&script_id_exit);
                    }
                    let _ = runtime_store.unregister(&script_id_exit);

                    if !shutdown_flag.load(Ordering::SeqCst) {
                        let success = exit_code.map(|c| c == 0).unwrap_or(false);

                        emitter.emit_script_status(
                            &script_id_exit,
                            if success {
                                ScriptStatus::Completed
                            } else {
                                ScriptStatus::Failed
                            },
                            None,
                        );

                        emitter.emit_script_exit(&script_id_exit, exit_code, success);
                    }

                    break;
                }
            }
        });

        Ok(pid)
    }

    pub fn stop_script(
        &self,
        emitter: &dyn ProcessEventEmitter,
        script_id: &str,
    ) -> Result<(), String> {
        let owned = {
            let mut scripts = self.scripts.lock();
            scripts.remove(script_id)
        };

        if let Some(mut info) = owned {
            let _ = kill_process_tree(info.pid);
            let _ = info.child.kill();
            let _ = info.child.wait();
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

        let mut cmd = Command::new(&program);
        cmd.args(&args)
            .current_dir(&working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

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

        apply_spawn_flags(&mut cmd);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start global script: {}", e))?;

        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let log_path = self.runtime_store.log_path(&script_id);

        if let Some(stdout) = stdout {
            spawn_tee_reader(
                stdout,
                log_path.clone(),
                emitter.clone(),
                script_id.clone(),
                LogStream::Stdout,
                LogTarget::GlobalScript,
            );
        }
        if let Some(stderr) = stderr {
            spawn_tee_reader(
                stderr,
                log_path.clone(),
                emitter.clone(),
                script_id.clone(),
                LogStream::Stderr,
                LogTarget::GlobalScript,
            );
        }

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

        {
            let mut global = self.global_scripts.lock();
            global.insert(
                script_id.clone(),
                ProcessInfo {
                    child,
                    service_id: script_id.clone(),
                    pid,
                    active_mode: None,
                    active_arg_preset: None,
                },
            );
        }

        emitter.emit_global_script_status(&script_id, ScriptStatus::Running, Some(pid));

        let global = self.global_scripts.clone();
        let shutdown_flag = self.shutdown_flag.clone();
        let script_id_exit = script_id.clone();
        let runtime_store = self.runtime_store.clone();
        thread::spawn(move || {
            loop {
                if shutdown_flag.load(Ordering::SeqCst) {
                    break;
                }

                thread::sleep(std::time::Duration::from_millis(100));

                let mut should_remove = false;
                let mut exit_code = None;

                {
                    let mut global_guard = global.lock();
                    if let Some(info) = global_guard.get_mut(&script_id_exit) {
                        match info.child.try_wait() {
                            Ok(Some(status)) => {
                                exit_code = status.code();
                                should_remove = true;
                            }
                            Ok(None) => {}
                            Err(_) => {
                                should_remove = true;
                            }
                        }
                    } else {
                        break;
                    }
                }

                if should_remove {
                    {
                        let mut global_guard = global.lock();
                        global_guard.remove(&script_id_exit);
                    }
                    let _ = runtime_store.unregister(&script_id_exit);

                    if !shutdown_flag.load(Ordering::SeqCst) {
                        let success = exit_code.map(|c| c == 0).unwrap_or(false);

                        emitter.emit_global_script_status(
                            &script_id_exit,
                            if success {
                                ScriptStatus::Completed
                            } else {
                                ScriptStatus::Failed
                            },
                            None,
                        );

                        emitter.emit_global_script_exit(&script_id_exit, exit_code, success);
                    }

                    break;
                }
            }
        });

        Ok(pid)
    }

    pub fn stop_global_script(
        &self,
        emitter: &dyn ProcessEventEmitter,
        script_id: &str,
    ) -> Result<(), String> {
        let owned = {
            let mut global = self.global_scripts.lock();
            global.remove(script_id)
        };

        if let Some(mut info) = owned {
            let _ = kill_process_tree(info.pid);
            let _ = info.child.kill();
            let _ = info.child.wait();
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
    // Shutdown
    // ========================================================================

    pub fn stop_all(&self) {
        // Set shutdown flag to stop monitoring threads
        self.shutdown_flag.store(true, Ordering::SeqCst);

        // Give monitoring threads a moment to see the flag
        thread::sleep(std::time::Duration::from_millis(50));

        // Collect all processes to kill
        let processes_to_kill: Vec<(String, u32)> = {
            let processes = self.processes.lock();
            processes
                .iter()
                .map(|(id, info)| (id.clone(), info.pid))
                .collect()
        };

        let scripts_to_kill: Vec<(String, u32)> = {
            let scripts = self.scripts.lock();
            scripts
                .iter()
                .map(|(id, info)| (id.clone(), info.pid))
                .collect()
        };

        let global_scripts_to_kill: Vec<(String, u32)> = {
            let global = self.global_scripts.lock();
            global
                .iter()
                .map(|(id, info)| (id.clone(), info.pid))
                .collect()
        };

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

        // Kill all service processes
        for (service_id, pid) in &processes_to_kill {
            log::info!("Stopping service {} (PID: {})", service_id, pid);
            if let Err(e) = kill_process_tree_robust(*pid) {
                log::error!("Failed to kill process tree for PID {}: {}", pid, e);
            }
        }

        // Kill all script processes
        for (script_id, pid) in &scripts_to_kill {
            log::info!("Stopping script {} (PID: {})", script_id, pid);
            if let Err(e) = kill_process_tree_robust(*pid) {
                log::error!("Failed to kill script process tree for PID {}: {}", pid, e);
            }
        }

        // Kill all global script processes
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

        // Drain and cleanup child handles
        {
            let mut processes = self.processes.lock();
            for (_, mut info) in processes.drain() {
                let _ = info.child.kill();
                let _ = info.child.wait();
            }
        }

        {
            let mut scripts = self.scripts.lock();
            for (_, mut info) in scripts.drain() {
                let _ = info.child.kill();
                let _ = info.child.wait();
            }
        }

        {
            let mut global = self.global_scripts.lock();
            for (_, mut info) in global.drain() {
                let _ = info.child.kill();
                let _ = info.child.wait();
            }
        }

        // Final verification - try to kill any remaining processes
        for (_, pid) in &processes_to_kill {
            let _ = kill_process_tree_robust(*pid);
        }
        for (_, pid) in &scripts_to_kill {
            let _ = kill_process_tree_robust(*pid);
        }
        for (_, pid) in &global_scripts_to_kill {
            let _ = kill_process_tree_robust(*pid);
        }

        log::info!("All services and scripts stopped");
    }

    /// Check if any processes are still running
    pub fn has_running_processes(&self) -> bool {
        let processes = self.processes.lock();
        let scripts = self.scripts.lock();
        let global = self.global_scripts.lock();
        !processes.is_empty() || !scripts.is_empty() || !global.is_empty()
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
    thread::sleep(std::time::Duration::from_millis(100));

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
            thread::sleep(std::time::Duration::from_millis(200));

            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(0x08000000)
                .output();

            thread::sleep(std::time::Duration::from_millis(100));
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
    // Try to kill the process group
    let _ = Command::new("kill")
        .args(["-TERM", &format!("-{}", pid)])
        .output();

    // Give it a moment, then force kill
    thread::sleep(std::time::Duration::from_millis(100));

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

    thread::sleep(std::time::Duration::from_millis(100));

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

        thread::sleep(std::time::Duration::from_millis(100));
    }

    // Use pkill as a fallback to kill any children that might have escaped
    let _ = Command::new("pkill")
        .args(["-KILL", "-P", &pid.to_string()])
        .output();

    Ok(())
}

// ============================================================================
// Tee reader: write each child output line to the log file AND emit it via
// the emitter for live UI consumers. Two writers (stdout + stderr threads)
// each hold their own File handle so they don't share a Mutex.
// ============================================================================

#[derive(Clone, Copy)]
enum LogTarget {
    Service,
    ProjectScript,
    GlobalScript,
}

fn spawn_tee_reader<R: std::io::Read + Send + 'static>(
    source: R,
    log_path: PathBuf,
    emitter: Arc<dyn ProcessEventEmitter>,
    id: String,
    stream: LogStream,
    target: LogTarget,
) {
    thread::spawn(move || {
        let mut log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .ok();
        let reader = BufReader::new(source);
        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => continue,
            };
            if let Some(file) = log.as_mut() {
                let _ = writeln!(file, "{}", line);
            }
            match target {
                LogTarget::Service => emitter.emit_service_log(&id, stream.clone(), line),
                LogTarget::ProjectScript => emitter.emit_script_log(&id, stream.clone(), line),
                LogTarget::GlobalScript => {
                    emitter.emit_global_script_log(&id, stream.clone(), line)
                }
            }
        }
    });
}

// ============================================================================
// Command parsing
// ============================================================================

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

