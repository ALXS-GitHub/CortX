//! Which CortX terminal is currently running which agent (DEV-13 P4).
//!
//! The agent (`claude`, `codex`) is never the shell itself: it is a
//! *descendant* of the PTY's process. So the link is made by walking the
//! process tree upwards, from the agent's pid to the terminal that owns it.
//!
//! Two sources, two levels of confidence:
//!
//! - **Claude Code** keeps a live registry (`<claude dir>/sessions/<pid>.json`,
//!   see [`super::claude_code::LiveEntry`]) with the pid, the session id, the
//!   session name and a `busy` / `idle` status. Everything the tab needs is
//!   authoritative — the state included.
//! - **Codex** publishes nothing live (no registry, no pid file). All we can
//!   assert is "a `codex` process is running under this terminal": the
//!   presence is solid (it comes from the OS process table), the *state* is
//!   not knowable, and the session title is only attached when exactly one
//!   recently-updated thread of the sqlite index sits in the same directory.
//!
//! The correlation itself ([`correlate`]) is pure and takes a
//! [`ProcessSnapshot`], so it is unit-testable without any real process.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use super::{AgentProvider, AgentState};

/// How far up the process tree we look for the owning terminal. A shell, a
/// wrapper (`npx`, `node`, a login shell) and the agent make three or four
/// hops; the cap only guards against a cycle in a corrupted table.
const MAX_TREE_DEPTH: usize = 24;

/// A PTY-backed terminal as the process manager knows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalProcess {
    /// Canonical terminal id (`shell:<id>`, `service:<id>`, …).
    pub terminal_id: String,
    /// Pid of the process the PTY started (the shell).
    pub pid: u32,
    /// Live directory (OSC 7) or the one the shell opened in. Used to attach
    /// a Codex thread, which carries no pid.
    pub cwd: Option<String>,
}

/// An agent found running inside a terminal. Serialized as-is to the GUI
/// (`terminal-agents` event / `get_terminal_agents`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAgent {
    pub terminal_id: String,
    pub provider: AgentProvider,
    /// `running` / `waiting` for Claude Code (registry `status`), `unknown`
    /// for Codex — the process is alive, what it is doing is not observable.
    pub state: AgentState,
    /// Pid of the agent process itself, not of the shell.
    pub pid: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Title the agent gives itself (`/rename`, `--name`, auto title).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// Claude Code `kind` (`interactive`, …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

/// One agent process, before it is attached to a terminal.
#[derive(Debug, Clone, PartialEq)]
pub struct AgentCandidate {
    pub provider: AgentProvider,
    pub pid: u32,
    pub state: AgentState,
    pub session_id: Option<String>,
    pub name: Option<String>,
    pub cwd: Option<String>,
    pub kind: Option<String>,
}

/// Minimal view of the OS process table: parent links and executable names.
///
/// Captured once per detection pass — enumerating processes is the expensive
/// part, walking the map afterwards is free.
#[derive(Debug, Clone, Default)]
pub struct ProcessSnapshot {
    /// pid → parent pid.
    parents: HashMap<u32, u32>,
    /// pid → lowercased executable name (`claude.exe`, `codex`).
    names: HashMap<u32, String>,
}

impl ProcessSnapshot {
    /// Build from an iterator of `(pid, parent, name)` — the test seam.
    pub fn from_entries<I, S>(entries: I) -> Self
    where
        I: IntoIterator<Item = (u32, Option<u32>, S)>,
        S: AsRef<str>,
    {
        let mut parents = HashMap::new();
        let mut names = HashMap::new();
        for (pid, parent, name) in entries {
            if let Some(p) = parent {
                parents.insert(pid, p);
            }
            names.insert(pid, name.as_ref().to_ascii_lowercase());
        }
        Self { parents, names }
    }

    /// Snapshot the real process table (pids, parents and names only).
    pub fn capture() -> Self {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
        let mut sys = System::new();
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::new());
        let mut parents = HashMap::new();
        let mut names = HashMap::new();
        for (pid, process) in sys.processes() {
            let pid = pid.as_u32();
            if let Some(parent) = process.parent() {
                parents.insert(pid, parent.as_u32());
            }
            names.insert(
                pid,
                process.name().to_string_lossy().to_ascii_lowercase(),
            );
        }
        Self { parents, names }
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }

    /// Executable name of a pid, lowercased.
    pub fn name_of(&self, pid: u32) -> Option<&str> {
        self.names.get(&pid).map(String::as_str)
    }

    /// Walk up from `pid` (excluded) until one of `roots` is met. `None` when
    /// the chain leaves the table or the cap is reached.
    pub fn ancestor_in(&self, pid: u32, roots: &HashSet<u32>) -> Option<u32> {
        let mut current = pid;
        for _ in 0..MAX_TREE_DEPTH {
            let parent = *self.parents.get(&current)?;
            if parent == current {
                return None;
            }
            if roots.contains(&parent) {
                return Some(parent);
            }
            current = parent;
        }
        None
    }

    /// Every pid whose executable name matches `is_match`.
    pub fn pids_named<F: Fn(&str) -> bool>(&self, is_match: F) -> Vec<u32> {
        let mut pids: Vec<u32> = self
            .names
            .iter()
            .filter(|(_, name)| is_match(name))
            .map(|(pid, _)| *pid)
            .collect();
        pids.sort_unstable();
        pids
    }
}

/// `codex`, `codex.exe` — and nothing else (`codex-something.exe` is not the
/// CLI, and we would rather miss an agent than tag a random process).
pub fn is_codex_process(name: &str) -> bool {
    let stem = name.strip_suffix(".exe").unwrap_or(name);
    stem == "codex"
}

/// Attach each candidate to the terminal that owns its process.
///
/// A terminal can host only one agent line; when several candidates share a
/// terminal (an agent spawning another one, a Codex process next to a Claude
/// one) the richest wins: Claude Code before Codex, then the newest pid.
pub fn correlate(
    candidates: &[AgentCandidate],
    terminals: &[TerminalProcess],
    snapshot: &ProcessSnapshot,
) -> Vec<TerminalAgent> {
    if candidates.is_empty() || terminals.is_empty() {
        return Vec::new();
    }
    let roots: HashSet<u32> = terminals.iter().map(|t| t.pid).collect();
    let by_pid: HashMap<u32, &TerminalProcess> = terminals.iter().map(|t| (t.pid, t)).collect();

    let mut best: HashMap<&str, (&AgentCandidate, u8)> = HashMap::new();
    for candidate in candidates {
        // The agent may *be* the terminal's process (an agent started as the
        // PTY command), otherwise it is a descendant of it.
        let root = if roots.contains(&candidate.pid) {
            candidate.pid
        } else {
            match snapshot.ancestor_in(candidate.pid, &roots) {
                Some(root) => root,
                None => continue,
            }
        };
        let Some(terminal) = by_pid.get(&root) else {
            continue;
        };
        let rank = match candidate.provider {
            AgentProvider::ClaudeCode => 1,
            AgentProvider::Codex => 0,
        };
        let key = terminal.terminal_id.as_str();
        match best.get(key) {
            Some((current, current_rank))
                if (*current_rank, current.pid) >= (rank, candidate.pid) => {}
            _ => {
                best.insert(key, (candidate, rank));
            }
        }
    }

    let mut out: Vec<TerminalAgent> = best
        .into_iter()
        .map(|(terminal_id, (c, _))| TerminalAgent {
            terminal_id: terminal_id.to_string(),
            provider: c.provider,
            state: c.state,
            pid: c.pid,
            session_id: c.session_id.clone(),
            name: c.name.clone(),
            cwd: c.cwd.clone(),
            kind: c.kind.clone(),
        })
        .collect();
    // Stable order so the GUI can compare two payloads for equality.
    out.sort_by(|a, b| a.terminal_id.cmp(&b.terminal_id));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> ProcessSnapshot {
        ProcessSnapshot::from_entries(vec![
            (1, None, "init"),
            // Terminal A: pwsh → claude
            (100, Some(1), "pwsh.exe"),
            (101, Some(100), "claude.exe"),
            // Terminal B: pwsh → npx → codex
            (200, Some(1), "pwsh.exe"),
            (201, Some(200), "npx.exe"),
            (202, Some(201), "codex.exe"),
            // Unrelated: a codex started from Warp
            (300, Some(1), "warp.exe"),
            (301, Some(300), "codex.exe"),
        ])
    }

    fn terminals() -> Vec<TerminalProcess> {
        vec![
            TerminalProcess {
                terminal_id: "shell:a".into(),
                pid: 100,
                cwd: Some("C:/code/cortx".into()),
            },
            TerminalProcess {
                terminal_id: "shell:b".into(),
                pid: 200,
                cwd: Some("C:/code/zorg".into()),
            },
        ]
    }

    fn claude(pid: u32, state: AgentState) -> AgentCandidate {
        AgentCandidate {
            provider: AgentProvider::ClaudeCode,
            pid,
            state,
            session_id: Some("sess-1".into()),
            name: Some("Terminal agents".into()),
            cwd: Some("C:/code/cortx".into()),
            kind: Some("interactive".into()),
        }
    }

    fn codex(pid: u32) -> AgentCandidate {
        AgentCandidate {
            provider: AgentProvider::Codex,
            pid,
            state: AgentState::Unknown,
            session_id: None,
            name: None,
            cwd: None,
            kind: None,
        }
    }

    #[test]
    fn direct_child_is_linked() {
        let out = correlate(&[claude(101, AgentState::Running)], &terminals(), &snapshot());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].terminal_id, "shell:a");
        assert_eq!(out[0].state, AgentState::Running);
        assert_eq!(out[0].pid, 101);
    }

    #[test]
    fn grandchild_is_linked() {
        let out = correlate(&[codex(202)], &terminals(), &snapshot());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].terminal_id, "shell:b");
        assert_eq!(out[0].provider, AgentProvider::Codex);
        assert_eq!(out[0].state, AgentState::Unknown);
    }

    #[test]
    fn agents_outside_cortx_are_ignored() {
        let out = correlate(&[codex(301)], &terminals(), &snapshot());
        assert!(out.is_empty(), "{out:?}");
    }

    #[test]
    fn the_agent_may_be_the_terminal_process_itself() {
        let terms = vec![TerminalProcess {
            terminal_id: "shell:c".into(),
            pid: 101,
            cwd: None,
        }];
        let out = correlate(&[claude(101, AgentState::Waiting)], &terms, &snapshot());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].terminal_id, "shell:c");
        assert_eq!(out[0].state, AgentState::Waiting);
    }

    #[test]
    fn claude_wins_over_codex_in_the_same_terminal() {
        let snap = ProcessSnapshot::from_entries(vec![
            (100, None, "pwsh.exe"),
            (101, Some(100), "claude.exe"),
            (102, Some(100), "codex.exe"),
        ]);
        let out = correlate(
            &[codex(102), claude(101, AgentState::Running)],
            &terminals(),
            &snap,
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].provider, AgentProvider::ClaudeCode);
    }

    #[test]
    fn a_cycle_does_not_hang() {
        let snap = ProcessSnapshot::from_entries(vec![(10, Some(11), "a"), (11, Some(10), "b")]);
        let roots: HashSet<u32> = [999].into_iter().collect();
        assert_eq!(snap.ancestor_in(10, &roots), None);
    }

    #[test]
    fn codex_process_names() {
        assert!(is_codex_process("codex"));
        assert!(is_codex_process("codex.exe"));
        assert!(!is_codex_process("codex-cli.exe"));
        assert!(!is_codex_process("node.exe"));
    }

    #[test]
    fn output_is_stable_and_deduped() {
        let out = correlate(
            &[claude(101, AgentState::Running), codex(202)],
            &terminals(),
            &snapshot(),
        );
        assert_eq!(
            out.iter().map(|a| a.terminal_id.as_str()).collect::<Vec<_>>(),
            vec!["shell:a", "shell:b"]
        );
    }
}
