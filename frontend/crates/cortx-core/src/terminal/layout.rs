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
//!
//! One thing Rust does own: the **migration** of a document read from disk
//! (see [`migrate`]). A document written before the Terminal window could be
//! more than one (v1) has to keep opening, and silently losing a user's tabs
//! because a field moved is exactly the kind of breakage nobody notices until
//! the sessions are gone — hence the tests at the bottom of this file.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::PathBuf;

/// Version of the layout document this build writes.
///
/// - v1: one Terminal window. `window: { scope, activeTabId, tabs }`.
/// - v2: N Terminal windows (DEV-13, ticket #20). `window.tabs` still holds
///   *every* tab — a tab now names its window with `windowId` (absent =
///   the first window) — and `windows` maps a window label to its own
///   `scope` / `activeTabId`. A v1 reader therefore still shows every tab,
///   which is the least destructive way to open a v2 document.
pub const LAYOUT_VERSION: u64 = 2;

/// Label of the first Terminal window. Tabs of a v1 document belong to it,
/// and its tabs keep no `windowId` so a single-window document is byte-for-
/// byte what it always was.
pub const PRIMARY_TERMINAL_WINDOW: &str = "terminal";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutDoc {
    pub revision: u64,
    pub layout: Value,
}

/// Bring a document read from disk up to [`LAYOUT_VERSION`].
///
/// Only additive: nothing is moved or dropped, so the same function is safe
/// to run on a document that is already current (it is idempotent), and a
/// document it does not recognise (null, an array, a future version) is
/// handed back untouched rather than replaced by an empty one.
pub fn migrate(layout: Value) -> Value {
    let Value::Object(mut map) = layout else {
        return layout;
    };

    // `windows` present and usable: already v2 (or newer), leave it alone.
    let has_windows = map
        .get("windows")
        .and_then(Value::as_object)
        .is_some_and(|w| !w.is_empty());

    if !has_windows {
        // v1 → v2: the single window becomes the primary one, keeping its
        // scope and active tab. Its tabs stay where they are; no `windowId`
        // means "the primary window", so they need no rewriting at all.
        let window = map.get("window").and_then(Value::as_object);
        let scope = window
            .and_then(|w| w.get("scope"))
            .cloned()
            .unwrap_or_else(|| Value::String("global".into()));
        let active_tab_id = window
            .and_then(|w| w.get("activeTabId"))
            .cloned()
            .unwrap_or(Value::Null);
        let mut states = Map::new();
        states.insert(
            PRIMARY_TERMINAL_WINDOW.to_string(),
            serde_json::json!({ "scope": scope, "activeTabId": active_tab_id }),
        );
        map.insert("windows".to_string(), Value::Object(states));
    }

    // `openWindows` (which windows to reopen on the next start) did not
    // exist in v1; `windowOpen` said whether the only one was up.
    if !map.get("openWindows").is_some_and(Value::is_array) {
        let open = map.get("windowOpen").and_then(Value::as_bool).unwrap_or(false);
        let list = if open {
            vec![Value::String(PRIMARY_TERMINAL_WINDOW.to_string())]
        } else {
            Vec::new()
        };
        map.insert("openWindows".to_string(), Value::Array(list));
    }

    // Never downgrade the marker: a document from a newer build keeps its own.
    let version = map.get("version").and_then(Value::as_u64).unwrap_or(0);
    if version < LAYOUT_VERSION {
        map.insert("version".to_string(), Value::from(LAYOUT_VERSION));
    }
    Value::Object(map)
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
            .map(migrate)
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

    // -----------------------------------------------------------------------
    // Migration v1 -> v2 (DEV-13, ticket #20)
    // -----------------------------------------------------------------------

    /// A `sessions.json` as CortX 0.14 wrote it: one window, two tabs, a
    /// split, recorded cwd / size, a scoped window and `windowOpen`.
    fn v1_document() -> Value {
        serde_json::json!({
            "version": 1,
            "surfaces": { "shell:a": "window", "shell:b": "window", "service:x": "dock" },
            "window": {
                "scope": { "projectId": "proj-1" },
                "activeTabId": "tab-1",
                "tabs": [
                    {
                        "id": "tab-1",
                        "workspaceId": "project:proj-1",
                        "title": "dev",
                        "color": "#7aa2f7",
                        "pinned": true,
                        "order": 1,
                        "activeLeafId": "leaf-1",
                        "layout": {
                            "kind": "split",
                            "id": "split-1",
                            "direction": "horizontal",
                            "sizes": [0.5, 0.5],
                            "children": [
                                { "kind": "leaf", "id": "leaf-1", "terminalId": "shell:a", "cwd": "C:/code", "cols": 120, "rows": 30 },
                                { "kind": "leaf", "id": "leaf-2", "terminalId": "shell:b" }
                            ]
                        }
                    },
                    {
                        "id": "tab-2",
                        "workspaceId": "free",
                        "title": null,
                        "color": null,
                        "pinned": false,
                        "order": 2,
                        "activeLeafId": "leaf-3",
                        "layout": { "kind": "leaf", "id": "leaf-3", "terminalId": "service:x" }
                    }
                ]
            },
            "windowOpen": true
        })
    }

    #[test]
    fn migrates_a_v1_document_into_the_first_window() {
        let out = migrate(v1_document());
        assert_eq!(out["version"], 2);
        // The single window's scope and active tab become the primary
        // window's; nothing else about `window` is touched.
        assert_eq!(out["windows"]["terminal"]["scope"]["projectId"], "proj-1");
        assert_eq!(out["windows"]["terminal"]["activeTabId"], "tab-1");
        assert_eq!(out["openWindows"], serde_json::json!(["terminal"]));
        // Every tab is still there, still without a `windowId` (= primary).
        let tabs = out["window"]["tabs"].as_array().unwrap();
        assert_eq!(tabs.len(), 2);
        assert!(tabs.iter().all(|t| t.get("windowId").is_none()));
        assert_eq!(tabs[0]["title"], "dev");
        assert_eq!(tabs[0]["pinned"], true);
        assert_eq!(tabs[0]["layout"]["children"][0]["cwd"], "C:/code");
        assert_eq!(tabs[0]["layout"]["children"][0]["cols"], 120);
        assert_eq!(out["surfaces"]["service:x"], "dock");
    }

    #[test]
    fn migration_is_idempotent() {
        let once = migrate(v1_document());
        let twice = migrate(once.clone());
        assert_eq!(once, twice);
    }

    #[test]
    fn migration_keeps_an_existing_multi_window_document() {
        let doc = serde_json::json!({
            "version": 2,
            "surfaces": {},
            "window": {
                "scope": "global",
                "activeTabId": "tab-2",
                "tabs": [
                    { "id": "tab-1", "workspaceId": "free", "order": 1 },
                    { "id": "tab-2", "workspaceId": "free", "order": 2, "windowId": "terminal-2" }
                ]
            },
            "windows": {
                "terminal": { "scope": "global", "activeTabId": "tab-1" },
                "terminal-2": { "scope": { "projectId": "p" }, "activeTabId": "tab-2" }
            },
            "openWindows": ["terminal", "terminal-2"],
            "windowOpen": true
        });
        let out = migrate(doc.clone());
        assert_eq!(out, doc);
    }

    #[test]
    fn migration_leaves_unknown_shapes_alone() {
        assert_eq!(migrate(Value::Null), Value::Null);
        assert_eq!(migrate(serde_json::json!([1, 2])), serde_json::json!([1, 2]));
    }

    #[test]
    fn migration_handles_an_empty_or_partial_document() {
        // Never opened: no `window` key at all.
        let out = migrate(serde_json::json!({}));
        assert_eq!(out["version"], 2);
        assert_eq!(out["windows"]["terminal"]["scope"], "global");
        assert_eq!(out["windows"]["terminal"]["activeTabId"], Value::Null);
        assert_eq!(out["openWindows"], serde_json::json!([]));
        // Half-written `windows` (empty object) is rebuilt from `window`.
        let out = migrate(serde_json::json!({
            "windows": {},
            "window": { "scope": "global", "activeTabId": "t", "tabs": [] }
        }));
        assert_eq!(out["windows"]["terminal"]["activeTabId"], "t");
    }

    #[test]
    fn migration_does_not_downgrade_a_newer_document() {
        let out = migrate(serde_json::json!({
            "version": 99,
            "windows": { "terminal": { "scope": "global", "activeTabId": null } },
            "openWindows": []
        }));
        assert_eq!(out["version"], 99);
    }

    #[test]
    fn a_v1_file_on_disk_is_migrated_when_the_store_opens_it() {
        let dir = std::env::temp_dir().join(format!("cortx-layout-mig-{}", uuid::Uuid::new_v4()));
        let path = dir.join("terminal").join("sessions.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, serde_json::to_string_pretty(&v1_document()).unwrap()).unwrap();
        let store = LayoutStore::new(Some(path));
        let layout = store.get().layout;
        assert_eq!(layout["version"], 2);
        assert_eq!(layout["windows"]["terminal"]["activeTabId"], "tab-1");
        assert_eq!(layout["window"]["tabs"].as_array().unwrap().len(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
