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
//!
//! ## Pid reuse (ticket #32)
//!
//! Both sources hand us a *pid*, and a pid is only unique while its process
//! lives. Windows hands out recently-freed pids first, so the shell of a tab
//! opened one second ago is very likely to carry the pid of something that
//! died a moment earlier — a `claude` that just exited, or a process some
//! *other* process still names as its parent (Windows never rewrites a
//! `ppid`, even when the parent is long gone).
//!
//! Left unchecked that turns into the bug this module was reported for: a
//! brand-new, perfectly ordinary tab shows up as an agent session. Two
//! guards, both of them "is this *still* true right now?":
//!
//! - a pid the registry claims is a session only counts while the process
//!   behind it is really one of [`CLAUDE_PROGRAMS`] / [`CODEX_PROGRAMS`]
//!   (see [`ProcessSnapshot::runs_agent`]);
//! - the tree walk never steps onto a parent that started *after* its child
//!   ([`ProcessSnapshot::ancestor_in`]) — that is a recycled `ppid`, not a
//!   parent.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use super::{AgentProvider, AgentState};

/// How far up the process tree we look for the owning terminal. A shell, a
/// wrapper (`npx`, `node`, a login shell) and the agent make three or four
/// hops; the cap only guards against a cycle in a corrupted table.
const MAX_TREE_DEPTH: usize = 24;

// ---------------------------------------------------------------------------
// Which programs are agents — the one list
// ---------------------------------------------------------------------------

/// Programs that *are* Claude Code. One list, used by every "is this an
/// agent?" question in the codebase.
pub const CLAUDE_PROGRAMS: &[&str] = &["claude", "claude-code"];

/// Programs that *are* Codex. `codex-something` is not the CLI, and we would
/// rather miss an agent than tag a random process.
pub const CODEX_PROGRAMS: &[&str] = &["codex"];

/// Runtimes an agent CLI can be published as: an npm install leaves a shim
/// whose process is the interpreter, not `claude`. Never enough on its own to
/// call something an agent — only enough to *believe* a provider that already
/// claims that pid is one of its sessions.
pub const AGENT_RUNTIMES: &[&str] = &["node", "bun", "deno"];

/// The bare program name behind a token: no directory, no quotes, no Windows
/// extension, lowercased. `"C:\Users\me\.local\bin\claude.exe"`,
/// `'/usr/local/bin/claude'` and `claude` all come out as `claude`.
pub fn program_stem(token: &str) -> String {
    let token = token.trim().trim_matches(|c| c == '"' || c == '\'');
    let base = token.rsplit(['/', '\\']).next().unwrap_or(token);
    let base = base.to_ascii_lowercase();
    for ext in [".exe", ".cmd", ".bat", ".ps1", ".com"] {
        if let Some(stem) = base.strip_suffix(ext) {
            return stem.to_string();
        }
    }
    base
}

/// Which agent an executable *name* is, if any (arguments are not part of a
/// name; a path and an extension are stripped by [`program_stem`]).
pub fn agent_provider_of_program(name: &str) -> Option<AgentProvider> {
    let stem = program_stem(name);
    if CLAUDE_PROGRAMS.contains(&stem.as_str()) {
        return Some(AgentProvider::ClaudeCode);
    }
    if CODEX_PROGRAMS.contains(&stem.as_str()) {
        return Some(AgentProvider::Codex);
    }
    None
}

/// Which agent a *command line* starts, if any.
///
/// Only the first token is looked at, which is the whole point: `git commit
/// -m "fix claude thing"` starts `git`. Arguments (`claude
/// --dangerously-skip-permissions`), an absolute path and an environment
/// prefix (`FOO=1 claude`) all resolve to the program that actually runs.
pub fn agent_provider_of_command(line: &str) -> Option<AgentProvider> {
    for token in line.split_whitespace() {
        // `VAR=value claude …`: the assignments come before the program.
        if token.contains('=') && !token.contains(['/', '\\']) {
            continue;
        }
        return agent_provider_of_program(token);
    }
    None
}

/// Is this executable name a runtime an agent CLI may be published as?
pub fn is_agent_runtime(name: &str) -> bool {
    AGENT_RUNTIMES.contains(&program_stem(name).as_str())
}

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
    /// What the session is at, read from its transcript (Claude Code).
    #[serde(flatten, default)]
    pub details: AgentDetails,
    /// The agent is stopped on you: a question, a plan to approve, or a
    /// permission prompt. See [`mark_needs_input`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub needs_input: Option<NeedsInput>,
}

/// What a live session is doing, from the files the agent writes itself —
/// CortX only reads them, it never sends the agent anything.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetails {
    /// Last `tool_use` that has no `tool_result` yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_tool: Option<String>,
    /// Last thing you asked (one line, shortened).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_prompt: Option<String>,
    /// Last text the agent answered (one line, shortened).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_reply: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Epoch millis of the last transcript entry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_activity: Option<i64>,
}

/// Why an agent is waiting on you.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NeedsInput {
    /// It asked you something (`AskUserQuestion`) or wants a plan approved
    /// (`ExitPlanMode`).
    Question,
    /// A tool call is waiting for your permission.
    Permission,
}

/// Tools that, when pending, are by nature a question to you.
const QUESTION_TOOLS: &[&str] = &["AskUserQuestion", "ExitPlanMode"];

/// How long an agent with a pending tool call has to stay silent before it
/// counts as stopped on a permission prompt. A tool that is running keeps the
/// agent's spinner (and its timer) redrawing several times a second; a prompt
/// is drawn once.
pub const PERMISSION_SILENCE: std::time::Duration = std::time::Duration::from_millis(2500);

/// Decide, for each agent, whether it is stopped on you. `output_idle` gives
/// how long a terminal has printed nothing (`None` = unknown).
///
/// - turn running and a question tool pending: a question, straight away;
/// - turn running, a tool call pending, and the terminal silent for
///   [`PERMISSION_SILENCE`]: a permission prompt.
///
/// Only a turn in progress can be stopped on you. A turn reported idle with a
/// tool call still pending in its transcript is one that was interrupted (the
/// call never got its result) — announcing it as "needs you" is what flooded
/// the notifications every time CortX started.
///
/// Pure observation — nothing here writes to the agent or its files.
pub fn mark_needs_input(agents: &mut [TerminalAgent], output_idle: impl Fn(&str) -> Option<std::time::Duration>) {
    for agent in agents.iter_mut() {
        agent.needs_input = None;
        let Some(tool) = agent.details.pending_tool.as_deref() else {
            continue;
        };
        if agent.state != AgentState::Running {
            continue;
        }
        if QUESTION_TOOLS.contains(&tool) {
            agent.needs_input = Some(NeedsInput::Question);
        } else if output_idle(&agent.terminal_id).is_some_and(|d| d >= PERMISSION_SILENCE) {
            agent.needs_input = Some(NeedsInput::Permission);
        }
    }
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
    pub details: AgentDetails,
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
    /// pid → start time, epoch seconds. `0` = unknown (the test seam, and
    /// any platform that would not report one): the reuse guard then simply
    /// does not fire.
    starts: HashMap<u32, u64>,
}

impl ProcessSnapshot {
    /// Build from an iterator of `(pid, parent, name)` — the test seam. Start
    /// times are unknown, so the pid-reuse guard stays out of the way.
    pub fn from_entries<I, S>(entries: I) -> Self
    where
        I: IntoIterator<Item = (u32, Option<u32>, S)>,
        S: AsRef<str>,
    {
        Self::from_dated_entries(
            entries
                .into_iter()
                .map(|(pid, parent, name)| (pid, parent, name, 0u64)),
        )
    }

    /// Same, with a start time per pid (epoch seconds; `0` = unknown).
    pub fn from_dated_entries<I, S>(entries: I) -> Self
    where
        I: IntoIterator<Item = (u32, Option<u32>, S, u64)>,
        S: AsRef<str>,
    {
        let mut parents = HashMap::new();
        let mut names = HashMap::new();
        let mut starts = HashMap::new();
        for (pid, parent, name, start) in entries {
            if let Some(p) = parent {
                parents.insert(pid, p);
            }
            names.insert(pid, name.as_ref().to_ascii_lowercase());
            if start > 0 {
                starts.insert(pid, start);
            }
        }
        Self {
            parents,
            names,
            starts,
        }
    }

    /// Snapshot the real process table (pids, parents, names and start times).
    pub fn capture() -> Self {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
        let mut sys = System::new();
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::new());
        let mut parents = HashMap::new();
        let mut names = HashMap::new();
        let mut starts = HashMap::new();
        for (pid, process) in sys.processes() {
            let pid = pid.as_u32();
            if let Some(parent) = process.parent() {
                parents.insert(pid, parent.as_u32());
            }
            names.insert(
                pid,
                process.name().to_string_lossy().to_ascii_lowercase(),
            );
            let start = process.start_time();
            if start > 0 {
                starts.insert(pid, start);
            }
        }
        Self {
            parents,
            names,
            starts,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }

    /// Executable name of a pid, lowercased.
    pub fn name_of(&self, pid: u32) -> Option<&str> {
        self.names.get(&pid).map(String::as_str)
    }

    /// Start time of a pid in epoch seconds, when the table reported one.
    pub fn start_of(&self, pid: u32) -> Option<u64> {
        self.starts.get(&pid).copied()
    }

    /// Is the process behind this pid *right now* the agent a provider says
    /// it is?
    ///
    /// The registry writes a file per pid; the pid outlives neither the
    /// process nor, on Windows, its own reuse. A pid that is gone, or that
    /// now belongs to the `pwsh` of a tab opened three seconds ago, is not a
    /// session — whatever the file still says. A runtime
    /// ([`AGENT_RUNTIMES`]) is accepted because an npm-installed CLI runs
    /// under one; a shell never is, which is exactly the case that was
    /// mislabelling fresh tabs.
    pub fn runs_agent(&self, pid: u32, provider: AgentProvider) -> bool {
        let Some(name) = self.name_of(pid) else {
            // Not in the table: the process is gone, so nothing runs in it.
            return false;
        };
        agent_provider_of_program(name) == Some(provider) || is_agent_runtime(name)
    }

    /// Could `parent` really be the parent of `child`? A parent starts before
    /// its child. When it started *after*, its pid was recycled and the link
    /// is an illusion — Windows keeps the numeric `ppid` of a parent that
    /// died and hands the number to somebody else.
    ///
    /// Start times have a one-second resolution, so "same second" passes.
    fn plausible_parent(&self, child: u32, parent: u32) -> bool {
        match (self.start_of(child), self.start_of(parent)) {
            (Some(child_start), Some(parent_start)) => parent_start <= child_start,
            // Unknown on either side: no opinion (the test seam, mostly).
            _ => true,
        }
    }

    /// Walk up from `pid` (excluded) until one of `roots` is met. `None` when
    /// the chain leaves the table, hits a recycled `ppid`, or the cap is
    /// reached.
    pub fn ancestor_in(&self, pid: u32, roots: &HashSet<u32>) -> Option<u32> {
        let mut current = pid;
        for _ in 0..MAX_TREE_DEPTH {
            let parent = *self.parents.get(&current)?;
            if parent == current {
                return None;
            }
            if !self.plausible_parent(current, parent) {
                // The chain is broken by pid reuse: everything above is
                // somebody else's tree.
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
    agent_provider_of_program(name) == Some(AgentProvider::Codex)
}

/// Attach each candidate to the terminal that owns its process.
///
/// A terminal can host only one agent line; when several candidates share a
/// terminal (an agent spawning another one, a Codex process next to a Claude
/// one) the richest wins: Claude Code before Codex, then the newest pid.
///
/// A candidate whose pid no longer runs its agent is dropped outright: the
/// answer has to be "what is running *now*", never "what a file still says"
/// (ticket #32).
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
        // Empty table (a snapshot we could not take): keep the old, trusting
        // behaviour rather than silently dropping every agent.
        if !snapshot.is_empty() && !snapshot.runs_agent(candidate.pid, candidate.provider) {
            continue;
        }
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
            details: c.details.clone(),
            needs_input: None,
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
            details: AgentDetails::default(),
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
            details: AgentDetails::default(),
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

    // -- ticket #32: agent or not is derived from what runs, never inherited --

    #[test]
    fn program_stem_strips_path_quotes_and_extension() {
        assert_eq!(program_stem("claude"), "claude");
        assert_eq!(program_stem("CLAUDE.EXE"), "claude");
        assert_eq!(program_stem(r"C:\Users\me\.local\bin\claude.exe"), "claude");
        assert_eq!(program_stem("'/usr/local/bin/claude'"), "claude");
        assert_eq!(program_stem("\"C:\\bin\\codex.cmd\""), "codex");
    }

    #[test]
    fn only_the_first_token_of_a_command_line_decides() {
        assert_eq!(
            agent_provider_of_command("claude --dangerously-skip-permissions"),
            Some(AgentProvider::ClaudeCode)
        );
        assert_eq!(
            agent_provider_of_command(r"  C:\Users\me\.local\bin\claude.exe --resume abc"),
            Some(AgentProvider::ClaudeCode)
        );
        assert_eq!(
            agent_provider_of_command("ANTHROPIC_API_KEY=x claude"),
            Some(AgentProvider::ClaudeCode)
        );
        assert_eq!(
            agent_provider_of_command("codex resume 42"),
            Some(AgentProvider::Codex)
        );
        // The pitfall: an agent's name inside somebody else's arguments.
        assert_eq!(agent_provider_of_command(r#"git commit -m "fix claude thing""#), None);
        assert_eq!(agent_provider_of_command("echo claude"), None);
        assert_eq!(agent_provider_of_command("pwsh -NoLogo"), None);
        assert_eq!(agent_provider_of_command(""), None);
    }

    #[test]
    fn a_registry_pid_that_now_runs_a_shell_is_not_an_agent() {
        // The tab's own `pwsh` inherited the pid of a `claude` that exited
        // and left its `<pid>.json` behind. It is a terminal, not a session.
        let snap = ProcessSnapshot::from_entries(vec![
            (1, None, "init"),
            (100, Some(1), "pwsh.exe"),
        ]);
        let terms = vec![TerminalProcess {
            terminal_id: "shell:new-tab".into(),
            pid: 100,
            cwd: None,
        }];
        let out = correlate(&[claude(100, AgentState::Running)], &terms, &snap);
        assert!(out.is_empty(), "{out:?}");
    }

    #[test]
    fn a_dead_registry_pid_is_not_an_agent() {
        let out = correlate(&[claude(4242, AgentState::Running)], &terminals(), &snapshot());
        assert!(out.is_empty(), "{out:?}");
    }

    #[test]
    fn an_npm_shim_running_under_node_still_counts() {
        let snap = ProcessSnapshot::from_entries(vec![
            (100, None, "bash"),
            (101, Some(100), "node"),
        ]);
        let terms = vec![TerminalProcess {
            terminal_id: "shell:a".into(),
            pid: 100,
            cwd: None,
        }];
        let out = correlate(&[claude(101, AgentState::Running)], &terms, &snap);
        assert_eq!(out.len(), 1, "{out:?}");
    }

    #[test]
    fn a_recycled_parent_pid_does_not_adopt_an_agent() {
        // `claude` (started at t=100) hangs off a Warp shell whose own parent
        // died; that number now belongs to the shell of a tab opened at
        // t=500. Walking up must stop, not hand the agent to the new tab.
        let snap = ProcessSnapshot::from_dated_entries(vec![
            (100, Some(50), "pwsh.exe", 90u64),   // Warp's shell, parent gone
            (101, Some(100), "claude.exe", 100),  // the agent
            (50, None, "pwsh.exe", 500),          // the fresh CortX tab
        ]);
        let terms = vec![TerminalProcess {
            terminal_id: "shell:new-tab".into(),
            pid: 50,
            cwd: None,
        }];
        let out = correlate(&[claude(101, AgentState::Running)], &terms, &snap);
        assert!(out.is_empty(), "{out:?}");
    }

    #[test]
    fn a_real_parent_is_still_walked_through() {
        let snap = ProcessSnapshot::from_dated_entries(vec![
            (100, None, "pwsh.exe", 100u64),
            (101, Some(100), "npx.exe", 150),
            (102, Some(101), "claude.exe", 150),
        ]);
        let terms = vec![TerminalProcess {
            terminal_id: "shell:a".into(),
            pid: 100,
            cwd: None,
        }];
        let out = correlate(&[claude(102, AgentState::Running)], &terms, &snap);
        assert_eq!(out.len(), 1, "{out:?}");
        assert_eq!(out[0].terminal_id, "shell:a");
    }

    #[test]
    fn an_agent_that_exits_gives_the_terminal_back() {
        let terms = terminals();
        let running = ProcessSnapshot::from_entries(vec![
            (100, None, "pwsh.exe"),
            (101, Some(100), "claude.exe"),
        ]);
        assert_eq!(
            correlate(&[claude(101, AgentState::Running)], &terms, &running).len(),
            1
        );
        // Same registry entry, next pass, the process is gone.
        let after = ProcessSnapshot::from_entries(vec![(100, None, "pwsh.exe")]);
        assert!(correlate(&[claude(101, AgentState::Running)], &terms, &after).is_empty());
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

    fn live_agent(state: AgentState, tool: Option<&str>) -> TerminalAgent {
        TerminalAgent {
            terminal_id: "shell:a".into(),
            provider: AgentProvider::ClaudeCode,
            state,
            pid: 1,
            session_id: None,
            name: None,
            cwd: None,
            kind: None,
            details: AgentDetails { pending_tool: tool.map(Into::into), ..Default::default() },
            needs_input: None,
        }
    }

    fn needs(agent: TerminalAgent, idle_ms: Option<u64>) -> Option<NeedsInput> {
        let mut agents = vec![agent];
        mark_needs_input(&mut agents, |_| idle_ms.map(std::time::Duration::from_millis));
        agents[0].needs_input
    }

    #[test]
    fn a_pending_question_needs_you_at_once() {
        assert_eq!(needs(live_agent(AgentState::Running, Some("AskUserQuestion")), Some(0)), Some(NeedsInput::Question));
        assert_eq!(needs(live_agent(AgentState::Running, Some("ExitPlanMode")), None), Some(NeedsInput::Question));
        // An idle turn with a question still pending was interrupted.
        assert_eq!(needs(live_agent(AgentState::Waiting, Some("AskUserQuestion")), None), None);
    }

    #[test]
    fn a_tool_call_waits_for_permission_once_the_terminal_goes_quiet() {
        // Spinner still redrawing: the tool is running.
        assert_eq!(needs(live_agent(AgentState::Running, Some("Bash")), Some(300)), None);
        // Silent: the prompt is drawn and waits.
        assert_eq!(needs(live_agent(AgentState::Running, Some("Bash")), Some(4000)), Some(NeedsInput::Permission));
        // Turn reported idle with the call still pending: interrupted, not a prompt.
        assert_eq!(needs(live_agent(AgentState::Waiting, Some("Edit")), None), None);
    }

    #[test]
    fn nothing_pending_needs_nothing() {
        assert_eq!(needs(live_agent(AgentState::Running, None), Some(60_000)), None);
        assert_eq!(needs(live_agent(AgentState::Waiting, None), None), None);
        assert_eq!(needs(live_agent(AgentState::Unknown, Some("Bash")), Some(60_000)), None);
    }

    #[test]
    fn details_ride_along_in_camel_case() {
        let mut a = live_agent(AgentState::Running, Some("Bash"));
        a.details.last_prompt = Some("fix it".into());
        a.needs_input = Some(NeedsInput::Permission);
        let json = serde_json::to_value(&a).unwrap();
        assert_eq!(json["pendingTool"], "Bash");
        assert_eq!(json["lastPrompt"], "fix it");
        assert_eq!(json["needsInput"], "permission");
        assert!(json.get("model").is_none());
    }
}
