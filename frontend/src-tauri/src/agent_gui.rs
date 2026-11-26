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

use cortx_core::agents::terminal_link::{AgentDetails, NeedsInput, TerminalAgent};
use cortx_core::agents::{AgentProvider, AgentState};
use cortx_core::process_manager::RunningTerminal;
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
    /// Epoch ms the process was started at (the close prompts' "for 3m").
    started_at: i64,
    child: Child,
    stdin: ChildStdin,
    live: GuiLive,
}

/// What the agent of a pane is doing, read off the messages that go through
/// the pipes — so that a pane in GUI mode is an agent like any other for the
/// rest of CortX: its tab's dot and colour, the grid, the inbox, the
/// notifications (CORT-66). See [`terminal_agents`].
#[derive(Debug, Clone, Default)]
struct GuiLive {
    cwd: String,
    session_id: Option<String>,
    model: Option<String>,
    /// On a turn: from the prompt sent to its `result`.
    busy: bool,
    needs_input: Option<NeedsInput>,
    pending_tool: Option<String>,
    last_prompt: Option<String>,
    last_reply: Option<String>,
    last_activity: Option<i64>,
}

/// Tools whose permission request is by nature a question to you.
const QUESTION_TOOLS: &[&str] = &["AskUserQuestion", "ExitPlanMode"];

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The text blocks of a message's `content` (a string, or an array of blocks).
fn text_of(content: Option<&serde_json::Value>) -> Option<String> {
    let text = match content? {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(blocks) => blocks
            .iter()
            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join(" "),
        _ => return None,
    };
    let line = cortx_core::agents::single_line(&text, 200);
    (!line.is_empty()).then_some(line)
}

fn str_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key).and_then(|t| t.as_str()).map(str::to_owned)
}

impl GuiLive {
    /// A message the agent wrote. Returns whether anything the rest of the
    /// app shows changed (stream deltas, many a second, change nothing).
    fn observe_out(&mut self, message: &serde_json::Value) -> bool {
        match message.get("type").and_then(|t| t.as_str()).unwrap_or("") {
            "system" if message.get("subtype").and_then(|t| t.as_str()) == Some("init") => {
                let session = str_field(message, "session_id");
                let model = str_field(message, "model");
                if let Some(cwd) = str_field(message, "cwd") {
                    self.cwd = cwd;
                }
                let changed = (session.is_some() && session != self.session_id) || (model.is_some() && model != self.model);
                if session.is_some() {
                    self.session_id = session;
                }
                if model.is_some() {
                    self.model = model;
                }
                changed
            }
            "assistant" => {
                let reply = text_of(message.get("message").and_then(|m| m.get("content")));
                let changed = !self.busy || (reply.is_some() && reply != self.last_reply);
                self.busy = true;
                if reply.is_some() {
                    self.last_reply = reply;
                    self.last_activity = Some(now_ms());
                }
                changed
            }
            "result" => {
                let changed = self.busy || self.needs_input.is_some();
                self.busy = false;
                self.needs_input = None;
                self.pending_tool = None;
                self.last_activity = Some(now_ms());
                changed
            }
            "control_request" => {
                let Some(request) = message.get("request") else {
                    return false;
                };
                if request.get("subtype").and_then(|t| t.as_str()) != Some("can_use_tool") {
                    return false;
                }
                let tool = str_field(request, "tool_name").unwrap_or_default();
                self.needs_input =
                    Some(if QUESTION_TOOLS.contains(&tool.as_str()) { NeedsInput::Question } else { NeedsInput::Permission });
                self.pending_tool = Some(tool);
                true
            }
            "control_cancel_request" => {
                let changed = self.needs_input.is_some();
                self.needs_input = None;
                self.pending_tool = None;
                changed
            }
            _ => false,
        }
    }

    /// A message CortX sent: a prompt starts a turn, an answer to a
    /// permission request lets it go on.
    fn observe_in(&mut self, message: &serde_json::Value) -> bool {
        match message.get("type").and_then(|t| t.as_str()).unwrap_or("") {
            "user" => {
                self.busy = true;
                if let Some(prompt) = text_of(message.get("message").and_then(|m| m.get("content"))) {
                    self.last_prompt = Some(prompt);
                }
                self.last_activity = Some(now_ms());
                true
            }
            "control_response" => {
                let changed = self.needs_input.is_some();
                self.needs_input = None;
                self.pending_tool = None;
                changed
            }
            _ => false,
        }
    }

    fn agent(&self, key: &str, pid: u32) -> TerminalAgent {
        TerminalAgent {
            terminal_id: key.to_owned(),
            provider: AgentProvider::ClaudeCode,
            state: if self.busy { AgentState::Running } else { AgentState::Waiting },
            pid,
            session_id: self.session_id.clone(),
            name: None,
            cwd: (!self.cwd.is_empty()).then(|| self.cwd.clone()),
            kind: Some("gui".to_owned()),
            details: AgentDetails {
                pending_tool: self.pending_tool.clone(),
                last_prompt: self.last_prompt.clone(),
                last_reply: self.last_reply.clone(),
                git_branch: None,
                model: self.model.clone(),
                last_activity: self.last_activity,
            },
            needs_input: if self.busy { self.needs_input } else { None },
        }
    }
}

/// The agents of the panes in GUI mode, reported with the terminals' own
/// agents (`terminal-agents`).
pub fn terminal_agents() -> Vec<TerminalAgent> {
    let Ok(procs) = processes().lock() else {
        return Vec::new();
    };
    let mut out: Vec<TerminalAgent> = procs.iter().map(|(key, p)| p.live.agent(key, p.pid)).collect();
    out.sort_by(|a, b| a.terminal_id.cmp(&b.terminal_id));
    out
}

/// The panes whose agent is running, for the quit prompt: closing them
/// kills a Claude Code session exactly as closing a terminal running its TUI
/// would, so they are listed the same way (`running_terminals`).
pub fn running_terminals() -> Vec<RunningTerminal> {
    let Ok(procs) = processes().lock() else {
        return Vec::new();
    };
    let mut out: Vec<RunningTerminal> = procs
        .iter()
        .map(|(key, p)| RunningTerminal {
            terminal_id: key.clone(),
            command: Some(RUNNING_LABEL.to_owned()),
            started_at: Some(p.started_at),
        })
        .collect();
    out.sort_by(|a, b| a.terminal_id.cmp(&b.terminal_id));
    out
}

/// How a running GUI agent is named in the close / quit prompts.
pub const RUNNING_LABEL: &str = "Claude Code (GUI mode)";

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
pub fn command_line(command: &str, resume: Option<&str>, permission_mode: Option<&str>) -> Result<String, String> {
    let base = command.trim();
    if base.is_empty() {
        return Err("No command to start the agent with".into());
    }
    let mut line = format!("{} {}", base, STREAM_JSON_FLAGS);
    // The mode the agent starts in (Settings > Agents). None: whatever the
    // command itself says (an alias shim may carry its own flags).
    match permission_mode.map(str::trim).filter(|m| !m.is_empty()) {
        None => {}
        Some("bypassPermissions") => line.push_str(" --dangerously-skip-permissions"),
        Some(mode @ ("default" | "acceptEdits" | "plan")) => {
            line.push_str(" --permission-mode ");
            line.push_str(mode);
        }
        Some(other) => return Err(format!("Not a permission mode: {}", other)),
    }
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
    state: tauri::State<crate::AppState>,
    key: String,
    cwd: String,
    command: String,
    resume: Option<String>,
    permission_mode: Option<String>,
) -> Result<u64, String> {
    stop(&key);
    // A session nobody wrote in yet cannot be resumed (CORT-66): Claude Code
    // stops on "No conversation found". A new one is started instead.
    let resume = resume.filter(|id| {
        let projects = state.agents.settings().claude_dir().join("projects");
        let ok = cortx_core::agents::claude_code::session_has_conversation(&projects, id);
        if !ok {
            log::info!("Agent GUI {}: session {} has no conversation yet, starting a new one", key, id);
        }
        ok
    });
    let line = command_line(&command, resume.as_deref(), permission_mode.as_deref())?;
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
        .insert(
            key.clone(),
            GuiProcess { generation, pid, started_at: now_ms(), child, stdin, live: GuiLive { cwd: cwd.clone(), ..Default::default() } },
        );
    crate::refresh_terminal_agents(&app);

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
                    if let Some(message) = &message {
                        let changed = processes().lock().ok().is_some_and(|mut p| match p.get_mut(&key) {
                            Some(proc) if proc.generation == generation => proc.live.observe_out(message),
                            _ => false,
                        });
                        if changed {
                            crate::refresh_terminal_agents(&app);
                        }
                    }
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
                crate::refresh_terminal_agents(&app);
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
pub fn agent_gui_send(app: AppHandle, key: String, line: String) -> Result<(), String> {
    let changed = {
        let mut procs = processes().lock().map_err(|e| e.to_string())?;
        let proc = procs.get_mut(&key).ok_or("The agent is not running")?;
        let one_line = line.replace('\n', " ");
        proc.stdin
            .write_all(one_line.as_bytes())
            .and_then(|_| proc.stdin.write_all(b"\n"))
            .and_then(|_| proc.stdin.flush())
            .map_err(|e| format!("Could not write to the agent: {}", e))?;
        serde_json::from_str::<serde_json::Value>(&line)
            .map(|message| proc.live.observe_in(&message))
            .unwrap_or(false)
    };
    if changed {
        crate::refresh_terminal_agents(&app);
    }
    Ok(())
}

/// Can this session be resumed — has anyone written in it yet? A session
/// switched between the GUI and the TUI before its first message has nothing
/// to resume (CORT-66).
#[tauri::command]
pub fn agent_session_has_conversation(state: tauri::State<crate::AppState>, session_id: String) -> bool {
    if !valid_session_id(&session_id) {
        return false;
    }
    let projects = state.agents.settings().claude_dir().join("projects");
    cortx_core::agents::claude_code::session_has_conversation(&projects, &session_id)
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
pub fn agent_gui_stop(app: AppHandle, key: String) {
    stop(&key);
    crate::refresh_terminal_agents(&app);
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
        assert_eq!(command_line("cc", None, None).unwrap(), format!("cc {}", STREAM_JSON_FLAGS));
        assert_eq!(
            command_line("claude", Some("aaaa1111-0000-4000-8000-000000000001"), None).unwrap(),
            format!("claude {} --resume aaaa1111-0000-4000-8000-000000000001", STREAM_JSON_FLAGS)
        );
        assert!(command_line("claude", Some("x; rm -rf /"), None).is_err());
        assert!(command_line("  ", None, None).is_err());
    }

    #[test]
    fn command_line_carries_the_permission_mode() {
        assert_eq!(
            command_line("claude", None, Some("bypassPermissions")).unwrap(),
            format!("claude {} --dangerously-skip-permissions", STREAM_JSON_FLAGS)
        );
        assert_eq!(
            command_line("claude", None, Some("plan")).unwrap(),
            format!("claude {} --permission-mode plan", STREAM_JSON_FLAGS)
        );
        assert_eq!(command_line("claude", None, Some("")).unwrap(), format!("claude {}", STREAM_JSON_FLAGS));
        assert!(command_line("claude", None, Some("x && y")).is_err());
    }

    #[test]
    fn the_live_state_follows_the_turn() {
        let mut live = GuiLive::default();
        let init = serde_json::json!({"type": "system", "subtype": "init", "session_id": "s1", "model": "opus", "cwd": "/p"});
        assert!(live.observe_out(&init));
        let prompt = serde_json::json!({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "hello"}]}});
        assert!(live.observe_in(&prompt));
        assert_eq!(live.agent("k", 1).state, AgentState::Running);
        assert_eq!(live.last_prompt.as_deref(), Some("hello"));
        // Stream deltas change nothing anyone sees.
        assert!(!live.observe_out(&serde_json::json!({"type": "stream_event", "event": {}})));
        let ask = serde_json::json!({"type": "control_request", "request_id": "r", "request": {"subtype": "can_use_tool", "tool_name": "Bash", "input": {}}});
        assert!(live.observe_out(&ask));
        assert_eq!(live.agent("k", 1).needs_input, Some(NeedsInput::Permission));
        assert!(live.observe_in(&serde_json::json!({"type": "control_response", "response": {}})));
        assert_eq!(live.agent("k", 1).needs_input, None);
        let reply = serde_json::json!({"type": "assistant", "message": {"content": [{"type": "text", "text": "Done."}]}});
        assert!(live.observe_out(&reply));
        assert!(live.observe_out(&serde_json::json!({"type": "result", "subtype": "success"})));
        let agent = live.agent("k", 1);
        assert_eq!(agent.state, AgentState::Waiting);
        assert_eq!(agent.session_id.as_deref(), Some("s1"));
        assert_eq!(agent.details.last_reply.as_deref(), Some("Done."));
        assert_eq!(agent.kind.as_deref(), Some("gui"));
    }
}
