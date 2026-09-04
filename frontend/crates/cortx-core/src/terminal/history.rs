//! Append-only command history (`runtime/command-history.jsonl`).
//!
//! One JSON object per line, written when a shell reports the end of a
//! command through OSC 133. Fed by every CortX terminal, so this is the
//! cross-session history the palette will search (DEV-13 P4). Lives under
//! `runtime/`, i.e. outside the git backup, like the `<id>.log` files.

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Rotate to `.jsonl.1` past this size so the file can't grow forever.
const MAX_HISTORY_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandRecord {
    /// Epoch millis when the command finished.
    pub ts: i64,
    pub terminal_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone)]
pub struct CommandHistory {
    path: PathBuf,
}

impl CommandHistory {
    pub fn new(runtime_dir: &Path) -> Self {
        Self {
            path: runtime_dir.join("command-history.jsonl"),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Append one record. Errors are swallowed on purpose: history must
    /// never break a terminal.
    pub fn append(&self, record: &CommandRecord) {
        let _ = self.try_append(record);
    }

    fn try_append(&self, record: &CommandRecord) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        if let Ok(meta) = fs::metadata(&self.path) {
            if meta.len() > MAX_HISTORY_BYTES {
                let rotated = self.path.with_extension("jsonl.1");
                let _ = fs::rename(&self.path, rotated);
            }
        }
        let mut file = OpenOptions::new().create(true).append(true).open(&self.path)?;
        let line = serde_json::to_string(record).map_err(std::io::Error::other)?;
        writeln!(file, "{}", line)
    }

    /// Most recent records first, at most `limit`. Reads the whole file;
    /// fine for the 10 MB cap.
    pub fn recent(&self, limit: usize) -> Vec<CommandRecord> {
        let Ok(text) = fs::read_to_string(&self.path) else {
            return Vec::new();
        };
        text.lines()
            .rev()
            .filter_map(|l| serde_json::from_str(l).ok())
            .take(limit)
            .collect()
    }

    /// Rank the most recent `scan` records for `ctx` and keep the best
    /// `limit`. See [`rank_commands`].
    pub fn suggestions(
        &self,
        ctx: &SuggestContext,
        scan: usize,
        limit: usize,
    ) -> Vec<CommandSuggestion> {
        rank_commands(&self.recent(scan), ctx, limit)
    }
}

// ---------------------------------------------------------------------------
// Ranking (#17)
// ---------------------------------------------------------------------------

/// What the caller is doing right now, so identical commands can be ordered
/// by how relevant they are *here*.
#[derive(Debug, Clone, Default)]
pub struct SuggestContext {
    /// Directory the terminal is in (OSC 7). Compared case-insensitively on
    /// Windows, with trailing separators ignored.
    pub cwd: Option<String>,
    /// Project the terminal belongs to.
    pub project_id: Option<String>,
    /// "Now" in epoch millis; injected so the ranking is deterministic in tests.
    pub now_ms: i64,
}

/// One ranked command. The frontend filters these by the typed prefix; every
/// component of the score is prefix-independent on purpose, so the list can
/// be fetched once per prompt and filtered locally at zero cost.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestion {
    pub command: String,
    pub score: f64,
    /// How many times it was run (all directories).
    pub count: u32,
    /// Epoch millis of the most recent run.
    pub last_ts: i64,
    /// Never once exited 0 while having failed at least once. The frontend
    /// keeps these out of the way unless they are the only match.
    pub failed: bool,
    /// Ran at least once in `SuggestContext::cwd`.
    pub same_cwd: bool,
    /// Ran at least once in `SuggestContext::project_id`.
    pub same_project: bool,
}

/// Weight of `ln(1 + count)`: a command run ten times beats one run once,
/// but not by so much that yesterday's one-off disappears.
const W_FREQUENCY: f64 = 2.0;
/// Weight of the recency term (`exp(-age / RECENCY_HOURS)`, in 0..1).
const W_RECENCY: f64 = 3.0;
/// Ran in this very directory.
const W_SAME_CWD: f64 = 2.5;
/// Ran somewhere in this project (only counted when the cwd doesn't match).
const W_SAME_PROJECT: f64 = 1.0;
/// Never succeeded: pushed below everything that ever worked, but kept in the
/// list so it can still be offered when nothing else matches.
const W_FAILED: f64 = 4.0;
/// Recency decay constant, in hours.
const RECENCY_HOURS: f64 = 72.0;

fn normalise_cwd(path: &str) -> String {
    let trimmed = path.trim().trim_end_matches(['/', '\\']);
    if cfg!(windows) {
        trimmed.to_lowercase().replace('/', "\\")
    } else {
        trimmed.to_string()
    }
}

#[derive(Default)]
struct Agg {
    count: u32,
    successes: u32,
    failures: u32,
    last_ts: i64,
    same_cwd: bool,
    same_project: bool,
}

/// Rank distinct commands found in `records` for the given context.
///
/// Pure function: no clock, no filesystem. `records` may be in any order.
pub fn rank_commands(
    records: &[CommandRecord],
    ctx: &SuggestContext,
    limit: usize,
) -> Vec<CommandSuggestion> {
    let want_cwd = ctx.cwd.as_deref().map(normalise_cwd);
    let mut aggs: std::collections::HashMap<String, Agg> = std::collections::HashMap::new();

    for r in records.iter() {
        let Some(cmd) = r.command.as_deref().map(str::trim) else {
            continue;
        };
        if cmd.is_empty() {
            continue;
        }
        let entry = aggs.entry(cmd.to_string()).or_default();
        entry.count = entry.count.saturating_add(1);
        match r.exit_code {
            Some(0) => entry.successes = entry.successes.saturating_add(1),
            // A non-zero code is a failure; `None` (unknown / still running)
            // counts for neither, so it can't mark a command as broken.
            Some(_) => entry.failures = entry.failures.saturating_add(1),
            None => {}
        }
        entry.last_ts = entry.last_ts.max(r.ts);
        if let (Some(want), Some(got)) = (want_cwd.as_deref(), r.cwd.as_deref()) {
            if normalise_cwd(got) == want {
                entry.same_cwd = true;
            }
        }
        if let (Some(want), Some(got)) = (ctx.project_id.as_deref(), r.project_id.as_deref()) {
            if want == got {
                entry.same_project = true;
            }
        }
    }

    let mut out: Vec<CommandSuggestion> = aggs
        .into_iter()
        .map(|(command, a)| {
            let age_hours = ((ctx.now_ms - a.last_ts).max(0) as f64) / 3_600_000.0;
            let recency = (-age_hours / RECENCY_HOURS).exp();
            let failed = a.successes == 0 && a.failures > 0;
            let mut score = W_FREQUENCY * (1.0 + a.count as f64).ln() + W_RECENCY * recency;
            if a.same_cwd {
                score += W_SAME_CWD;
            } else if a.same_project {
                score += W_SAME_PROJECT;
            }
            if failed {
                score -= W_FAILED;
            }
            CommandSuggestion {
                command,
                score,
                count: a.count,
                last_ts: a.last_ts,
                failed,
                same_cwd: a.same_cwd,
                same_project: a.same_project,
            }
        })
        .collect();

    // Deterministic order: score, then recency, then the command itself.
    out.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.last_ts.cmp(&a.last_ts))
            .then(a.command.cmp(&b.command))
    });
    out.truncate(limit);
    out
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_then_recent_round_trips_newest_first() {
        let dir = std::env::temp_dir().join(format!("cortx-hist-{}", uuid::Uuid::new_v4()));
        let hist = CommandHistory::new(&dir);
        for i in 0..3 {
            hist.append(&CommandRecord {
                ts: i,
                terminal_id: "shell:a".into(),
                project_id: None,
                cwd: Some("/tmp".into()),
                command: Some(format!("cmd{}", i)),
                exit_code: Some(0),
                duration_ms: 10,
            });
        }
        let recent = hist.recent(2);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].command.as_deref(), Some("cmd2"));
        assert_eq!(recent[1].command.as_deref(), Some("cmd1"));
        let _ = fs::remove_dir_all(&dir);
    }

    fn rec(ts: i64, cmd: &str, cwd: &str, exit: Option<i32>) -> CommandRecord {
        CommandRecord {
            ts,
            terminal_id: "shell:a".into(),
            project_id: Some("p1".into()),
            cwd: Some(cwd.into()),
            command: Some(cmd.into()),
            exit_code: exit,
            duration_ms: 1,
        }
    }

    const HOUR: i64 = 3_600_000;

    #[test]
    fn ranking_prefers_the_current_directory() {
        let now = 100 * HOUR;
        // `cargo test` ran here once; `cargo build` ran elsewhere twice, more
        // recently. The cwd bonus must win.
        let records = vec![
            rec(now - 10 * HOUR, "cargo test", "/work/cortx", Some(0)),
            rec(now - 2 * HOUR, "cargo build", "/other", Some(0)),
            rec(now - HOUR, "cargo build", "/other", Some(0)),
        ];
        let ranked = rank_commands(
            &records,
            &SuggestContext {
                cwd: Some("/work/cortx".into()),
                project_id: None,
                now_ms: now,
            },
            10,
        );
        assert_eq!(ranked[0].command, "cargo test");
        assert!(ranked[0].same_cwd);
        assert!(!ranked[1].same_cwd);
    }

    #[test]
    fn ranking_falls_back_to_the_project_when_the_directory_differs() {
        let now = 100 * HOUR;
        let mut here = rec(now - 5 * HOUR, "npm run dev", "/work/cortx/sub", Some(0));
        here.project_id = Some("cortx".into());
        let mut elsewhere = rec(now - 5 * HOUR, "npm run build", "/somewhere", Some(0));
        elsewhere.project_id = Some("zorg".into());
        let ranked = rank_commands(
            &[here, elsewhere],
            &SuggestContext {
                cwd: Some("/work/cortx".into()),
                project_id: Some("cortx".into()),
                now_ms: now,
            },
            10,
        );
        assert_eq!(ranked[0].command, "npm run dev");
        assert!(ranked[0].same_project && !ranked[0].same_cwd);
    }

    #[test]
    fn ranking_sinks_commands_that_never_succeeded() {
        let now = 100 * HOUR;
        let records = vec![
            // Failed twice, just now, in this very directory: every other
            // signal is in its favour and it must still lose.
            rec(now - HOUR / 2, "cargo bild", "/work", Some(101)),
            rec(now - HOUR / 4, "cargo bild", "/work", Some(101)),
            rec(now - 40 * HOUR, "cargo build", "/work", Some(0)),
        ];
        let ranked = rank_commands(
            &records,
            &SuggestContext {
                cwd: Some("/work".into()),
                project_id: None,
                now_ms: now,
            },
            10,
        );
        assert_eq!(ranked[0].command, "cargo build");
        assert!(!ranked[0].failed);
        assert_eq!(ranked[1].command, "cargo bild");
        assert!(ranked[1].failed, "never-succeeded commands are flagged");
    }

    #[test]
    fn ranking_keeps_a_command_that_failed_once_but_worked_since() {
        let now = 100 * HOUR;
        let records = vec![
            rec(now - 3 * HOUR, "pytest", "/work", Some(1)),
            rec(now - 2 * HOUR, "pytest", "/work", Some(0)),
        ];
        let ranked = rank_commands(
            &records,
            &SuggestContext { cwd: None, project_id: None, now_ms: now },
            10,
        );
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].count, 2);
        assert!(!ranked[0].failed);
    }

    #[test]
    fn ranking_weighs_frequency_against_recency() {
        let now = 100 * HOUR;
        let mut records = vec![rec(now - 30 * HOUR, "git status", "/work", Some(0)); 8];
        records.push(rec(now - HOUR / 10, "ls", "/work", Some(0)));
        let ranked = rank_commands(
            &records,
            &SuggestContext { cwd: None, project_id: None, now_ms: now },
            10,
        );
        assert_eq!(ranked[0].command, "git status", "8 runs beat one very recent run");
        assert_eq!(ranked[0].count, 8);
    }

    #[test]
    fn ranking_ignores_blank_commands_and_unknown_exit_codes() {
        let mut blank = rec(0, "x", "/work", Some(0));
        blank.command = Some("   ".into());
        let mut no_cmd = rec(0, "x", "/work", None);
        no_cmd.command = None;
        let unknown = rec(0, "sleep 1", "/work", None);
        let ranked = rank_commands(
            &[blank, no_cmd, unknown],
            &SuggestContext { cwd: None, project_id: None, now_ms: 0 },
            10,
        );
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].command, "sleep 1");
        assert!(!ranked[0].failed, "an unknown exit code is not a failure");
    }

    #[test]
    fn ranking_is_deterministic_and_capped() {
        let records: Vec<_> = (0..20)
            .map(|i| rec(0, &format!("cmd{:02}", i), "/w", Some(0)))
            .collect();
        let ctx = SuggestContext { cwd: None, project_id: None, now_ms: 0 };
        let a = rank_commands(&records, &ctx, 5);
        let b = rank_commands(&records, &ctx, 5);
        assert_eq!(a, b);
        assert_eq!(a.len(), 5);
        assert_eq!(a[0].command, "cmd00", "equal scores fall back to the command name");
    }

    #[test]
    fn suggestions_reads_the_file_and_ranks_it() {
        let dir = std::env::temp_dir().join(format!("cortx-hist-rank-{}", uuid::Uuid::new_v4()));
        let hist = CommandHistory::new(&dir);
        hist.append(&rec(1, "cargo build", "/work", Some(0)));
        hist.append(&rec(2, "cargo bench", "/elsewhere", Some(0)));
        let ranked = hist.suggestions(
            &SuggestContext { cwd: Some("/work".into()), project_id: None, now_ms: 3 },
            500,
            10,
        );
        assert_eq!(ranked[0].command, "cargo build");
        let _ = fs::remove_dir_all(&dir);
    }
}
