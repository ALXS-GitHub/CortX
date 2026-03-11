use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

/// Identifies which data file changed
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DataFile {
    Projects,
    Settings,
    GlobalScripts,
    TagDefinitions,
    ScriptGroups,
    ExecutionHistory,
    Tools,
    Unknown(String),
}

impl DataFile {
    pub fn from_filename(filename: &str) -> Self {
        match filename {
            "projects.json" => DataFile::Projects,
            "settings.json" => DataFile::Settings,
            "global_scripts.json" => DataFile::GlobalScripts,
            "tag_definitions.json" => DataFile::TagDefinitions,
            "script_groups.json" => DataFile::ScriptGroups,
            "execution_history.json" => DataFile::ExecutionHistory,
            "tools.json" => DataFile::Tools,
            other => DataFile::Unknown(other.to_string()),
        }
    }
}

/// Handle returned by `start_watching`. Drop to stop watching.
pub struct FileWatcherHandle {
    _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
    _thread: std::thread::JoinHandle<()>,
}

/// Start watching `watch_dir` for .json changes. Debounces by 300ms.
/// Calls `on_change` with list of changed DataFiles.
pub fn start_watching<F>(
    watch_dir: PathBuf,
    on_change: F,
) -> Result<FileWatcherHandle, notify::Error>
where
    F: Fn(Vec<DataFile>) + Send + 'static,
{
    let (tx, rx) = mpsc::channel::<DebounceEventResult>();
    let mut debouncer = new_debouncer(Duration::from_millis(300), tx)?;
    debouncer
        .watcher()
        .watch(&watch_dir, notify::RecursiveMode::NonRecursive)?;

    let thread = std::thread::Builder::new()
        .name("cortx-file-watcher".into())
        .spawn(move || {
            while let Ok(result) = rx.recv() {
                let events = match result {
                    Ok(events) => events,
                    Err(err) => {
                        log::warn!("File watcher error: {:?}", err);
                        continue;
                    }
                };

                let mut changed: Vec<DataFile> = Vec::new();
                for event in events {
                    if let Some(filename) = event.path.file_name().and_then(|f| f.to_str()) {
                        if filename.ends_with(".json") {
                            let df = DataFile::from_filename(filename);
                            if !changed.contains(&df) {
                                changed.push(df);
                            }
                        }
                    }
                }
                if !changed.is_empty() {
                    on_change(changed);
                }
            }
        })
        .map_err(|e| notify::Error::generic(&e.to_string()))?;

    Ok(FileWatcherHandle {
        _debouncer: debouncer,
        _thread: thread,
    })
}
