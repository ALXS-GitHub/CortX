//! Agents in GUI mode (ticket CORT-62).
//!
//! A pane in GUI mode does not run Claude Code's TUI: CortX starts Claude
//! Code itself the way the Claude Agent SDK (and so the Claude desktop app)
//! does — `claude --output-format stream-json --verbose --input-format
//! stream-json …`, pipes on stdin / stdout, no terminal. With stream-json
//! input the process stays up and reads one message per line, turn after
//! turn. (No `-p`: the SDK does not pass it either.)
//!
//! This module is only the pipe. Each line Claude Code writes on stdout (a
//! JSON message: system/init, stream_event deltas, assistant / user
//! messages, result, control_request for a permission…) is forwarded as is
//! to the frontend on the `agent-gui` event, and each line the frontend
//! hands to [`agent_gui_send`] is written to stdin. The protocol itself is
//! spoken by the frontend (`agent-view/streamJson.ts`), where it is tested.
//!
//! One process per pane, keyed by the pane's terminal id. Every start gets a
//! new `generation`, carried by its events, so a late line of a stopped
//! process never lands in the one that replaced it.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

/// The flags that make Claude Code speak stream-json on its pipes. The
/// command the user chose (`claude`, an alias shim like `cc`, a path) goes in
/// front; `--resume <id>` after.
/// The flags of the Agent SDK's own transport: stream-json both ways, the
/// answer as it is written (`--include-partial-messages`), permission
/// prompts sent to us as control requests (`--permission-prompt-tool stdio`).
const STREAM_JSON_FLAGS: &str =
    "--output-format stream-json --verbose --input-format stream-json --include-partial-messages --permission-prompt-tool stdio";

struct GuiProcess {
    generation: u64,
    pid: u32,
    child: Child,
    stdin: ChildStdin,
}

fn processes() -> &'static Mutex<HashMap<String, GuiProcess>> {
    static PROCS: OnceLock<Mutex<HashMap<String, GuiProcess>>> = OnceLock::new();
    PROCS.get_or_init(|| Mutex::new(HashMap::new()))
}

static GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentGuiEvent {
    key: String,
    generation: u64,
    /// One stdout line, parsed.
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<serde_json::Value>,
    /// A stdout line that is not JSON, or a stderr line.
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    /// The process is gone (its exit code when known).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    exited: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
}

/// Is this a session id (a UUID, as Claude Code makes them)? It goes on a
/// command line, so nothing else is accepted.
fn valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// The command line for a pane: the user's command, the stream-json flags,
/// and the session to resume.
pub fn command_line(command: &str, resume: Option<&str>) -> Result<String, String> {
    let base = command.trim();
    if base.is_empty() {
        return Err("No command to start the agent with".into());
    }
    let mut line = format!("{} {}", base, STREAM_JSON_FLAGS);
    if let Some(id) = resume.map(str::trim).filter(|s| !s.is_empty()) {
        if !valid_session_id(id) {
            return Err(format!("Not a session id: {}", id));
        }
        line.push_str(" --resume ");
        line.push_str(id);
    }
    Ok(line)
}

fn shell_command(line: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("cmd");
        cmd.args(["/D", "/S", "/C", line]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        // `exec`: the pid is the agent's own, not a shell's around it.
        let mut cmd = Command::new("sh");
        cmd.args(["-c", &format!("exec {}", line)]);
        cmd
    }
}

fn emit(app: &AppHandle, event: AgentGuiEvent) {
    let _ = app.emit("agent-gui", event);
}

/// Start the agent of a pane (stopping the one it had). Returns the
/// generation its events will carry.
#[tauri::command]
pub fn agent_gui_start(
    app: AppHandle,
    key: String,
    cwd: String,
    command: String,
    resume: Option<String>,
) -> Result<u64, String> {
    stop(&key);
    let line = command_line(&command, resume.as_deref())?;
    let mut cmd = shell_command(&line);
    if !cwd.trim().is_empty() {
        cmd.current_dir(&cwd);
    }
    // As in the terminals: whoever launched CortX must not make the agent
    // believe it is somebody's child session.
    for var in ["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT", "NODE_OPTIONS"] {
        cmd.env_remove(var);
    }
    // What the TypeScript Agent SDK sets: the CLI knows it is driven by a
    // program, not a person at a terminal.
    cmd.env("CLAUDE_CODE_ENTRYPOINT", "sdk-ts");
    let base_path = std::env::var("PATH").unwrap_or_default();
    cmd.env("PATH", cortx_core::command_builder::run_path(&cwd, &base_path));
    cmd.env("CORTX_AGENT_GUI", "1");
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start `{}`: {}", command.trim(), e))?;
    let pid = child.id();
    let stdin = child.stdin.take().ok_or("No stdin")?;
    let stdout = child.stdout.take().ok_or("No stdout")?;
    let stderr = child.stderr.take();
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed);

    processes()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(key.clone(), GuiProcess { generation, pid, child, stdin });

    // stdout: one JSON message per line.
    {
        let app = app.clone();
        let key = key.clone();
        std::thread::Builder::new()
            .name("cortx-agent-gui-out".into())
            .spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    let Ok(line) = line else { break };
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let (message, text) = match serde_json::from_str::<serde_json::Value>(trimmed) {
                        Ok(v) => (Some(v), None),
                        Err(_) => (None, Some(line)),
                    };
                    emit(&app, AgentGuiEvent { key: key.clone(), generation, message, text, exited: false, exit_code: None });
                }
                // The pipe closed: the process is ending. Reap it — unless a
                // newer one took its place meanwhile.
                let taken = processes().lock().ok().and_then(|mut p| {
                    if p.get(&key).map(|x| x.generation) == Some(generation) {
                        p.remove(&key)
                    } else {
                        None
                    }
                });
                let exit_code = taken.and_then(|mut proc| proc.child.wait().ok().and_then(|s| s.code()));
                emit(&app, AgentGuiEvent { key, generation, message: None, text: None, exited: true, exit_code });
            })
            .map_err(|e| e.to_string())?;
    }

    // stderr: shown in the view when something goes wrong.
    if let Some(stderr) = stderr {
        let app = app.clone();
        let key = key.clone();
        let _ = std::thread::Builder::new().name("cortx-agent-gui-err".into()).spawn(move || {
            for line in BufReader::new(stderr).lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                emit(&app, AgentGuiEvent { key: key.clone(), generation, message: None, text: Some(line), exited: false, exit_code: None });
            }
        });
    }

    log::info!("Agent GUI {} started (pid {}, generation {})", key, pid, generation);
    Ok(generation)
}

/// Write one message (a JSON line) to the agent of a pane.
#[tauri::command]
pub fn agent_gui_send(key: String, line: String) -> Result<(), String> {
    let mut procs = processes().lock().map_err(|e| e.to_string())?;
    let proc = procs.get_mut(&key).ok_or("The agent is not running")?;
    let one_line = line.replace('\n', " ");
    proc.stdin
        .write_all(one_line.as_bytes())
        .and_then(|_| proc.stdin.write_all(b"\n"))
        .and_then(|_| proc.stdin.flush())
        .map_err(|e| format!("Could not write to the agent: {}", e))
}

/// Is the agent of a pane running? Its generation when it is.
#[tauri::command]
pub fn agent_gui_running(key: String) -> Option<u64> {
    processes().lock().ok()?.get(&key).map(|p| p.generation)
}

fn stop(key: &str) {
    let proc = processes().lock().ok().and_then(|mut p| p.remove(key));
    if let Some(mut proc) = proc {
        log::info!("Agent GUI {} stopped (pid {})", key, proc.pid);
        let _ = cortx_core::runtime_state::kill_pid_tree(proc.pid);
        let _ = proc.child.kill();
        let _ = proc.child.wait();
    }
}

/// Stop the agent of a pane (closing the pane, switching it to the TUI).
#[tauri::command]
pub fn agent_gui_stop(key: String) {
    stop(&key);
}

/// Every agent, at quit.
pub fn stop_all() {
    let keys: Vec<String> = processes().lock().map(|p| p.keys().cloned().collect()).unwrap_or_default();
    for key in keys {
        stop(&key);
    }
}

/// The git branch of a directory, read from `.git/HEAD` (walking up, a
/// worktree's `.git` file followed) — for the agent view's side panel. A
/// detached HEAD gives its short hash; no repository, nothing.
pub fn git_branch_of(dir: &std::path::Path) -> Option<String> {
    let mut cur = Some(dir);
    while let Some(d) = cur {
        let dot_git = d.join(".git");
        let git_dir = if dot_git.is_dir() {
            Some(dot_git)
        } else if dot_git.is_file() {
            std::fs::read_to_string(&dot_git)
                .ok()
                .and_then(|s| s.trim().strip_prefix("gitdir:").map(|p| d.join(p.trim())))
        } else {
            None
        };
        if let Some(git_dir) = git_dir {
            let head = std::fs::read_to_string(git_dir.join("HEAD")).ok()?;
            let head = head.trim();
            return Some(match head.strip_prefix("ref: refs/heads/") {
                Some(branch) => branch.to_string(),
                None => head.chars().take(7).collect(),
            });
        }
        cur = d.parent();
    }
    None
}

#[tauri::command]
pub fn agent_gui_git_branch(cwd: String) -> Option<String> {
    if cwd.trim().is_empty() {
        return None;
    }
    git_branch_of(std::path::Path::new(&cwd))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_branch_from_head() {
        let dir = std::env::temp_dir().join(format!("cortx-git-branch-{}", std::process::id()));
        let sub = dir.join("src").join("deep");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::write(dir.join(".git").join("HEAD"), "ref: refs/heads/feature/x\n").unwrap();
        assert_eq!(git_branch_of(&sub).as_deref(), Some("feature/x"));
        std::fs::write(dir.join(".git").join("HEAD"), "0123456789abcdef\n").unwrap();
        assert_eq!(git_branch_of(&dir).as_deref(), Some("0123456"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn command_line_appends_the_flags_and_the_session() {
        assert_eq!(command_line("cc", None).unwrap(), format!("cc {}", STREAM_JSON_FLAGS));
        assert_eq!(
            command_line("claude", Some("aaaa1111-0000-4000-8000-000000000001")).unwrap(),
            format!("claude {} --resume aaaa1111-0000-4000-8000-000000000001", STREAM_JSON_FLAGS)
        );
        assert!(command_line("claude", Some("x; rm -rf /")).is_err());
        assert!(command_line("  ", None).is_err());
    }
}
