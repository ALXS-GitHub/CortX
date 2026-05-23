//! Persistent runtime state for CLI-managed processes.
//!
//! The CLI is a one-shot binary: it spawns a child detached, writes a state
//! file recording the PID + metadata, and exits. Subsequent CLI invocations
//! (`cortx ps`, `cortx service stop`, `cortx logs`, ...) read these files
//! to list, monitor, or terminate running processes.
//!
//! Layout under `<app_dir>/runtime/`:
//!   `<id>.json` — RuntimeEntry metadata (pid, command, start time, ...)
//!   `<id>.log`  — captured stdout + stderr, appended
//!
//! This store is independent from the in-memory ProcessManager used by the
//! MCP server / GUI / TUI. They keep `std::process::Child` handles in RAM
//! and stream output via event emitters; that model can't survive a CLI
//! exit, hence this separate filesystem-backed view.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityKind {
    Service,
    ProjectScript,
    GlobalScript,
}

impl EntityKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EntityKind::Service => "service",
            EntityKind::ProjectScript => "project_script",
            EntityKind::GlobalScript => "global_script",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEntry {
    /// Lookup key (also the filename stem). For entities backed by storage
    /// this is the entity UUID; for ad-hoc invocations the caller chooses.
    pub id: String,
    pub kind: EntityKind,
    pub pid: u32,
    pub display_name: String,
    pub command: String,
    pub working_dir: String,
    pub started_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arg_preset: Option<String>,
}

pub struct RuntimeStore {
    dir: PathBuf,
}

impl RuntimeStore {
    pub fn new(app_dir: &Path) -> std::io::Result<Self> {
        let dir = app_dir.join("runtime");
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn state_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{}.json", id))
    }

    pub fn log_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{}.log", id))
    }

    /// Atomic write: serialize to a `.tmp` file then rename into place.
    pub fn register(&self, entry: &RuntimeEntry) -> std::io::Result<()> {
        let path = self.state_path(&entry.id);
        let tmp = path.with_extension("json.tmp");
        let json = serde_json::to_string_pretty(entry)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        fs::write(&tmp, json)?;
        fs::rename(&tmp, &path)?;
        Ok(())
    }

    /// Remove the state file. The log file is kept for post-mortem inspection.
    pub fn unregister(&self, id: &str) -> std::io::Result<()> {
        let state = self.state_path(id);
        if state.exists() {
            fs::remove_file(&state)?;
        }
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<RuntimeEntry> {
        let content = fs::read_to_string(self.state_path(id)).ok()?;
        serde_json::from_str(&content).ok()
    }

    /// Return every parseable state file paired with a liveness check.
    pub fn list(&self) -> Vec<(RuntimeEntry, bool)> {
        let mut out = Vec::new();
        let read = match fs::read_dir(&self.dir) {
            Ok(r) => r,
            Err(_) => return out,
        };
        for entry in read.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(parsed) = serde_json::from_str::<RuntimeEntry>(&content) {
                    let alive = is_pid_alive(parsed.pid);
                    out.push((parsed, alive));
                }
            }
        }
        out
    }

    /// Delete state files whose PID is no longer alive. Returns the count
    /// removed.
    pub fn prune_stale(&self) -> usize {
        let mut pruned = 0;
        for (entry, alive) in self.list() {
            if !alive && self.unregister(&entry.id).is_ok() {
                pruned += 1;
            }
        }
        pruned
    }
}

/// Cross-platform liveness check for a PID.
pub fn is_pid_alive(pid: u32) -> bool {
    use sysinfo::{Pid, ProcessesToUpdate, System};
    let mut sys = System::new();
    let pid = Pid::from(pid as usize);
    sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), false);
    sys.process(pid).is_some()
}

/// Spawn `program args...` detached from the caller.
///
/// stdin is `/dev/null` (or the Windows equivalent); stdout and stderr are
/// appended to `log_path`. On Windows the child gets DETACHED_PROCESS +
/// CREATE_NEW_PROCESS_GROUP + CREATE_NO_WINDOW. On Unix the child calls
/// `setsid()` in `pre_exec`, becoming a session leader with no controlling
/// terminal — so a parent terminal hang-up will not SIGHUP it.
///
/// Returns the child PID on success.
pub fn spawn_detached(
    program: &str,
    args: &[String],
    working_dir: &str,
    env_vars: Option<&HashMap<String, String>>,
    log_path: &Path,
) -> std::io::Result<u32> {
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)?;
    let log_err = log.try_clone()?;

    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));

    #[cfg(target_os = "windows")]
    {
        cmd.env("PYTHONUTF8", "1");
        cmd.env("PYTHONIOENCODING", "utf-8");
    }

    if let Some(env) = env_vars {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    apply_detached_flags(&mut cmd);

    let child = cmd.spawn()?;
    Ok(child.id())
}

#[cfg(target_os = "windows")]
fn apply_detached_flags(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    // DETACHED_PROCESS (0x00000008) — child has no console
    // CREATE_NEW_PROCESS_GROUP (0x00000200) — own process group
    // CREATE_NO_WINDOW (0x08000000) — no console window flash
    cmd.creation_flags(0x00000008 | 0x00000200 | 0x08000000);
}

#[cfg(unix)]
fn apply_detached_flags(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        cmd.pre_exec(|| {
            // New session → no controlling terminal, immune to SIGHUP from
            // the calling shell. setsid() also creates a new process group
            // whose id equals the new session leader's pid, so `kill -PID`
            // (negative) reaches the whole tree.
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

/// Build the shell wrapper for an arbitrary command string, matching the
/// `ProcessManager::parse_command` convention used elsewhere. Returns
/// `(program, args)` suitable for [`spawn_detached`].
pub fn shell_wrap(command: &str) -> (String, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), command.to_string()],
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        (
            "sh".to_string(),
            vec!["-c".to_string(), command.to_string()],
        )
    }
}

/// Best-effort cross-platform kill of a PID *and its descendants*.
///
/// Mirrors `ProcessManager::kill_process_tree_robust` but stands alone
/// because the CLI has no `Child` handle to call `.kill()` on.
pub fn kill_pid_tree(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let output = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| format!("taskkill failed to launch: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.contains("not found") && !stderr.contains("No tasks") {
                return Err(format!("taskkill: {}", stderr.trim()));
            }
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Negative pid targets the process group created by setsid().
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{}", pid)])
            .output();
        std::thread::sleep(std::time::Duration::from_millis(100));
        if is_pid_alive(pid) {
            let _ = Command::new("kill")
                .args(["-KILL", &format!("-{}", pid)])
                .output();
            let _ = Command::new("kill")
                .args(["-KILL", &pid.to_string()])
                .output();
        }
        // Fallback in case the child changed its pgid.
        let _ = Command::new("pkill")
            .args(["-KILL", "-P", &pid.to_string()])
            .output();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample_entry(id: &str, pid: u32) -> RuntimeEntry {
        RuntimeEntry {
            id: id.to_string(),
            kind: EntityKind::Service,
            pid,
            display_name: "demo".into(),
            command: "echo hi".into(),
            working_dir: ".".into(),
            started_at: Utc::now(),
            project_id: None,
            project_name: None,
            mode: None,
            arg_preset: None,
        }
    }

    #[test]
    fn register_then_get_roundtrip() {
        let dir = TempDir::new().unwrap();
        let store = RuntimeStore::new(dir.path()).unwrap();
        let entry = sample_entry("abc", 1234);
        store.register(&entry).unwrap();
        let loaded = store.get("abc").unwrap();
        assert_eq!(loaded.id, "abc");
        assert_eq!(loaded.pid, 1234);
    }

    #[test]
    fn list_filters_to_json_files_and_reports_alive_flag() {
        let dir = TempDir::new().unwrap();
        let store = RuntimeStore::new(dir.path()).unwrap();
        store.register(&sample_entry("a", 1)).unwrap();
        store.register(&sample_entry("b", std::process::id())).unwrap();
        // Stray non-json file is ignored
        fs::write(store.dir().join("notes.txt"), "ignore me").unwrap();

        let listed = store.list();
        assert_eq!(listed.len(), 2);
        let by_id: HashMap<_, _> = listed.into_iter().map(|(e, a)| (e.id, a)).collect();
        // PID 1 might exist on some systems (init), but the entry for our
        // current process should always be alive.
        assert!(by_id.get("b").copied().unwrap_or(false));
    }

    #[test]
    fn prune_removes_dead_entries() {
        let dir = TempDir::new().unwrap();
        let store = RuntimeStore::new(dir.path()).unwrap();
        // Pick a PID we're confident is dead. u32::MAX is never assigned.
        store.register(&sample_entry("dead", u32::MAX - 1)).unwrap();
        store.register(&sample_entry("alive", std::process::id())).unwrap();
        let pruned = store.prune_stale();
        assert_eq!(pruned, 1);
        assert!(store.get("dead").is_none());
        assert!(store.get("alive").is_some());
    }

    #[test]
    fn current_process_is_alive() {
        assert!(is_pid_alive(std::process::id()));
    }
}
