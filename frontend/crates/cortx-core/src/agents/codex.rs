//! Codex provider.
//!
//! - Index: `<codex>/state_<N>.sqlite` (highest N), table `threads`, opened
//!   read-only. Falls back to the `session_meta` lines of the rollouts when
//!   the sqlite file is missing or has an unexpected schema.
//! - Transcripts: `<codex>/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`,
//!   lines `{timestamp, type, payload}`.
//! - No live registry: a thread updated within the configured threshold is
//!   reported as `running`, otherwise `stopped`.

use super::index_cache::{CacheEntry, IndexCache, TranscriptSummary};
use super::{
    assemble_session, display_path, jsonl, ms_to_datetime, AgentAnnotations, AgentMessage,
    AgentPart, AgentProvider, AgentRole, AgentSession, AgentState,
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use std::path::{Path, PathBuf};

const PROMPT_KEEP_CHARS: usize = 500;

// ============================================================================
// Discovery
// ============================================================================

/// Every `rollout-*.jsonl` under `<codex>/sessions` (recursive).
pub fn discover_rollouts(sessions_dir: &Path) -> Vec<PathBuf> {
    if !sessions_dir.is_dir() {
        return Vec::new();
    }
    walkdir::WalkDir::new(sessions_dir)
        .max_depth(5)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            let name = e.file_name().to_string_lossy();
            name.starts_with("rollout-") && name.ends_with(".jsonl")
        })
        .map(|e| e.into_path())
        .collect()
}

/// `state_<N>.sqlite` with the highest N.
pub fn find_state_db(codex_dir: &Path) -> Option<PathBuf> {
    let rd = std::fs::read_dir(codex_dir).ok()?;
    let mut best: Option<(u32, PathBuf)> = None;
    for f in rd.flatten() {
        let name = f.file_name().to_string_lossy().to_string();
        let Some(n) = name
            .strip_prefix("state_")
            .and_then(|s| s.strip_suffix(".sqlite"))
            .and_then(|s| s.parse::<u32>().ok())
        else {
            continue;
        };
        if best.as_ref().map(|(b, _)| n > *b).unwrap_or(true) {
            best = Some((n, f.path()));
        }
    }
    best.map(|(_, p)| p)
}

// ============================================================================
// Thread index (sqlite)
// ============================================================================

#[derive(Debug, Clone, Default)]
pub struct CodexThread {
    pub id: String,
    pub rollout_path: String,
    pub cwd: String,
    pub title: String,
    pub name: Option<String>,
    pub first_user_message: String,
    pub git_branch: Option<String>,
    pub model: Option<String>,
    pub cli_version: Option<String>,
    pub source: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

fn opt_str(row: &rusqlite::Row, idx: usize) -> Option<String> {
    row.get::<_, Option<String>>(idx)
        .ok()
        .flatten()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn opt_i64(row: &rusqlite::Row, idx: usize) -> Option<i64> {
    row.get::<_, Option<i64>>(idx).ok().flatten()
}

/// Read every non-archived thread. Errors (missing file, schema drift, lock)
/// are returned so the caller can fall back to the rollouts.
pub fn load_threads(codex_dir: &Path) -> Result<Vec<CodexThread>, String> {
    use rusqlite::OpenFlags;
    let db = find_state_db(codex_dir).ok_or_else(|| "no state_<N>.sqlite".to_string())?;
    let conn = rusqlite::Connection::open_with_flags(
        &db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("{}: {}", db.display(), e))?;
    let _ = conn.busy_timeout(std::time::Duration::from_millis(750));

    const FULL: &str = "SELECT id, rollout_path, cwd, title, name, first_user_message, git_branch, \
        model, cli_version, source, created_at, updated_at, created_at_ms, updated_at_ms \
        FROM threads WHERE archived = 0";
    // Older schemas: no name / model / *_ms columns.
    const MINIMAL: &str = "SELECT id, rollout_path, cwd, title, NULL, '', git_branch, NULL, \
        cli_version, source, created_at, updated_at, NULL, NULL \
        FROM threads WHERE archived = 0";

    let read = |sql: &str| -> Result<Vec<CodexThread>, rusqlite::Error> {
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], |row| {
            let created_s = opt_i64(row, 10).unwrap_or(0);
            let updated_s = opt_i64(row, 11).unwrap_or(0);
            Ok(CodexThread {
                id: row.get::<_, String>(0)?,
                rollout_path: row.get::<_, String>(1)?,
                cwd: display_path(&row.get::<_, String>(2).unwrap_or_default()),
                title: row.get::<_, String>(3).unwrap_or_default(),
                name: opt_str(row, 4),
                first_user_message: row.get::<_, String>(5).unwrap_or_default(),
                git_branch: opt_str(row, 6),
                model: opt_str(row, 7),
                cli_version: opt_str(row, 8),
                source: opt_str(row, 9),
                created_at_ms: opt_i64(row, 12).unwrap_or(created_s * 1000),
                updated_at_ms: opt_i64(row, 13).unwrap_or(updated_s * 1000),
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            match r {
                Ok(t) => out.push(t),
                Err(e) => log::debug!("Skipping Codex thread row: {}", e),
            }
        }
        Ok(out)
    };

    match read(FULL) {
        Ok(t) => Ok(t),
        Err(e) => {
            log::info!("Codex threads: full query failed ({}), trying minimal schema", e);
            read(MINIMAL).map_err(|e| format!("{}: {}", db.display(), e))
        }
    }
}

/// Fallback when the sqlite index is unavailable: rebuild threads from the
/// scanned rollouts (no titles / names).
pub fn threads_from_cache(cache: &IndexCache) -> Vec<CodexThread> {
    cache
        .iter(AgentProvider::Codex)
        .filter_map(|(path, entry)| {
            let s = &entry.summary;
            let id = s.session_id.clone()?;
            Some(CodexThread {
                id,
                rollout_path: path.to_string(),
                cwd: s.cwd.as_deref().map(display_path).unwrap_or_default(),
                title: String::new(),
                name: None,
                first_user_message: s.first_prompt.clone().unwrap_or_default(),
                git_branch: s.git_branch.clone(),
                model: s.model.clone(),
                cli_version: s.version.clone(),
                source: s.kind.clone(),
                created_at_ms: s
                    .first_timestamp
                    .map(|t| t.timestamp_millis())
                    .unwrap_or(entry.mtime_ms),
                updated_at_ms: s
                    .last_timestamp
                    .map(|t| t.timestamp_millis())
                    .unwrap_or(entry.mtime_ms)
                    .max(entry.mtime_ms),
            })
        })
        .collect()
}

// ============================================================================
// Rollout line model
// ============================================================================

#[derive(Deserialize)]
struct ContentItem {
    #[serde(rename = "type", default)]
    ty: String,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize)]
struct SummaryItem {
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize, Default)]
struct GitMeta {
    #[serde(default)]
    branch: Option<String>,
}

#[derive(Deserialize)]
struct Payload {
    #[serde(rename = "type", default)]
    ty: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    cli_version: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    git: Option<GitMeta>,
    /// `user_message` / `agent_message` text.
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    last_agent_message: Option<String>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    content: Option<Vec<ContentItem>>,
    #[serde(default)]
    summary: Option<Vec<SummaryItem>>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
    #[serde(default)]
    input: Option<String>,
    #[serde(default)]
    call_id: Option<String>,
    #[serde(default)]
    output: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct RolloutLine {
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(rename = "type", default)]
    ty: String,
    #[serde(default)]
    payload: Option<Payload>,
}

const WANTED_TYPES: &[&str] = &[
    "\"type\":\"session_meta\"",
    "\"type\":\"event_msg\"",
    "\"type\":\"response_item\"",
    "\"type\":\"turn_context\"",
];

fn is_wanted(line: &str) -> bool {
    let head = jsonl::head(line, 256);
    if !WANTED_TYPES.iter().any(|t| head.contains(t)) {
        return false;
    }
    if line.len() > jsonl::HUGE_LINE_BYTES
        && (head.contains("tool_call_output") || head.contains("function_call_output"))
    {
        // Multi-megabyte tool outputs (base64 images): nothing to learn.
        return false;
    }
    true
}

fn parse_ts(s: &Option<String>) -> Option<DateTime<Utc>> {
    s.as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc))
}

fn join_text(items: &[ContentItem]) -> String {
    let mut out = String::new();
    for it in items {
        if let Some(t) = &it.text {
            if it.ty == "input_text" || it.ty == "output_text" || it.ty == "text" {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(t);
            }
        }
    }
    out
}

/// Context injected by Codex as a `user` message (`<environment_context>`,
/// `<recommended_plugins>`, ...) is not a prompt.
fn is_context_injection(text: &str) -> bool {
    let t = text.trim_start();
    if !t.starts_with('<') {
        return false;
    }
    let tag: String = t[1..]
        .chars()
        .take_while(|c| *c != '>')
        .collect();
    !tag.is_empty()
        && tag.len() < 64
        && tag
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ' ' || c == '-')
}

/// Drop the `<image name=... path=...> </image>` markers Codex prepends to a
/// prompt with attached images.
fn strip_image_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<image ") {
        out.push_str(&rest[..start]);
        let after = &rest[start..];
        let end = after
            .find("</image>")
            .map(|i| i + "</image>".len())
            .or_else(|| after.find('>').map(|i| i + 1))
            .unwrap_or(after.len());
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

fn keep(s: &str) -> String {
    let cleaned = strip_image_tags(s);
    super::truncate_chars(cleaned.trim(), PROMPT_KEEP_CHARS)
}

// ============================================================================
// Summary scan
// ============================================================================

pub fn update_summary(summary: &mut TranscriptSummary, line: &str) {
    if !is_wanted(line) {
        return;
    }
    let Ok(entry) = serde_json::from_str::<RolloutLine>(line) else {
        return;
    };
    if let Some(ts) = parse_ts(&entry.timestamp) {
        if summary.first_timestamp.is_none() {
            summary.first_timestamp = Some(ts);
        }
        summary.last_timestamp = Some(ts);
    }
    let Some(p) = entry.payload else {
        return;
    };
    match entry.ty.as_str() {
        "session_meta" => {
            if summary.session_id.is_none() {
                summary.session_id = p.id;
            }
            if p.cwd.is_some() {
                summary.cwd = p.cwd;
            }
            if p.cli_version.is_some() {
                summary.version = p.cli_version;
            }
            if p.source.is_some() {
                summary.kind = p.source;
            }
            if let Some(b) = p.git.and_then(|g| g.branch) {
                summary.git_branch = Some(b);
            }
        }
        "turn_context" => {
            if p.model.is_some() {
                summary.model = p.model;
            }
            if summary.cwd.is_none() {
                summary.cwd = p.cwd;
            }
        }
        "event_msg" => match p.ty.as_deref() {
            Some("user_message") => {
                if let Some(m) = p.message.filter(|m| !m.trim().is_empty()) {
                    let k = keep(&m);
                    if summary.first_prompt.is_none() {
                        summary.first_prompt = Some(k.clone());
                    }
                    summary.last_prompt = Some(k);
                    summary.event_message_count += 1;
                }
            }
            Some("agent_message") => {
                if let Some(m) = p.message.filter(|m| !m.trim().is_empty()) {
                    summary.last_assistant_text = Some(keep(&m));
                    summary.event_message_count += 1;
                }
            }
            Some("task_complete") => {
                if let Some(m) = p.last_agent_message.filter(|m| !m.trim().is_empty()) {
                    summary.last_assistant_text = Some(keep(&m));
                }
                summary.pending_tools.clear();
                summary.current_tool = None;
            }
            _ => {}
        },
        "response_item" => match p.ty.as_deref() {
            Some("message") => {
                let text = p.content.as_deref().map(join_text).unwrap_or_default();
                match p.role.as_deref() {
                    Some("user") => {
                        if text.trim().is_empty() || is_context_injection(&text) {
                            return;
                        }
                        let k = keep(&text);
                        if summary.first_prompt.is_none() {
                            summary.first_prompt = Some(k.clone());
                        }
                        summary.last_prompt = Some(k);
                        summary.message_count += 1;
                    }
                    Some("assistant") => {
                        if !text.trim().is_empty() {
                            summary.last_assistant_text = Some(keep(&text));
                        }
                        summary.message_count += 1;
                    }
                    _ => {}
                }
            }
            Some("function_call") | Some("custom_tool_call") => {
                let id = p.call_id.unwrap_or_default();
                let name = p.name.unwrap_or_else(|| "tool".to_string());
                summary.pending_tools.push((id, name.clone()));
                if summary.pending_tools.len() > 32 {
                    summary.pending_tools.remove(0);
                }
                summary.current_tool = Some(name);
            }
            Some("function_call_output") | Some("custom_tool_call_output") => {
                if let Some(id) = p.call_id {
                    summary.pending_tools.retain(|(pid, _)| *pid != id);
                }
                summary.current_tool = summary.pending_tools.last().map(|(_, n)| n.clone());
            }
            _ => {}
        },
        _ => {}
    }
}

// ============================================================================
// Session assembly
// ============================================================================

pub fn build_session(
    thread: &CodexThread,
    entry: Option<&CacheEntry>,
    live_threshold: Duration,
    projects: &[(String, String)],
    annotations: Option<&AgentAnnotations>,
) -> AgentSession {
    let empty = TranscriptSummary::default();
    let summary_src = entry.map(|e| &e.summary).unwrap_or(&empty);

    // Merge sqlite facts into the transcript summary (sqlite wins for
    // identity fields, the transcript wins for "last ..." fields).
    let mut summary = summary_src.clone();
    if !thread.first_user_message.trim().is_empty() {
        // sqlite stores the clean prompt (no injected context / image tags).
        summary.first_prompt = Some(keep(&thread.first_user_message));
    }
    if summary.last_prompt.is_none() {
        summary.last_prompt = summary.first_prompt.clone();
    }
    if summary.model.is_none() {
        summary.model = thread.model.clone();
    }
    if thread.cli_version.is_some() {
        summary.version = thread.cli_version.clone();
    }
    if thread.git_branch.is_some() {
        summary.git_branch = thread.git_branch.clone();
    }
    if summary.message_count == 0 {
        summary.message_count = summary.event_message_count;
    }

    let cwd = if thread.cwd.is_empty() {
        summary.cwd.clone().unwrap_or_default()
    } else {
        thread.cwd.clone()
    };

    let file_mtime = entry.filter(|e| e.mtime_ms > 0).map(|e| e.mtime());
    let updated_at = [
        (thread.updated_at_ms > 0).then(|| ms_to_datetime(thread.updated_at_ms)),
        file_mtime,
        summary.last_timestamp,
    ]
    .into_iter()
    .flatten()
    .max();
    let started_at = (thread.created_at_ms > 0)
        .then(|| ms_to_datetime(thread.created_at_ms))
        .or(summary.first_timestamp)
        .or(updated_at)
        .unwrap_or_else(Utc::now);
    let last_activity_at = updated_at.unwrap_or(started_at);

    let state = match updated_at {
        Some(u) if Utc::now() - u <= live_threshold => AgentState::Running,
        Some(_) => AgentState::Stopped,
        None => AgentState::Unknown,
    };

    // `title` mirrors the first user message unless Codex / the user set one.
    let auto_title = {
        let t = thread.title.trim();
        let first = thread.first_user_message.trim();
        let mirrors_first = t.is_empty()
            || t == first
            || (first.len() >= 20 && t.starts_with(first))
            || (t.len() >= 20 && first.starts_with(t));
        if mirrors_first {
            None
        } else {
            Some(t)
        }
    };

    assemble_session(
        &thread.id,
        AgentProvider::Codex,
        &summary,
        &thread.rollout_path,
        &cwd,
        state,
        None,
        thread.source.clone().or_else(|| summary.kind.clone()),
        started_at,
        last_activity_at,
        0,
        thread.name.as_deref(),
        auto_title,
        projects,
        annotations,
    )
}

// ============================================================================
// Transcript (detail view)
// ============================================================================

fn output_to_text(v: &serde_json::Value) -> String {
    super::claude_code::value_to_text(v)
}

/// Chronological messages. Assistant-side items (reasoning, tool calls,
/// assistant text) that follow each other are merged into one assistant
/// message; tool outputs become `user` messages with `tool-result` parts;
/// injected context becomes `system`.
pub fn parse_transcript(path: &Path) -> std::io::Result<Vec<AgentMessage>> {
    let mut messages: Vec<AgentMessage> = Vec::new();
    let mut tool_names: std::collections::HashMap<String, String> = Default::default();
    let mut open_assistant: Option<usize> = None;
    let mut n = 0usize;

    jsonl::read_all_lines(path, |line| {
        n += 1;
        let head = jsonl::head(line, 256);
        if !head.contains("\"type\":\"response_item\"") {
            return;
        }
        let Ok(entry) = serde_json::from_str::<RolloutLine>(line) else {
            return;
        };
        let Some(p) = entry.payload else {
            return;
        };
        let timestamp = parse_ts(&entry.timestamp).unwrap_or_else(Utc::now);
        let id = p.id.clone().unwrap_or_else(|| format!("line-{}", n));

        let mut push_assistant_part = |part: AgentPart, id: &str, timestamp: DateTime<Utc>| {
            if let Some(idx) = open_assistant {
                messages[idx].parts.push(part);
                messages[idx].timestamp = timestamp;
            } else {
                messages.push(AgentMessage {
                    id: id.to_string(),
                    role: AgentRole::Assistant,
                    timestamp,
                    parts: vec![part],
                    is_sidechain: false,
                });
                open_assistant = Some(messages.len() - 1);
            }
        };

        match p.ty.as_deref() {
            Some("message") => {
                let mut parts: Vec<AgentPart> = Vec::new();
                let mut text = String::new();
                if let Some(items) = &p.content {
                    for it in items {
                        match it.ty.as_str() {
                            "input_text" | "output_text" | "text" => {
                                if let Some(t) = &it.text {
                                    if !text.is_empty() {
                                        text.push('\n');
                                    }
                                    text.push_str(t);
                                }
                            }
                            "input_image" | "image" => parts.push(AgentPart::Attachment {
                                description: "image".to_string(),
                            }),
                            _ => {}
                        }
                    }
                }
                match p.role.as_deref() {
                    Some("assistant") => {
                        if !text.is_empty() {
                            push_assistant_part(AgentPart::Text { text }, &id, timestamp);
                        }
                    }
                    Some("user") => {
                        let role = if is_context_injection(&text) {
                            AgentRole::System
                        } else {
                            AgentRole::User
                        };
                        if !text.trim().is_empty() {
                            parts.insert(0, AgentPart::Text { text });
                        }
                        if parts.is_empty() {
                            return;
                        }
                        open_assistant = None;
                        messages.push(AgentMessage {
                            id,
                            role,
                            timestamp,
                            parts,
                            is_sidechain: false,
                        });
                    }
                    _ => {} // developer / system prompts are not shown
                }
            }
            Some("reasoning") => {
                let text = p
                    .summary
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|s| s.text)
                    .collect::<Vec<_>>()
                    .join("\n");
                if !text.trim().is_empty() {
                    push_assistant_part(AgentPart::Reasoning { text }, &id, timestamp);
                }
            }
            Some("function_call") | Some("custom_tool_call") => {
                let tool_id = p.call_id.clone().unwrap_or_else(|| id.clone());
                let name = p.name.clone().unwrap_or_else(|| "tool".to_string());
                tool_names.insert(tool_id.clone(), name.clone());
                let input = match (p.arguments.as_deref(), p.input.as_deref()) {
                    (Some(a), _) => serde_json::from_str::<serde_json::Value>(a)
                        .unwrap_or_else(|_| serde_json::Value::String(a.to_string())),
                    (None, Some(i)) => serde_json::Value::String(i.to_string()),
                    (None, None) => serde_json::Value::Null,
                };
                push_assistant_part(
                    AgentPart::ToolCall {
                        tool_id,
                        name,
                        input,
                    },
                    &id,
                    timestamp,
                );
            }
            Some("function_call_output") | Some("custom_tool_call_output") => {
                let tool_id = p.call_id.clone().unwrap_or_default();
                let output = p.output.as_ref().map(output_to_text).unwrap_or_default();
                open_assistant = None;
                messages.push(AgentMessage {
                    id,
                    role: AgentRole::User,
                    timestamp,
                    parts: vec![AgentPart::ToolResult {
                        name: tool_names.get(&tool_id).cloned(),
                        tool_id,
                        output,
                        is_error: false,
                    }],
                    is_sidechain: false,
                });
            }
            _ => {}
        }
    })?;

    Ok(messages)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Anonymized excerpt of a Codex 0.147 rollout.
    const FIXTURE: &str = r#"{"timestamp":"2026-08-30T14:46:18.240Z","type":"session_meta","payload":{"id":"01a05322-b2c8-7861-960f-dde9cdbc9a60","timestamp":"2026-08-30T14:46:18.103Z","cwd":"C:\\Users\\Me\\Proj\\Fruits","originator":"codex_exec","cli_version":"0.147.0","source":"exec","git":{"branch":"main"}}}
{"timestamp":"2026-08-30T14:46:18.241Z","type":"event_msg","payload":{"type":"task_started","turn_id":"t1"}}
{"timestamp":"2026-08-30T14:46:20.457Z","type":"response_item","payload":{"type":"message","id":"msg_dev","role":"developer","content":[{"type":"input_text","text":"<skills_instructions>...</skills_instructions>"}]}}
{"timestamp":"2026-08-30T14:46:20.458Z","type":"turn_context","payload":{"turn_id":"t1","cwd":"C:\\Users\\Me\\Proj\\Fruits","model":"gpt-x"}}
{"timestamp":"2026-08-30T14:46:20.500Z","type":"response_item","payload":{"type":"message","id":"msg_ctx","role":"user","content":[{"type":"input_text","text":"<environment_context>\n  <cwd>C:\\x</cwd>\n</environment_context>"}]}}
{"timestamp":"2026-08-30T14:46:20.540Z","type":"response_item","payload":{"type":"message","id":"msg_u1","role":"user","content":[{"type":"input_text","text":"Generate ONE image for ticket FR-12"},{"type":"input_image","image_url":"data:image/png;base64,AAAA"}]}}
{"timestamp":"2026-08-30T14:46:20.544Z","type":"event_msg","payload":{"type":"user_message","message":"Generate ONE image for ticket FR-12"}}
{"timestamp":"2026-08-30T14:46:38.638Z","type":"event_msg","payload":{"type":"agent_message","message":"I will use the image skill.","phase":"commentary"}}
{"timestamp":"2026-08-30T14:46:38.640Z","type":"response_item","payload":{"type":"message","id":"msg_a1","role":"assistant","content":[{"type":"output_text","text":"I will use the image skill."}]}}
{"timestamp":"2026-08-30T14:46:39.752Z","type":"response_item","payload":{"type":"custom_tool_call","id":"ctc_1","status":"completed","call_id":"call_1","name":"exec","input":"const r = 1;"}}
{"timestamp":"2026-08-30T14:46:40.424Z","type":"response_item","payload":{"type":"custom_tool_call_output","id":"ctco_1","call_id":"call_1","output":[{"type":"input_text","text":"Script completed"}]}}
{"timestamp":"2026-08-30T14:46:43.655Z","type":"response_item","payload":{"type":"reasoning","id":"rs_1","summary":[{"type":"summary_text","text":"Thinking about it"}],"encrypted_content":"x"}}
{"timestamp":"2026-08-30T14:46:44.000Z","type":"response_item","payload":{"type":"function_call","id":"fc_1","name":"wait","arguments":"{\"cell_id\":\"2\"}","call_id":"call_2"}}
{"timestamp":"2026-08-30T14:50:05.903Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"t1","last_agent_message":"Saved icon."}}
"#;

    #[test]
    fn summary_from_fixture() {
        let mut s = TranscriptSummary::default();
        for l in FIXTURE.lines().filter(|l| !l.is_empty()) {
            update_summary(&mut s, l);
        }
        assert_eq!(s.session_id.as_deref(), Some("01a05322-b2c8-7861-960f-dde9cdbc9a60"));
        assert_eq!(s.cwd.as_deref(), Some(r"C:\Users\Me\Proj\Fruits"));
        assert_eq!(s.version.as_deref(), Some("0.147.0"));
        assert_eq!(s.kind.as_deref(), Some("exec"));
        assert_eq!(s.git_branch.as_deref(), Some("main"));
        assert_eq!(s.model.as_deref(), Some("gpt-x"));
        assert_eq!(s.first_prompt.as_deref(), Some("Generate ONE image for ticket FR-12"));
        assert_eq!(s.last_assistant_text.as_deref(), Some("Saved icon."));
        // response_item messages: 1 user (context injection skipped) + 1 assistant.
        assert_eq!(s.message_count, 2);
        assert_eq!(s.event_message_count, 2);
        // task_complete clears the pending tool.
        assert_eq!(s.current_tool, None);
        assert_eq!(
            s.first_timestamp.unwrap().to_rfc3339(),
            "2026-08-30T14:46:18.240+00:00"
        );
        assert_eq!(
            s.last_timestamp.unwrap().to_rfc3339(),
            "2026-08-30T14:50:05.903+00:00"
        );
    }

    #[test]
    fn image_tags_are_stripped() {
        assert_eq!(
            keep("<image name=[Image #1] path=\"a.png\"> </image> <image name=[Image #2] path=\"b.png\"> </image> Use the tool"),
            "Use the tool"
        );
        assert_eq!(keep("plain"), "plain");
    }

    #[test]
    fn pending_tool_before_completion() {
        let mut s = TranscriptSummary::default();
        for l in FIXTURE.lines().filter(|l| !l.is_empty()).take(13) {
            update_summary(&mut s, l);
        }
        assert_eq!(s.current_tool.as_deref(), Some("wait"));
    }

    #[test]
    fn transcript_from_fixture() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("rollout-x.jsonl");
        std::fs::write(&p, FIXTURE).unwrap();
        let msgs = parse_transcript(&p).unwrap();
        // system(context), user(prompt+image), assistant(text+tool), user(tool result),
        // assistant(reasoning + function_call)
        assert_eq!(msgs.len(), 5, "{:#?}", msgs);
        assert_eq!(msgs[0].role, AgentRole::System);
        assert_eq!(msgs[1].role, AgentRole::User);
        assert_eq!(msgs[1].parts.len(), 2);
        assert!(matches!(msgs[1].parts[1], AgentPart::Attachment { .. }));
        assert_eq!(msgs[2].role, AgentRole::Assistant);
        assert!(matches!(&msgs[2].parts[1], AgentPart::ToolCall { name, .. } if name == "exec"));
        match &msgs[3].parts[0] {
            AgentPart::ToolResult { name, output, .. } => {
                assert_eq!(name.as_deref(), Some("exec"));
                assert_eq!(output, "Script completed");
            }
            other => panic!("{:?}", other),
        }
        assert!(matches!(&msgs[4].parts[0], AgentPart::Reasoning { text } if text == "Thinking about it"));
        match &msgs[4].parts[1] {
            AgentPart::ToolCall { input, name, .. } => {
                assert_eq!(name, "wait");
                assert_eq!(input["cell_id"], "2");
            }
            other => panic!("{:?}", other),
        }
    }

    #[test]
    fn build_session_state_and_title() {
        let thread = CodexThread {
            id: "01a05322-b2c8-7861-960f-dde9cdbc9a60".into(),
            rollout_path: "C:/r.jsonl".into(),
            cwd: display_path(r"\\?\C:\Users\Me\Proj\Fruits"),
            title: "Generate ONE image for ticket FR-12".into(),
            first_user_message: "Generate ONE image for ticket FR-12".into(),
            updated_at_ms: Utc::now().timestamp_millis(),
            created_at_ms: Utc::now().timestamp_millis() - 1000,
            ..Default::default()
        };
        let projects = vec![("p1".to_string(), r"C:\Users\Me\Proj".to_string())];
        let s = build_session(&thread, None, Duration::minutes(5), &projects, None);
        assert_eq!(s.state, AgentState::Running);
        assert_eq!(s.project_id.as_deref(), Some("p1"));
        assert_eq!(s.title_source, super::super::AgentTitleSource::FirstPrompt);
        assert_eq!(s.ticket_refs, vec!["FR-12"]);
        assert!(!s.cwd.starts_with(r"\\?\"));

        let old = CodexThread {
            updated_at_ms: Utc::now().timestamp_millis() - 3_600_000,
            name: Some("Icon job".into()),
            ..thread
        };
        let s = build_session(&old, None, Duration::minutes(5), &projects, None);
        assert_eq!(s.state, AgentState::Stopped);
        assert_eq!(s.title, "Icon job");
        assert_eq!(s.title_source, super::super::AgentTitleSource::Custom);
    }

    #[test]
    fn state_db_picks_highest_version() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("state_3.sqlite"), "").unwrap();
        std::fs::write(dir.path().join("state_10.sqlite"), "").unwrap();
        std::fs::write(dir.path().join("state_10.sqlite-wal"), "").unwrap();
        std::fs::write(dir.path().join("logs_2.sqlite"), "").unwrap();
        assert!(find_state_db(dir.path()).unwrap().ends_with("state_10.sqlite"));
        assert!(load_threads(dir.path()).is_err());
    }
}
