//! Agents section (DEV-11): read-only discovery of coding-agent sessions
//! (Claude Code, Codex) from the files each CLI writes on disk.
//!
//! CortX never owns a session: the source of truth is `~/.claude` / `~/.codex`.
//! The only thing persisted by CortX is a small set of per-session
//! annotations (`agents.json`, see `storage.rs`) plus a throw-away index cache
//! (`<app_dir>/runtime/agents_index.json`) so restarts do not re-read hundreds
//! of megabytes of transcripts.
//!
//! Layout:
//! - `mod.rs`        — public types, project resolution, ticket refs, the `AgentIndex` façade
//! - `jsonl.rs`      — incremental (append-aware) JSONL line scanner
//! - `index_cache.rs`— persisted per-file scan cache
//! - `claude_code.rs`— Claude Code transcripts + live registry
//! - `codex.rs`      — Codex sqlite index + rollout transcripts
//! - `watcher.rs`    — recursive `notify` watcher over the provider roots
//! - `launch.rs`     — resume command building + Warp launch configurations
//! - `terminal_link.rs` — which CortX terminal runs which agent (DEV-13)

pub mod claude_code;
pub mod codex;
pub mod index_cache;
pub mod jsonl;
pub mod launch;
pub mod terminal_link;
pub mod watcher;

use chrono::{DateTime, Duration, Utc};
use parking_lot::RwLock;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use index_cache::{CacheEntry, IndexCache, TranscriptSummary};

// ============================================================================
// Public types (see agents-contract.md — field names are part of the contract)
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentProvider {
    ClaudeCode,
    Codex,
}

impl AgentProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentProvider::ClaudeCode => "claude-code",
            AgentProvider::Codex => "codex",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentState {
    Running,
    Waiting,
    Stopped,
    Unknown,
}

impl AgentState {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentState::Running => "running",
            AgentState::Waiting => "waiting",
            AgentState::Stopped => "stopped",
            AgentState::Unknown => "unknown",
        }
    }

    pub fn is_live(&self) -> bool {
        matches!(self, AgentState::Running | AgentState::Waiting)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentTitleSource {
    Custom,
    Auto,
    FirstPrompt,
}

/// User-authored metadata persisted in `agents.json`, keyed by session id.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAnnotations {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_name: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id_override: Option<String>,
    #[serde(default = "Utc::now")]
    pub updated_at: DateTime<Utc>,
}

impl Default for AgentAnnotations {
    fn default() -> Self {
        Self {
            custom_name: None,
            tags: Vec::new(),
            status: None,
            pinned: false,
            hidden: false,
            notes: None,
            project_id_override: None,
            // Stable sentinel for "never annotated" (keeps list payloads
            // identical between calls).
            updated_at: DateTime::<Utc>::UNIX_EPOCH,
        }
    }
}

/// A discovered session (computed, never persisted).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub provider: AgentProvider,
    pub title: String,
    pub title_source: AgentTitleSource,
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    pub state: AgentState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub started_at: DateTime<Utc>,
    pub last_activity_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_user_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_assistant_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_tool: Option<String>,
    pub message_count: u32,
    pub subagent_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub transcript_path: String,
    pub ticket_refs: Vec<String>,
    pub annotations: AgentAnnotations,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentRole {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum AgentPart {
    Text {
        text: String,
    },
    Reasoning {
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    ToolCall {
        tool_id: String,
        name: String,
        input: serde_json::Value,
    },
    #[serde(rename_all = "camelCase")]
    ToolResult {
        tool_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        output: String,
        is_error: bool,
    },
    Attachment {
        description: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub role: AgentRole,
    pub timestamp: DateTime<Utc>,
    pub parts: Vec<AgentPart>,
    pub is_sidechain: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTranscriptPage {
    pub session_id: String,
    pub messages: Vec<AgentMessage>,
    pub total_messages: usize,
    pub offset: usize,
    pub has_more: bool,
}

fn default_page_limit() -> usize {
    50
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTranscriptQuery {
    /// Exclusive end index; `None` => `total_messages`.
    #[serde(default)]
    pub end: Option<usize>,
    #[serde(default = "default_page_limit")]
    pub limit: usize,
}

impl Default for AgentTranscriptQuery {
    fn default() -> Self {
        Self {
            end: None,
            limit: default_page_limit(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentSessionsOptions {
    /// `None` => all. Running / waiting sessions are always included.
    #[serde(default)]
    pub since_days: Option<u32>,
    #[serde(default)]
    pub include_hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderHealth {
    pub provider: AgentProvider,
    pub enabled: bool,
    pub detected: bool,
    pub root_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub session_count: u32,
    pub live_count: u32,
    pub unreadable_count: u32,
    pub live_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsHealth {
    pub providers: Vec<AgentProviderHealth>,
    pub indexing: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_scan_at: Option<DateTime<Utc>>,
}

fn default_true() -> bool {
    true
}
fn default_threshold() -> u32 {
    5
}
fn default_recent_days() -> u32 {
    7
}

/// `AppSettings.agents` — every path is configurable (house rule).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsSettings {
    /// Defaults to `$CLAUDE_CONFIG_DIR` or `~/.claude` when empty / missing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_config_dir: Option<String>,
    /// Defaults to `$CODEX_HOME` or `~/.codex` when empty / missing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_home: Option<String>,
    #[serde(default = "default_true")]
    pub claude_enabled: bool,
    #[serde(default = "default_true")]
    pub codex_enabled: bool,
    /// Codex has no live registry: a thread updated within N minutes is `running`.
    #[serde(default = "default_threshold")]
    pub codex_live_threshold_minutes: u32,
    /// UI default filter for finished sessions.
    #[serde(default = "default_recent_days")]
    pub recent_days: u32,
}

impl Default for AgentsSettings {
    fn default() -> Self {
        Self {
            claude_config_dir: None,
            codex_home: None,
            claude_enabled: true,
            codex_enabled: true,
            codex_live_threshold_minutes: default_threshold(),
            recent_days: default_recent_days(),
        }
    }
}

fn home_dir() -> PathBuf {
    directories::BaseDirs::new()
        .map(|b| b.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn configured_dir(explicit: &Option<String>, env_var: &str, default_name: &str) -> PathBuf {
    if let Some(p) = explicit.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        return PathBuf::from(p);
    }
    if let Some(p) = std::env::var_os(env_var).filter(|v| !v.is_empty()) {
        return PathBuf::from(p);
    }
    home_dir().join(default_name)
}

impl AgentsSettings {
    pub fn claude_dir(&self) -> PathBuf {
        configured_dir(&self.claude_config_dir, "CLAUDE_CONFIG_DIR", ".claude")
    }

    pub fn codex_dir(&self) -> PathBuf {
        configured_dir(&self.codex_home, "CODEX_HOME", ".codex")
    }

    /// Roots the agent watcher should observe. Non-existent roots are skipped
    /// by the watcher itself.
    pub fn watch_roots(&self) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if self.claude_enabled {
            let c = self.claude_dir();
            roots.push(c.join("projects"));
            roots.push(c.join("sessions"));
        }
        if self.codex_enabled {
            // Recursive on the Codex home: covers `sessions/**` and the
            // `state_<N>.sqlite(-wal)` files at the root.
            roots.push(self.codex_dir());
        }
        roots
    }
}

// ============================================================================
// Pure helpers (project resolution, ticket refs, titles, truncation)
// ============================================================================

/// Normalize a path for prefix comparison: strip `\\?\`, unify separators,
/// drop the trailing separator, lowercase on Windows.
pub fn normalize_path(p: &str) -> String {
    let mut s = p.trim().to_string();
    if let Some(rest) = s.strip_prefix("\\\\?\\") {
        s = rest.to_string();
    } else if let Some(rest) = s.strip_prefix("//?/") {
        s = rest.to_string();
    }
    let mut s = s.replace('\\', "/");
    while s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    if cfg!(windows) {
        s = s.to_lowercase();
    }
    s
}

/// Strip the Windows extended-length prefix and normalize separators for
/// display (keeps case). Used for `AgentSession.cwd`.
pub fn display_path(p: &str) -> String {
    let s = p.trim();
    let s = s
        .strip_prefix("\\\\?\\")
        .or_else(|| s.strip_prefix("//?/"))
        .unwrap_or(s);
    let mut s = if cfg!(windows) {
        s.replace('/', "\\")
    } else {
        s.to_string()
    };
    let sep = if cfg!(windows) { '\\' } else { '/' };
    while s.len() > 1 && s.ends_with(sep) && !s.ends_with(":\\") {
        s.pop();
    }
    s
}

/// Longest-prefix match of `cwd` against `(project_id, root_path)` pairs, on a
/// path-segment boundary.
pub fn resolve_project(cwd: &str, projects: &[(String, String)]) -> Option<String> {
    let cwd_n = normalize_path(cwd);
    if cwd_n.is_empty() {
        return None;
    }
    let mut best: Option<(usize, &str)> = None;
    for (id, root) in projects {
        let root_n = normalize_path(root);
        if root_n.is_empty() {
            continue;
        }
        let matches = cwd_n == root_n
            || (cwd_n.starts_with(&root_n)
                && (root_n.ends_with('/') || cwd_n[root_n.len()..].starts_with('/')));
        if matches && best.map(|(len, _)| root_n.len() > len).unwrap_or(true) {
            best = Some((root_n.len(), id.as_str()));
        }
    }
    best.map(|(_, id)| id.to_string())
}

fn ticket_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\b[A-Z]{2,}-\d+\b|#\d+").expect("ticket regex"))
}

/// Ticket-like references (`DEV-11`, `#42`) found in the title / first prompt,
/// deduped, in order of appearance.
pub fn ticket_refs(title: &str, first_prompt: Option<&str>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for text in [Some(title), first_prompt].into_iter().flatten() {
        for m in ticket_regex().find_iter(text) {
            let s = m.as_str().to_string();
            if seen.insert(s.clone()) {
                out.push(s);
            }
        }
    }
    out
}

/// Collapse to a single line (whitespace runs -> one space) and cut at
/// `max_chars` characters with an ellipsis.
pub fn single_line(text: &str, max_chars: usize) -> String {
    let collapsed: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_chars(&collapsed, max_chars)
}

/// Cut at `max_chars` characters (not bytes) and append `…`.
pub fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let keep = max_chars.saturating_sub(1);
    let mut s: String = text.chars().take(keep).collect();
    let trimmed = s.trim_end().len();
    s.truncate(trimmed);
    s.push('…');
    s
}

pub const TITLE_MAX_CHARS: usize = 80;
pub const LINE_MAX_CHARS: usize = 200;

/// Title precedence: custom (annotations.customName, `/rename`, Codex `name`)
/// > auto (Claude `ai-title`, Codex `title`) > first prompt (truncated).
pub fn pick_title(
    custom: Option<&str>,
    auto: Option<&str>,
    first_prompt: Option<&str>,
    fallback: &str,
) -> (String, AgentTitleSource) {
    let clean = |s: &str| single_line(s, TITLE_MAX_CHARS);
    if let Some(c) = custom.map(str::trim).filter(|s| !s.is_empty()) {
        return (clean(c), AgentTitleSource::Custom);
    }
    if let Some(a) = auto.map(str::trim).filter(|s| !s.is_empty()) {
        return (clean(a), AgentTitleSource::Auto);
    }
    if let Some(p) = first_prompt.map(str::trim).filter(|s| !s.is_empty()) {
        return (clean(p), AgentTitleSource::FirstPrompt);
    }
    (fallback.to_string(), AgentTitleSource::FirstPrompt)
}

fn ms_to_datetime(ms: i64) -> DateTime<Utc> {
    DateTime::<Utc>::from_timestamp_millis(ms).unwrap_or_else(Utc::now)
}

// ============================================================================
// AgentIndex façade
// ============================================================================

/// Thread-safe index of every discovered session. One instance per process,
/// shared between the watcher thread and the command handlers.
pub struct AgentIndex {
    settings: RwLock<AgentsSettings>,
    cache_path: PathBuf,
    cache: RwLock<IndexCache>,
    /// Claude live registry, keyed by session id (pid-filtered).
    live: RwLock<HashMap<String, claude_code::LiveEntry>>,
    /// Codex threads from the sqlite index (or rebuilt from rollouts).
    codex_threads: RwLock<Vec<codex::CodexThread>>,
    codex_index_ok: AtomicBool,
    indexing: AtomicBool,
    last_scan_at: RwLock<Option<DateTime<Utc>>>,
}

impl AgentIndex {
    /// `runtime_dir` is `<app_dir>/runtime` (created if missing).
    pub fn new(settings: AgentsSettings, runtime_dir: &Path) -> Self {
        let _ = std::fs::create_dir_all(runtime_dir);
        let cache_path = runtime_dir.join("agents_index.json");
        let cache = IndexCache::load(&cache_path);
        Self {
            settings: RwLock::new(settings),
            cache_path,
            cache: RwLock::new(cache),
            live: RwLock::new(HashMap::new()),
            codex_threads: RwLock::new(Vec::new()),
            codex_index_ok: AtomicBool::new(false),
            indexing: AtomicBool::new(false),
            last_scan_at: RwLock::new(None),
        }
    }

    pub fn settings(&self) -> AgentsSettings {
        self.settings.read().clone()
    }

    /// Swap the settings (roots / thresholds). Callers should follow up with
    /// `refresh_all()` when a root changed.
    pub fn set_settings(&self, settings: AgentsSettings) {
        *self.settings.write() = settings;
    }

    pub fn is_indexing(&self) -> bool {
        self.indexing.load(Ordering::Relaxed)
    }

    pub fn watch_roots(&self) -> Vec<PathBuf> {
        self.settings.read().watch_roots()
    }

    // ------------------------------------------------------------------
    // Scanning
    // ------------------------------------------------------------------

    /// Full rescan of both providers. Cheap when the cache is warm (only
    /// files whose (mtime, size) changed are re-read).
    pub fn refresh_all(&self) {
        self.indexing.store(true, Ordering::Relaxed);
        let settings = self.settings();

        // --- Claude Code ---
        if settings.claude_enabled {
            let claude_dir = settings.claude_dir();
            let projects_dir = claude_dir.join("projects");
            let files = claude_code::discover_transcripts(&projects_dir);
            let present: HashSet<String> = files
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            for path in &files {
                self.scan_one(AgentProvider::ClaudeCode, path);
            }
            self.cache
                .write()
                .retain(AgentProvider::ClaudeCode, |k| present.contains(k));
            self.reload_live_registry(&claude_dir.join("sessions"));
        } else {
            self.cache.write().retain(AgentProvider::ClaudeCode, |_| false);
            self.live.write().clear();
        }

        // --- Codex ---
        if settings.codex_enabled {
            let codex_dir = settings.codex_dir();
            let files = codex::discover_rollouts(&codex_dir.join("sessions"));
            let present: HashSet<String> = files
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            for path in &files {
                self.scan_one(AgentProvider::Codex, path);
            }
            self.cache
                .write()
                .retain(AgentProvider::Codex, |k| present.contains(k));
            self.reload_codex_index(&codex_dir);
        } else {
            self.cache.write().retain(AgentProvider::Codex, |_| false);
            self.codex_threads.write().clear();
        }

        self.save_cache();
        *self.last_scan_at.write() = Some(Utc::now());
        self.indexing.store(false, Ordering::Relaxed);
    }

    /// Incremental refresh after the watcher reported `changed` paths.
    /// Returns `true` if anything relevant was updated.
    pub fn refresh_paths(&self, changed: &[PathBuf]) -> bool {
        let settings = self.settings();
        let claude_dir = settings.claude_dir();
        let claude_projects = claude_dir.join("projects");
        let claude_sessions = claude_dir.join("sessions");
        let codex_dir = settings.codex_dir();
        let codex_sessions = codex_dir.join("sessions");

        let mut touched = false;
        let mut reload_registry = false;
        let mut reload_sqlite = false;

        for path in changed {
            if settings.claude_enabled && path.starts_with(&claude_projects) {
                let rel: Vec<_> = match path.strip_prefix(&claude_projects) {
                    Ok(r) => r.components().collect(),
                    Err(_) => continue,
                };
                match rel.len() {
                    2 if path.extension().and_then(|e| e.to_str()) == Some("jsonl") => {
                        if path.exists() {
                            self.scan_one(AgentProvider::ClaudeCode, path);
                        } else {
                            self.cache.write().remove(&path.to_string_lossy());
                        }
                        touched = true;
                    }
                    n if n > 2 => {
                        // Subagent transcript under `<project>/<sessionId>/...`
                        let session_dir = claude_projects.join(rel[0]).join(rel[1]);
                        let main = session_dir.with_extension("jsonl");
                        let key = main.to_string_lossy().to_string();
                        let count = claude_code::count_subagents(&main);
                        if let Some(entry) = self.cache.write().get_mut(&key) {
                            if entry.subagent_count != count {
                                entry.subagent_count = count;
                                touched = true;
                            }
                        }
                    }
                    _ => {}
                }
            } else if settings.claude_enabled && path.starts_with(&claude_sessions) {
                reload_registry = true;
            } else if settings.codex_enabled && path.starts_with(&codex_dir) {
                let name = path
                    .file_name()
                    .and_then(|f| f.to_str())
                    .unwrap_or_default();
                if name.starts_with("state_") && name.contains(".sqlite") {
                    reload_sqlite = true;
                } else if path.starts_with(&codex_sessions)
                    && name.starts_with("rollout-")
                    && name.ends_with(".jsonl")
                {
                    if path.exists() {
                        self.scan_one(AgentProvider::Codex, path);
                    } else {
                        self.cache.write().remove(&path.to_string_lossy());
                    }
                    touched = true;
                }
            }
        }

        if reload_registry {
            self.reload_live_registry(&claude_sessions);
            touched = true;
        }
        if reload_sqlite {
            self.reload_codex_index(&codex_dir);
            touched = true;
        }
        if touched {
            self.save_cache();
            *self.last_scan_at.write() = Some(Utc::now());
        }
        touched
    }

    /// (Re-)scan a single transcript, incrementally when it only grew.
    fn scan_one(&self, provider: AgentProvider, path: &Path) {
        let key = path.to_string_lossy().to_string();
        let previous = self.cache.read().get(&key).cloned();
        let entry = index_cache::scan_file(provider, path, previous);
        self.cache.write().insert(key, entry);
    }

    fn reload_live_registry(&self, sessions_dir: &Path) {
        let entries = claude_code::read_live_registry(sessions_dir);
        let mut map = HashMap::new();
        for e in entries {
            map.insert(e.session_id.clone(), e);
        }
        *self.live.write() = map;
    }

    fn reload_codex_index(&self, codex_dir: &Path) {
        match codex::load_threads(codex_dir) {
            Ok(threads) => {
                self.codex_index_ok.store(true, Ordering::Relaxed);
                *self.codex_threads.write() = threads;
            }
            Err(e) => {
                log::warn!("Codex sqlite index unavailable ({}); using rollouts", e);
                self.codex_index_ok.store(false, Ordering::Relaxed);
                let cache = self.cache.read();
                *self.codex_threads.write() = codex::threads_from_cache(&cache);
            }
        }
    }

    fn save_cache(&self) {
        let cache = self.cache.read();
        if let Err(e) = cache.save(&self.cache_path) {
            log::warn!("Could not persist agents index cache: {}", e);
        }
    }

    // ------------------------------------------------------------------
    // Listing
    // ------------------------------------------------------------------

    /// Assemble every known session. `projects` = `(id, root_path)` pairs used
    /// for prefix resolution; `annotations` = the `agents.json` map.
    pub fn list(
        &self,
        options: &ListAgentSessionsOptions,
        projects: &[(String, String)],
        annotations: &HashMap<String, AgentAnnotations>,
    ) -> Vec<AgentSession> {
        let mut out = self.build_all(projects, annotations);
        let cutoff = options
            .since_days
            .map(|d| Utc::now() - Duration::days(d as i64));
        out.retain(|s| {
            if !options.include_hidden && s.annotations.hidden {
                return false;
            }
            // Empty transcripts (a session opened then closed, or only a
            // slash command like `/model`) carry nothing worth listing once
            // the process is gone.
            if !s.state.is_live() && s.message_count == 0 {
                return false;
            }
            if let Some(cutoff) = cutoff {
                if !s.state.is_live() && s.last_activity_at < cutoff {
                    return false;
                }
            }
            true
        });
        out
    }

    /// Look up one session by id (no filters applied).
    pub fn session(
        &self,
        session_id: &str,
        projects: &[(String, String)],
        annotations: &HashMap<String, AgentAnnotations>,
    ) -> Option<AgentSession> {
        self.build_all(projects, annotations)
            .into_iter()
            .find(|s| s.id == session_id)
    }

    fn build_all(
        &self,
        projects: &[(String, String)],
        annotations: &HashMap<String, AgentAnnotations>,
    ) -> Vec<AgentSession> {
        let settings = self.settings();
        let cache = self.cache.read();
        let live = self.live.read();
        let mut out: Vec<AgentSession> = Vec::new();

        if settings.claude_enabled {
            let mut seen = HashSet::new();
            for (path, entry) in cache.iter(AgentProvider::ClaudeCode) {
                let id = entry
                    .summary
                    .session_id
                    .clone()
                    .or_else(|| {
                        Path::new(path)
                            .file_stem()
                            .map(|s| s.to_string_lossy().to_string())
                    })
                    .unwrap_or_default();
                if id.is_empty() {
                    continue;
                }
                seen.insert(id.clone());
                let live_entry = live.get(&id);
                out.push(claude_code::build_session(
                    &id,
                    path,
                    entry,
                    live_entry,
                    projects,
                    annotations.get(&id),
                ));
            }
            // Live sessions whose transcript is not on disk yet.
            let projects_dir = settings.claude_dir().join("projects");
            for (id, live_entry) in live.iter() {
                if seen.contains(id) {
                    continue;
                }
                let path =
                    claude_code::transcript_path_for(&projects_dir, &live_entry.cwd, id);
                let placeholder = CacheEntry::placeholder(AgentProvider::ClaudeCode);
                out.push(claude_code::build_session(
                    id,
                    &path.to_string_lossy(),
                    &placeholder,
                    Some(live_entry),
                    projects,
                    annotations.get(id),
                ));
            }
        }

        if settings.codex_enabled {
            let threads = self.codex_threads.read();
            let threshold = Duration::minutes(settings.codex_live_threshold_minutes.max(1) as i64);
            for thread in threads.iter() {
                let entry = cache.get_normalized(&thread.rollout_path);
                out.push(codex::build_session(
                    thread,
                    entry,
                    threshold,
                    projects,
                    annotations.get(&thread.id),
                ));
            }
        }

        out
    }

    // ------------------------------------------------------------------
    // Transcript
    // ------------------------------------------------------------------

    /// Normalized, paginated transcript. `query.end` is an exclusive index
    /// into the chronological message list (`None` = total).
    pub fn transcript(
        &self,
        session_id: &str,
        query: &AgentTranscriptQuery,
    ) -> Result<AgentTranscriptPage, String> {
        let (provider, path) = self
            .locate(session_id)
            .ok_or_else(|| format!("Agent session not found: {}", session_id))?;
        let messages = match provider {
            AgentProvider::ClaudeCode => claude_code::parse_transcript(&path),
            AgentProvider::Codex => codex::parse_transcript(&path),
        }
        .map_err(|e| format!("Cannot read transcript {}: {}", path.display(), e))?;

        let total = messages.len();
        let end = query.end.unwrap_or(total).min(total);
        let limit = query.limit.max(1);
        let start = end.saturating_sub(limit);
        let page = messages[start..end].to_vec();
        Ok(AgentTranscriptPage {
            session_id: session_id.to_string(),
            messages: page,
            total_messages: total,
            offset: start,
            has_more: start > 0,
        })
    }

    /// Provider + transcript path for a session id.
    pub fn locate(&self, session_id: &str) -> Option<(AgentProvider, PathBuf)> {
        {
            let cache = self.cache.read();
            for (path, entry) in cache.iter(AgentProvider::ClaudeCode) {
                let id = entry.summary.session_id.as_deref().or_else(|| {
                    Path::new(path).file_stem().and_then(|s| s.to_str())
                });
                if id == Some(session_id) {
                    return Some((AgentProvider::ClaudeCode, PathBuf::from(path)));
                }
            }
        }
        {
            let threads = self.codex_threads.read();
            if let Some(t) = threads.iter().find(|t| t.id == session_id) {
                return Some((AgentProvider::Codex, PathBuf::from(&t.rollout_path)));
            }
        }
        // Live Claude session without a transcript yet.
        let live = self.live.read();
        if let Some(l) = live.get(session_id) {
            let projects_dir = self.settings().claude_dir().join("projects");
            return Some((
                AgentProvider::ClaudeCode,
                claude_code::transcript_path_for(&projects_dir, &l.cwd, session_id),
            ));
        }
        None
    }

    /// The cwd of a session (for launching / project creation).
    pub fn session_cwd(&self, session_id: &str) -> Option<(AgentProvider, String)> {
        let empty = HashMap::new();
        self.session(session_id, &[], &empty)
            .map(|s| (s.provider, s.cwd))
    }

    /// Build the resume command for a session: `(program, args, cwd)`.
    pub fn resume_command(
        &self,
        session_id: &str,
        fork: bool,
    ) -> Result<launch::ResumeCommand, String> {
        let (provider, cwd) = self
            .session_cwd(session_id)
            .ok_or_else(|| format!("Agent session not found: {}", session_id))?;
        launch::build_resume_command(provider, session_id, fork, &cwd)
    }

    // ------------------------------------------------------------------
    // Terminal ↔ agent correlation (DEV-13)
    // ------------------------------------------------------------------

    /// Which of these terminals is running an agent right now.
    ///
    /// Captures the OS process table once, then walks it upwards from every
    /// known agent process to the terminal that owns it. Returns an empty
    /// list (without touching the process table) when there is no terminal.
    pub fn terminal_agents(
        &self,
        terminals: &[terminal_link::TerminalProcess],
    ) -> Vec<terminal_link::TerminalAgent> {
        if terminals.is_empty() {
            return Vec::new();
        }
        let snapshot = terminal_link::ProcessSnapshot::capture();
        self.terminal_agents_with(terminals, &snapshot)
    }

    /// Same, against an already-captured process table (tests, or several
    /// passes over one snapshot).
    pub fn terminal_agents_with(
        &self,
        terminals: &[terminal_link::TerminalProcess],
        snapshot: &terminal_link::ProcessSnapshot,
    ) -> Vec<terminal_link::TerminalAgent> {
        let settings = self.settings();
        let mut candidates: Vec<terminal_link::AgentCandidate> = Vec::new();

        // --- Claude Code: the live registry is authoritative (pid, session,
        // name, busy/idle). ---
        if settings.claude_enabled {
            let live = self.live.read();
            if !live.is_empty() {
                let titles = self.claude_live_titles(&live);
                for (id, entry) in live.iter() {
                    let name = entry
                        .custom_name()
                        .map(|n| single_line(n, TITLE_MAX_CHARS))
                        .or_else(|| titles.get(id).cloned());
                    candidates.push(terminal_link::AgentCandidate {
                        provider: AgentProvider::ClaudeCode,
                        pid: entry.pid,
                        state: entry.state(),
                        session_id: Some(id.clone()),
                        name,
                        cwd: Some(display_path(&entry.cwd)).filter(|c| !c.is_empty()),
                        kind: entry.kind.clone(),
                    });
                }
            }
        }

        // --- Codex: no registry, no pid file. The process table is the only
        // live signal, and it says nothing about what the agent is doing. ---
        if settings.codex_enabled {
            for pid in snapshot.pids_named(terminal_link::is_codex_process) {
                candidates.push(terminal_link::AgentCandidate {
                    provider: AgentProvider::Codex,
                    pid,
                    state: AgentState::Unknown,
                    session_id: None,
                    name: None,
                    cwd: None,
                    kind: None,
                });
            }
        }

        let mut out = terminal_link::correlate(&candidates, terminals, snapshot);

        // A Codex agent only gets a title when the terminal's directory holds
        // exactly one recently-updated thread — anything looser would label a
        // session with another session's title.
        if settings.codex_enabled && out.iter().any(|a| a.provider == AgentProvider::Codex) {
            let threshold = Duration::minutes(settings.codex_live_threshold_minutes.max(1) as i64);
            for agent in out.iter_mut() {
                if agent.provider != AgentProvider::Codex {
                    continue;
                }
                let cwd = terminals
                    .iter()
                    .find(|t| t.terminal_id == agent.terminal_id)
                    .and_then(|t| t.cwd.clone());
                let Some(cwd) = cwd else { continue };
                agent.cwd = Some(display_path(&cwd));
                if let Some((id, title)) = self.unique_codex_thread_in(&cwd, threshold) {
                    agent.session_id = Some(id);
                    agent.name = Some(title);
                }
            }
        }
        out
    }

    /// Session titles (`ai-title`, `/rename`, `--name`) of the live sessions,
    /// read from the index cache in one pass.
    fn claude_live_titles(
        &self,
        live: &HashMap<String, claude_code::LiveEntry>,
    ) -> HashMap<String, String> {
        let cache = self.cache.read();
        let mut out = HashMap::new();
        for (path, entry) in cache.iter(AgentProvider::ClaudeCode) {
            let id = match entry.summary.session_id.clone().or_else(|| {
                Path::new(path)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
            }) {
                Some(id) => id,
                None => continue,
            };
            if !live.contains_key(&id) {
                continue;
            }
            let title = entry
                .summary
                .custom_title
                .as_deref()
                .or(entry.summary.agent_name.as_deref())
                .or(entry.summary.auto_title.as_deref())
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .map(|t| single_line(t, TITLE_MAX_CHARS));
            if let Some(title) = title {
                out.insert(id, title);
            }
        }
        out
    }

    /// `(id, title)` of the only non-stale Codex thread sitting in `cwd`.
    /// `None` as soon as there are zero or several — an ambiguous match is a
    /// wrong label, not a useful one.
    fn unique_codex_thread_in(&self, cwd: &str, threshold: Duration) -> Option<(String, String)> {
        let wanted = normalize_path(cwd);
        if wanted.is_empty() {
            return None;
        }
        let now = Utc::now();
        let threads = self.codex_threads.read();
        let mut found: Option<(String, String)> = None;
        for thread in threads.iter() {
            if normalize_path(&thread.cwd) != wanted {
                continue;
            }
            if now - ms_to_datetime(thread.updated_at_ms) > threshold {
                continue;
            }
            if found.is_some() {
                return None;
            }
            let title = thread
                .name
                .as_deref()
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .unwrap_or(thread.title.trim());
            if title.is_empty() {
                return None;
            }
            found = Some((thread.id.clone(), single_line(title, TITLE_MAX_CHARS)));
        }
        found
    }

    // ------------------------------------------------------------------
    // Health
    // ------------------------------------------------------------------

    pub fn health(&self) -> AgentsHealth {
        let settings = self.settings();
        let cache = self.cache.read();
        let live = self.live.read();

        let claude_dir = settings.claude_dir();
        let claude_entries: Vec<&CacheEntry> = cache
            .iter(AgentProvider::ClaudeCode)
            .map(|(_, e)| e)
            .collect();
        let claude_version = live
            .values()
            .filter_map(|l| l.version.clone())
            .next()
            .or_else(|| {
                claude_entries
                    .iter()
                    .filter_map(|e| e.summary.version.clone())
                    .max()
            });
        let claude = AgentProviderHealth {
            provider: AgentProvider::ClaudeCode,
            enabled: settings.claude_enabled,
            detected: claude_dir.join("projects").is_dir(),
            root_path: claude_dir.to_string_lossy().to_string(),
            version: claude_version,
            session_count: claude_entries.len() as u32,
            live_count: live.len() as u32,
            unreadable_count: claude_entries.iter().filter(|e| e.unreadable).count() as u32,
            live_supported: true,
        };

        let codex_dir = settings.codex_dir();
        let threads = self.codex_threads.read();
        let threshold = Duration::minutes(settings.codex_live_threshold_minutes.max(1) as i64);
        let now = Utc::now();
        let codex_live = threads
            .iter()
            .filter(|t| now - ms_to_datetime(t.updated_at_ms) <= threshold)
            .count() as u32;
        let codex_version = threads
            .iter()
            .max_by_key(|t| t.updated_at_ms)
            .and_then(|t| t.cli_version.clone());
        let codex = AgentProviderHealth {
            provider: AgentProvider::Codex,
            enabled: settings.codex_enabled,
            detected: codex_dir.is_dir(),
            root_path: codex_dir.to_string_lossy().to_string(),
            version: codex_version,
            session_count: threads.len() as u32,
            live_count: codex_live,
            unreadable_count: cache
                .iter(AgentProvider::Codex)
                .filter(|(_, e)| e.unreadable)
                .count() as u32,
            live_supported: false,
        };

        AgentsHealth {
            providers: vec![claude, codex],
            indexing: self.is_indexing(),
            last_scan_at: *self.last_scan_at.read(),
        }
    }
}

/// Shared by both providers: turn a summary + metadata into the list row.
#[allow(clippy::too_many_arguments)]
pub(crate) fn assemble_session(
    id: &str,
    provider: AgentProvider,
    summary: &TranscriptSummary,
    transcript_path: &str,
    cwd_raw: &str,
    state: AgentState,
    pid: Option<u32>,
    kind: Option<String>,
    started_at: DateTime<Utc>,
    last_activity_at: DateTime<Utc>,
    subagent_count: u32,
    custom_title: Option<&str>,
    auto_title: Option<&str>,
    projects: &[(String, String)],
    annotations: Option<&AgentAnnotations>,
) -> AgentSession {
    let annotations = annotations.cloned().unwrap_or_default();
    let cwd = display_path(cwd_raw);
    let project_id = annotations
        .project_id_override
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| resolve_project(&cwd, projects));

    let custom = annotations
        .custom_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or(custom_title);
    let (title, title_source) = pick_title(
        custom,
        auto_title,
        summary.first_prompt.as_deref(),
        &id.chars().take(8).collect::<String>(),
    );
    let ticket_refs = ticket_refs(&title, summary.first_prompt.as_deref());

    AgentSession {
        id: id.to_string(),
        provider,
        title,
        title_source,
        cwd,
        project_id,
        git_branch: summary.git_branch.clone(),
        state,
        pid,
        kind,
        started_at,
        last_activity_at,
        last_user_prompt: summary
            .last_prompt
            .as_deref()
            .map(|s| single_line(s, LINE_MAX_CHARS))
            .filter(|s| !s.is_empty()),
        last_assistant_text: summary
            .last_assistant_text
            .as_deref()
            .map(|s| single_line(s, LINE_MAX_CHARS))
            .filter(|s| !s.is_empty()),
        current_tool: if state == AgentState::Running {
            summary.current_tool.clone()
        } else {
            None
        },
        message_count: summary.message_count,
        subagent_count,
        model: summary.model.clone(),
        version: summary.version.clone(),
        transcript_path: transcript_path.to_string(),
        ticket_refs,
        annotations,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn projects() -> Vec<(String, String)> {
        vec![
            ("p-cortx".into(), r"C:\Users\Me\Desktop\Programmes\Perso\CortX".into()),
            ("p-cortx-front".into(), r"C:\Users\Me\Desktop\Programmes\Perso\CortX\frontend".into()),
            ("p-other".into(), r"C:\Users\Me\Desktop\Programmes\Perso\CortXtra".into()),
        ]
    }

    #[test]
    fn resolve_project_exact_and_subfolder() {
        let p = projects();
        assert_eq!(
            resolve_project(r"C:\Users\Me\Desktop\Programmes\Perso\CortX", &p).as_deref(),
            Some("p-cortx")
        );
        // Sub-folder: longest prefix wins.
        assert_eq!(
            resolve_project(r"C:\Users\Me\Desktop\Programmes\Perso\CortX\frontend\src", &p)
                .as_deref(),
            Some("p-cortx-front")
        );
        // Sibling with a common string prefix but no segment boundary.
        assert_eq!(
            resolve_project(r"C:\Users\Me\Desktop\Programmes\Perso\CortXtra\x", &p).as_deref(),
            Some("p-other")
        );
        assert_eq!(
            resolve_project(r"C:\Users\Me\Desktop\Programmes\Perso\CortXy", &p),
            None
        );
        assert_eq!(resolve_project("", &p), None);
    }

    #[test]
    fn resolve_project_case_separators_and_extended_prefix() {
        let p = projects();
        // `\\?\` prefix + forward slashes + trailing separator.
        assert_eq!(
            resolve_project(r"\\?\C:/Users/Me/Desktop/Programmes/Perso/CortX/", &p).as_deref(),
            Some("p-cortx")
        );
        if cfg!(windows) {
            assert_eq!(
                resolve_project(r"c:\users\me\desktop\programmes\perso\cortx\docs", &p).as_deref(),
                Some("p-cortx")
            );
        }
    }

    #[test]
    fn display_path_strips_extended_prefix() {
        let d = display_path(r"\\?\C:\Users\Me\Proj");
        assert!(!d.starts_with(r"\\?\"));
        assert!(d.ends_with("Proj"));
    }

    #[test]
    fn ticket_refs_dedup_and_order() {
        let refs = ticket_refs(
            "Dashboard agents pour Cortx #DEV-11",
            Some("Dans le contexte du ticket DEV-11 et #42, voir ABC-7 et #42. pas x-1 ni AB-"),
        );
        assert_eq!(refs, vec!["DEV-11", "#42", "ABC-7"]);
        assert!(ticket_refs("nothing here", None).is_empty());
    }

    #[test]
    fn title_precedence() {
        let (t, s) = pick_title(Some("Mine"), Some("Auto"), Some("prompt"), "id");
        assert_eq!((t.as_str(), s), ("Mine", AgentTitleSource::Custom));
        let (t, s) = pick_title(Some("  "), Some("Auto"), Some("prompt"), "id");
        assert_eq!((t.as_str(), s), ("Auto", AgentTitleSource::Auto));
        let (t, s) = pick_title(None, None, Some("a very\nlong   prompt"), "id");
        assert_eq!((t.as_str(), s), ("a very long prompt", AgentTitleSource::FirstPrompt));
        let (t, s) = pick_title(None, None, None, "93ab4258");
        assert_eq!((t.as_str(), s), ("93ab4258", AgentTitleSource::FirstPrompt));
        // First prompt is truncated to TITLE_MAX_CHARS.
        let long = "x".repeat(200);
        let (t, _) = pick_title(None, None, Some(&long), "id");
        assert_eq!(t.chars().count(), TITLE_MAX_CHARS);
        assert!(t.ends_with('…'));
    }

    #[test]
    fn truncation_helpers() {
        assert_eq!(single_line("a\n  b\t c", 100), "a b c");
        assert_eq!(truncate_chars("héllo wörld", 6), "héllo…");
        assert_eq!(truncate_chars("short", 10), "short");
        assert_eq!(truncate_chars("exact", 5), "exact");
        assert_eq!(single_line("", 10), "");
    }

    #[test]
    fn transcript_query_defaults() {
        let q: AgentTranscriptQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(q.limit, 50);
        assert_eq!(q.end, None);
        let q: AgentTranscriptQuery = serde_json::from_str(r#"{"end":null,"limit":10}"#).unwrap();
        assert_eq!(q.limit, 10);
    }

    /// End-to-end: a fake `~/.claude` + `~/.codex` tree, full scan, append,
    /// incremental refresh, cache reuse across index instances.
    /// End to end: a live Claude registry entry and a Codex process, both
    /// running under a CortX shell, come back as terminal agents.
    #[test]
    fn terminal_agents_link_live_sessions_to_terminals() {
        let dir = tempfile::tempdir().unwrap();
        let claude = dir.path().join("claude");
        let codex = dir.path().join("codex");
        let runtime = dir.path().join("runtime");
        let proj = claude.join("projects").join("C--Users-Me-Proj-CortX");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::create_dir_all(claude.join("sessions")).unwrap();
        std::fs::create_dir_all(codex.join("sessions")).unwrap();

        let sid = "bbbb2222-0000-4000-8000-000000000002";
        // The registry only keeps entries whose pid is alive: use our own.
        let agent_pid = std::process::id();
        std::fs::write(
            claude.join("sessions").join(format!("{}.json", agent_pid)),
            format!(
                concat!(
                    r#"{{"pid":{},"sessionId":"{}","cwd":"C:\\Users\\Me\\Proj\\CortX","#,
                    r#""status":"idle","kind":"interactive","name":"cortx-80","nameSource":"derived"}}"#
                ),
                agent_pid, sid
            ),
        )
        .unwrap();
        // The transcript carries the title the agent gave itself.
        std::fs::write(
            proj.join(format!("{}.jsonl", sid)),
            format!(
                "{{\"type\":\"ai-title\",\"aiTitle\":\"Terminal agent statuses\",\"sessionId\":\"{}\"}}\n",
                sid
            ),
        )
        .unwrap();

        let settings = AgentsSettings {
            claude_config_dir: Some(claude.to_string_lossy().to_string()),
            codex_home: Some(codex.to_string_lossy().to_string()),
            ..Default::default()
        };
        let index = AgentIndex::new(settings, &runtime);
        index.refresh_all();

        // pwsh (the PTY) -> claude, and another pwsh -> codex.
        let shell_pid = agent_pid + 100_000;
        let shell2_pid = agent_pid + 200_000;
        let codex_pid = agent_pid + 200_001;
        let snapshot = terminal_link::ProcessSnapshot::from_entries(vec![
            (shell_pid, None, "pwsh.exe"),
            (agent_pid, Some(shell_pid), "claude.exe"),
            (shell2_pid, None, "pwsh.exe"),
            (codex_pid, Some(shell2_pid), "codex.exe"),
        ]);
        let terminals = vec![
            terminal_link::TerminalProcess {
                terminal_id: "shell:one".into(),
                pid: shell_pid,
                cwd: Some(r"C:\Users\Me\Proj\CortX".into()),
            },
            terminal_link::TerminalProcess {
                terminal_id: "shell:two".into(),
                pid: shell2_pid,
                cwd: Some(r"C:\Users\Me\Proj\Other".into()),
            },
        ];

        let agents = index.terminal_agents_with(&terminals, &snapshot);
        assert_eq!(agents.len(), 2, "{:#?}", agents);

        let claude_agent = &agents[0];
        assert_eq!(claude_agent.terminal_id, "shell:one");
        assert_eq!(claude_agent.provider, AgentProvider::ClaudeCode);
        // `idle` with a live pid = the agent is waiting for the user.
        assert_eq!(claude_agent.state, AgentState::Waiting);
        assert_eq!(claude_agent.session_id.as_deref(), Some(sid));
        // A derived name (`cortx-80`) is not a title: the ai-title wins.
        assert_eq!(claude_agent.name.as_deref(), Some("Terminal agent statuses"));

        let codex_agent = &agents[1];
        assert_eq!(codex_agent.terminal_id, "shell:two");
        assert_eq!(codex_agent.provider, AgentProvider::Codex);
        // No live registry on the Codex side: presence yes, state no.
        assert_eq!(codex_agent.state, AgentState::Unknown);
        assert_eq!(codex_agent.name, None);

        // No terminal, no process-table walk.
        assert!(index.terminal_agents(&[]).is_empty());
    }

    #[test]
    fn index_scans_and_refreshes_incrementally() {
        let dir = tempfile::tempdir().unwrap();
        let claude = dir.path().join("claude");
        let codex = dir.path().join("codex");
        let runtime = dir.path().join("runtime");
        let proj = claude.join("projects").join("C--Users-Me-Proj-CortX");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::create_dir_all(claude.join("sessions")).unwrap();
        std::fs::create_dir_all(codex.join("sessions").join("2026").join("08").join("30")).unwrap();

        let sid = "aaaa1111-0000-4000-8000-000000000001";
        let transcript = proj.join(format!("{}.jsonl", sid));
        let line = |ty: &str, uuid: &str, content: &str, ts: &str| {
            format!(
                "{{\"parentUuid\":null,\"isSidechain\":false,\"type\":\"{}\",\"message\":{{\"role\":\"{}\",\"id\":\"m-{}\",\"content\":{}}},\"uuid\":\"{}\",\"timestamp\":\"{}\",\"cwd\":\"C:\\\\Users\\\\Me\\\\Proj\\\\CortX\",\"sessionId\":\"{}\",\"version\":\"2.1.258\",\"gitBranch\":\"main\"}}\n",
                ty, ty, uuid, content, uuid, ts, sid
            )
        };
        std::fs::write(
            &transcript,
            line("user", "u1", "\"Fix DEV-11 please\"", "2026-09-02T20:24:10.000Z")
                + &line("assistant", "a1", "[{\"type\":\"text\",\"text\":\"Sure.\"}]", "2026-09-02T20:24:20.000Z"),
        )
        .unwrap();
        // Codex rollout + no sqlite => fallback to session_meta.
        let rollout = codex.join("sessions/2026/08/30/rollout-2026-08-30T16-46-18-01a05322-b2c8-7861-960f-dde9cdbc9a60.jsonl");
        std::fs::write(&rollout, concat!(
            "{\"timestamp\":\"2026-08-30T14:46:18.240Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"01a05322-b2c8-7861-960f-dde9cdbc9a60\",\"cwd\":\"C:\\\\Users\\\\Me\\\\Proj\\\\Other\",\"cli_version\":\"0.147.0\",\"source\":\"cli\"}}\n",
            "{\"timestamp\":\"2026-08-30T14:46:20.544Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"Hello codex\"}}\n",
        )).unwrap();

        let settings = AgentsSettings {
            claude_config_dir: Some(claude.to_string_lossy().to_string()),
            codex_home: Some(codex.to_string_lossy().to_string()),
            ..Default::default()
        };
        let index = AgentIndex::new(settings.clone(), &runtime);
        index.refresh_all();
        let projects = vec![("p1".to_string(), r"C:\Users\Me\Proj\CortX".to_string())];
        let sessions = index.list(&ListAgentSessionsOptions::default(), &projects, &HashMap::new());
        assert_eq!(sessions.len(), 2, "{:#?}", sessions);
        let claude_s = sessions.iter().find(|s| s.provider == AgentProvider::ClaudeCode).unwrap();
        assert_eq!(claude_s.id, sid);
        assert_eq!(claude_s.project_id.as_deref(), Some("p1"));
        assert_eq!(claude_s.state, AgentState::Stopped);
        assert_eq!(claude_s.message_count, 2);
        assert_eq!(claude_s.ticket_refs, vec!["DEV-11"]);
        let codex_s = sessions.iter().find(|s| s.provider == AgentProvider::Codex).unwrap();
        assert_eq!(codex_s.title, "Hello codex");
        assert_eq!(codex_s.kind.as_deref(), Some("cli"));
        assert!(codex_s.project_id.is_none());

        // `sinceDays` filter drops stopped sessions older than the cutoff but
        // never live ones (the Codex rollout was just written => `running`).
        let recent = index.list(
            &ListAgentSessionsOptions { since_days: Some(0), include_hidden: false },
            &projects,
            &HashMap::new(),
        );
        assert_eq!(recent.len(), 1, "{:#?}", recent);
        assert_eq!(recent[0].provider, AgentProvider::Codex);
        assert_eq!(recent[0].state, AgentState::Running);

        // Append a turn, then refresh only that path.
        {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().append(true).open(&transcript).unwrap();
            f.write_all(line("user", "u2", "\"And #42\"", "2026-09-02T20:25:00.000Z").as_bytes()).unwrap();
        }
        assert!(index.refresh_paths(&[transcript.clone()]));
        let s = index.session(sid, &projects, &HashMap::new()).unwrap();
        assert_eq!(s.message_count, 3);
        assert_eq!(s.last_user_prompt.as_deref(), Some("And #42"));

        // Transcript pagination: end=None, limit=2 => last two messages.
        let page = index.transcript(sid, &AgentTranscriptQuery { end: None, limit: 2 }).unwrap();
        assert_eq!(page.total_messages, 3);
        assert_eq!(page.offset, 1);
        assert!(page.has_more);
        assert_eq!(page.messages.len(), 2);
        let page0 = index.transcript(sid, &AgentTranscriptQuery { end: Some(1), limit: 2 }).unwrap();
        assert_eq!(page0.offset, 0);
        assert!(!page0.has_more);
        assert_eq!(page0.messages.len(), 1);

        // Annotations: override project + custom name; hidden filtered.
        let mut ann = HashMap::new();
        ann.insert(sid.to_string(), AgentAnnotations {
            custom_name: Some("My run".into()),
            project_id_override: Some("p9".into()),
            hidden: true,
            ..Default::default()
        });
        let s = index.session(sid, &projects, &ann).unwrap();
        assert_eq!(s.title, "My run");
        assert_eq!(s.title_source, AgentTitleSource::Custom);
        assert_eq!(s.project_id.as_deref(), Some("p9"));
        assert!(index.list(&ListAgentSessionsOptions::default(), &projects, &ann).iter().all(|s| s.id != sid));

        // Resume command.
        let cmd = index.resume_command(sid, true).unwrap();
        assert_eq!(cmd.command_line(), format!("claude --resume {} --fork-session", sid));
        assert_eq!(cmd.cwd, r"C:\Users\Me\Proj\CortX");

        // A second index instance reuses the persisted cache (no rescan needed).
        assert!(runtime.join("agents_index.json").exists());
        let index2 = AgentIndex::new(settings, &runtime);
        index2.refresh_all();
        let s2 = index2.session(sid, &projects, &HashMap::new()).unwrap();
        assert_eq!(s2.message_count, 3);
        let h = index2.health();
        assert_eq!(h.providers.len(), 2);
        assert!(h.providers[0].detected && h.providers[1].detected);
        assert_eq!(h.providers[0].session_count, 1);
        assert_eq!(h.providers[1].session_count, 1);
        assert!(!h.indexing);
    }

    #[test]
    fn serde_shapes_match_contract() {
        let part = AgentPart::ToolResult {
            tool_id: "t1".into(),
            name: None,
            output: "ok".into(),
            is_error: false,
        };
        let v = serde_json::to_value(&part).unwrap();
        assert_eq!(v["type"], "tool-result");
        assert_eq!(v["toolId"], "t1");
        assert_eq!(v["isError"], false);
        assert!(v.get("name").is_none());
        assert_eq!(
            serde_json::to_value(AgentProvider::ClaudeCode).unwrap(),
            "claude-code"
        );
        assert_eq!(
            serde_json::to_value(AgentTitleSource::FirstPrompt).unwrap(),
            "first-prompt"
        );
        let s: AgentsSettings = serde_json::from_str("{}").unwrap();
        assert!(s.claude_enabled && s.codex_enabled);
        assert_eq!(s.codex_live_threshold_minutes, 5);
        assert_eq!(s.recent_days, 7);
        let a: AgentAnnotations = serde_json::from_str(r#"{"tags":[],"pinned":true,"hidden":false,"updatedAt":"2026-01-01T00:00:00Z"}"#).unwrap();
        assert!(a.pinned);
    }
}
