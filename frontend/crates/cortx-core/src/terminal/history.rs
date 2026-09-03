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
}
