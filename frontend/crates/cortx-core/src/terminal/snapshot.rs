//! Scrollback snapshots for session restore (DEV-13 P2).
//!
//! Restoring a session recreates the *layout* and the shells, not the
//! processes. To make a restored tab feel like the one you left, the tail of
//! each terminal's raw scrollback (escape sequences included, so colours
//! survive) is written to `runtime/terminal-snapshots/<id>.bin` — at quit and
//! every minute while the app runs. When the replacement shell is spawned the
//! snapshot is pushed into the hub *before* the PTY starts, so the GUI simply
//! replays it like any scrollback. `runtime/` stays outside the git backup.

use super::TerminalHub;
use std::fs;
use std::path::{Path, PathBuf};

/// Hard cap per snapshot, whatever the line count asks for.
const MAX_SNAPSHOT_BYTES: usize = 256 * 1024;

/// Separator written between the restored tail and the new shell's output.
pub const RESTORE_SEPARATOR: &[u8] = b"\r\n\x1b[2m\xe2\x94\x80\xe2\x94\x80 restored session \xe2\x94\x80\xe2\x94\x80\x1b[0m\r\n";

pub fn snapshots_dir(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join("terminal-snapshots")
}

fn file_for(runtime_dir: &Path, terminal_id: &str) -> PathBuf {
    // Terminal ids are `<kind>:<uuid>`; ':' is not allowed in file names.
    snapshots_dir(runtime_dir).join(format!("{}.bin", terminal_id.replace(':', "_")))
}

/// Last `max_lines` lines of `bytes` (counted on `\n`), capped in size.
pub fn tail_lines(bytes: &[u8], max_lines: usize) -> &[u8] {
    if max_lines == 0 || bytes.is_empty() {
        return &[];
    }
    // A trailing newline terminates the last line rather than starting a new
    // one, so it needs one more separator to reach `max_lines`.
    let trailing = usize::from(bytes.last() == Some(&b'\n'));
    let needed = max_lines + trailing;
    let mut seen = 0usize;
    let mut start = 0usize;
    for (i, &b) in bytes.iter().enumerate().rev() {
        if b == b'\n' {
            seen += 1;
            if seen == needed {
                start = i + 1;
                break;
            }
        }
    }
    let mut tail = &bytes[start..];
    if tail.len() > MAX_SNAPSHOT_BYTES {
        tail = &tail[tail.len() - MAX_SNAPSHOT_BYTES..];
    }
    tail
}

/// A snapshot written by the GUI (a serialised xterm buffer: plain lines
/// with colours, no cursor movement) is preferred over the raw PTY tail; the
/// raw tail only fills in when the GUI's copy is older than this.
const GUI_SNAPSHOT_FRESH: std::time::Duration = std::time::Duration::from_secs(150);

/// Store a snapshot produced by the GUI (see `terminalSnapshots.ts`).
pub fn store(runtime_dir: &Path, terminal_id: &str, bytes: &[u8]) {
    let path = file_for(runtime_dir, terminal_id);
    if bytes.is_empty() {
        let _ = fs::remove_file(&path);
        return;
    }
    if fs::create_dir_all(snapshots_dir(runtime_dir)).is_err() {
        return;
    }
    let capped = if bytes.len() > MAX_SNAPSHOT_BYTES {
        &bytes[bytes.len() - MAX_SNAPSHOT_BYTES..]
    } else {
        bytes
    };
    let tmp = path.with_extension("bin.tmp");
    if fs::write(&tmp, capped).is_ok() {
        let _ = fs::rename(&tmp, &path);
    }
}

fn is_fresh(path: &Path) -> bool {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .map(|age| age < GUI_SNAPSHOT_FRESH)
        .unwrap_or(false)
}

/// Write the raw PTY tail of every terminal in `ids` (or all hub terminals
/// when `ids` is `None`), unless the GUI stored a fresh snapshot for it.
/// Missing / empty scrollbacks remove a stale file.
pub fn save_all(hub: &TerminalHub, runtime_dir: &Path, ids: Option<&[String]>, max_lines: usize) {
    let dir = snapshots_dir(runtime_dir);
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let ids: Vec<String> = match ids {
        Some(list) => list.to_vec(),
        None => hub.ids(),
    };
    for id in ids {
        let path = file_for(runtime_dir, &id);
        if is_fresh(&path) {
            continue;
        }
        let scrollback = hub.scrollback(&id);
        let tail = tail_lines(&scrollback, max_lines);
        if tail.is_empty() {
            let _ = fs::remove_file(&path);
            continue;
        }
        let tmp = path.with_extension("bin.tmp");
        if fs::write(&tmp, tail).is_ok() {
            let _ = fs::rename(&tmp, &path);
        }
    }
}

/// Read (and keep) a snapshot.
pub fn load(runtime_dir: &Path, terminal_id: &str) -> Option<Vec<u8>> {
    fs::read(file_for(runtime_dir, terminal_id)).ok().filter(|b| !b.is_empty())
}

pub fn remove(runtime_dir: &Path, terminal_id: &str) {
    let _ = fs::remove_file(file_for(runtime_dir, terminal_id));
}

/// Drop snapshots of terminals that no longer appear in the layout.
pub fn prune_except(runtime_dir: &Path, keep: &[String]) {
    let Ok(entries) = fs::read_dir(snapshots_dir(runtime_dir)) else {
        return;
    };
    let keep: Vec<PathBuf> = keep.iter().map(|id| file_for(runtime_dir, id)).collect();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("bin") && !keep.contains(&path) {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_keeps_the_last_n_lines() {
        let data = b"one\ntwo\nthree\nfour\nfive";
        assert_eq!(tail_lines(data, 2), b"four\nfive");
        assert_eq!(tail_lines(data, 100), data);
        assert_eq!(tail_lines(data, 0), b"");
        assert_eq!(tail_lines(b"a\nb\n", 1), b"b\n");
    }

    #[test]
    fn save_load_prune_round_trip() {
        let dir = std::env::temp_dir().join(format!("cortx-snap-{}", uuid::Uuid::new_v4()));
        let hub = TerminalHub::new();
        hub.push("shell:a", b"hello\nworld\n");
        hub.push("shell:b", b"x\n");
        save_all(&hub, &dir, None, 200);
        assert_eq!(load(&dir, "shell:a").as_deref(), Some(&b"hello\nworld\n"[..]));
        prune_except(&dir, &["shell:a".to_string()]);
        assert!(load(&dir, "shell:b").is_none());
        remove(&dir, "shell:a");
        assert!(load(&dir, "shell:a").is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
