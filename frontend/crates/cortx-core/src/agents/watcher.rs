//! Recursive watcher over the provider roots (`~/.claude/projects`,
//! `~/.claude/sessions`, `~/.codex`). Debounced (500 ms) and filtered to the
//! files the index cares about; the callback receives the changed paths and
//! is expected to call `AgentIndex::refresh_paths`.

use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

pub struct AgentWatcherHandle {
    _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
    _thread: std::thread::JoinHandle<()>,
    pub watched_roots: Vec<PathBuf>,
}

/// Only transcripts, registry files and the Codex state database matter.
pub fn is_relevant(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|f| f.to_str()) else {
        return false;
    };
    if name.ends_with(".jsonl") || name.ends_with(".json") {
        return true;
    }
    name.starts_with("state_") && name.contains(".sqlite")
}

pub fn start_agent_watching<F>(
    roots: Vec<PathBuf>,
    on_change: F,
) -> Result<AgentWatcherHandle, notify::Error>
where
    F: Fn(Vec<PathBuf>) + Send + 'static,
{
    let (tx, rx) = mpsc::channel::<DebounceEventResult>();
    let mut debouncer = new_debouncer(Duration::from_millis(500), tx)?;

    let mut watched_roots = Vec::new();
    for root in roots {
        if !root.is_dir() {
            log::info!("Agent watcher: root {} does not exist, skipping", root.display());
            continue;
        }
        match debouncer
            .watcher()
            .watch(&root, notify::RecursiveMode::Recursive)
        {
            Ok(()) => watched_roots.push(root),
            Err(e) => log::warn!("Agent watcher: cannot watch {}: {}", root.display(), e),
        }
    }

    let thread = std::thread::Builder::new()
        .name("cortx-agent-watcher".into())
        .spawn(move || {
            while let Ok(result) = rx.recv() {
                let events = match result {
                    Ok(events) => events,
                    Err(err) => {
                        log::warn!("Agent watcher error: {:?}", err);
                        continue;
                    }
                };
                let mut changed: Vec<PathBuf> = Vec::new();
                for event in events {
                    if is_relevant(&event.path) && !changed.contains(&event.path) {
                        changed.push(event.path);
                    }
                }
                if !changed.is_empty() {
                    on_change(changed);
                }
            }
        })
        .map_err(|e| notify::Error::generic(&e.to_string()))?;

    Ok(AgentWatcherHandle {
        _debouncer: debouncer,
        _thread: thread,
        watched_roots,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relevance_filter() {
        assert!(is_relevant(Path::new("/x/projects/p/abc.jsonl")));
        assert!(is_relevant(Path::new("/x/sessions/123.json")));
        assert!(is_relevant(Path::new("/x/state_5.sqlite-wal")));
        assert!(!is_relevant(Path::new("/x/logs_2.sqlite")));
        assert!(!is_relevant(Path::new("/x/sessions/123.key")));
        assert!(!is_relevant(Path::new("/x/tmp/foo.txt")));
    }

    #[test]
    fn reports_relevant_changes_recursively() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("projects").join("p");
        std::fs::create_dir_all(&nested).unwrap();
        let (tx, rx) = std::sync::mpsc::channel::<Vec<PathBuf>>();
        let _h = start_agent_watching(vec![dir.path().to_path_buf()], move |changed| {
            let _ = tx.send(changed);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        std::fs::write(nested.join("ignored.txt"), "x").unwrap();
        std::fs::write(nested.join("abc.jsonl"), "{}
").unwrap();
        let changed = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("watcher should report the jsonl write");
        assert!(changed.iter().any(|p| p.ends_with("abc.jsonl")), "{:?}", changed);
        assert!(changed.iter().all(|p| !p.ends_with("ignored.txt")), "{:?}", changed);
    }

    #[test]
    fn missing_roots_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let h = start_agent_watching(
            vec![dir.path().join("nope"), dir.path().to_path_buf()],
            |_| {},
        )
        .unwrap();
        assert_eq!(h.watched_roots.len(), 1);
    }
}
