//! Shell-integration observer for the PTY byte stream.
//!
//! `cortx init` makes the user's shell emit two families of OSC sequences
//! whenever it runs inside a CortX terminal (`CORTX_TERMINAL_ID` is set):
//!
//! - **OSC 7** `file://host/path` — the current working directory, at every
//!   prompt.
//! - **OSC 133** (FinalTerm / iTerm2 / WezTerm / Windows Terminal convention):
//!   `A` prompt start, `B` prompt end (input starts), `C` command start
//!   (CortX adds `;cmd=<base64 utf-8>` with the command line), `D[;exit]`
//!   command end.
//!
//! [`OscScanner`] is a pure observer: it never modifies the stream (xterm.js
//! ignores these sequences on its own), it just spots them across chunk
//! boundaries and reports [`ShellEvent`]s. [`TerminalStateTracker`] folds
//! those into the per-terminal [`TerminalShellState`] the GUI shows (cwd,
//! running command, exit code) and reports each finished command so the
//! caller can append it to the history file.
//!
//! Large OSC payloads (iTerm2 inline images are OSC 1337 and can be
//! megabytes) are skipped without buffering.

use base64::Engine;
use serde::{Deserialize, Serialize};

/// Hard cap on the bytes buffered for one OSC 7 / 133 sequence. Anything
/// longer is malformed (a command line is base64'd, so 16 KB is ~12 KB of
/// text) and gets dropped.
const MAX_OSC_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellEvent {
    /// OSC 7 — decoded filesystem path.
    Cwd(String),
    /// OSC 133;A
    PromptStart,
    /// OSC 133;B
    PromptEnd,
    /// OSC 133;C — `command` is present when the shell sent `cmd=<base64>`.
    CommandStart { command: Option<String> },
    /// OSC 133;D — `exit_code` is `None` when the shell didn't report one.
    CommandEnd { exit_code: Option<i32> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Ground,
    /// Saw ESC; the next byte decides.
    Esc,
    /// Inside `ESC ]`, collecting the numeric selector + params.
    Osc,
    /// Inside an OSC we don't care about — wait for the terminator only.
    OscSkip,
    /// Saw ESC inside an OSC (possible `ESC \` string terminator).
    OscEsc,
    /// Same, while skipping.
    OscSkipEsc,
}

/// Streaming detector for OSC 7 / OSC 133. Feed it every chunk in order.
pub struct OscScanner {
    state: State,
    buf: Vec<u8>,
}

impl Default for OscScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl OscScanner {
    pub fn new() -> Self {
        Self {
            state: State::Ground,
            buf: Vec::new(),
        }
    }

    /// Scan `chunk` and return the shell events it completes, in order.
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<ShellEvent> {
        let mut events = Vec::new();
        for &b in chunk {
            match self.state {
                State::Ground => {
                    if b == 0x1b {
                        self.state = State::Esc;
                    }
                }
                State::Esc => {
                    if b == b']' {
                        self.buf.clear();
                        self.state = State::Osc;
                    } else if b == 0x1b {
                        // Stay in Esc: `ESC ESC ]` still starts an OSC.
                    } else {
                        self.state = State::Ground;
                    }
                }
                State::Osc => match b {
                    0x07 => {
                        self.finish(&mut events);
                    }
                    0x1b => self.state = State::OscEsc,
                    _ => {
                        self.buf.push(b);
                        if !self.interesting_prefix() || self.buf.len() > MAX_OSC_BYTES {
                            self.buf.clear();
                            self.state = State::OscSkip;
                        }
                    }
                },
                State::OscEsc => {
                    if b == b'\\' {
                        self.finish(&mut events);
                    } else if b == b']' {
                        // A new OSC started before the old one terminated.
                        self.buf.clear();
                        self.state = State::Osc;
                    } else {
                        // Not a terminator: the ESC was part of the payload
                        // (unusual). Keep going.
                        self.buf.push(0x1b);
                        self.buf.push(b);
                        self.state = State::Osc;
                    }
                }
                State::OscSkip => match b {
                    0x07 => self.state = State::Ground,
                    0x1b => self.state = State::OscSkipEsc,
                    _ => {}
                },
                State::OscSkipEsc => {
                    if b == b'\\' {
                        self.state = State::Ground;
                    } else if b == b']' {
                        self.buf.clear();
                        self.state = State::Osc;
                    } else {
                        self.state = State::OscSkip;
                    }
                }
            }
        }
        events
    }

    /// While the selector is still being read, can this still be a 7 or a
    /// 133? Called after each byte pushed in `Osc` state.
    fn interesting_prefix(&self) -> bool {
        let buf = &self.buf;
        let sel_end = buf.iter().position(|&c| c == b';').unwrap_or(buf.len());
        let sel = &buf[..sel_end];
        if sel_end == buf.len() {
            // Selector still incomplete: keep going only if it's a prefix of
            // "7" or "133".
            return sel == b"7" || b"133".starts_with(sel);
        }
        sel == b"7" || sel == b"133"
    }

    fn finish(&mut self, events: &mut Vec<ShellEvent>) {
        let payload = std::mem::take(&mut self.buf);
        self.state = State::Ground;
        if let Some(ev) = parse_osc(&payload) {
            events.push(ev);
        }
    }
}

/// Parse a complete OSC payload (selector + params, terminator stripped).
fn parse_osc(payload: &[u8]) -> Option<ShellEvent> {
    let text = String::from_utf8_lossy(payload);
    let mut parts = text.splitn(2, ';');
    let selector = parts.next()?;
    let rest = parts.next().unwrap_or("");
    match selector {
        "7" => parse_osc7_path(rest).map(ShellEvent::Cwd),
        "133" => {
            let mut params = rest.split(';');
            let marker = params.next().unwrap_or("");
            match marker {
                "A" => Some(ShellEvent::PromptStart),
                "B" => Some(ShellEvent::PromptEnd),
                "C" => {
                    let command = params.find_map(|p| {
                        p.strip_prefix("cmd=")
                            .and_then(|b64| {
                                base64::engine::general_purpose::STANDARD
                                    .decode(b64.trim())
                                    .ok()
                            })
                            .map(|bytes| String::from_utf8_lossy(&bytes).trim().to_string())
                            .filter(|s| !s.is_empty())
                    });
                    Some(ShellEvent::CommandStart { command })
                }
                "D" => {
                    let exit_code = params.next().and_then(|p| p.trim().parse::<i32>().ok());
                    Some(ShellEvent::CommandEnd { exit_code })
                }
                _ => None,
            }
        }
        _ => None,
    }
}

/// `file://host/path` → local path. Accepts an empty host, percent-decodes,
/// and on Windows turns `/C:/Users/x` into `C:\Users\x`.
pub fn parse_osc7_path(uri: &str) -> Option<String> {
    let uri = uri.trim();
    let rest = uri.strip_prefix("file://")?;
    let path = match rest.find('/') {
        Some(idx) => &rest[idx..],
        None => return None,
    };
    let decoded = percent_decode(path);
    if decoded.is_empty() {
        return None;
    }
    Some(normalise_local_path(&decoded))
}

fn normalise_local_path(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        let bytes = path.as_bytes();
        if bytes.len() >= 3 && bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && bytes[2] == b':' {
            return path[1..].replace('/', "\\");
        }
        path.to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_string()
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ============================================================================
// Per-terminal state
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShellPhase {
    /// No shell integration seen yet.
    Unknown,
    /// Prompt is being drawn / waiting for input.
    Idle,
    /// A command is executing.
    Running,
}

/// What the GUI knows about the shell behind a terminal. Emitted as the
/// `terminal-state` event every time it changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalShellState {
    pub terminal_id: String,
    pub phase: ShellPhase,
    /// Latest OSC 7 directory, if the shell reported one.
    pub cwd: Option<String>,
    /// Command currently running (phase == Running), if the shell sent it.
    pub command: Option<String>,
    /// Epoch millis when the running command started.
    pub started_at: Option<i64>,
    /// Last finished command, its exit code and duration.
    pub last_command: Option<String>,
    pub last_exit_code: Option<i32>,
    pub last_duration_ms: Option<u64>,
    /// Epoch millis when the last command finished.
    pub last_finished_at: Option<i64>,
    /// Monotonic counter of finished commands (lets the GUI detect "new
    /// result" without comparing every field).
    pub completed_commands: u64,
}

impl TerminalShellState {
    pub fn new(terminal_id: &str) -> Self {
        Self {
            terminal_id: terminal_id.to_string(),
            phase: ShellPhase::Unknown,
            cwd: None,
            command: None,
            started_at: None,
            last_command: None,
            last_exit_code: None,
            last_duration_ms: None,
            last_finished_at: None,
            completed_commands: 0,
        }
    }
}

/// Outcome of folding one event into the state.
#[derive(Debug, Default)]
pub struct TrackerUpdate {
    /// The state changed and should be broadcast.
    pub changed: bool,
    /// A command just finished.
    pub finished: Option<FinishedCommand>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FinishedCommand {
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub finished_at: i64,
}

/// Folds [`ShellEvent`]s into a [`TerminalShellState`].
pub struct TerminalStateTracker {
    state: TerminalShellState,
    /// Set by `C`, cleared by `D`; a `D` without a `C` (first prompt, or an
    /// empty line) is not a command.
    running: bool,
}

impl TerminalStateTracker {
    pub fn new(terminal_id: &str) -> Self {
        Self {
            state: TerminalShellState::new(terminal_id),
            running: false,
        }
    }

    pub fn state(&self) -> &TerminalShellState {
        &self.state
    }

    /// `now_ms` is epoch millis (injected so tests are deterministic).
    pub fn apply(&mut self, event: ShellEvent, now_ms: i64) -> TrackerUpdate {
        let mut update = TrackerUpdate::default();
        match event {
            ShellEvent::Cwd(path) => {
                if self.state.cwd.as_deref() != Some(path.as_str()) {
                    self.state.cwd = Some(path);
                    update.changed = true;
                }
            }
            ShellEvent::PromptStart | ShellEvent::PromptEnd => {
                if self.running {
                    // A prompt without a `D`: the shell lost track (Ctrl+C in
                    // some shells). Close the command with no exit code.
                    update.finished = Some(self.finish(None, now_ms));
                    update.changed = true;
                }
                if self.state.phase != ShellPhase::Idle {
                    self.state.phase = ShellPhase::Idle;
                    update.changed = true;
                }
            }
            ShellEvent::CommandStart { command } => {
                if self.running {
                    update.finished = Some(self.finish(None, now_ms));
                }
                self.running = true;
                self.state.phase = ShellPhase::Running;
                self.state.command = command;
                self.state.started_at = Some(now_ms);
                update.changed = true;
            }
            ShellEvent::CommandEnd { exit_code } => {
                if self.running {
                    update.finished = Some(self.finish(exit_code, now_ms));
                    update.changed = true;
                } else if self.state.phase == ShellPhase::Unknown {
                    self.state.phase = ShellPhase::Idle;
                    update.changed = true;
                }
            }
        }
        update
    }

    fn finish(&mut self, exit_code: Option<i32>, now_ms: i64) -> FinishedCommand {
        let started = self.state.started_at.unwrap_or(now_ms);
        let duration_ms = now_ms.saturating_sub(started).max(0) as u64;
        let command = self.state.command.take();
        self.running = false;
        self.state.phase = ShellPhase::Idle;
        self.state.started_at = None;
        self.state.last_command = command.clone();
        self.state.last_exit_code = exit_code;
        self.state.last_duration_ms = Some(duration_ms);
        self.state.last_finished_at = Some(now_ms);
        self.state.completed_commands += 1;
        FinishedCommand {
            command,
            cwd: self.state.cwd.clone(),
            exit_code,
            duration_ms,
            finished_at: now_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b64(s: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
    }

    #[test]
    fn detects_133_markers_with_both_terminators() {
        let mut sc = OscScanner::new();
        let ev = sc.feed(b"\x1b]133;A\x07prompt> \x1b]133;B\x1b\\");
        assert_eq!(ev, vec![ShellEvent::PromptStart, ShellEvent::PromptEnd]);
    }

    #[test]
    fn command_start_decodes_base64_command() {
        let mut sc = OscScanner::new();
        let seq = format!("\x1b]133;C;cmd={}\x07", b64("cargo build --release"));
        let ev = sc.feed(seq.as_bytes());
        assert_eq!(
            ev,
            vec![ShellEvent::CommandStart {
                command: Some("cargo build --release".into())
            }]
        );
    }

    #[test]
    fn command_end_parses_exit_code_or_none() {
        let mut sc = OscScanner::new();
        let ev = sc.feed(b"\x1b]133;D;127\x07\x1b]133;D\x07");
        assert_eq!(
            ev,
            vec![
                ShellEvent::CommandEnd { exit_code: Some(127) },
                ShellEvent::CommandEnd { exit_code: None }
            ]
        );
    }

    #[test]
    fn sequences_split_across_chunks_still_parse() {
        let mut sc = OscScanner::new();
        let full = b"\x1b]7;file://localhost/C:/Users/Alexis%20Munch/dev\x1b\\";
        let mut events = Vec::new();
        for chunk in full.chunks(3) {
            events.extend(sc.feed(chunk));
        }
        let expected = if cfg!(target_os = "windows") {
            "C:\\Users\\Alexis Munch\\dev"
        } else {
            "/C:/Users/Alexis Munch/dev"
        };
        assert_eq!(events, vec![ShellEvent::Cwd(expected.into())]);
    }

    #[test]
    fn unix_osc7_keeps_posix_path() {
        assert_eq!(
            parse_osc7_path("file://myhost/home/alexis/p"),
            Some(normalise_local_path("/home/alexis/p"))
        );
        assert_eq!(parse_osc7_path("file:///home/a%20b"), Some(normalise_local_path("/home/a b")));
        assert_eq!(parse_osc7_path("http://x"), None);
    }

    #[test]
    fn other_oscs_are_skipped_without_buffering() {
        let mut sc = OscScanner::new();
        let mut big = b"\x1b]1337;File=inline=1:".to_vec();
        big.extend(std::iter::repeat(b'A').take(200_000));
        big.push(0x07);
        big.extend_from_slice(b"\x1b]133;A\x07");
        let ev = sc.feed(&big);
        assert_eq!(ev, vec![ShellEvent::PromptStart]);
        assert!(sc.buf.capacity() < MAX_OSC_BYTES * 2);
    }

    #[test]
    fn repainting_tui_noise_does_not_produce_events() {
        let mut sc = OscScanner::new();
        let ev = sc.feed(
            b"\x1b[2J\x1b[H\x1b[31mred\x1b[0m\x1b]0;title\x07\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\",
        );
        assert!(ev.is_empty());
    }

    #[test]
    fn tracker_records_a_full_command_cycle() {
        let mut t = TerminalStateTracker::new("shell:1");
        let u = t.apply(ShellEvent::Cwd("/tmp".into()), 0);
        assert!(u.changed);
        t.apply(ShellEvent::PromptStart, 0);
        t.apply(ShellEvent::PromptEnd, 0);
        // First prompt's D (no C before it) is not a command.
        let u = t.apply(ShellEvent::CommandEnd { exit_code: Some(0) }, 1);
        assert!(u.finished.is_none());
        let u = t.apply(
            ShellEvent::CommandStart {
                command: Some("ls".into()),
            },
            1_000,
        );
        assert!(u.changed);
        assert_eq!(t.state().phase, ShellPhase::Running);
        let u = t.apply(ShellEvent::CommandEnd { exit_code: Some(2) }, 3_500);
        let fin = u.finished.expect("finished");
        assert_eq!(fin.command.as_deref(), Some("ls"));
        assert_eq!(fin.exit_code, Some(2));
        assert_eq!(fin.duration_ms, 2_500);
        assert_eq!(fin.cwd.as_deref(), Some("/tmp"));
        assert_eq!(t.state().phase, ShellPhase::Idle);
        assert_eq!(t.state().completed_commands, 1);
        assert_eq!(t.state().last_exit_code, Some(2));
    }

    #[test]
    fn prompt_after_lost_command_closes_it() {
        let mut t = TerminalStateTracker::new("shell:1");
        t.apply(
            ShellEvent::CommandStart {
                command: Some("sleep 100".into()),
            },
            0,
        );
        let u = t.apply(ShellEvent::PromptStart, 500);
        let fin = u.finished.expect("closed by prompt");
        assert_eq!(fin.exit_code, None);
        assert_eq!(t.state().phase, ShellPhase::Idle);
    }
}
