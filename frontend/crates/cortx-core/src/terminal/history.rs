//! Append-only command history (`runtime/command-history.jsonl`).
//!
//! One JSON object per line, written when a shell reports the end of a
//! command through OSC 133. Fed by every CortX terminal, so this is the
//! cross-session history the palette will search (DEV-13 P4). Lives under
//! `runtime/`, i.e. outside the git backup, like the `<id>.log` files.

use super::redact;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Compact past this size so the file can't grow forever: it is rewritten
/// with only its most recent half (see [`CommandHistory::compact`]).
///
/// At ~250 bytes a record, 10 MB is about 40 000 commands, so one rewrite
/// every ~20 000 — a few tens of milliseconds, that rare.
pub const DEFAULT_MAX_HISTORY_BYTES: u64 = 10 * 1024 * 1024;

/// Floor for the cap. Below this, compaction would fire on nearly every
/// append and the file would never hold a useful number of commands.
pub const MIN_MAX_HISTORY_BYTES: u64 = 4 * 1024;

/// How much is read at a time when walking a history file backwards.
const TAIL_CHUNK: usize = 64 * 1024;

/// Default for `terminal.redactSecrets` — deliberately **on**.
///
/// The two failure modes are not symmetric. Masking a value nobody cared about
/// costs one less useful line in the history view. *Not* masking one puts a
/// live credential in a plain-text file, in the Ctrl+R view and in the
/// suggestion ranking, and leaves it there for the life of the file.
pub const DEFAULT_REDACT_SECRETS: bool = true;

/// How long `terminal.redactSecrets` is trusted before `settings.json` is read
/// again. Long enough that a busy terminal is not re-reading the file on every
/// prompt, short enough that flipping the switch takes effect while the user is
/// still looking at the Settings page.
const REDACT_SETTING_TTL: Duration = Duration::from_secs(5);

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
    /// Size past which [`compact`](Self::compact) rewrites the file.
    ///
    /// Shared rather than copied: `CommandHistory` derives `Clone` and the
    /// Tauri commands clone it off the process manager to move work onto a
    /// blocking thread, so a plain field would let each copy drift from the
    /// setting. One cell behind an `Arc` means [`set_max_bytes`] reaches the
    /// clone that is actually appending.
    max_bytes: Arc<AtomicU64>,
    /// `terminal.redactSecrets` — see [`redact_secrets`](Self::redact_secrets).
    /// Shared for the same reason as `max_bytes`: the clone that appends has to
    /// see the same answer as the one that was configured.
    redact: Arc<Mutex<RedactSetting>>,
}

/// The cached answer to "is `terminal.redactSecrets` on?".
#[derive(Debug, Default)]
struct RedactSetting {
    /// Set by [`CommandHistory::set_redact_secrets`]; wins over the file.
    forced: Option<bool>,
    /// The last value read from `settings.json`, and when it was read.
    cached: Option<(Instant, bool)>,
}

impl CommandHistory {
    pub fn new(runtime_dir: &Path) -> Self {
        Self {
            path: runtime_dir.join("command-history.jsonl"),
            max_bytes: Arc::new(AtomicU64::new(DEFAULT_MAX_HISTORY_BYTES)),
            redact: Arc::new(Mutex::new(RedactSetting::default())),
        }
    }

    /// Override the size cap. Clamped to something that can still hold a
    /// useful number of commands — a cap of a few bytes would compact on
    /// every append.
    pub fn with_max_bytes(self, bytes: u64) -> Self {
        self.set_max_bytes(bytes);
        self
    }

    /// The size cap, from the setting. Takes `&self` so it can be called on
    /// the live history rather than only at construction — `ProcessManager`
    /// builds this before any setting has been read.
    pub fn set_max_bytes(&self, bytes: u64) {
        self.max_bytes
            .store(bytes.max(MIN_MAX_HISTORY_BYTES), Ordering::Relaxed);
    }

    fn max_bytes(&self) -> u64 {
        self.max_bytes.load(Ordering::Relaxed)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    // -----------------------------------------------------------------------
    // `terminal.redactSecrets`
    // -----------------------------------------------------------------------

    /// Where `settings.json` lives, derived from the runtime directory this was
    /// built with: `Storage` keeps `runtime/` inside the application data
    /// directory and `settings.json` right beside it.
    ///
    /// Read straight off disk rather than through `Storage`, the way
    /// `shell_init::resolve_block_spacing` does: appends happen on the PTY
    /// reader thread, which holds no handle on the store.
    fn settings_path(&self) -> Option<PathBuf> {
        Some(self.path.parent()?.parent()?.join("settings.json"))
    }

    /// Pin the setting, ignoring `settings.json` — for tests, and for any
    /// caller that already holds the parsed settings.
    pub fn set_redact_secrets(&self, on: bool) {
        self.redact.lock().forced = Some(on);
    }

    /// [`set_redact_secrets`](Self::set_redact_secrets) as a builder.
    pub fn with_redact_secrets(self, on: bool) -> Self {
        self.set_redact_secrets(on);
        self
    }

    /// Is `terminal.redactSecrets` on? Cached for [`REDACT_SETTING_TTL`].
    pub fn redact_secrets(&self) -> bool {
        let mut state = self.redact.lock();
        if let Some(forced) = state.forced {
            return forced;
        }
        if let Some((at, value)) = state.cached {
            if at.elapsed() < REDACT_SETTING_TTL {
                return value;
            }
        }
        let value = read_redact_setting(self.settings_path().as_deref());
        state.cached = Some((Instant::now(), value));
        value
    }

    /// The record as it should be written: same thing, with any secret in the
    /// command line replaced (see [`redact`]).
    ///
    /// Borrowed whenever there was nothing to hide, which is almost always, so
    /// the ordinary command costs no clone.
    fn redacted<'a>(&self, record: &'a CommandRecord) -> Cow<'a, CommandRecord> {
        let Some(command) = record.command.as_deref() else {
            return Cow::Borrowed(record);
        };
        if !self.redact_secrets() {
            return Cow::Borrowed(record);
        }
        match redact::redact(command) {
            Cow::Borrowed(_) => Cow::Borrowed(record),
            Cow::Owned(clean) => {
                let mut copy = record.clone();
                copy.command = Some(clean);
                Cow::Owned(copy)
            }
        }
    }

    /// The `.jsonl.1` archive older builds rotated to. Never written any
    /// more, but still read: it holds real commands, and until the next
    /// compaction folds it away it is the only copy of them.
    fn archive_path(&self) -> PathBuf {
        self.path.with_extension("jsonl.1")
    }

    /// Append one record. Errors are swallowed on purpose: history must
    /// never break a terminal.
    ///
    /// This is the *only* place a command line is written down, which is why
    /// the secret filter sits here: the history view, the Ctrl+R search and the
    /// suggestion ranking all read this one file back, so masking on the way in
    /// covers all three at once — and nothing has to be un-leaked afterwards.
    pub fn append(&self, record: &CommandRecord) {
        let _ = self.try_append(record);
    }

    fn try_append(&self, record: &CommandRecord) -> std::io::Result<()> {
        // First, before any I/O: a secret that reaches the file once is in the
        // history for good.
        let redacted = self.redacted(record);
        let record: &CommandRecord = &redacted;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        if let Ok(meta) = fs::metadata(&self.path) {
            if meta.len() > self.max_bytes() {
                if let Err(e) = self.compact() {
                    log::warn!("Could not compact {}: {}", self.path.display(), e);
                }
            }
        }
        let mut file = OpenOptions::new().create(true).append(true).open(&self.path)?;
        let line = serde_json::to_string(record).map_err(std::io::Error::other)?;
        writeln!(file, "{}", line)
    }

    /// Rewrite the history with only its most recent half.
    ///
    /// This replaces the `.jsonl.1` rotation that used to happen here. The
    /// rotation renamed the file away and *no reader ever opened the result*,
    /// so crossing the cap emptied the history view, the Ctrl+R search and
    /// the inline suggestions in one go — and the next rotation overwrote the
    /// archive for good. Keeping the recent half in the one file everything
    /// reads costs the same rewrite and loses half as much, once per
    /// ~20 000 commands instead of all of it once per 40 000.
    ///
    /// The new file is written beside the old one and renamed over it, so a
    /// crash (or a power cut) mid-compaction leaves either the whole old file
    /// or the whole compacted one — never a truncated history. The copy also
    /// starts at a line boundary, so the first record is never half a line.
    fn compact(&self) -> std::io::Result<()> {
        let keep = self.max_bytes() / 2;
        let mut file = File::open(&self.path)?;
        let size = file.seek(SeekFrom::End(0))?;
        let start = line_start_at_or_after(&mut file, size.saturating_sub(keep))?;
        file.seek(SeekFrom::Start(start))?;

        let tmp = self.path.with_extension("jsonl.tmp");
        {
            // `create` truncates, so a `.jsonl.tmp` left by an interrupted
            // compaction is simply overwritten.
            let mut out = File::create(&tmp)?;
            std::io::copy(&mut file, &mut out)?;
            out.sync_all()?;
        }
        // Close the source before renaming over it: Windows is the platform
        // that minds.
        drop(file);
        match fs::rename(&tmp, &self.path) {
            Ok(()) => {
                // Everything the legacy archive holds predates the half that
                // was just dropped from the live file, so it goes with it —
                // it was readable right up to this point, which is the part
                // the rotation got wrong.
                let _ = fs::remove_file(self.archive_path());
                Ok(())
            }
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                Err(e)
            }
        }
    }

    /// Most recent records first, at most `limit`.
    ///
    /// Walks the file backwards from the end and stops as soon as it has
    /// enough, so the 4 000 records the suggestion ranking asks for cost
    /// ~1 MB rather than the whole cap. This runs on the IPC thread through
    /// `suggest_history`, several times a minute.
    pub fn recent(&self, limit: usize) -> Vec<CommandRecord> {
        let mut out = Vec::with_capacity(limit.min(4096));
        tail_records(&self.path, limit, &mut out);
        // Older than anything above, hence last — see `archive_path`.
        tail_records(&self.archive_path(), limit, &mut out);
        out
    }

    /// One page of the history, filtered by `q`, newest first.
    ///
    /// The whole filter runs here rather than in the GUI: the file is capped
    /// at [`DEFAULT_MAX_HISTORY_BYTES`], which is far more than a webview
    /// wants to hold, and every one of these predicates is a substring test
    /// the frontend would have to redo on every keystroke. One streamed pass
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

        // Oldest first, so `window` ends up holding the newest matches: the
        // legacy `.jsonl.1` archive (when one is still around) precedes the
        // live file.
        for path in [self.archive_path(), self.path.clone()] {
            let Ok(file) = File::open(&path) else {
                continue;
            };
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

    /// Run the secret filter over the history **that is already on disk**.
    ///
    /// Nothing calls this. It is deliberately a lever rather than a reflex:
    /// the file predates the filter and may hold credentials the user has
    /// since rotated, or notes they would rather keep — rewriting it behind
    /// their back at the next start would be a decision taken for them, and it
    /// cannot be undone. Wire it to a button or a command and it cleans the
    /// file in one pass; leave it alone and the old lines stay exactly as they
    /// are, with every *new* line masked on the way in.
    ///
    /// Applies whatever `terminal.redactSecrets` says, because running this is
    /// already an explicit answer to that question.
    ///
    /// Each line is rewritten only if its command actually changed; everything
    /// else is copied byte for byte, so no field drifts and no line a future
    /// build understands better than this one is flattened. The rewrite goes
    /// through a temporary and a rename, like [`compact`](Self::compact), so an
    /// interruption leaves the whole old file or the whole new one. There is no
    /// backup on purpose: a `.bak` with the secrets still in it would defeat
    /// the point.
    pub fn redact_existing(&self) -> std::io::Result<RedactionReport> {
        let mut report = RedactionReport::default();
        for path in [self.path.clone(), self.archive_path()] {
            if path.exists() {
                report.add(redact_file(&path)?);
            }
        }
        Ok(report)
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

/// What one pass of [`CommandHistory::redact_existing`] did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactionReport {
    /// Lines read.
    pub scanned: usize,
    /// Lines whose command held a secret and was masked.
    pub redacted: usize,
    /// Lines that are not readable records and were kept byte for byte. They
    /// are copied rather than rewritten because their shape is unknown — a
    /// count here is worth looking at rather than ignoring.
    pub skipped: usize,
}

impl RedactionReport {
    fn add(&mut self, other: RedactionReport) {
        self.scanned += other.scanned;
        self.redacted += other.redacted;
        self.skipped += other.skipped;
    }
}

/// One history file, rewritten with the secret filter applied.
fn redact_file(path: &Path) -> std::io::Result<RedactionReport> {
    let mut report = RedactionReport::default();
    let tmp = path.with_extension("jsonl.redact.tmp");
    {
        let source = File::open(path)?;
        // `create` truncates, so a temporary left by an interrupted pass is
        // simply overwritten.
        let mut out = File::create(&tmp)?;
        for line in BufReader::new(source).lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            report.scanned += 1;
            match serde_json::from_str::<CommandRecord>(&line) {
                Ok(mut record) => {
                    // Owned before the record is touched, so nothing is still
                    // borrowing it when the command is put back.
                    let cleaned = match record.command.as_deref() {
                        Some(command) => match redact::redact(command) {
                            Cow::Owned(clean) => Some(clean),
                            Cow::Borrowed(_) => None,
                        },
                        None => None,
                    };
                    match cleaned {
                        Some(clean) => {
                            report.redacted += 1;
                            record.command = Some(clean);
                            let json =
                                serde_json::to_string(&record).map_err(std::io::Error::other)?;
                            writeln!(out, "{}", json)?;
                        }
                        // Nothing to hide: keep the original bytes, so no
                        // field this build does not know about is lost.
                        None => writeln!(out, "{}", line)?,
                    }
                }
                Err(_) => {
                    report.skipped += 1;
                    writeln!(out, "{}", line)?;
                }
            }
        }
        out.sync_all()?;
        // Close the source before renaming over it: Windows is the platform
        // that minds.
    }
    match fs::rename(&tmp, path) {
        Ok(()) => Ok(report),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// `terminal.redactSecrets` out of `settings.json`, defaulting to
/// [`DEFAULT_REDACT_SECRETS`].
///
/// Every way this can go wrong — no settings file yet, a file written by a
/// build that has never heard of the key, a parse error, a permission problem
/// — resolves to "redact". The only direction the failure can take is masking
/// a little more than the user asked for; it can never be the one that writes a
/// credential out.
fn read_redact_setting(path: Option<&Path>) -> bool {
    fn read(path: &Path) -> Option<bool> {
        let bytes = fs::read(path).ok()?;
        let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
        json.get("terminal")?.get("redactSecrets")?.as_bool()
    }
    path.and_then(read).unwrap_or(DEFAULT_REDACT_SECRETS)
}

// ---------------------------------------------------------------------------
// Reading from the end (#50)
// ---------------------------------------------------------------------------

/// Append records from the end of `path`, newest first, until `out` holds
/// `limit` of them (whatever it held on entry counts).
///
/// The file is read backwards in [`TAIL_CHUNK`] blocks and stops as soon as
/// there are enough records, so this is bounded by what the caller asked for
/// rather than by the size of the history. Splitting raw bytes on `\n` is
/// safe: a newline can never appear inside a multi-byte UTF-8 sequence.
///
/// Anything unreadable — a missing file, a bad seek, a corrupt line — yields
/// what was collected so far. History must never break a terminal.
fn tail_records(path: &Path, limit: usize, out: &mut Vec<CommandRecord>) {
    if out.len() >= limit {
        return;
    }
    let Ok(mut file) = File::open(path) else {
        return;
    };
    let Ok(size) = file.seek(SeekFrom::End(0)) else {
        return;
    };
    let mut pos = size;
    // The bytes read so far that are not yet a complete line: always a prefix
    // of some line, so at most one record long.
    let mut head: Vec<u8> = Vec::new();
    while pos > 0 && out.len() < limit {
        let step = (TAIL_CHUNK as u64).min(pos);
        pos -= step;
        let mut chunk = vec![0u8; step as usize];
        if file.seek(SeekFrom::Start(pos)).is_err() || file.read_exact(&mut chunk).is_err() {
            return;
        }
        chunk.extend_from_slice(&head);
        head = chunk;
        // Whatever follows a newline is a whole line; what comes before the
        // first one may still be continued by the chunk before it.
        while out.len() < limit {
            let Some(nl) = head.iter().rposition(|&b| b == b'\n') else {
                break;
            };
            push_record(&head[nl + 1..], out);
            head.truncate(nl);
        }
    }
    // Start of file reached: what is left is a whole line after all.
    if pos == 0 && out.len() < limit {
        push_record(&head, out);
    }
}

fn push_record(line: &[u8], out: &mut Vec<CommandRecord>) {
    let Ok(text) = std::str::from_utf8(line) else {
        return;
    };
    if text.trim().is_empty() {
        return;
    }
    if let Ok(record) = serde_json::from_str(text) {
        out.push(record);
    }
}

/// Offset of the first line starting at or after `offset`, so a compacted
/// file never begins in the middle of a record. Returns the file size when
/// there is no newline left (a single oversized line), i.e. "keep nothing".
fn line_start_at_or_after(file: &mut File, offset: u64) -> std::io::Result<u64> {
    if offset == 0 {
        return Ok(0);
    }
    file.seek(SeekFrom::Start(offset))?;
    let mut skipped = Vec::new();
    let consumed = BufReader::new(file).read_until(b'\n', &mut skipped)?;
    Ok(offset + consumed as u64)
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

    // -----------------------------------------------------------------------
    // Compaction and reading from the end (#50)
    // -----------------------------------------------------------------------

    /// A history in its own directory, with a cap small enough that
    /// compaction can be exercised without writing megabytes.
    fn temp_history(tag: &str, max_bytes: u64) -> (PathBuf, CommandHistory) {
        let dir = std::env::temp_dir().join(format!("cortx-hist-{tag}-{}", uuid::Uuid::new_v4()));
        let hist = CommandHistory::new(&dir).with_max_bytes(max_bytes);
        (dir, hist)
    }

    const SMALL_CAP: u64 = 8 * 1024;

    #[test]
    fn compaction_keeps_the_recent_half_and_the_file_stays_readable() {
        let (dir, hist) = temp_history("compact", SMALL_CAP);
        for i in 0..400i64 {
            hist.append(&rec(i, &format!("cmd{i:04}"), "/work", Some(0)));
        }

        let size = fs::metadata(hist.path()).unwrap().len();
        assert!(size <= SMALL_CAP + 1024, "the file stops growing: {size} bytes");
        assert!(
            !hist.path().with_extension("jsonl.1").exists(),
            "the rotation that nothing read is gone: no orphan archive"
        );
        assert!(!hist.path().with_extension("jsonl.tmp").exists(), "no temporary is left behind");

        // The newest commands are still there — this is exactly what the old
        // rotation threw away wholesale.
        let recent = hist.recent(5);
        assert_eq!(recent[0].command.as_deref(), Some("cmd0399"));
        assert_eq!(recent[4].command.as_deref(), Some("cmd0395"));

        // And every line kept is a whole one: the copy started at a line
        // boundary, so nothing is half a record.
        let page = hist.query(&HistoryQuery::default());
        assert_eq!(page.total, page.scanned, "no truncated line survived compaction");
        assert!(page.total > 10, "a useful window is kept, not a handful: {}", page.total);
        assert_eq!(page.records[0].command.as_deref(), Some("cmd0399"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_legacy_archive_is_read_and_only_ages_out_with_the_rest() {
        let (dir, hist) = temp_history("archive", SMALL_CAP);
        fs::create_dir_all(&dir).unwrap();
        // What an older build left on disk and never opened again.
        let archive = hist.path().with_extension("jsonl.1");
        let mut rotated = String::new();
        for i in 0..20i64 {
            rotated.push_str(&serde_json::to_string(&rec(i, &format!("old{i:02}"), "/work", Some(0))).unwrap());
            rotated.push('\n');
        }
        fs::write(&archive, rotated).unwrap();
        for i in 100..110i64 {
            hist.append(&rec(i, &format!("new{i}"), "/work", Some(0)));
        }

        // The history view sees both files, oldest last.
        let page = hist.query(&HistoryQuery::default());
        assert_eq!(page.total, 30, "the rotated archive is not invisible any more");
        assert_eq!(page.records[0].command.as_deref(), Some("new109"));
        assert_eq!(page.records[29].command.as_deref(), Some("old00"));

        // So do the suggestions, which read from the end of each file.
        let recent = hist.recent(30);
        assert_eq!(recent.len(), 30);
        assert_eq!(recent[0].command.as_deref(), Some("new109"));
        assert_eq!(
            recent[10].command.as_deref(),
            Some("old19"),
            "the archive picks up where the live file stops"
        );

        // It is only dropped when compaction retires that whole period —
        // never silently on the way in.
        for i in 200..400i64 {
            hist.append(&rec(i, &format!("cmd{i}"), "/work", Some(0)));
        }
        assert!(!archive.exists(), "one file is left, not an archive nobody reads");
        assert_eq!(hist.recent(1)[0].command.as_deref(), Some("cmd399"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn recent_returns_what_reading_the_whole_file_returned() {
        let (dir, hist) = temp_history("tail", DEFAULT_MAX_HISTORY_BYTES);
        // Comfortably more than one `TAIL_CHUNK`, so the backwards walk has
        // to stitch chunks together.
        for i in 0..2_000i64 {
            hist.append(&rec(i, &format!("cmd{i:05}"), "/work", Some(0)));
        }
        let whole_file: Vec<CommandRecord> = fs::read_to_string(hist.path())
            .unwrap()
            .lines()
            .rev()
            .filter_map(|l| serde_json::from_str(l).ok())
            .take(7)
            .collect();
        assert_eq!(hist.recent(7), whole_file, "same answer as the old whole-file read");
        assert!(hist.recent(0).is_empty());
        assert_eq!(hist.recent(5_000).len(), 2_000, "asking for more than exists returns all of it");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_reading_survives_blanks_junk_and_a_missing_final_newline() {
        let (dir, hist) = temp_history("ragged", DEFAULT_MAX_HISTORY_BYTES);
        fs::create_dir_all(&dir).unwrap();
        let one = |ts: i64, cmd: &str| serde_json::to_string(&rec(ts, cmd, "/work", Some(0))).unwrap();
        fs::write(
            hist.path(),
            format!(
                "{}\n\n{{not json}}\n{}\n\n{}",
                one(1, "first"),
                one(2, "second"),
                one(3, "third")
            ),
        )
        .unwrap();
        let commands: Vec<String> = hist.recent(10).into_iter().filter_map(|r| r.command).collect();
        assert_eq!(
            commands,
            vec!["third", "second", "first"],
            "an unterminated last line, blank lines and junk are all handled"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------------
    // Redaction on the way in
    //
    // Every "secret" below is invented — only the shape is real.
    // -----------------------------------------------------------------------

    /// An application directory with `runtime/` inside it, the layout
    /// `Storage` builds, so `settings.json` really does land where
    /// `settings_path` looks for it.
    fn app_dir(tag: &str) -> (PathBuf, CommandHistory) {
        let root = std::env::temp_dir().join(format!("cortx-hist-{tag}-{}", uuid::Uuid::new_v4()));
        let hist = CommandHistory::new(&root.join("runtime"));
        fs::create_dir_all(root.join("runtime")).unwrap();
        (root, hist)
    }

    #[test]
    fn a_secret_never_reaches_the_file() {
        let (root, hist) = app_dir("redact");
        let hist = hist.with_redact_secrets(true);
        let mut r = rec(1, "export GITHUB_TOKEN=abcdef123456", "/work", Some(0));
        hist.append(&r);
        r.ts = 2;
        r.command =
            Some(r#"curl -H "Authorization: Bearer abcdef123456" https://api.example.com"#.into());
        hist.append(&r);
        r.ts = 3;
        r.command = Some("cargo test -p cortx-core".into());
        hist.append(&r);

        // The file itself — this is the thing the ticket is about.
        let raw = fs::read_to_string(hist.path()).unwrap();
        assert!(!raw.contains("abcdef123456"), "no secret on disk:\n{raw}");
        assert!(raw.contains("export GITHUB_TOKEN="), "the shape of the command is kept");
        assert!(raw.contains("Authorization: "), "so is how it authenticated");
        assert!(raw.contains("cargo test -p cortx-core"), "ordinary commands are untouched");

        // And therefore the history view, the Ctrl+R search and the ranking,
        // because all three read this same file back.
        let page = hist.query(&HistoryQuery::default());
        assert_eq!(page.total, 3);
        assert!(page
            .records
            .iter()
            .all(|r| !r.command.as_deref().unwrap_or_default().contains("abcdef")));
        let suggestions = hist.suggestions(&SuggestContext::default(), 100, 10);
        assert!(suggestions.iter().all(|s| !s.command.contains("abcdef")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_setting_is_read_from_settings_json_and_fails_safe() {
        let (root, hist) = app_dir("redact-setting");
        let settings = root.join("settings.json");

        // No settings file at all: redaction is on.
        assert!(hist.redact_secrets(), "the default is to redact");

        fs::write(&settings, r#"{"terminal":{"redactSecrets":false}}"#).unwrap();
        assert!(!CommandHistory::new(&root.join("runtime")).redact_secrets());

        fs::write(&settings, r#"{"terminal":{"redactSecrets":true}}"#).unwrap();
        assert!(CommandHistory::new(&root.join("runtime")).redact_secrets());

        // A settings file from a build that never heard of the key, and a
        // corrupt one: both mean "redact", never "write the secret out".
        fs::write(&settings, r#"{"terminal":{"blockSpacing":"normal"}}"#).unwrap();
        assert!(CommandHistory::new(&root.join("runtime")).redact_secrets());
        fs::write(&settings, "{ not json").unwrap();
        assert!(CommandHistory::new(&root.join("runtime")).redact_secrets());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn turning_the_setting_off_writes_the_line_verbatim() {
        let (root, hist) = app_dir("redact-off");
        let hist = hist.with_redact_secrets(false);
        hist.append(&rec(1, "export API_KEY=kept-on-purpose", "/w", Some(0)));
        let raw = fs::read_to_string(hist.path()).unwrap();
        assert!(raw.contains("export API_KEY=kept-on-purpose"), "{raw}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_existing_file_can_be_cleaned_on_demand_and_only_on_demand() {
        let (root, hist) = app_dir("redact-existing");
        // A history written before the filter existed: the setting is off, so
        // these go in exactly as typed.
        let hist = hist.with_redact_secrets(false);
        hist.append(&rec(1, "export GITHUB_TOKEN=abcdef123456", "/w", Some(0)));
        hist.append(&rec(2, "cargo build --release", "/w", Some(0)));
        hist.append(&rec(3, "mysql -uroot -phunter2 cortx", "/w", Some(0)));
        fs::write(
            hist.path(),
            format!("{}{{not json}}\n", fs::read_to_string(hist.path()).unwrap()),
        )
        .unwrap();
        let before = fs::read_to_string(hist.path()).unwrap();
        assert!(before.contains("abcdef123456"), "the old file really is in the clear");

        // Nothing happens until it is asked for: appending again leaves the
        // old lines exactly where they were.
        hist.append(&rec(4, "ls", "/w", Some(0)));
        assert!(fs::read_to_string(hist.path()).unwrap().contains("abcdef123456"));

        let report = hist.redact_existing().unwrap();
        assert_eq!(report.scanned, 5);
        assert_eq!(report.redacted, 2);
        assert_eq!(report.skipped, 1, "the unreadable line is counted, not silently dropped");

        let after = fs::read_to_string(hist.path()).unwrap();
        assert!(!after.contains("abcdef123456"), "the secret is gone:\n{after}");
        assert!(!after.contains("hunter2"));
        assert!(after.contains("cargo build --release"), "ordinary lines survive");
        assert!(after.contains("{not json}"), "and so does what could not be parsed");
        assert!(!hist.path().with_extension("jsonl.redact.tmp").exists());

        // Still a readable history afterwards, minus the secrets.
        let page = hist.query(&HistoryQuery::default());
        assert_eq!(page.total, 4);
        assert_eq!(page.records[0].command.as_deref(), Some("ls"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_ranking_and_the_search_cope_with_a_masked_line() {
        let now = 100 * HOUR;
        let masked = format!("export GITHUB_TOKEN={}", redact::REDACTED);
        let records = vec![
            rec(now - HOUR, &masked, "/work", Some(0)),
            rec(now - HOUR, &masked, "/work", Some(0)),
            rec(now - 2 * HOUR, "cargo build", "/work", Some(0)),
        ];
        let ranked = rank_commands(
            &records,
            &SuggestContext { cwd: Some("/work".into()), project_id: None, now_ms: now },
            10,
        );
        // The marker is ordinary text to the ranking: two identical masked
        // lines collapse into one suggestion with a count of two, exactly as
        // two identical ordinary lines would.
        assert_eq!(ranked.len(), 2);
        assert_eq!(ranked[0].command, masked);
        assert_eq!(ranked[0].count, 2);
        assert!(!ranked[0].failed);

        // And the history search still finds it by the half that is left.
        let (root, hist) = app_dir("redact-search");
        hist.append(&rec(1, &masked, "/work", Some(0)));
        let found = hist.query(&HistoryQuery {
            search: Some("github_token".into()),
            ..Default::default()
        });
        assert_eq!(found.total, 1, "searching the surviving half still works");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn compaction_is_atomic_and_overwrites_a_leftover_temporary() {
        let (dir, hist) = temp_history("atomic", SMALL_CAP);
        for i in 0..200i64 {
            hist.append(&rec(i, &format!("cmd{i:04}"), "/work", Some(0)));
        }
        // What a process killed mid-compaction leaves: a partial `.jsonl.tmp`.
        // The history itself is whole, because it is only ever replaced by a
        // finished rename.
        let tmp = hist.path().with_extension("jsonl.tmp");
        fs::write(&tmp, "{\"ts\":1,\"terminal").unwrap();
        let interrupted = hist.query(&HistoryQuery::default());
        assert!(interrupted.total > 0, "the history is intact after a crash");
        assert_eq!(interrupted.total, interrupted.scanned, "and holds no half record");

        for i in 200..400i64 {
            hist.append(&rec(i, &format!("cmd{i:04}"), "/work", Some(0)));
        }
        assert!(!tmp.exists(), "the next compaction reuses and renames the temporary away");
        let page = hist.query(&HistoryQuery::default());
        assert_eq!(page.total, page.scanned);
        assert_eq!(page.records[0].command.as_deref(), Some("cmd0399"));
        let _ = fs::remove_dir_all(&dir);
    }
}
