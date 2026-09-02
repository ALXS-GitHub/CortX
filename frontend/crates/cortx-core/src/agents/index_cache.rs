//! Per-transcript scan cache, persisted to `<app_dir>/runtime/agents_index.json`.
//!
//! `{ "version": 1, "files": { "<path>": CacheEntry } }`. Entries are keyed
//! by transcript path. If `(mtime, size)` is unchanged the file is not
//! re-read; if it only grew, scanning resumes from `offset`; otherwise the
//! file is scanned from scratch.

use super::{claude_code, codex, jsonl, AgentProvider};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

const CACHE_VERSION: u32 = 2;

/// Provider-agnostic facts extracted from one transcript file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct TranscriptSummary {
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    pub version: Option<String>,
    pub model: Option<String>,
    /// Claude `ai-title` / Codex `title`.
    pub auto_title: Option<String>,
    /// Claude `custom-title` (`/rename`).
    pub custom_title: Option<String>,
    /// Claude `agent-name` (`--name`).
    pub agent_name: Option<String>,
    /// Codex `session_meta.source` (`cli`, `exec`, ...).
    pub kind: Option<String>,
    pub first_prompt: Option<String>,
    pub last_prompt: Option<String>,
    pub last_assistant_text: Option<String>,
    /// Last `tool_use` without a matching `tool_result` (Claude).
    pub current_tool: Option<String>,
    /// Pending `(tool_use_id, name)` pairs, bounded.
    pub pending_tools: Vec<(String, String)>,
    /// Human-level messages (user prompts + assistant turns).
    pub message_count: u32,
    /// Codex: counts from `event_msg` used only when no `response_item` messages exist.
    pub event_message_count: u32,
    pub first_timestamp: Option<DateTime<Utc>>,
    pub last_timestamp: Option<DateTime<Utc>>,
    /// Claude: `message.id` of the last assistant entry (to merge split entries).
    pub last_assistant_msg_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct CacheEntry {
    pub provider: AgentProvider,
    pub mtime_ms: i64,
    pub size: u64,
    /// Byte offset after the last complete line scanned.
    pub offset: u64,
    pub subagent_count: u32,
    pub unreadable: bool,
    pub summary: TranscriptSummary,
}

impl Default for CacheEntry {
    fn default() -> Self {
        Self {
            provider: AgentProvider::ClaudeCode,
            mtime_ms: 0,
            size: 0,
            offset: 0,
            subagent_count: 0,
            unreadable: false,
            summary: TranscriptSummary::default(),
        }
    }
}

impl CacheEntry {
    pub fn placeholder(provider: AgentProvider) -> Self {
        Self {
            provider,
            ..Default::default()
        }
    }

    pub fn mtime(&self) -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp_millis(self.mtime_ms).unwrap_or_else(Utc::now)
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct IndexCache {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub files: HashMap<String, CacheEntry>,
}

impl IndexCache {
    pub fn load(path: &Path) -> Self {
        match std::fs::read_to_string(path) {
            Ok(s) => match serde_json::from_str::<IndexCache>(&s) {
                Ok(c) if c.version == CACHE_VERSION => c,
                Ok(_) => {
                    log::info!("agents_index.json version mismatch; rebuilding");
                    Self::default()
                }
                Err(e) => {
                    log::warn!("agents_index.json unreadable ({}); rebuilding", e);
                    Self::default()
                }
            },
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        #[derive(Serialize)]
        struct Out<'a> {
            version: u32,
            files: &'a HashMap<String, CacheEntry>,
        }
        let json = serde_json::to_string(&Out {
            version: CACHE_VERSION,
            files: &self.files,
        })?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json)?;
        std::fs::rename(&tmp, path).or_else(|_| {
            // Windows: rename over an existing file can fail if it is open.
            std::fs::copy(&tmp, path).map(|_| ()).and_then(|_| std::fs::remove_file(&tmp))
        })
    }

    pub fn get(&self, key: &str) -> Option<&CacheEntry> {
        self.files.get(key)
    }

    /// Lookup tolerant to separator / case differences (sqlite stores its
    /// own spelling of the rollout path).
    pub fn get_normalized(&self, key: &str) -> Option<&CacheEntry> {
        if let Some(e) = self.files.get(key) {
            return Some(e);
        }
        let wanted = super::normalize_path(key);
        self.files
            .iter()
            .find(|(k, _)| super::normalize_path(k) == wanted)
            .map(|(_, e)| e)
    }

    pub fn get_mut(&mut self, key: &str) -> Option<&mut CacheEntry> {
        self.files.get_mut(key)
    }

    pub fn insert(&mut self, key: String, entry: CacheEntry) {
        self.files.insert(key, entry);
    }

    pub fn remove(&mut self, key: &str) {
        self.files.remove(key);
    }

    /// Drop every entry of `provider` for which `keep(path)` is false.
    pub fn retain<F: Fn(&str) -> bool>(&mut self, provider: AgentProvider, keep: F) {
        self.files
            .retain(|k, v| v.provider != provider || keep(k));
    }

    pub fn iter(&self, provider: AgentProvider) -> impl Iterator<Item = (&str, &CacheEntry)> {
        self.files
            .iter()
            .filter(move |(_, e)| e.provider == provider)
            .map(|(k, e)| (k.as_str(), e))
    }
}

fn file_mtime_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .map(|t| DateTime::<Utc>::from(t).timestamp_millis())
        .unwrap_or(0)
}

/// Scan `path` (fully, or incrementally from the previous entry) and return
/// the refreshed cache entry. Never panics on unreadable files: they are
/// flagged `unreadable` and keep whatever summary they had.
pub fn scan_file(provider: AgentProvider, path: &Path, previous: Option<CacheEntry>) -> CacheEntry {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => {
            let mut e = previous.unwrap_or_else(|| CacheEntry::placeholder(provider));
            e.unreadable = true;
            return e;
        }
    };
    let mtime_ms = file_mtime_ms(&meta);
    let size = meta.len();

    let (mut entry, start) = match previous {
        Some(prev) if prev.provider == provider && prev.mtime_ms == mtime_ms && prev.size == size => {
            // Unchanged: only refresh the subagent count (cheap directory walk).
            let mut e = prev;
            if provider == AgentProvider::ClaudeCode {
                e.subagent_count = claude_code::count_subagents(path);
            }
            return e;
        }
        Some(prev) if prev.provider == provider && size > prev.size && prev.offset <= size => {
            let off = prev.offset;
            (prev, off)
        }
        _ => (CacheEntry::placeholder(provider), 0),
    };
    if start == 0 {
        entry.summary = TranscriptSummary::default();
    }

    let mut summary = std::mem::take(&mut entry.summary);
    let result = jsonl::scan_from(path, start, |line| match provider {
        AgentProvider::ClaudeCode => claude_code::update_summary(&mut summary, line),
        AgentProvider::Codex => codex::update_summary(&mut summary, line),
    });
    entry.summary = summary;
    match result {
        Ok(new_offset) => {
            entry.offset = new_offset;
            entry.unreadable = false;
        }
        Err(e) => {
            log::debug!("Cannot scan {}: {}", path.display(), e);
            entry.unreadable = true;
        }
    }
    entry.mtime_ms = mtime_ms;
    entry.size = size;
    if provider == AgentProvider::ClaudeCode {
        entry.subagent_count = claude_code::count_subagents(path);
    }
    entry
}
