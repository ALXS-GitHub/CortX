use crate::models::{LogStream, ServiceExitPayload, ServiceLogPayload, ServiceStatus, ServiceStatusPayload};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};

pub struct ProcessInfo {
    pub child: Child,
    pub service_id: String,
    pub pid: u32,
}

pub struct ProcessManager {
    processes: Arc<Mutex<HashMap<String, ProcessInfo>>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
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
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

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
        let service_id_exit = service_id.clone();
        thread::spawn(move || {
            // Wait for the process to exit
            loop {
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
                        // Process was removed (stopped manually)
                        break;
                    }
                }

                if should_remove {
                    {
                        let mut processes_guard = processes.lock();
                        processes_guard.remove(&service_id_exit);
                    }

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
        let mut processes = self.processes.lock();
        for (_, mut info) in processes.drain() {
            // Kill the entire process tree (including child processes)
            let _ = kill_process_tree(info.pid);
            // Also try to kill and wait on the child handle for cleanup
            let _ = info.child.kill();
            let _ = info.child.wait();
        }
    }
}

impl Drop for ProcessManager {
    fn drop(&mut self) {
        self.stop_all();
    }
}

/// Kill a process and all its child processes on Windows
#[cfg(target_os = "windows")]
fn kill_process_tree(pid: u32) -> Result<(), std::io::Error> {
    use std::os::windows::process::CommandExt;
    Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()?;
    Ok(())
}

/// Kill a process and all its child processes on Unix
#[cfg(not(target_os = "windows"))]
fn kill_process_tree(pid: u32) -> Result<(), std::io::Error> {
    // On Unix, we use negative PID to kill the process group
    // First try SIGTERM, then SIGKILL
    use std::process::Command;

    // Try to kill the process group
    let _ = Command::new("kill")
        .args(["-TERM", &format!("-{}", pid)])
        .output();

    // Give it a moment, then force kill
    std::thread::sleep(std::time::Duration::from_millis(100));

    let _ = Command::new("kill")
        .args(["-KILL", &format!("-{}", pid)])
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
