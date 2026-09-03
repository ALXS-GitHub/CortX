//! Shared terminal layout document (DEV-13 P1).
//!
//! The main window (bottom dock) and the dedicated Terminal window are two
//! WebViews with their own JavaScript state. What they must agree on — which
//! terminal is shown where, the Terminal window's tabs and split trees — is
//! kept here as one JSON document with a revision counter. Windows read it
//! on boot, write whole documents back, and every write is broadcast as the
//! `terminal-layout` event so the other window re-syncs.
//!
//! The schema is owned by the frontend (`src/lib/terminalLayout.ts`); Rust
//! only stores, versions and (from P2 on) persists it under
//! `data/terminal/sessions.json`.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutDoc {
    pub revision: u64,
    pub layout: Value,
}

pub struct LayoutStore {
    doc: Mutex<LayoutDoc>,
    /// Where to persist. `None` = memory only (P1); P2 wires the data dir.
    path: Option<PathBuf>,
}

impl LayoutStore {
    pub fn new(path: Option<PathBuf>) -> Self {
        let layout = path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or(Value::Null);
        Self {
            doc: Mutex::new(LayoutDoc { revision: 0, layout }),
            path,
        }
    }

    pub fn get(&self) -> LayoutDoc {
        self.doc.lock().clone()
    }

    /// Replace the document; returns the new revision. Last write wins —
    /// both windows apply the same optimistic mutation locally and the
    /// broadcast reconciles whoever was behind.
    pub fn set(&self, layout: Value) -> u64 {
        let mut doc = self.doc.lock();
        doc.revision += 1;
        doc.layout = layout;
        let revision = doc.revision;
        self.persist(&doc);
        revision
    }

    /// Set one top-level key from the backend (e.g. `windowOpen`) and return
    /// the new document so the caller can broadcast it. A null / non-object
    /// document is turned into an object first.
    pub fn patch(&self, key: &str, value: Value) -> LayoutDoc {
        let mut doc = self.doc.lock();
        if !doc.layout.is_object() {
            doc.layout = Value::Object(Default::default());
        }
        if let Some(map) = doc.layout.as_object_mut() {
            map.insert(key.to_string(), value);
        }
        doc.revision += 1;
        self.persist(&doc);
        doc.clone()
    }

    fn persist(&self, doc: &LayoutDoc) {
        if let Some(path) = &self.path {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(text) = serde_json::to_string_pretty(&doc.layout) {
                let tmp = path.with_extension("json.tmp");
                if std::fs::write(&tmp, text).is_ok() {
                    let _ = std::fs::rename(&tmp, path);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_bumps_revision_and_get_returns_latest() {
        let store = LayoutStore::new(None);
        assert_eq!(store.get().revision, 0);
        let r1 = store.set(serde_json::json!({ "version": 1 }));
        let r2 = store.set(serde_json::json!({ "version": 1, "tabs": [] }));
        assert_eq!((r1, r2), (1, 2));
        assert_eq!(store.get().layout["tabs"], serde_json::json!([]));
    }

    #[test]
    fn persists_and_reloads_from_path() {
        let dir = std::env::temp_dir().join(format!("cortx-layout-{}", uuid::Uuid::new_v4()));
        let path = dir.join("terminal").join("sessions.json");
        let store = LayoutStore::new(Some(path.clone()));
        store.set(serde_json::json!({ "hello": "world" }));
        let again = LayoutStore::new(Some(path));
        assert_eq!(again.get().layout["hello"], "world");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
