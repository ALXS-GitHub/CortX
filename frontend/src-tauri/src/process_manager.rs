use crate::models::{
    LogStream, ScriptExitPayload, ScriptLogPayload, ScriptStatus, ScriptStatusPayload,
    ServiceExitPayload, ServiceLogPayload, ServiceStatus, ServiceStatusPayload,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub struct ProcessInfo {
    pub child: Child,
    pub service_id: String,
    pub pid: u32,
}

pub struct ProcessManager {
    processes: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    scripts: Arc<Mutex<HashMap<String, ProcessInfo>>>,
    shutdown_flag: Arc<AtomicBool>,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            scripts: Arc::new(Mutex::new(HashMap::new())),
            shutdown_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Get a clone of the shutdown flag for monitoring threads
    pub fn get_shutdown_flag(&self) -> Arc<AtomicBool> {
        self.shutdown_flag.clone()
    }

    pub fn start_service(
        &self,
        app_handle: AppHandle,
        service_id: String,
        working_dir: String,
        command: String,
        env_vars: Option<HashMap<String, String>>,
    ) -> Result<u32, String> {
        // Check if already running
        {
            let processes = self.processes.lock();
            if processes.contains_key(&service_id) {
                return Err("Service is already running".to_string());
            }
        }

        // Emit starting status
        let _ = app_handle.emit(
            "service-status",
            ServiceStatusPayload {
                service_id: service_id.clone(),
                status: ServiceStatus::Starting,
                pid: None,
            },
        );

        // Parse command
        let (program, args) = parse_command(&command);

        // Build command
        let mut cmd = Command::new(&program);
        cmd.args(&args)
            .current_dir(&working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

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
        let mut child = cmd.spawn().map_err(|e| format!("Failed to start process: {}", e))?;

        let pid = child.id();

        // Set up stdout reader
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let service_id_clone = service_id.clone();
        let app_handle_clone = app_handle.clone();

        // Spawn thread to read stdout
        if let Some(stdout) = stdout {
            let service_id = service_id_clone.clone();
            let app_handle = app_handle_clone.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let _ = app_handle.emit(
                            "service-log",
                            ServiceLogPayload {
                                service_id: service_id.clone(),
                                stream: LogStream::Stdout,
                                content: line,
                            },
                        );
                    }
                }
            });
        }

        // Spawn thread to read stderr
        if let Some(stderr) = stderr {
            let service_id = service_id_clone.clone();
            let app_handle = app_handle_clone.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let _ = app_handle.emit(
                            "service-log",
                            ServiceLogPayload {
                                service_id: service_id.clone(),
                                stream: LogStream::Stderr,
                                content: line,
                            },
                        );
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
                },
            );
        }

        // Emit running status
        let _ = app_handle.emit(
            "service-status",
            ServiceStatusPayload {
                service_id: service_id.clone(),
                status: ServiceStatus::Running,
                pid: Some(pid),
            },
        );

        // Spawn thread to wait for process exit
        let processes = self.processes.clone();
        let shutdown_flag = self.shutdown_flag.clone();
        let service_id_exit = service_id.clone();
        thread::spawn(move || {
            // Wait for the process to exit
            loop {
                // Check shutdown flag first
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
                        let _ = app_handle.emit(
                            "service-status",
                            ServiceStatusPayload {
                                service_id: service_id_exit.clone(),
                                status: ServiceStatus::Stopped,
                                pid: None,
                            },
                        );

                        let _ = app_handle.emit(
                            "service-exit",
                            ServiceExitPayload {
                                service_id: service_id_exit.clone(),
                                exit_code,
                            },
                        );
                    }

                    break;
                }
            }
        });

        Ok(pid)
    }

    pub fn stop_service(&self, app_handle: &AppHandle, service_id: &str) -> Result<(), String> {
        let mut processes = self.processes.lock();

        if let Some(mut info) = processes.remove(service_id) {
            // Kill the entire process tree (including child processes)
            let _ = kill_process_tree(info.pid);
            // Also try to kill and wait on the child handle for cleanup
            let _ = info.child.kill();
            let _ = info.child.wait();

            // Emit stopped status to frontend
            let _ = app_handle.emit(
                "service-status",
                ServiceStatusPayload {
                    service_id: service_id.to_string(),
                    status: ServiceStatus::Stopped,
                    pid: None,
                },
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

    pub fn stop_all(&self) {
        // Set shutdown flag to stop monitoring threads
        self.shutdown_flag.store(true, Ordering::SeqCst);

        // Give monitoring threads a moment to see the flag
        thread::sleep(std::time::Duration::from_millis(50));

        // Collect all processes to kill (services)
        let processes_to_kill: Vec<(String, u32)> = {
            let processes = self.processes.lock();
            processes.iter().map(|(id, info)| (id.clone(), info.pid)).collect()
        };

        // Collect all scripts to kill
        let scripts_to_kill: Vec<(String, u32)> = {
            let scripts = self.scripts.lock();
            scripts.iter().map(|(id, info)| (id.clone(), info.pid)).collect()
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

        // Now drain and cleanup child handles for services
        {
            let mut processes = self.processes.lock();
            for (_, mut info) in processes.drain() {
                // Try to kill via child handle as backup
                let _ = info.child.kill();
                // Wait with timeout
                let _ = info.child.wait();
            }
        }

        // Drain and cleanup child handles for scripts
        {
            let mut scripts = self.scripts.lock();
            for (_, mut info) in scripts.drain() {
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

        log::info!("All services and scripts stopped");
    }

    /// Check if any processes are still running
    pub fn has_running_processes(&self) -> bool {
        let processes = self.processes.lock();
        let scripts = self.scripts.lock();
        !processes.is_empty() || !scripts.is_empty()
    }

    // Script execution methods

    pub fn run_script(
        &self,
        app_handle: AppHandle,
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
        let _ = app_handle.emit(
            "script-status",
            ScriptStatusPayload {
                script_id: script_id.clone(),
                status: ScriptStatus::Running,
                pid: None,
            },
        );

        // Parse command
        let (program, args) = parse_command(&command);

        // Build command
        let mut cmd = Command::new(&program);
        cmd.args(&args)
            .current_dir(&working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // On Windows, prevent console window from appearing
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        // Spawn the process
        let mut child = cmd.spawn().map_err(|e| format!("Failed to start script: {}", e))?;

        let pid = child.id();

        // Set up stdout reader
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let script_id_clone = script_id.clone();
        let app_handle_clone = app_handle.clone();

        // Spawn thread to read stdout
        if let Some(stdout) = stdout {
            let script_id = script_id_clone.clone();
            let app_handle = app_handle_clone.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let _ = app_handle.emit(
                            "script-log",
                            ScriptLogPayload {
                                script_id: script_id.clone(),
                                stream: LogStream::Stdout,
                                content: line,
                            },
                        );
                    }
                }
            });
        }

        // Spawn thread to read stderr
        if let Some(stderr) = stderr {
            let script_id = script_id_clone.clone();
            let app_handle = app_handle_clone.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let _ = app_handle.emit(
                            "script-log",
                            ScriptLogPayload {
                                script_id: script_id.clone(),
                                stream: LogStream::Stderr,
                                content: line,
                            },
                        );
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
                    service_id: script_id.clone(), // Reusing service_id field for script_id
                    pid,
                },
            );
        }

        // Update status with PID
        let _ = app_handle.emit(
            "script-status",
            ScriptStatusPayload {
                script_id: script_id.clone(),
                status: ScriptStatus::Running,
                pid: Some(pid),
            },
        );

        // Spawn thread to wait for script exit
        let scripts = self.scripts.clone();
        let shutdown_flag = self.shutdown_flag.clone();
        let script_id_exit = script_id.clone();
        thread::spawn(move || {
            // Wait for the process to exit
            loop {
                // Check shutdown flag first
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
                            Ok(None) => {
                                // Still running
                            }
                            Err(_) => {
                                should_remove = true;
                            }
                        }
                    } else {
                        // Script was removed (stopped manually or during shutdown)
                        break;
                    }
                }

                if should_remove {
                    {
                        let mut scripts_guard = scripts.lock();
                        scripts_guard.remove(&script_id_exit);
                    }

                    // Don't emit events during shutdown
                    if !shutdown_flag.load(Ordering::SeqCst) {
                        let success = exit_code.map(|c| c == 0).unwrap_or(false);

                        let _ = app_handle.emit(
                            "script-status",
                            ScriptStatusPayload {
                                script_id: script_id_exit.clone(),
                                status: if success { ScriptStatus::Completed } else { ScriptStatus::Failed },
                                pid: None,
                            },
                        );

                        let _ = app_handle.emit(
                            "script-exit",
                            ScriptExitPayload {
                                script_id: script_id_exit.clone(),
                                exit_code,
                                success,
                            },
                        );
                    }

                    break;
                }
            }
        });

        Ok(pid)
    }

    pub fn stop_script(&self, app_handle: &AppHandle, script_id: &str) -> Result<(), String> {
        let mut scripts = self.scripts.lock();

        if let Some(mut info) = scripts.remove(script_id) {
            // Kill the entire process tree (including child processes)
            let _ = kill_process_tree(info.pid);
            // Also try to kill and wait on the child handle for cleanup
            let _ = info.child.kill();
            let _ = info.child.wait();

            // Emit failed status (script was stopped, not completed)
            let _ = app_handle.emit(
                "script-status",
                ScriptStatusPayload {
                    script_id: script_id.to_string(),
                    status: ScriptStatus::Failed,
                    pid: None,
                },
            );

            Ok(())
        } else {
            Err("Script is not running".to_string())
        }
    }

    pub fn is_script_running(&self, script_id: &str) -> bool {
        let scripts = self.scripts.lock();
        scripts.contains_key(script_id)
    }
}

impl Drop for ProcessManager {
    fn drop(&mut self) {
        if !self.shutdown_flag.load(Ordering::SeqCst) {
            self.stop_all();
        }
    }
}

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
            log::warn!("Process {} still running after first kill attempt, retrying...", pid);
            thread::sleep(std::time::Duration::from_millis(200));

            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(0x08000000)
                .output();

            thread::sleep(std::time::Duration::from_millis(100));
        }
    }

    // Also try to kill by process name pattern (node.exe) as a fallback
    // This helps catch any orphaned node processes that might have been spawned
    let _ = Command::new("wmic")
        .args(["process", "where", &format!("ParentProcessId={}", pid), "delete"])
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
        log::warn!("Process {} still running after SIGTERM, sending SIGKILL...", pid);

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

fn parse_command(command: &str) -> (String, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        // On Windows, run through cmd
        ("cmd".to_string(), vec!["/C".to_string(), command.to_string()])
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On Unix, run through sh
        ("sh".to_string(), vec!["-c".to_string(), command.to_string()])
    }
}
