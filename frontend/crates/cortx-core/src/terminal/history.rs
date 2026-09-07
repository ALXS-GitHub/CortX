//! Append-only command history (`runtime/command-history.jsonl`).
//!
//! One JSON object per line, written when a shell reports the end of a
//! command through OSC 133. Fed by every CortX terminal, so this is the
//! cross-session history the palette will search (DEV-13 P4). Lives under
//! `runtime/`, i.e. outside the git backup, like the `<id>.log` files.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
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
    /// Branch (or short commit id) the command ran on, when `cwd` was inside a
    /// git repository — Warp's `entry.git_head`. Added after the fact, hence
    /// `Option` + `serde(default)`: every line written before it exists reads
    /// back fine, with `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_head: Option<String>,
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

    /// One page of the history, filtered by `q`, newest first.
    ///
    /// The whole filter runs here rather than in the GUI: the file is capped
    /// at [`MAX_HISTORY_BYTES`], which is far more than a webview wants to
    /// hold, and every one of these predicates is a substring test the
    /// frontend would have to redo on every keystroke. One streamed pass
    /// answers the page, the match count and the facet lists at once.
    pub fn query(&self, q: &HistoryQuery) -> HistoryPage {
        let limit = if q.limit == 0 { DEFAULT_PAGE } else { q.limit.min(MAX_PAGE) };
        let offset = q.offset.min(MAX_OFFSET);
        let filter = Filter::new(q);
        // Only the last `offset + limit` matches can end up on the page, so
        // that is all that is ever held: a full 10 MB file never lands in RAM
        // as records.
        let keep = offset.saturating_add(limit);
        let mut window: VecDeque<CommandRecord> = VecDeque::with_capacity(keep.min(1024));
        let mut total = 0usize;
        let mut scanned = 0usize;
        let mut projects: HashMap<String, usize> = HashMap::new();
        let mut cwds: HashMap<String, usize> = HashMap::new();

        if let Ok(file) = File::open(&self.path) {
            for line in BufReader::new(file).lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                scanned += 1;
                let Ok(record) = serde_json::from_str::<CommandRecord>(&line) else {
                    continue;
                };
                if !filter.base(&record) {
                    continue;
                }
                // Facets ignore their own dimension, so narrowing to one
                // project still lists every directory of that project — and
                // the project list does not collapse to the one you picked.
                if filter.cwd(&record) {
                    if let Some(id) = record.project_id.as_deref() {
                        *projects.entry(id.to_string()).or_default() += 1;
                    }
                }
                if filter.project(&record) {
                    if let Some(dir) = record.cwd.as_deref() {
                        *cwds.entry(dir.to_string()).or_default() += 1;
                    }
                }
                if !(filter.cwd(&record) && filter.project(&record)) {
                    continue;
                }
                total += 1;
                if keep > 0 {
                    if window.len() == keep {
                        window.pop_front();
                    }
                    window.push_back(record);
                }
            }
        }

        let records: Vec<CommandRecord> = window.into_iter().rev().skip(offset).take(limit).collect();
        HistoryPage {
            has_more: offset + records.len() < total,
            records,
            total,
            scanned,
            projects: top_facets(projects),
            cwds: top_facets(cwds),
        }
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
// Querying (#39)
// ---------------------------------------------------------------------------

/// Page size when the caller does not ask for one.
const DEFAULT_PAGE: usize = 200;
/// Hard ceiling on one page, so a bad `limit` cannot pull the whole file.
const MAX_PAGE: usize = 2000;
/// Paging past this is a scroll nobody does; clamped rather than refused.
const MAX_OFFSET: usize = 100_000;
/// How many distinct values a facet list carries back.
const FACET_LIMIT: usize = 60;

/// Filters of the history view. Every field is optional; the default query is
/// "the whole file, newest first".
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HistoryQuery {
    /// Case-insensitive words that must *all* appear in the command, in any
    /// order — so `docker cortx` finds `docker run … cortx`.
    pub search: Option<String>,
    pub project_id: Option<String>,
    /// Exact working directory, compared the way [`rank_commands`] does
    /// (case-insensitively and separator-agnostically on Windows).
    pub cwd: Option<String>,
    pub terminal_id: Option<String>,
    /// Keep only commands that exited non-zero. An unknown exit code is not a
    /// failure (same rule as the ranking).
    pub failures_only: bool,
    /// Keep only commands that ran at least this long.
    pub min_duration_ms: Option<u64>,
    /// Keep only commands that finished at or after this instant.
    pub since_ms: Option<i64>,
    pub offset: usize,
    pub limit: usize,
}

/// One value of a filter dropdown, with how many records carry it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFacet {
    pub value: String,
    pub count: usize,
}

/// One page of [`CommandHistory::query`].
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    /// The page itself, newest first.
    pub records: Vec<CommandRecord>,
    /// Records matching the whole query, not just this page.
    pub total: usize,
    /// True when there is a next page.
    pub has_more: bool,
    /// Lines the file held, matched or not.
    pub scanned: usize,
    /// Projects present, ignoring the `project_id` filter.
    pub projects: Vec<HistoryFacet>,
    /// Directories present, ignoring the `cwd` filter.
    pub cwds: Vec<HistoryFacet>,
}

/// The query compiled once, so the per-record test is only comparisons.
struct Filter {
    words: Vec<String>,
    project_id: Option<String>,
    cwd: Option<String>,
    terminal_id: Option<String>,
    failures_only: bool,
    min_duration_ms: u64,
    since_ms: Option<i64>,
}

impl Filter {
    fn new(q: &HistoryQuery) -> Self {
        Self {
            words: q
                .search
                .as_deref()
                .unwrap_or_default()
                .split_whitespace()
                .map(str::to_lowercase)
                .collect(),
            project_id: q.project_id.clone().filter(|s| !s.is_empty()),
            cwd: q.cwd.as_deref().map(normalise_cwd).filter(|s| !s.is_empty()),
            terminal_id: q.terminal_id.clone().filter(|s| !s.is_empty()),
            failures_only: q.failures_only,
            min_duration_ms: q.min_duration_ms.unwrap_or(0),
            since_ms: q.since_ms,
        }
    }

    /// Everything except the two facet dimensions.
    fn base(&self, r: &CommandRecord) -> bool {
        if self.failures_only && !matches!(r.exit_code, Some(code) if code != 0) {
            return false;
        }
        if r.duration_ms < self.min_duration_ms {
            return false;
        }
        if let Some(since) = self.since_ms {
            if r.ts < since {
                return false;
            }
        }
        if let Some(id) = &self.terminal_id {
            if &r.terminal_id != id {
                return false;
            }
        }
        if !self.words.is_empty() {
            let command = r.command.as_deref().unwrap_or_default().to_lowercase();
            if !self.words.iter().all(|w| command.contains(w.as_str())) {
                return false;
            }
        }
        true
    }

    fn project(&self, r: &CommandRecord) -> bool {
        match &self.project_id {
            None => true,
            Some(want) => r.project_id.as_deref() == Some(want.as_str()),
        }
    }

    fn cwd(&self, r: &CommandRecord) -> bool {
        match &self.cwd {
            None => true,
            Some(want) => r.cwd.as_deref().map(normalise_cwd).as_deref() == Some(want.as_str()),
        }
    }
}

/// The most common values first, then alphabetically, capped at
/// [`FACET_LIMIT`] so a decade of directories cannot flood the dropdown.
fn top_facets(counts: HashMap<String, usize>) -> Vec<HistoryFacet> {
    let mut out: Vec<HistoryFacet> = counts
        .into_iter()
        .map(|(value, count)| HistoryFacet { value, count })
        .collect();
    out.sort_by(|a, b| b.count.cmp(&a.count).then(a.value.cmp(&b.value)));
    out.truncate(FACET_LIMIT);
    out
}

// ---------------------------------------------------------------------------
// git HEAD (#39)
// ---------------------------------------------------------------------------

/// How far up from the working directory a `.git` is looked for.
const GIT_SEARCH_DEPTH: usize = 40;

/// The git ref a command ran on: the branch name when HEAD points at one,
/// the short commit id when it is detached, `None` outside a repository.
///
/// `.git/HEAD` is read directly instead of shelling out to `git`: this runs on
/// the PTY reader thread once per command, where spawning a process would cost
/// milliseconds and could block. The walk up is a handful of `metadata` calls
/// and the read is one line, so the whole thing is a few filesystem lookups.
/// Nothing is cached — checking out a branch has to show up on the very next
/// command, and the value is only ever read once per command anyway.
pub fn git_head(cwd: &Path) -> Option<String> {
    let git_dir = find_git_dir(cwd)?;
    parse_head(&fs::read_to_string(git_dir.join("HEAD")).ok()?)
}

fn find_git_dir(cwd: &Path) -> Option<PathBuf> {
    let mut dir = cwd;
    for _ in 0..GIT_SEARCH_DEPTH {
        let candidate = dir.join(".git");
        match fs::metadata(&candidate) {
            Ok(meta) if meta.is_dir() => return Some(candidate),
            // A linked worktree or a submodule: `.git` is a file pointing at
            // the real directory, which is where HEAD lives.
            Ok(_) => return resolve_gitdir_file(&candidate, dir),
            Err(_) => {}
        }
        dir = dir.parent()?;
    }
    None
}

/// `.git` as a file: `gitdir: <path>`, absolute or relative to `base`.
fn resolve_gitdir_file(file: &Path, base: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(file).ok()?;
    let target = text.lines().next()?.trim().strip_prefix("gitdir:")?.trim();
    if target.is_empty() {
        return None;
    }
    let path = Path::new(target);
    Some(if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    })
}

/// `ref: refs/heads/main` → `main`; a detached HEAD → the first 8 characters
/// of the commit id.
fn parse_head(text: &str) -> Option<String> {
    let line = text.lines().next()?.trim();
    if line.is_empty() {
        return None;
    }
    if let Some(reference) = line.strip_prefix("ref:") {
        let reference = reference.trim();
        let name = reference.strip_prefix("refs/heads/").unwrap_or(reference);
        return (!name.is_empty()).then(|| name.to_string());
    }
    let id: String = line.chars().take_while(char::is_ascii_hexdigit).collect();
    (id.len() >= 7).then(|| id.chars().take(8).collect())
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
                git_head: None,
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
            git_head: None,
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

    // -----------------------------------------------------------------------
    // git HEAD (#39)
    // -----------------------------------------------------------------------

    #[test]
    fn head_parses_a_branch_a_detached_commit_and_junk() {
        assert_eq!(parse_head("ref: refs/heads/main\n").as_deref(), Some("main"));
        assert_eq!(
            parse_head("ref: refs/heads/feat/terminal-mode\n").as_deref(),
            Some("feat/terminal-mode")
        );
        // A ref that is not a branch (a tag checkout) keeps its full name.
        assert_eq!(parse_head("ref: refs/tags/v1.2\n").as_deref(), Some("refs/tags/v1.2"));
        assert_eq!(
            parse_head("8e1cb4529b6f1d0a3c5e7f9012345678abcdef01\n").as_deref(),
            Some("8e1cb452"),
            "a detached HEAD is shortened the way git does"
        );
        assert_eq!(parse_head(""), None);
        assert_eq!(parse_head("   \n"), None);
        assert_eq!(parse_head("ref:\n"), None);
        assert_eq!(parse_head("deadbee\n").as_deref(), Some("deadbee"), "7 is the shortest id");
        assert_eq!(parse_head("nope\n"), None, "too short to be a commit id");
    }

    #[test]
    fn git_head_walks_up_and_follows_a_gitdir_file() {
        let root = std::env::temp_dir().join(format!("cortx-head-{}", uuid::Uuid::new_v4()));
        let deep = root.join("repo").join("src").join("terminal");
        fs::create_dir_all(&deep).unwrap();
        // A real repository: `.git` is a directory.
        let git = root.join("repo").join(".git");
        fs::create_dir_all(&git).unwrap();
        fs::write(git.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        assert_eq!(git_head(&deep).as_deref(), Some("main"), "found from a nested directory");
        // Outside any repository.
        assert_eq!(git_head(&root), None);

        // A linked worktree: `.git` is a file pointing at the real dir.
        let wt = root.join("wt");
        fs::create_dir_all(&wt).unwrap();
        let real = git.join("worktrees").join("wt");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("HEAD"), "ref: refs/heads/side\n").unwrap();
        fs::write(wt.join(".git"), format!("gitdir: {}\n", real.display())).unwrap();
        assert_eq!(git_head(&wt).as_deref(), Some("side"));

        let _ = fs::remove_dir_all(&root);
    }

    // -----------------------------------------------------------------------
    // Backwards compatibility (#39)
    // -----------------------------------------------------------------------

    #[test]
    fn old_history_files_without_git_head_still_read() {
        // Byte-for-byte a line written before `gitHead` existed.
        let old = r#"{"ts":1757000000000,"terminalId":"shell:a","projectId":"p1","cwd":"/work","command":"cargo build","exitCode":0,"durationMs":4200}"#;
        let parsed: CommandRecord = serde_json::from_str(old).expect("an old line must still parse");
        assert_eq!(parsed.command.as_deref(), Some("cargo build"));
        assert_eq!(parsed.git_head, None);

        // And through the real reader, mixed with new lines.
        let dir = std::env::temp_dir().join(format!("cortx-hist-compat-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let hist = CommandHistory::new(&dir);
        fs::write(hist.path(), format!("{}\n", old)).unwrap();
        let mut fresh = rec(1757000001000, "cargo test", "/work", Some(0));
        fresh.git_head = Some("main".into());
        hist.append(&fresh);

        let recent = hist.recent(10);
        assert_eq!(recent.len(), 2, "the old line is not dropped");
        assert_eq!(recent[0].git_head.as_deref(), Some("main"));
        assert_eq!(recent[1].git_head, None);

        // A record without a branch must not write the key at all, so a file
        // read by an older build stays exactly what it was.
        let line = serde_json::to_string(&rec(1, "ls", "/work", Some(0))).unwrap();
        assert!(!line.contains("gitHead"), "no null noise in the file: {line}");
        assert!(serde_json::to_string(&fresh).unwrap().contains(r#""gitHead":"main""#));

        let _ = fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------------
    // Query (#39)
    // -----------------------------------------------------------------------

    fn seeded() -> (PathBuf, CommandHistory) {
        let dir = std::env::temp_dir().join(format!("cortx-hist-q-{}", uuid::Uuid::new_v4()));
        let hist = CommandHistory::new(&dir);
        let mk = |ts: i64, cmd: &str, cwd: &str, exit: Option<i32>, ms: u64, project: &str| {
            let mut r = rec(ts, cmd, cwd, exit);
            r.cwd = Some(cwd.into());
            r.project_id = Some(project.into());
            r.duration_ms = ms;
            hist.append(&r);
        };
        mk(1, "cargo build", "/work/cortx", Some(0), 12_000, "cortx");
        mk(2, "docker compose up", "/work/cortx", Some(1), 900, "cortx");
        mk(3, "git status", "/work/zorg", Some(0), 40, "zorg");
        mk(4, "docker ps", "/work/zorg/sub", Some(0), 30, "zorg");
        mk(5, "cargo test", "/work/cortx", Some(101), 30_000, "cortx");
        (dir, hist)
    }

    #[test]
    fn query_returns_the_newest_first_with_totals() {
        let (dir, hist) = seeded();
        let page = hist.query(&HistoryQuery::default());
        assert_eq!(page.total, 5);
        assert_eq!(page.scanned, 5);
        assert!(!page.has_more);
        assert_eq!(page.records[0].command.as_deref(), Some("cargo test"));
        assert_eq!(page.records[4].command.as_deref(), Some("cargo build"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn query_filters_on_every_stored_field() {
        let (dir, hist) = seeded();
        let q = |f: fn(&mut HistoryQuery)| {
            let mut q = HistoryQuery::default();
            f(&mut q);
            hist.query(&q)
        };

        // Text search: all words, any order.
        let found = q(|q| q.search = Some("docker".into()));
        assert_eq!(found.total, 2);
        let found = q(|q| q.search = Some("UP compose".into()));
        assert_eq!(found.total, 1, "words match in any order, case-insensitively");

        // Failures only: a non-zero code, never an unknown one.
        let failures = q(|q| q.failures_only = true);
        assert_eq!(failures.total, 2);
        assert!(failures.records.iter().all(|r| r.exit_code.unwrap_or(0) != 0));

        // Long commands.
        let slow = q(|q| q.min_duration_ms = Some(10_000));
        assert_eq!(slow.total, 2);

        // Project, then directory (which is exact, not a prefix).
        assert_eq!(q(|q| q.project_id = Some("zorg".into())).total, 2);
        assert_eq!(q(|q| q.cwd = Some("/work/zorg".into())).total, 1);
        assert_eq!(q(|q| q.since_ms = Some(4)).total, 2);
        assert_eq!(q(|q| q.terminal_id = Some("shell:a".into())).total, 5);
        assert_eq!(q(|q| q.terminal_id = Some("shell:zzz".into())).total, 0);

        // Combined.
        let both = HistoryQuery {
            project_id: Some("cortx".into()),
            failures_only: true,
            ..Default::default()
        };
        assert_eq!(hist.query(&both).total, 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn query_pages_without_holding_the_whole_file() {
        let (dir, hist) = seeded();
        let mut q = HistoryQuery { limit: 2, ..Default::default() };
        let first = hist.query(&q);
        assert_eq!(first.records.len(), 2);
        assert_eq!(first.total, 5);
        assert!(first.has_more);
        assert_eq!(first.records[0].command.as_deref(), Some("cargo test"));

        q.offset = 4;
        let last = hist.query(&q);
        assert_eq!(last.records.len(), 1, "the tail page is short");
        assert!(!last.has_more);
        assert_eq!(last.records[0].command.as_deref(), Some("cargo build"));

        q.offset = 99;
        assert!(hist.query(&q).records.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn query_facets_ignore_their_own_dimension() {
        let (dir, hist) = seeded();
        let page = hist.query(&HistoryQuery::default());
        assert_eq!(
            page.projects,
            vec![
                HistoryFacet { value: "cortx".into(), count: 3 },
                HistoryFacet { value: "zorg".into(), count: 2 },
            ]
        );
        assert_eq!(page.cwds.len(), 3);

        // Narrowed to one project, the project list must still offer the
        // other one — otherwise the dropdown collapses to the current choice.
        let narrowed = hist.query(&HistoryQuery {
            project_id: Some("zorg".into()),
            ..Default::default()
        });
        assert_eq!(narrowed.total, 2);
        assert_eq!(narrowed.projects.len(), 2, "the project facet ignores the project filter");
        assert_eq!(narrowed.cwds.len(), 2, "directories are narrowed to the project");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn query_survives_a_missing_file_and_a_corrupt_line() {
        let dir = std::env::temp_dir().join(format!("cortx-hist-bad-{}", uuid::Uuid::new_v4()));
        let hist = CommandHistory::new(&dir);
        let empty = hist.query(&HistoryQuery::default());
        assert_eq!(empty.total, 0);
        assert_eq!(empty.scanned, 0);

        fs::create_dir_all(&dir).unwrap();
        fs::write(hist.path(), "{not json}\n\n").unwrap();
        hist.append(&rec(1, "ls", "/w", Some(0)));
        let page = hist.query(&HistoryQuery::default());
        assert_eq!(page.scanned, 2, "the blank line is skipped, the junk one is counted");
        assert_eq!(page.total, 1, "and only the readable record comes back");
        let _ = fs::remove_dir_all(&dir);
    }
}
