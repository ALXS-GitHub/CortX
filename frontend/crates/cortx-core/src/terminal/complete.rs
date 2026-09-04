//! Cheap, context-aware completion sources for the integrated terminal (#17).
//!
//! Everything here is scoped to the terminal's own working directory and is
//! either a plain filesystem read or one short, bounded `git` invocation that
//! goes through [`spec::run_capped`] — the same no-shell, timed, output-capped
//! path used to learn `--help` specs. Nothing is ever run from a string the
//! user typed.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::spec::{resolve_in_path, run_capped, SpecItem};

const GIT_TIMEOUT: Duration = Duration::from_secs(3);
const GIT_MAX_BYTES: usize = 256 * 1024;
/// Refs, entries and scripts are all capped so a huge repository or directory
/// can never turn into a huge IPC payload.
const MAX_REFS: usize = 500;
const DEFAULT_MAX_ENTRIES: usize = 200;

/// One filesystem entry offered as a completion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathCompletion {
    /// Entry name on its own (`src`, `Cargo.toml`).
    pub name: String,
    /// What the whole word becomes once accepted, directory part included
    /// and a trailing separator added for directories.
    pub value: String,
    pub is_dir: bool,
}

/// Split a half-typed path into the directory to list and the prefix to match.
///
/// `"src/comp"` → `("src/", "comp")`, `"src/"` → `("src/", "")`,
/// `"comp"` → `("", "comp")`. Pure: this is the part worth testing.
pub fn split_path_fragment(fragment: &str) -> (&str, &str) {
    match fragment.rfind(['/', '\\']) {
        Some(i) => (&fragment[..=i], &fragment[i + 1..]),
        None => ("", fragment),
    }
}

fn starts_with_ci(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return true;
    }
    if cfg!(windows) {
        haystack.to_lowercase().starts_with(&needle.to_lowercase())
    } else {
        haystack.starts_with(needle)
    }
}

/// Resolve the directory part of a fragment against `cwd`, refusing anything
/// that isn't a directory.
fn resolve_dir(cwd: &Path, dir_part: &str) -> Option<PathBuf> {
    let candidate = if dir_part.is_empty() {
        cwd.to_path_buf()
    } else {
        let p = Path::new(dir_part);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            cwd.join(p)
        }
    };
    candidate.is_dir().then_some(candidate)
}

/// Entries of the directory `fragment` points at, filtered by its last
/// segment. Directories first, then files, each alphabetical.
///
/// Hidden entries (leading `.`) only show up once the prefix asks for them.
pub fn complete_path(cwd: &Path, fragment: &str, limit: usize) -> Vec<PathCompletion> {
    let limit = limit.clamp(1, DEFAULT_MAX_ENTRIES);
    let (dir_part, base) = split_path_fragment(fragment);
    let Some(dir) = resolve_dir(cwd, dir_part) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let sep = if dir_part.contains('\\') || (dir_part.is_empty() && cfg!(windows)) {
        '\\'
    } else {
        '/'
    };
    let mut out: Vec<PathCompletion> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') && !base.starts_with('.') {
            continue;
        }
        if !starts_with_ci(&name, base) {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let mut value = format!("{dir_part}{name}");
        if is_dir {
            value.push(sep);
        }
        out.push(PathCompletion { name, value, is_dir });
        if out.len() > DEFAULT_MAX_ENTRIES * 4 {
            break;
        }
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out.truncate(limit);
    out
}

/// Local branches, remote branches and tags of the repository at `cwd`.
///
/// Runs `git for-each-ref` — read-only, no shell, 3 s cap. Returns an empty
/// list when `cwd` isn't a repository or git isn't installed.
pub fn git_refs(cwd: &Path) -> Vec<String> {
    if !cwd.is_dir() {
        return Vec::new();
    }
    let Some(git) = resolve_in_path("git") else {
        return Vec::new();
    };
    let Ok(out) = run_capped(
        &git,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "--sort=-committerdate",
            "--count=500",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
        Some(cwd),
        GIT_TIMEOUT,
        GIT_MAX_BYTES,
    ) else {
        return Vec::new();
    };
    parse_git_refs(&out)
}

/// Turn `git for-each-ref` output into a deduplicated ref list.
pub fn parse_git_refs(output: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    output
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.ends_with("/HEAD"))
        .filter(|l| seen.insert(l.to_string()))
        .take(MAX_REFS)
        .map(str::to_string)
        .collect()
}

/// `scripts` of the `package.json` sitting in `cwd` (no walk up: the terminal
/// is where the user is).
pub fn npm_scripts(cwd: &Path) -> Vec<SpecItem> {
    let path = cwd.join("package.json");
    let Ok(meta) = std::fs::metadata(&path) else {
        return Vec::new();
    };
    if meta.len() > 4 * 1024 * 1024 {
        return Vec::new();
    }
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    parse_npm_scripts(&text)
}

/// Extract `{ "scripts": { name: body } }`. Split out so it can be tested
/// without touching the disk.
pub fn parse_npm_scripts(package_json: &str) -> Vec<SpecItem> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(package_json) else {
        return Vec::new();
    };
    let Some(scripts) = value.get("scripts").and_then(|s| s.as_object()) else {
        return Vec::new();
    };
    let mut out: Vec<SpecItem> = scripts
        .iter()
        .map(|(name, body)| SpecItem {
            name: name.clone(),
            description: body.as_str().map(|b| {
                if b.chars().count() > 120 {
                    format!("{}…", b.chars().take(120).collect::<String>())
                } else {
                    b.to_string()
                }
            }),
            takes_value: false,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splitting_a_fragment_keeps_the_directory_part() {
        assert_eq!(split_path_fragment("comp"), ("", "comp"));
        assert_eq!(split_path_fragment("src/comp"), ("src/", "comp"));
        assert_eq!(split_path_fragment("src/"), ("src/", ""));
        assert_eq!(split_path_fragment("a\\b\\c"), ("a\\b\\", "c"));
        assert_eq!(split_path_fragment(""), ("", ""));
    }

    #[test]
    fn path_completion_lists_directories_first_and_hides_dotfiles() {
        let dir = std::env::temp_dir().join(format!("cortx-cmpl-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::write(dir.join("Cargo.toml"), "x").unwrap();
        std::fs::write(dir.join("src.txt"), "x").unwrap();

        let all = complete_path(&dir, "", 50);
        let names: Vec<_> = all.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["src", "Cargo.toml", "src.txt"]);
        assert!(all[0].is_dir);
        assert!(all[0].value.ends_with('/') || all[0].value.ends_with('\\'));

        let filtered = complete_path(&dir, "src", 50);
        assert_eq!(filtered.len(), 2);

        let hidden = complete_path(&dir, ".g", 50);
        assert_eq!(hidden.len(), 1, "dotfiles show once asked for");
        assert_eq!(hidden[0].name, ".git");

        let inside = complete_path(&dir, "src/", 50);
        assert!(inside.is_empty(), "empty directory");

        assert!(complete_path(&dir, "nope/", 50).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn path_completion_keeps_the_typed_directory_in_the_value() {
        let dir = std::env::temp_dir().join(format!("cortx-cmpl2-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("src/lib")).unwrap();
        let out = complete_path(&dir, "src/l", 50);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].value, "src/lib/");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_refs_are_deduplicated_and_head_is_dropped() {
        let out = "main\nfeat/x\norigin/main\norigin/HEAD\nmain\nv1.0\n\n";
        assert_eq!(
            parse_git_refs(out),
            vec!["main", "feat/x", "origin/main", "v1.0"]
        );
    }

    #[test]
    fn npm_scripts_are_sorted_with_their_body_as_description() {
        let pkg = r#"{ "name": "x", "scripts": { "dev": "vite", "build": "tsc && vite build" } }"#;
        let scripts = parse_npm_scripts(pkg);
        let names: Vec<_> = scripts.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["build", "dev"]);
        assert_eq!(scripts[1].description.as_deref(), Some("vite"));
        assert!(parse_npm_scripts("{}").is_empty());
        assert!(parse_npm_scripts("not json").is_empty());
    }
}
