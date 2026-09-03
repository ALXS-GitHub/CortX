//! Launch configurations (DEV-13 P2): "open a dev session" presets.
//!
//! One YAML file per configuration under `data/terminal/launch/<id>.yaml`
//! (synced by the git backup). CortX's own format, deliberately not Warp's:
//!
//! ```yaml
//! id: 8c1f…
//! name: Zorg dev
//! projectId: 3fa2…        # optional; leaves' cwd are relative to its root
//! window: terminal         # terminal (default) | dock
//! tabs:
//!   - title: dev
//!     layout:
//!       split: horizontal  # children side by side; vertical = stacked
//!       children:
//!         - { cwd: ".", command: "bun dev" }
//!         - { cwd: ".", shell: pwsh }
//!   - layout: { cwd: ".", command: claude }
//! ```
//!
//! Commands are *typed into the shell* by the GUI (so the profile, aliases
//! and history apply), never executed by Rust. This module only stores,
//! validates and serialises; running a configuration is frontend logic.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum LaunchTarget {
    #[default]
    Terminal,
    Dock,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LaunchSplit {
    Horizontal,
    Vertical,
}

/// A split or a leaf. Untagged: a mapping with `split` is a split, anything
/// else is a leaf.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LaunchNode {
    Split {
        split: LaunchSplit,
        children: Vec<LaunchNode>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sizes: Option<Vec<f64>>,
    },
    Leaf {
        /// Absolute, or relative to the project root (`.` = root).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cwd: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        command: Option<String>,
        /// Shell command line override (`pwsh -NoLogo`, `nu`…).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        shell: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchTab {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub layout: LaunchNode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchConfig {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default)]
    pub window: LaunchTarget,
    pub tabs: Vec<LaunchTab>,
}

const MAX_LEAVES: usize = 32;

impl LaunchNode {
    fn count_leaves(&self) -> usize {
        match self {
            LaunchNode::Leaf { .. } => 1,
            LaunchNode::Split { children, .. } => children.iter().map(|c| c.count_leaves()).sum(),
        }
    }

    fn validate(&self, path: &str) -> Result<(), String> {
        match self {
            LaunchNode::Leaf { .. } => Ok(()),
            LaunchNode::Split { children, sizes, .. } => {
                if children.len() < 2 {
                    return Err(format!("{}: a split needs at least two children", path));
                }
                if let Some(s) = sizes {
                    if s.len() != children.len() {
                        return Err(format!("{}: `sizes` must have one entry per child", path));
                    }
                    if s.iter().any(|v| !v.is_finite() || *v <= 0.0) {
                        return Err(format!("{}: `sizes` must be positive numbers", path));
                    }
                }
                for (i, c) in children.iter().enumerate() {
                    c.validate(&format!("{}.children[{}]", path, i))?;
                }
                Ok(())
            }
        }
    }
}

impl LaunchConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.trim().is_empty() {
            return Err("`id` is required".into());
        }
        if self.name.trim().is_empty() {
            return Err("`name` is required".into());
        }
        if self.tabs.is_empty() {
            return Err("at least one tab is required".into());
        }
        let mut leaves = 0;
        for (i, tab) in self.tabs.iter().enumerate() {
            tab.layout.validate(&format!("tabs[{}].layout", i))?;
            leaves += tab.layout.count_leaves();
        }
        if leaves > MAX_LEAVES {
            return Err(format!("too many terminals ({} > {})", leaves, MAX_LEAVES));
        }
        Ok(())
    }

    pub fn to_yaml(&self) -> Result<String, String> {
        serde_yaml::to_string(self).map_err(|e| e.to_string())
    }

    pub fn from_yaml(text: &str) -> Result<Self, String> {
        let cfg: LaunchConfig = serde_yaml::from_str(text).map_err(|e| e.to_string())?;
        cfg.validate()?;
        Ok(cfg)
    }
}

/// Filesystem store for `data/terminal/launch/*.yaml`.
#[derive(Debug, Clone)]
pub struct LaunchStore {
    dir: PathBuf,
}

impl LaunchStore {
    pub fn new(terminal_dir: &Path) -> Self {
        Self {
            dir: terminal_dir.join("launch"),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path_for(&self, id: &str) -> Result<PathBuf, String> {
        if id.is_empty() || id.contains(['/', '\\', ':', '.']) {
            return Err(format!("invalid launch configuration id '{}'", id));
        }
        Ok(self.dir.join(format!("{}.yaml", id)))
    }

    /// Every valid configuration, sorted by name. Broken files are skipped
    /// (and logged) so one bad edit never hides the others.
    pub fn list(&self) -> Vec<LaunchConfig> {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        let mut out: Vec<LaunchConfig> = entries
            .flatten()
            .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("yaml"))
            .filter_map(|e| match fs::read_to_string(e.path()) {
                Ok(text) => match LaunchConfig::from_yaml(&text) {
                    Ok(cfg) => Some(cfg),
                    Err(err) => {
                        log::warn!("Skipping launch config {}: {}", e.path().display(), err);
                        None
                    }
                },
                Err(_) => None,
            })
            .collect();
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        out
    }

    pub fn get(&self, id: &str) -> Option<LaunchConfig> {
        let path = self.path_for(id).ok()?;
        let text = fs::read_to_string(path).ok()?;
        LaunchConfig::from_yaml(&text).ok()
    }

    /// Raw file text (for the YAML editor); `None` when missing.
    pub fn read_yaml(&self, id: &str) -> Option<String> {
        let path = self.path_for(id).ok()?;
        fs::read_to_string(path).ok()
    }

    pub fn save(&self, cfg: &LaunchConfig) -> Result<(), String> {
        cfg.validate()?;
        let path = self.path_for(&cfg.id)?;
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let text = cfg.to_yaml()?;
        let tmp = path.with_extension("yaml.tmp");
        fs::write(&tmp, text).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &path).map_err(|e| e.to_string())
    }

    /// Validate `text` and store it as-is (comments preserved). The id in the
    /// text wins over `expected_id` when they differ, and the old file is
    /// removed.
    pub fn save_yaml(&self, expected_id: Option<&str>, text: &str) -> Result<LaunchConfig, String> {
        let cfg = LaunchConfig::from_yaml(text)?;
        let path = self.path_for(&cfg.id)?;
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("yaml.tmp");
        fs::write(&tmp, text).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        if let Some(old) = expected_id {
            if old != cfg.id {
                let _ = self.delete(old);
            }
        }
        Ok(cfg)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let path = self.path_for(id)?;
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
id: zorg-dev
name: Zorg dev
projectId: p1
tabs:
  - title: dev
    layout:
      split: horizontal
      children:
        - { cwd: ".", command: "bun dev" }
        - split: vertical
          children:
            - { cwd: ".", command: "cargo watch -x run" }
            - { cwd: ".", shell: pwsh }
  - layout: { cwd: ".", command: claude }
"#;

    #[test]
    fn parses_the_documented_format() {
        let cfg = LaunchConfig::from_yaml(SAMPLE).unwrap();
        assert_eq!(cfg.name, "Zorg dev");
        assert_eq!(cfg.window, LaunchTarget::Terminal);
        assert_eq!(cfg.tabs.len(), 2);
        match &cfg.tabs[0].layout {
            LaunchNode::Split { split, children, .. } => {
                assert_eq!(*split, LaunchSplit::Horizontal);
                assert_eq!(children.len(), 2);
            }
            _ => panic!("expected a split"),
        }
        let yaml = cfg.to_yaml().unwrap();
        let again = LaunchConfig::from_yaml(&yaml).unwrap();
        assert_eq!(again, cfg);
    }

    #[test]
    fn rejects_invalid_configs() {
        assert!(LaunchConfig::from_yaml("id: a\nname: A\ntabs: []\n").is_err());
        let one_child = "id: a\nname: A\ntabs:\n  - layout:\n      split: horizontal\n      children:\n        - { cwd: . }\n";
        assert!(LaunchConfig::from_yaml(one_child).unwrap_err().contains("two children"));
        let bad_sizes = "id: a\nname: A\ntabs:\n  - layout:\n      split: horizontal\n      sizes: [1]\n      children:\n        - { cwd: . }\n        - { cwd: . }\n";
        assert!(LaunchConfig::from_yaml(bad_sizes).unwrap_err().contains("sizes"));
    }

    #[test]
    fn store_round_trip() {
        let dir = std::env::temp_dir().join(format!("cortx-launch-{}", uuid::Uuid::new_v4()));
        let store = LaunchStore::new(&dir);
        let cfg = LaunchConfig::from_yaml(SAMPLE).unwrap();
        store.save(&cfg).unwrap();
        assert_eq!(store.list().len(), 1);
        assert_eq!(store.get("zorg-dev").unwrap(), cfg);
        assert!(store.read_yaml("zorg-dev").unwrap().contains("Zorg dev"));
        // Raw save with a renamed id replaces the old file.
        let renamed = SAMPLE.replace("id: zorg-dev", "id: zorg-dev2");
        store.save_yaml(Some("zorg-dev"), &renamed).unwrap();
        assert!(store.get("zorg-dev").is_none());
        assert!(store.get("zorg-dev2").is_some());
        assert!(store.path_for("../x").is_err());
        store.delete("zorg-dev2").unwrap();
        assert!(store.list().is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
