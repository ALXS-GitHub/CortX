//! Claude Code provider.
//!
//! - Transcripts: `<config>/projects/<cwd-encoded>/<sessionId>.jsonl` (one JSON
//!   object per line; the format is undocumented so everything is optional).
//! - Subagents: `<config>/projects/<cwd-encoded>/<sessionId>/**/*.jsonl` (counted only).
//! - Live registry: `<config>/sessions/<pid>.json`, kept only when the pid is alive.

use super::index_cache::{CacheEntry, TranscriptSummary};
use super::{
    assemble_session, jsonl, ms_to_datetime, AgentAnnotations, AgentMessage, AgentPart,
    AgentProvider, AgentRole, AgentSession, AgentState,
};
use chrono::{DateTime, Utc};
use serde::de::{self, Deserializer, SeqAccess, Visitor};
use serde::Deserialize;
use std::fmt;
use std::path::{Path, PathBuf};

const PROMPT_KEEP_CHARS: usize = 500;
const MAX_PENDING_TOOLS: usize = 32;

// ============================================================================
// Discovery
// ============================================================================

/// Every main transcript: `<projects_dir>/*/*.jsonl` (subdirectories hold
/// subagent transcripts and are deliberately not descended into).
pub fn discover_transcripts(projects_dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(dirs) = std::fs::read_dir(projects_dir) else {
        return out;
    };
    for dir in dirs.flatten() {
        let path = dir.path();
        if !path.is_dir() {
            continue;
        }
        let Ok(files) = std::fs::read_dir(&path) else {
            continue;
        };
        for f in files.flatten() {
            let p = f.path();
            if p.is_file() && p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                out.push(p);
            }
        }
    }
    out
}

/// Claude encodes the cwd by replacing every non-alphanumeric char with `-`.
pub fn encode_cwd(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

pub fn transcript_path_for(projects_dir: &Path, cwd: &str, session_id: &str) -> PathBuf {
    projects_dir
        .join(encode_cwd(cwd))
        .join(format!("{}.jsonl", session_id))
}

/// Number of subagent transcripts next to a main transcript
/// (`<sessionId>/**/*.jsonl`, depth-limited).
pub fn count_subagents(main_transcript: &Path) -> u32 {
    let dir = main_transcript.with_extension("");
    if !dir.is_dir() {
        return 0;
    }
    walkdir::WalkDir::new(&dir)
        .max_depth(3)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path().extension().and_then(|x| x.to_str()) == Some("jsonl")
        })
        .count() as u32
}

// ============================================================================
// Line model (only the fields we need; everything else is skipped by serde)
// ============================================================================

/// `message.content` is either a plain string or an array of blocks.
/// Deserialized with a visitor (not `untagged`) so huge tool results are not
/// buffered twice.
pub(crate) enum Content<B> {
    Text(String),
    Blocks(Vec<B>),
}

impl<'de, B: Deserialize<'de>> Deserialize<'de> for Content<B> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V<B>(std::marker::PhantomData<B>);
        impl<'de, B: Deserialize<'de>> Visitor<'de> for V<B> {
            type Value = Content<B>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a string or an array of content blocks")
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(Content::Text(v.to_string()))
            }
            fn visit_string<E: de::Error>(self, v: String) -> Result<Self::Value, E> {
                Ok(Content::Text(v))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
                let mut out = Vec::new();
                while let Some(b) = seq.next_element::<B>()? {
                    out.push(b);
                }
                Ok(Content::Blocks(out))
            }
            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(Content::Text(String::new()))
            }
            fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(Content::Text(String::new()))
            }
        }
        d.deserialize_any(V(std::marker::PhantomData))
    }
}

#[derive(Deserialize)]
struct SummaryBlock {
    #[serde(rename = "type", default)]
    ty: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    tool_use_id: Option<String>,
}

#[derive(Deserialize)]
struct Message<B> {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    content: Option<Content<B>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Line<B> {
    #[serde(rename = "type", default)]
    ty: String,
    #[serde(default)]
    uuid: Option<String>,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    git_branch: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    is_sidechain: bool,
    #[serde(default)]
    is_meta: bool,
    message: Option<Message<B>>,
    #[serde(default)]
    ai_title: Option<String>,
    #[serde(default)]
    custom_title: Option<String>,
    #[serde(default)]
    last_prompt: Option<String>,
    #[serde(default)]
    agent_name: Option<String>,
}

/// Entry kinds that are never interesting. `assistant` entries put `message`
/// before `type`, so the filter is expressed negatively: anything not
/// recognisably noise gets parsed.
const UNWANTED_MARKERS: &[&str] = &[
    "\"attachment\":{",
    "\"type\":\"mode\"",
    "\"type\":\"permission-mode\"",
    "\"type\":\"bridge-session\"",
    "\"type\":\"file-history-snapshot\"",
    "\"type\":\"file-history-delta\"",
    "\"type\":\"queue-operation\"",
    "\"type\":\"atis-latch\"",
    "\"type\":\"cost-state\"",
    "\"type\":\"summary\"",
];

/// Cheap pre-filter: attachments / snapshots / mode records are skipped
/// without parsing (they are the bulk of the lines).
fn is_wanted(line: &str) -> bool {
    let head = jsonl::head(line, 256);
    !UNWANTED_MARKERS.iter().any(|t| head.contains(t))
}

fn parse_ts(s: &Option<String>) -> Option<DateTime<Utc>> {
    s.as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc))
}

fn keep_prompt(s: &str) -> String {
    super::truncate_chars(s.trim(), PROMPT_KEEP_CHARS)
}

/// Slash-command echoes and local command output are not user prompts.
fn is_synthetic_user_text(text: &str) -> bool {
    let t = text.trim_start();
    t.starts_with("<command-")
        || t.starts_with("<local-command")
        || t.starts_with("<system-reminder>")
        || t.starts_with("<task-notification>")
        || t.starts_with("[Request interrupted")
}

// ============================================================================
// Summary scan (list view)
// ============================================================================

/// Fold one JSONL line into the running summary.
pub fn update_summary(summary: &mut TranscriptSummary, line: &str) {
    if !is_wanted(line) {
        return;
    }
    let Ok(entry) = serde_json::from_str::<Line<SummaryBlock>>(line) else {
        return;
    };
    if summary.session_id.is_none() {
        summary.session_id = entry.session_id.clone();
    }
    match entry.ty.as_str() {
        "ai-title" => {
            if let Some(t) = entry.ai_title.filter(|t| !t.trim().is_empty()) {
                summary.auto_title = Some(t);
            }
        }
        "custom-title" => {
            summary.custom_title = entry.custom_title.filter(|t| !t.trim().is_empty());
        }
        "agent-name" => {
            summary.agent_name = entry.agent_name.filter(|t| !t.trim().is_empty());
        }
        "last-prompt" => {
            if summary.last_prompt.is_none() {
                summary.last_prompt = entry.last_prompt.map(|p| keep_prompt(&p));
            }
        }
        "system" => {
            // Sessions that only ran a slash command have no user/assistant
            // entries; `system` records still carry cwd / branch / version.
            if entry.cwd.is_some() && summary.cwd.is_none() {
                summary.cwd = entry.cwd.clone();
            }
            if entry.git_branch.is_some() && summary.git_branch.is_none() {
                summary.git_branch = entry.git_branch.clone();
            }
            if entry.version.is_some() && summary.version.is_none() {
                summary.version = entry.version.clone();
            }
            if let Some(ts) = parse_ts(&entry.timestamp) {
                if summary.first_timestamp.is_none() {
                    summary.first_timestamp = Some(ts);
                }
                summary.last_timestamp = Some(ts);
            }
        }
        "user" | "assistant" => {
            if entry.cwd.is_some() && summary.cwd.is_none() {
                summary.cwd = entry.cwd.clone();
            }
            if entry.git_branch.is_some() {
                summary.git_branch = entry.git_branch.clone();
            }
            if entry.version.is_some() {
                summary.version = entry.version.clone();
            }
            if entry.is_sidechain {
                return;
            }
            let ts = parse_ts(&entry.timestamp);
            if let Some(ts) = ts {
                if summary.first_timestamp.is_none() {
                    summary.first_timestamp = Some(ts);
                }
                summary.last_timestamp = Some(ts);
            }
            let Some(message) = entry.message else {
                return;
            };
            if entry.ty == "user" {
                let mut text = String::new();
                match message.content {
                    Some(Content::Text(s)) => text = s,
                    Some(Content::Blocks(blocks)) => {
                        for b in blocks {
                            match b.ty.as_str() {
                                "text" => {
                                    if let Some(t) = b.text {
                                        if !text.is_empty() {
                                            text.push('\n');
                                        }
                                        text.push_str(&t);
                                    }
                                }
                                "tool_result" => {
                                    if let Some(id) = b.tool_use_id {
                                        summary.pending_tools.retain(|(pid, _)| *pid != id);
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    None => {}
                }
                summary.current_tool = summary.pending_tools.last().map(|(_, n)| n.clone());
                if entry.is_meta || text.trim().is_empty() || is_synthetic_user_text(&text) {
                    return;
                }
                let kept = keep_prompt(&text);
                if summary.first_prompt.is_none() {
                    summary.first_prompt = Some(kept.clone());
                }
                summary.last_prompt = Some(kept);
                summary.message_count += 1;
            } else {
                if message.model.is_some() {
                    summary.model = message.model.clone();
                }
                if message.id.is_some() && message.id != summary.last_assistant_msg_id {
                    summary.message_count += 1;
                    summary.last_assistant_msg_id = message.id.clone();
                } else if message.id.is_none() {
                    summary.message_count += 1;
                }
                if let Some(Content::Blocks(blocks)) = message.content {
                    for b in blocks {
                        match b.ty.as_str() {
                            "text" => {
                                if let Some(t) = b.text.filter(|t| !t.trim().is_empty()) {
                                    summary.last_assistant_text = Some(keep_prompt(&t));
                                }
                            }
                            "tool_use" => {
                                let id = b.id.unwrap_or_default();
                                let name = b.name.unwrap_or_else(|| "tool".to_string());
                                summary.pending_tools.push((id, name));
                                if summary.pending_tools.len() > MAX_PENDING_TOOLS {
                                    summary.pending_tools.remove(0);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                summary.current_tool = summary.pending_tools.last().map(|(_, n)| n.clone());
            }
        }
        _ => {}
    }
}

// ============================================================================
// Live registry
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveEntry {
    pub pid: u32,
    pub session_id: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub name_source: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub updated_at: Option<i64>,
}

impl LiveEntry {
    pub fn state(&self) -> AgentState {
        match self.status.as_str() {
            "idle" => AgentState::Waiting,
            _ => AgentState::Running,
        }
    }

    /// A user-chosen name (`--name`, `/rename`); derived names such as
    /// `cortx-80` are not titles.
    pub fn custom_name(&self) -> Option<&str> {
        let name = self.name.as_deref().map(str::trim).filter(|n| !n.is_empty())?;
        match self.name_source.as_deref() {
            Some("derived") | Some("auto") => None,
            _ => Some(name),
        }
    }
}

/// Parse `<sessions_dir>/*.json`, keeping only entries whose pid is alive.
pub fn read_live_registry(sessions_dir: &Path) -> Vec<LiveEntry> {
    let mut entries: Vec<LiveEntry> = Vec::new();
    let Ok(rd) = std::fs::read_dir(sessions_dir) else {
        return entries;
    };
    for f in rd.flatten() {
        let p = f.path();
        if p.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(s) = std::fs::read_to_string(&p) else {
            continue;
        };
        match serde_json::from_str::<LiveEntry>(&s) {
            Ok(e) if !e.session_id.is_empty() => entries.push(e),
            Ok(_) => {}
            Err(e) => log::debug!("Skipping live entry {}: {}", p.display(), e),
        }
    }
    if entries.is_empty() {
        return entries;
    }
    let alive = alive_pids(entries.iter().map(|e| e.pid));
    entries.retain(|e| alive.contains(&e.pid));
    entries
}

fn alive_pids(pids: impl Iterator<Item = u32>) -> Vec<u32> {
    use sysinfo::{Pid, ProcessesToUpdate, System};
    let wanted: Vec<Pid> = pids.map(|p| Pid::from(p as usize)).collect();
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&wanted), false);
    wanted
        .into_iter()
        .filter(|p| sys.process(*p).is_some())
        .map(|p| p.as_u32())
        .collect()
}

// ============================================================================
// Session assembly
// ============================================================================

pub fn build_session(
    id: &str,
    transcript_path: &str,
    entry: &CacheEntry,
    live: Option<&LiveEntry>,
    projects: &[(String, String)],
    annotations: Option<&AgentAnnotations>,
) -> AgentSession {
    let summary = &entry.summary;
    let cwd = summary
        .cwd
        .clone()
        .or_else(|| live.map(|l| l.cwd.clone()))
        .unwrap_or_default();
    let state = live.map(|l| l.state()).unwrap_or(AgentState::Stopped);
    let file_mtime = if entry.mtime_ms > 0 {
        Some(entry.mtime())
    } else {
        None
    };
    let started_at = summary
        .first_timestamp
        .or_else(|| live.and_then(|l| l.started_at).map(ms_to_datetime))
        .or(file_mtime)
        .unwrap_or_else(Utc::now);
    let last_activity_at = [
        summary.last_timestamp,
        file_mtime,
        live.and_then(|l| l.updated_at).map(ms_to_datetime),
    ]
    .into_iter()
    .flatten()
    .max()
    .unwrap_or(started_at);

    let custom_title = summary
        .custom_title
        .as_deref()
        .or_else(|| live.and_then(|l| l.custom_name()))
        .or(summary.agent_name.as_deref());

    let mut summary_for_version = summary.clone();
    if let Some(v) = live.and_then(|l| l.version.clone()) {
        summary_for_version.version = Some(v);
    }

    assemble_session(
        id,
        AgentProvider::ClaudeCode,
        &summary_for_version,
        transcript_path,
        &cwd,
        state,
        live.map(|l| l.pid),
        live.and_then(|l| l.kind.clone()),
        started_at,
        last_activity_at,
        entry.subagent_count,
        custom_title,
        summary.auto_title.as_deref(),
        projects,
        annotations,
    )
}

// ============================================================================
// Transcript (detail view)
// ============================================================================

#[derive(Deserialize)]
struct FullBlock {
    #[serde(rename = "type", default)]
    ty: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    thinking: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    input: Option<serde_json::Value>,
    #[serde(default)]
    tool_use_id: Option<String>,
    #[serde(default)]
    content: Option<serde_json::Value>,
    #[serde(default)]
    is_error: Option<bool>,
}

/// Flatten a `tool_result.content` (string | [{type:text,text}] | other).
pub(crate) fn value_to_text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(items) => {
            let mut out = String::new();
            for item in items {
                match item {
                    serde_json::Value::String(s) => out.push_str(s),
                    serde_json::Value::Object(o) => {
                        if let Some(t) = o.get("text").and_then(|t| t.as_str()) {
                            out.push_str(t);
                        } else if o.get("type").and_then(|t| t.as_str()) == Some("image") {
                            out.push_str("[image]");
                        }
                    }
                    other => out.push_str(&other.to_string()),
                }
                out.push('\n');
            }
            out.trim_end().to_string()
        }
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Chronological main-chain messages (meta / sidechain entries skipped).
/// Consecutive assistant entries sharing `message.id` are merged into one
/// message; user entries carrying tool results become `user` messages with
/// `tool-result` parts.
pub fn parse_transcript(path: &Path) -> std::io::Result<Vec<AgentMessage>> {
    let mut messages: Vec<AgentMessage> = Vec::new();
    let mut tool_names: std::collections::HashMap<String, String> = Default::default();
    let mut last_assistant: Option<(String, usize)> = None; // (message.id, index)
    let mut n = 0usize;

    jsonl::read_all_lines(path, |line| {
        n += 1;
        if !is_wanted(line) {
            return;
        }
        let Ok(entry) = serde_json::from_str::<Line<FullBlock>>(line) else {
            return;
        };
        if entry.ty != "user" && entry.ty != "assistant" {
            return;
        }
        if entry.is_sidechain || entry.is_meta {
            return;
        }
        let Some(message) = entry.message else {
            return;
        };
        let timestamp = parse_ts(&entry.timestamp).unwrap_or_else(Utc::now);
        let id = entry.uuid.unwrap_or_else(|| format!("line-{}", n));

        if entry.ty == "user" {
            let mut parts = Vec::new();
            match message.content {
                Some(Content::Text(s)) => {
                    if !s.trim().is_empty() {
                        parts.push(AgentPart::Text { text: s });
                    }
                }
                Some(Content::Blocks(blocks)) => {
                    for b in blocks {
                        match b.ty.as_str() {
                            "text" => {
                                if let Some(t) = b.text.filter(|t| !t.trim().is_empty()) {
                                    parts.push(AgentPart::Text { text: t });
                                }
                            }
                            "tool_result" => {
                                let tool_id = b.tool_use_id.unwrap_or_default();
                                let name = tool_names.get(&tool_id).cloned();
                                let output =
                                    b.content.as_ref().map(value_to_text).unwrap_or_default();
                                parts.push(AgentPart::ToolResult {
                                    tool_id,
                                    name,
                                    output,
                                    is_error: b.is_error.unwrap_or(false),
                                });
                            }
                            "image" => parts.push(AgentPart::Attachment {
                                description: "image".to_string(),
                            }),
                            _ => {}
                        }
                    }
                }
                None => {}
            }
            if parts.is_empty() {
                return;
            }
            last_assistant = None;
            messages.push(AgentMessage {
                id,
                role: AgentRole::User,
                timestamp,
                parts,
                is_sidechain: false,
            });
        } else {
            let mut parts = Vec::new();
            if let Some(Content::Blocks(blocks)) = message.content {
                for b in blocks {
                    match b.ty.as_str() {
                        "text" => {
                            if let Some(t) = b.text.filter(|t| !t.is_empty()) {
                                parts.push(AgentPart::Text { text: t });
                            }
                        }
                        "thinking" => {
                            if let Some(t) = b.thinking.filter(|t| !t.trim().is_empty()) {
                                parts.push(AgentPart::Reasoning { text: t });
                            }
                        }
                        "tool_use" => {
                            let tool_id = b.id.unwrap_or_default();
                            let name = b.name.unwrap_or_else(|| "tool".to_string());
                            tool_names.insert(tool_id.clone(), name.clone());
                            parts.push(AgentPart::ToolCall {
                                tool_id,
                                name,
                                input: b.input.unwrap_or(serde_json::Value::Null),
                            });
                        }
                        _ => {}
                    }
                }
            }
            let merge_into = match (&message.id, &last_assistant) {
                (Some(mid), Some((last_id, idx))) if mid == last_id => Some(*idx),
                _ => None,
            };
            if let Some(idx) = merge_into {
                messages[idx].parts.extend(parts);
                messages[idx].timestamp = timestamp;
            } else {
                messages.push(AgentMessage {
                    id,
                    role: AgentRole::Assistant,
                    timestamp,
                    parts,
                    is_sidechain: false,
                });
                if let Some(mid) = message.id {
                    last_assistant = Some((mid, messages.len() - 1));
                } else {
                    last_assistant = None;
                }
            }
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

    /// Anonymized excerpt of a real Claude Code 2.1.x transcript.
    const FIXTURE: &str = r##"{"type":"mode","mode":"normal","sessionId":"aaaa1111-0000-4000-8000-000000000001"}
{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"<local-command-caveat>Caveat: local commands.</local-command-caveat>"},"isMeta":true,"uuid":"u0","timestamp":"2026-09-02T20:24:04.312Z","cwd":"C:\\Users\\Me\\Proj\\CortX","sessionId":"aaaa1111-0000-4000-8000-000000000001","version":"2.1.258","gitBranch":"main"}
{"parentUuid":"u0","isSidechain":false,"type":"user","message":{"role":"user","content":"Dans le contexte du ticket DEV-11, fais un dashboard"},"uuid":"u1","timestamp":"2026-09-02T20:24:10.000Z","cwd":"C:\\Users\\Me\\Proj\\CortX","sessionId":"aaaa1111-0000-4000-8000-000000000001","version":"2.1.258","gitBranch":"main"}
{"type":"ai-title","aiTitle":"Dashboard agents #DEV-11","sessionId":"aaaa1111-0000-4000-8000-000000000001"}
{"type":"last-prompt","lastPrompt":"Dans le contexte du ticket DEV-11, fais un dashboard","leafUuid":"u1","sessionId":"aaaa1111-0000-4000-8000-000000000001"}
{"parentUuid":"u1","isSidechain":false,"type":"assistant","message":{"model":"claude-x","id":"msg_1","type":"message","role":"assistant","content":[{"type":"thinking","thinking":"plan","signature":"x"}]},"uuid":"a1","timestamp":"2026-09-02T20:24:20.000Z","cwd":"C:\\Users\\Me\\Proj\\CortX","sessionId":"aaaa1111-0000-4000-8000-000000000001","version":"2.1.258","gitBranch":"main"}
{"parentUuid":"a1","isSidechain":false,"type":"assistant","message":{"model":"claude-x","id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"Je lis le plan."}]},"uuid":"a2","timestamp":"2026-09-02T20:24:21.000Z","cwd":"C:\\Users\\Me\\Proj\\CortX","sessionId":"aaaa1111-0000-4000-8000-000000000001","version":"2.1.258","gitBranch":"main"}
{"parentUuid":"a2","isSidechain":false,"type":"assistant","message":{"model":"claude-x","id":"msg_1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"plans/x.md"}}]},"uuid":"a3","timestamp":"2026-09-02T20:24:22.000Z","cwd":"C:\\Users\\Me\\Proj\\CortX","sessionId":"aaaa1111-0000-4000-8000-000000000001","version":"2.1.258","gitBranch":"main"}
{"parentUuid":"a3","isSidechain":false,"type":"attachment","attachment":{"type":"total_tokens_reminder","text":"x"},"uuid":"att1","timestamp":"2026-09-02T20:24:22.500Z","cwd":"C:\\Users\\Me\\Proj\\CortX","sessionId":"aaaa1111-0000-4000-8000-000000000001","version":"2.1.258","gitBranch":"main"}
{"parentUuid":"a3","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"# plan"}]},"uuid":"u2","timestamp":"2026-09-02T20:24:23.000Z","toolUseResult":{"type":"text","file":{"filePath":"plans/x.md"}},"cwd":"C:\\Users\\Me\\Proj\\CortX","sessionId":"aaaa1111-0000-4000-8000-000000000001","version":"2.1.258","gitBranch":"feat/dev-11"}
{"parentUuid":"u2","isSidechain":false,"type":"assistant","message":{"model":"claude-x","id":"msg_2","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"Bash","input":{"command":"cargo check"}}]},"uuid":"a4","timestamp":"2026-09-02T20:24:30.000Z","cwd":"C:\\Users\\Me\\Proj\\CortX","sessionId":"aaaa1111-0000-4000-8000-000000000001","version":"2.1.258","gitBranch":"feat/dev-11"}
{"parentUuid":"x","isSidechain":true,"type":"assistant","message":{"model":"claude-x","id":"msg_side","role":"assistant","content":[{"type":"text","text":"side"}]},"uuid":"s1","timestamp":"2026-09-02T20:24:31.000Z","cwd":"C:\\Users\\Me\\Proj\\CortX","sessionId":"aaaa1111-0000-4000-8000-000000000001","version":"2.1.258","gitBranch":"feat/dev-11"}
"##;

    fn scan(fixture: &str) -> TranscriptSummary {
        let mut s = TranscriptSummary::default();
        for line in fixture.lines().filter(|l| !l.is_empty()) {
            update_summary(&mut s, line);
        }
        s
    }

    #[test]
    fn summary_from_fixture() {
        let s = scan(FIXTURE);
        assert_eq!(s.session_id.as_deref(), Some("aaaa1111-0000-4000-8000-000000000001"));
        assert_eq!(s.cwd.as_deref(), Some(r"C:\Users\Me\Proj\CortX"));
        assert_eq!(s.git_branch.as_deref(), Some("feat/dev-11"));
        assert_eq!(s.version.as_deref(), Some("2.1.258"));
        assert_eq!(s.model.as_deref(), Some("claude-x"));
        assert_eq!(s.auto_title.as_deref(), Some("Dashboard agents #DEV-11"));
        assert_eq!(
            s.first_prompt.as_deref(),
            Some("Dans le contexte du ticket DEV-11, fais un dashboard")
        );
        assert_eq!(s.last_prompt, s.first_prompt);
        assert_eq!(s.last_assistant_text.as_deref(), Some("Je lis le plan."));
        // toolu_1 got its result, toolu_2 is still pending.
        assert_eq!(s.current_tool.as_deref(), Some("Bash"));
        // 1 user prompt + 2 assistant messages (msg_1 merged, sidechain skipped).
        assert_eq!(s.message_count, 3);
        assert_eq!(
            s.first_timestamp.unwrap().to_rfc3339(),
            "2026-09-02T20:24:04.312+00:00"
        );
        assert_eq!(
            s.last_timestamp.unwrap().to_rfc3339(),
            "2026-09-02T20:24:30+00:00"
        );
    }

    #[test]
    fn summary_is_incremental_head_then_tail() {
        // Scanning the head then the tail must equal scanning everything.
        let lines: Vec<&str> = FIXTURE.lines().filter(|l| !l.is_empty()).collect();
        let mut s = TranscriptSummary::default();
        for l in &lines[..5] {
            update_summary(&mut s, l);
        }
        assert_eq!(s.current_tool, None);
        assert_eq!(s.message_count, 1);
        for l in &lines[5..] {
            update_summary(&mut s, l);
        }
        let full = scan(FIXTURE);
        assert_eq!(s.message_count, full.message_count);
        assert_eq!(s.current_tool, full.current_tool);
        assert_eq!(s.last_assistant_text, full.last_assistant_text);
    }

    #[test]
    fn transcript_from_fixture() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("aaaa1111-0000-4000-8000-000000000001.jsonl");
        std::fs::write(&p, FIXTURE).unwrap();
        let msgs = parse_transcript(&p).unwrap();
        // user, assistant(msg_1 merged), user(tool result), assistant(msg_2)
        assert_eq!(msgs.len(), 4);
        assert_eq!(msgs[0].role, AgentRole::User);
        assert_eq!(msgs[1].role, AgentRole::Assistant);
        assert_eq!(msgs[1].parts.len(), 3);
        assert!(matches!(msgs[1].parts[0], AgentPart::Reasoning { .. }));
        assert!(matches!(msgs[1].parts[2], AgentPart::ToolCall { ref name, .. } if name == "Read"));
        match &msgs[2].parts[0] {
            AgentPart::ToolResult {
                tool_id,
                name,
                output,
                is_error,
            } => {
                assert_eq!(tool_id, "toolu_1");
                assert_eq!(name.as_deref(), Some("Read"));
                assert_eq!(output, "# plan");
                assert!(!is_error);
            }
            other => panic!("unexpected part {:?}", other),
        }
        assert_eq!(msgs[3].id, "a4");
        assert_eq!(count_subagents(&p), 0);
        std::fs::create_dir_all(p.with_extension("").join("subagents")).unwrap();
        std::fs::write(p.with_extension("").join("subagents").join("agent-1.jsonl"), "{}\n").unwrap();
        assert_eq!(count_subagents(&p), 1);
    }

    #[test]
    fn encode_cwd_matches_claude_layout() {
        assert_eq!(
            encode_cwd(r"C:\Users\Alexis Munch\Desktop\CortX"),
            "C--Users-Alexis-Munch-Desktop-CortX"
        );
        let p = transcript_path_for(Path::new("/p"), "/home/me/x", "abc");
        assert!(p.ends_with("-home-me-x/abc.jsonl"));
    }

    #[test]
    fn live_entry_states_and_names() {
        let e: LiveEntry = serde_json::from_str(
            r#"{"pid":1,"sessionId":"s","cwd":"C:\\x","startedAt":1788380587508,"version":"2.1.258","kind":"interactive","name":"cortx-80","nameSource":"derived","status":"busy","updatedAt":1788382087889}"#,
        )
        .unwrap();
        assert_eq!(e.state(), AgentState::Running);
        assert_eq!(e.custom_name(), None);
        let e2 = LiveEntry {
            status: "idle".into(),
            name: Some("my agent".into()),
            name_source: Some("user".into()),
            ..e
        };
        assert_eq!(e2.state(), AgentState::Waiting);
        assert_eq!(e2.custom_name(), Some("my agent"));
    }

    #[test]
    fn live_registry_drops_dead_pids() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("4000000.json"),
            r#"{"pid":4000000,"sessionId":"dead","status":"busy"}"#,
        )
        .unwrap();
        let me = std::process::id();
        std::fs::write(
            dir.path().join(format!("{}.json", me)),
            format!(r#"{{"pid":{},"sessionId":"alive","status":"idle"}}"#, me),
        )
        .unwrap();
        std::fs::write(dir.path().join("x.key"), "k").unwrap();
        let live = read_live_registry(dir.path());
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].session_id, "alive");
    }
}
