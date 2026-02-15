use crate::models::{LogStream, ScriptStatus, ServiceStatus};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

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
}

pub struct ProcessInfo {
    pub child: Child,
    pub service_id: String,
    pub pid: u32,
    pub active_mode: Option<String>,
    pub active_arg_preset: Option<String>,
}

pub struct ProcessManager {
    processes: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    scripts: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    global_scripts: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    shutdown_flag: Arc<AtomicBool>,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            scripts: Arc::new(Mutex::new(HashMap::new())),
            global_scripts: Arc::new(Mutex::new(HashMap::new())),
            shutdown_flag: Arc::new(AtomicBool::new(false)),
        }
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
    ) -> Result<u32, String> {
        // Check if already running
        {
            let processes = self.processes.lock();
            if processes.contains_key(&service_id) {
                return Err("Service is already running".to_string());
            }
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

        // On Windows, prevent console window from appearing
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        // Spawn the process
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start process: {}", e))?;

        let pid = child.id();

        // Set up stdout/stderr readers
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Spawn thread to read stdout
        if let Some(stdout) = stdout {
            let emitter = emitter.clone();
            let service_id = service_id.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        emitter.emit_service_log(&service_id, LogStream::Stdout, line);
                    }
                }
            });
        }

        // Spawn thread to read stderr
        if let Some(stderr) = stderr {
            let emitter = emitter.clone();
            let service_id = service_id.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        emitter.emit_service_log(&service_id, LogStream::Stderr, line);
                    }
                }
            });
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

        // Spawn thread to wait for process exit
        let processes = self.processes.clone();
        let shutdown_flag = self.shutdown_flag.clone();
        let service_id_exit = service_id.clone();
        let exit_mode = mode.clone();
        let exit_arg_preset = arg_preset.clone();
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
        let mut processes = self.processes.lock();

        if let Some(mut info) = processes.remove(service_id) {
            let stopped_mode = info.active_mode.clone();
            let stopped_arg_preset = info.active_arg_preset.clone();

            // Kill the entire process tree (including child processes)
            let _ = kill_process_tree(info.pid);
            // Also try to kill and wait on the child handle for cleanup
            let _ = info.child.kill();
            let _ = info.child.wait();

            // Emit stopped status
            emitter.emit_service_status(
                service_id,
                ServiceStatus::Stopped,
                None,
                stopped_mode,
                stopped_arg_preset,
            );

            Ok(())
        } else {
            Err("Service is not running".to_string())
        }
    }

    pub fn is_running(&self, service_id: &str) -> bool {
        let processes = self.processes.lock();
        processes.contains_key(service_id)
    }

    pub fn get_running_services(&self) -> Vec<String> {
        let processes = self.processes.lock();
        processes.keys().cloned().collect()
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
    ) -> Result<u32, String> {
        // Check if already running
        {
            let scripts = self.scripts.lock();
            if scripts.contains_key(&script_id) {
                return Err("Script is already running".to_string());
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

        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start script: {}", e))?;

        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Spawn stdout reader
        if let Some(stdout) = stdout {
            let emitter = emitter.clone();
            let script_id = script_id.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        emitter.emit_script_log(&script_id, LogStream::Stdout, line);
                    }
                }
            });
        }

        // Spawn stderr reader
        if let Some(stderr) = stderr {
            let emitter = emitter.clone();
            let script_id = script_id.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        emitter.emit_script_log(&script_id, LogStream::Stderr, line);
                    }
                }
            });
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
        let mut scripts = self.scripts.lock();

        if let Some(mut info) = scripts.remove(script_id) {
            let _ = kill_process_tree(info.pid);
            let _ = info.child.kill();
            let _ = info.child.wait();

            // Emit failed status (script was stopped, not completed)
            emitter.emit_script_status(script_id, ScriptStatus::Failed, None);

            Ok(())
        } else {
            Err("Script is not running".to_string())
        }
    }

    pub fn is_script_running(&self, script_id: &str) -> bool {
        let scripts = self.scripts.lock();
        scripts.contains_key(script_id)
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
    ) -> Result<u32, String> {
        // Check if already running
        {
            let global = self.global_scripts.lock();
            if global.contains_key(&script_id) {
                return Err("Global script is already running".to_string());
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

        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start global script: {}", e))?;

        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        if let Some(stdout) = stdout {
            let emitter = emitter.clone();
            let script_id = script_id.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        emitter.emit_global_script_log(&script_id, LogStream::Stdout, line);
                    }
                }
            });
        }

        if let Some(stderr) = stderr {
            let emitter = emitter.clone();
            let script_id = script_id.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        emitter.emit_global_script_log(&script_id, LogStream::Stderr, line);
                    }
                }
            });
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
        let mut global = self.global_scripts.lock();

        if let Some(mut info) = global.remove(script_id) {
            let _ = kill_process_tree(info.pid);
            let _ = info.child.kill();
            let _ = info.child.wait();

            emitter.emit_global_script_status(script_id, ScriptStatus::Failed, None);

            Ok(())
        } else {
            Err("Global script is not running".to_string())
        }
    }

    pub fn is_global_script_running(&self, script_id: &str) -> bool {
        let global = self.global_scripts.lock();
        global.contains_key(script_id)
    }

    // ========================================================================
    // Script Group Execution
    // ========================================================================

    /// Run a group of global scripts.
    /// In Parallel mode: all scripts are launched simultaneously.
    /// In Sequential mode: scripts are launched one by one, waiting for each to complete.
    /// If stop_on_failure is true (sequential only), stops on the first failure.
    /// Returns a list of (script_id, Result<pid, error>) for each script.
    pub fn run_script_group(
        &self,
        emitter: Arc<dyn ProcessEventEmitter>,
        scripts: Vec<(String, String, String, Vec<String>, Option<HashMap<String, String>>)>, // (id, working_dir, program, args, env_vars)
        sequential: bool,
        stop_on_failure: bool,
    ) -> Vec<(String, Result<u32, String>)> {
        let mut results = Vec::new();

        if sequential {
            for (script_id, working_dir, program, args, env_vars) in scripts {
                let pid_result = self.run_global_script(
                    emitter.clone(),
                    script_id.clone(),
                    working_dir,
                    program,
                    args,
                    env_vars,
                );

                let failed = pid_result.is_err();
                results.push((script_id.clone(), pid_result));

                if failed && stop_on_failure {
                    break;
                }

                if !failed {
                    // Wait for script to finish before launching next one
                    loop {
                        thread::sleep(std::time::Duration::from_millis(100));
                        if !self.is_global_script_running(&script_id) {
                            break;
                        }
                    }
                }
            }
        } else {
            // Parallel: launch all at once
            for (script_id, working_dir, program, args, env_vars) in scripts {
                let pid_result = self.run_global_script(
                    emitter.clone(),
                    script_id.clone(),
                    working_dir,
                    program,
                    args,
                    env_vars,
                );
                results.push((script_id, pid_result));
            }
        }

        results
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

