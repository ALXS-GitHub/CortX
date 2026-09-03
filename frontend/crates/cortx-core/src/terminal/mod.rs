//! Byte-level plumbing for the integrated terminal.
//!
//! Every process CortX spawns from the GUI (services, project scripts, global
//! scripts, interactive shells) runs inside a real PTY. The raw byte stream
//! coming out of that PTY is fanned out to two consumers:
//!
//! 1. **[`TerminalHub`]** — keeps a bounded raw scrollback per terminal and
//!    forwards live bytes to any attached sink (the GUI's xterm.js view). The
//!    hub is the single place where "snapshot + subscribe" happens atomically,
//!    so a view that attaches late never sees bytes out of order.
//! 2. **[`AnsiLineSplitter`]** — strips escape sequences (colours, cursor
//!    moves, image payloads, ...) and turns the stream back into plain text
//!    lines. Those feed the on-disk `<id>.log` file and the line-based
//!    `emit_*_log` events that the TUI, the MCP server and the sidebar rely on.
//!
//! Neither piece knows anything about Tauri; the GUI adapts a `Channel` into a
//! [`SinkFn`].

pub mod history;
pub mod launch;
pub mod layout;
pub mod osc;
pub mod snapshot;
pub mod themes;

pub use history::{CommandHistory, CommandRecord};
pub use launch::{LaunchConfig, LaunchNode, LaunchStore, LaunchTab, LaunchTarget};
pub use layout::{LayoutDoc, LayoutStore};
pub use osc::{OscScanner, ShellEvent, ShellPhase, TerminalShellState, TerminalStateTracker};
pub use themes::{TerminalTheme, ThemeStore, ThemeSummary};

use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

/// Upper bound on the raw bytes kept per terminal. Images (Sixel / iTerm2)
/// are large, so this is deliberately generous.
pub const MAX_SCROLLBACK_BYTES: usize = 4 * 1024 * 1024;
/// When the cap is hit, drop the oldest bytes down to this size so trimming
/// isn't triggered on every push.
const TRIM_TO_BYTES: usize = 3 * 1024 * 1024;

/// Which kind of thing a terminal id refers to. The string form is the prefix
/// used on both sides of the IPC (`service:<id>`, `shell:<id>`, ...), matching
/// the frontend's `Terminal.id`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalKind {
    Service,
    Script,
    GlobalScript,
    Shell,
}

impl TerminalKind {
    pub fn as_str(self) -> &'static str {
        match self {
            TerminalKind::Service => "service",
            TerminalKind::Script => "script",
            TerminalKind::GlobalScript => "global-script",
            TerminalKind::Shell => "shell",
        }
    }
}

/// Build the canonical terminal id for a (kind, runtime key) pair.
pub fn terminal_id(kind: TerminalKind, key: &str) -> String {
    format!("{}:{}", kind.as_str(), key)
}

/// Live output consumer. Returns `false` when the sink is dead (e.g. the
/// webview went away) so the hub can forget it.
pub type SinkFn = Box<dyn Fn(&[u8]) -> bool + Send + Sync>;

struct Entry {
    scrollback: Vec<u8>,
    sinks: Vec<(u64, SinkFn)>,
}

impl Entry {
    fn new() -> Self {
        Self {
            scrollback: Vec::new(),
            sinks: Vec::new(),
        }
    }
}

/// Per-terminal raw scrollback + live subscribers.
pub struct TerminalHub {
    entries: Mutex<HashMap<String, Entry>>,
    next_token: AtomicU64,
}

impl Default for TerminalHub {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalHub {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            next_token: AtomicU64::new(1),
        }
    }

    /// Append bytes to a terminal's scrollback and forward them to every
    /// attached sink. Dead sinks are dropped on the spot.
    pub fn push(&self, id: &str, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        let mut entries = self.entries.lock();
        let entry = entries
            .entry(id.to_string())
            .or_insert_with(Entry::new);
        entry.scrollback.extend_from_slice(data);
        if entry.scrollback.len() > MAX_SCROLLBACK_BYTES {
            let excess = entry.scrollback.len() - TRIM_TO_BYTES;
            entry.scrollback.drain(..excess);
        }
        entry.sinks.retain(|(_, sink)| sink(data));
    }

    /// Register a live sink. The current scrollback is delivered through the
    /// sink *before* it is registered, under the same lock as `push`, so the
    /// subscriber sees a consistent, ordered stream. Returns a token for
    /// [`detach`](Self::detach).
    pub fn attach(&self, id: &str, sink: SinkFn) -> u64 {
        let token = self.next_token.fetch_add(1, Ordering::Relaxed);
        let mut entries = self.entries.lock();
        let entry = entries
            .entry(id.to_string())
            .or_insert_with(Entry::new);
        if !entry.scrollback.is_empty() {
            // If the snapshot can't be delivered the sink is already dead —
            // don't bother registering it.
            if !sink(&entry.scrollback) {
                return token;
            }
        }
        entry.sinks.push((token, sink));
        token
    }

    /// Forget a sink previously returned by [`attach`](Self::attach).
    pub fn detach(&self, id: &str, token: u64) {
        let mut entries = self.entries.lock();
        if let Some(entry) = entries.get_mut(id) {
            entry.sinks.retain(|(t, _)| *t != token);
        }
    }

    /// Drop the scrollback but keep subscribers (the "Clear" button).
    pub fn clear(&self, id: &str) {
        let mut entries = self.entries.lock();
        if let Some(entry) = entries.get_mut(id) {
            entry.scrollback.clear();
        }
    }

    /// Forget the terminal entirely (scrollback and sinks).
    pub fn remove(&self, id: &str) {
        self.entries.lock().remove(id);
    }

    /// Ids of every terminal with a scrollback entry.
    pub fn ids(&self) -> Vec<String> {
        self.entries.lock().keys().cloned().collect()
    }

    /// Copy of the current scrollback (used by tests and diagnostics).
    pub fn scrollback(&self, id: &str) -> Vec<u8> {
        self.entries
            .lock()
            .get(id)
            .map(|e| e.scrollback.clone())
            .unwrap_or_default()
    }

    /// Number of live sinks for a terminal (diagnostics).
    pub fn sink_count(&self, id: &str) -> usize {
        self.entries
            .lock()
            .get(id)
            .map(|e| e.sinks.len())
            .unwrap_or(0)
    }
}

// ============================================================================
// ANSI-stripping line splitter
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    /// Plain text.
    Ground,
    /// Just saw ESC.
    Escape,
    /// ESC [ ... — parameters/intermediates until a final byte 0x40..=0x7E.
    Csi,
    /// ESC ] / ESC P / ESC _ / ESC ^ / ESC X ... — runs until BEL or ESC \.
    /// Covers OSC (titles, hyperlinks, iTerm2 images), DCS (Sixel), APC
    /// (Kitty graphics), PM and SOS.
    StringSeq,
    /// Inside a string sequence and just saw ESC (expecting `\` = ST).
    StringSeqEscape,
    /// ESC followed by intermediate bytes 0x20..=0x2F (e.g. `ESC ( B`).
    EscapeIntermediate,
}

/// Converts a raw PTY byte stream into plain-text lines.
///
/// - All escape sequences are removed (CSI, OSC, DCS, APC, PM, SOS, and
///   two/three-byte ESC sequences), which also drops image payloads.
/// - `\r\n` is a line break. A bare `\r` followed by more text restarts the
///   current line (carriage-return overwrite), so progress bars collapse to
///   their final state instead of producing one line per redraw.
/// - Other C0 controls are dropped, except `\t` which is kept.
/// - Invalid UTF-8 is replaced lossily at line boundaries.
pub struct AnsiLineSplitter {
    state: State,
    line: Vec<u8>,
    pending_cr: bool,
}

impl Default for AnsiLineSplitter {
    fn default() -> Self {
        Self::new()
    }
}

impl AnsiLineSplitter {
    pub fn new() -> Self {
        Self {
            state: State::Ground,
            line: Vec::new(),
            pending_cr: false,
        }
    }

    /// Feed bytes; returns every completed line (without the terminator).
    pub fn feed(&mut self, data: &[u8]) -> Vec<String> {
        let mut out = Vec::new();
        for &b in data {
            match self.state {
                State::Ground => {
                    if self.pending_cr {
                        self.pending_cr = false;
                        if b == b'\n' {
                            out.push(self.take_line());
                            continue;
                        }
                        // Bare CR followed by text: the program is redrawing
                        // the current line. Start over.
                        self.line.clear();
                    }
                    match b {
                        0x1b => self.state = State::Escape,
                        b'\n' => out.push(self.take_line()),
                        b'\r' => self.pending_cr = true,
                        b'\t' => self.line.push(b),
                        0x00..=0x1f | 0x7f => {}
                        _ => self.line.push(b),
                    }
                }
                State::Escape => match b {
                    b'[' => self.state = State::Csi,
                    b']' | b'P' | b'_' | b'^' | b'X' => self.state = State::StringSeq,
                    0x20..=0x2f => self.state = State::EscapeIntermediate,
                    // Any other single-byte final (ESC 7, ESC =, ESC M, ...).
                    _ => self.state = State::Ground,
                },
                State::EscapeIntermediate => {
                    if !(0x20..=0x2f).contains(&b) {
                        self.state = State::Ground;
                    }
                }
                State::Csi => {
                    if (0x40..=0x7e).contains(&b) {
                        self.state = State::Ground;
                    }
                }
                State::StringSeq => match b {
                    0x07 => self.state = State::Ground,
                    0x1b => self.state = State::StringSeqEscape,
                    _ => {}
                },
                State::StringSeqEscape => {
                    // ESC \ terminates; anything else stays inside the string
                    // (an ESC that starts a nested sequence is not valid, but
                    // be lenient and keep skipping).
                    self.state = if b == b'\\' {
                        State::Ground
                    } else {
                        State::StringSeq
                    };
                }
            }
        }
        out
    }

    /// Flush whatever is buffered as a final line (call at EOF). Returns
    /// `None` when nothing is pending.
    pub fn finish(&mut self) -> Option<String> {
        self.pending_cr = false;
        if self.line.is_empty() {
            None
        } else {
            Some(self.take_line())
        }
    }

    fn take_line(&mut self) -> String {
        let s = String::from_utf8_lossy(&self.line).into_owned();
        self.line.clear();
        s
    }
}

/// One-shot helper: strip escape sequences from a complete chunk of text.
pub fn strip_ansi(input: &str) -> String {
    let mut splitter = AnsiLineSplitter::new();
    let mut lines = splitter.feed(input.as_bytes());
    if let Some(last) = splitter.finish() {
        lines.push(last);
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;

    #[test]
    fn splitter_strips_sgr_and_splits_lines() {
        let mut s = AnsiLineSplitter::new();
        let lines = s.feed(b"\x1b[32mready\x1b[0m on port 3000\r\nnext");
        assert_eq!(lines, vec!["ready on port 3000".to_string()]);
        assert_eq!(s.finish(), Some("next".to_string()));
    }

    #[test]
    fn splitter_collapses_carriage_return_redraws() {
        let mut s = AnsiLineSplitter::new();
        let lines = s.feed(b"10%\r50%\r100%\n");
        assert_eq!(lines, vec!["100%".to_string()]);
    }

    #[test]
    fn splitter_handles_lf_and_crlf_split_across_chunks() {
        let mut s = AnsiLineSplitter::new();
        let mut lines = s.feed(b"a\r");
        assert!(lines.is_empty());
        lines.extend(s.feed(b"\nb\n"));
        assert_eq!(lines, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn splitter_drops_osc_dcs_apc_payloads() {
        let mut s = AnsiLineSplitter::new();
        // OSC 8 hyperlink with BEL, iTerm2 image with ST, Sixel DCS, Kitty APC.
        let input = b"\x1b]8;;http://x\x07link\x1b]8;;\x07 \
                      \x1b]1337;File=inline=1:AAAA\x1b\\img \
                      \x1bPq#0;2;0;0;0~-\x1b\\six \
                      \x1b_Gf=100,a=T;AAAA\x1b\\kit\n";
        let lines = s.feed(input);
        assert_eq!(lines, vec!["link img six kit".to_string()]);
    }

    #[test]
    fn splitter_handles_charset_and_private_sequences() {
        let mut s = AnsiLineSplitter::new();
        let lines = s.feed(b"\x1b(B\x1b[?25l\x1b[2K\x1b=hello\x1b[1;31m!\x1b[m\n");
        assert_eq!(lines, vec!["hello!".to_string()]);
    }

    #[test]
    fn splitter_keeps_tabs_and_drops_other_controls() {
        let mut s = AnsiLineSplitter::new();
        let lines = s.feed(b"a\tb\x07c\x08\n");
        assert_eq!(lines, vec!["a\tbc".to_string()]);
    }

    #[test]
    fn strip_ansi_one_shot() {
        assert_eq!(strip_ansi("\x1b[1mbold\x1b[0m\nplain"), "bold\nplain");
    }

    #[test]
    fn hub_delivers_snapshot_then_live_bytes_in_order() {
        let hub = TerminalHub::new();
        hub.push("t", b"hello ");
        let seen = Arc::new(Mutex::new(Vec::<u8>::new()));
        let seen2 = seen.clone();
        let token = hub.attach(
            "t",
            Box::new(move |d| {
                seen2.lock().extend_from_slice(d);
                true
            }),
        );
        hub.push("t", b"world");
        assert_eq!(&*seen.lock(), b"hello world");
        assert_eq!(hub.scrollback("t"), b"hello world");
        hub.detach("t", token);
        hub.push("t", b"!");
        assert_eq!(&*seen.lock(), b"hello world");
        assert_eq!(hub.sink_count("t"), 0);
    }

    #[test]
    fn hub_drops_dead_sinks() {
        let hub = TerminalHub::new();
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        hub.attach(
            "t",
            Box::new(move |_| {
                c.fetch_add(1, Ordering::SeqCst);
                false
            }),
        );
        assert_eq!(hub.sink_count("t"), 1);
        hub.push("t", b"x");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(hub.sink_count("t"), 0);
    }

    #[test]
    fn hub_trims_scrollback() {
        let hub = TerminalHub::new();
        let chunk = vec![b'x'; 1024 * 1024];
        for _ in 0..5 {
            hub.push("t", &chunk);
        }
        let len = hub.scrollback("t").len();
        assert!(len <= MAX_SCROLLBACK_BYTES, "len = {len}");
        assert!(len >= TRIM_TO_BYTES, "len = {len}");
        hub.clear("t");
        assert!(hub.scrollback("t").is_empty());
        hub.remove("t");
        assert_eq!(hub.sink_count("t"), 0);
    }

    #[test]
    fn terminal_id_format_matches_frontend() {
        assert_eq!(terminal_id(TerminalKind::Service, "abc"), "service:abc");
        assert_eq!(terminal_id(TerminalKind::GlobalScript, "g"), "global-script:g");
        assert_eq!(terminal_id(TerminalKind::Shell, "s"), "shell:s");
    }
}
