//! Command specifications learned from `<command> --help` (#17).
//!
//! Warp ships hand-written completion specs for hundreds of programs. CortX
//! doesn't need to: [`help_parser`](crate::help_parser) already knows how to
//! read a `--help` page, so a spec can be *learned* the first time a command
//! is typed and then remembered on disk.
//!
//! # Running someone else's program is the risky part
//!
//! Everything in this module exists to make that safe. The policy, in full:
//!
//! 1. **Never a free-form string.** The only thing that reaches
//!    [`SpecStore::get_or_learn`] is the first token of a command line, and it
//!    must match [`is_safe_command_name`]: no path separator, no whitespace,
//!    no shell metacharacter, no leading `-`, at most 64 characters.
//! 2. **Must already be on the PATH.** [`resolve_in_path`] walks `PATH` (and
//!    `PATHEXT` on Windows) and returns a real, existing file. A name that
//!    doesn't resolve is never run — so `./evil`, `C:\tmp\evil.exe` or a typo
//!    can't be executed.
//! 3. **No shell.** The resolved absolute path is handed to
//!    `std::process::Command` with one fixed argument (`--help`, then `-h`).
//!    No `cmd /c`, no `sh -c`, nothing the user typed is ever an argument.
//! 4. **Deny list.** A handful of names that either hang, prompt, or are
//!    destructive enough that we would rather not poke them ([`DENIED`]).
//! 5. **Bounded.** 5 s wall clock (the child is killed on timeout), 512 KB of
//!    captured output, stdin closed, no console window on Windows.
//! 6. **Once.** The result — including an empty one — is cached under
//!    `runtime/command-specs/`, invalidated by age (14 days) or by the
//!    executable's path/mtime changing. A second request while one is in
//!    flight returns the cache instead of spawning again.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// How long a learned spec stays fresh.
const TTL_MS: i64 = 14 * 24 * 60 * 60 * 1000;
/// Wall clock allowed to `<cmd> --help`.
const HELP_TIMEOUT: Duration = Duration::from_secs(5);
/// Captured bytes per stream.
const MAX_HELP_BYTES: usize = 512 * 1024;

/// Programs we never invoke, even with `--help`: they read stdin, page, or
/// are destructive enough not to be worth the risk.
const DENIED: &[&str] = &[
    "sudo", "su", "doas", "runas", "shutdown", "reboot", "halt", "poweroff", "logoff", "passwd",
    "ssh", "scp", "sftp", "telnet", "ftp", "nc", "ncat", "vi", "vim", "nvim", "nano", "emacs",
    "less", "more", "man", "top", "htop", "btop", "watch", "tail", "cat", "dd", "mkfs", "fdisk",
    "diskpart", "format", "gpg", "openssl", "python", "python3", "node", "irb", "ruby", "perl",
    "php", "R", "julia", "claude", "codex", "aider",
];

/// One completable token: a subcommand or a flag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecItem {
    /// What gets inserted (`checkout`, `--verbose`, `-v`).
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The flag expects a value (`--output FILE`), so the menu adds a space.
    #[serde(default)]
    pub takes_value: bool,
}

/// What CortX knows about one command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSpec {
    pub command: String,
    #[serde(default)]
    pub subcommands: Vec<SpecItem>,
    #[serde(default)]
    pub flags: Vec<SpecItem>,
    /// Epoch millis of the run that produced this.
    pub fetched_at: i64,
    /// Absolute path of the executable it was learned from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exe_path: Option<String>,
    /// Executable mtime in epoch millis; a change invalidates the cache.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exe_mtime: Option<i64>,
    /// `--help`, `-h`, or `none` when the program said nothing useful.
    pub source: String,
}

impl CommandSpec {
    pub fn is_empty(&self) -> bool {
        self.subcommands.is_empty() && self.flags.is_empty()
    }
}

/// Rule 1 of the safety policy: what may be looked up at all.
///
/// ASCII letters, digits and `. _ + -`, never leading with `-`, at most 64
/// characters. That excludes `/`, `\`, spaces, quotes, `;`, `&`, `|`, `$`,
/// `(`, backticks and every other shell metacharacter by construction.
pub fn is_safe_command_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 {
        return false;
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_alphanumeric() && first != '_' {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'))
}

/// True when the name is on the deny list (compared without a Windows
/// extension, case-insensitively).
pub fn is_denied(name: &str) -> bool {
    let stem = name
        .rsplit_once('.')
        .map(|(s, _)| s)
        .filter(|s| !s.is_empty())
        .unwrap_or(name)
        .to_ascii_lowercase();
    DENIED.contains(&stem.as_str())
}

/// Rule 2: resolve `name` against `PATH` and return the file that would run.
///
/// Deliberately does *not* look in the current directory: only what is
/// already installed on this machine can be probed.
pub fn resolve_in_path(name: &str) -> Option<PathBuf> {
    if !is_safe_command_name(name) {
        return None;
    }
    let path = std::env::var_os("PATH")?;
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
            .split(';')
            .filter(|e| !e.is_empty())
            .map(|e| e.to_ascii_lowercase())
            .collect()
    } else {
        Vec::new()
    };
    for dir in std::env::split_paths(&path) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        // Windows resolves through PATHEXT first: many installers drop both
        // `npm` (a shell script Windows can't run) and `npm.cmd` in the same
        // directory, and the extensionless one must not win.
        for ext in &exts {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        let direct = dir.join(name);
        if direct.is_file() && (!cfg!(windows) || direct.extension().is_some()) {
            return Some(direct);
        }
    }
    None
}

fn mtime_ms(path: &Path) -> Option<i64> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    let dur = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(dur.as_millis() as i64)
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Read a pipe, keeping at most `cap` bytes but draining the rest so the
/// child never blocks on a full pipe.
fn read_capped<R: Read>(mut r: R, cap: usize) -> Vec<u8> {
    let mut out = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        match r.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if out.len() < cap {
                    let room = cap - out.len();
                    out.extend_from_slice(&buf[..n.min(room)]);
                }
            }
        }
    }
    out
}

/// Run an already-resolved executable with fixed arguments, bounded in time
/// and in output. No shell, stdin closed, no console window on Windows.
///
/// Shared with [`super::complete`] so `git for-each-ref` gets the same
/// treatment as `--help`.
pub fn run_capped(
    program: &Path,
    args: &[&str],
    cwd: Option<&Path>,
    timeout: Duration,
    cap: usize,
) -> Result<String, String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        if dir.is_dir() {
            cmd.current_dir(dir);
        }
    }
    // A program that decides to page or colour its help is noise we don't want.
    cmd.env("PAGER", "cat")
        .env("GIT_PAGER", "cat")
        .env("NO_COLOR", "1")
        .env("TERM", "dumb")
        .env("COLUMNS", "200");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let h_out = std::thread::spawn(move || stdout.map(|s| read_capped(s, cap)).unwrap_or_default());
    let h_err = std::thread::spawn(move || stderr.map(|s| read_capped(s, cap)).unwrap_or_default());

    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(e) => return Err(e.to_string()),
        }
        if Instant::now() >= deadline {
            timed_out = true;
            let _ = child.kill();
            let _ = child.wait();
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let out = h_out.join().unwrap_or_default();
    let err = h_err.join().unwrap_or_default();
    if timed_out {
        return Err("timed out".to_string());
    }
    let stdout = String::from_utf8_lossy(&out);
    let stderr = String::from_utf8_lossy(&err);
    // Help goes to stdout or stderr depending on the program and on whether
    // it considered the invocation an error; take whichever said more.
    let combined = if stdout.trim().len() >= stderr.trim().len() {
        stdout.into_owned()
    } else {
        stderr.into_owned()
    };
    if combined.trim().is_empty() {
        Err("no output".to_string())
    } else {
        Ok(combined)
    }
}

/// Turn a help page into a spec (pure; the interesting part to test).
pub fn spec_from_help(command: &str, help: &str, source: &str) -> CommandSpec {
    let mut flags: Vec<SpecItem> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for p in crate::help_parser::parse_help_output(help) {
        let takes_value = p.param_type != crate::models::ScriptParamType::Bool;
        for flag in [p.long_flag.as_deref(), p.short_flag.as_deref()]
            .into_iter()
            .flatten()
        {
            if seen.insert(flag.to_string()) {
                flags.push(SpecItem {
                    name: flag.to_string(),
                    description: p.description.clone(),
                    takes_value,
                });
            }
        }
    }
    let subcommands = crate::help_parser::parse_help_subcommands(help)
        .into_iter()
        .map(|(name, description)| SpecItem {
            name,
            description,
            takes_value: false,
        })
        .collect();
    CommandSpec {
        command: command.to_string(),
        subcommands,
        flags,
        fetched_at: now_ms(),
        exe_path: None,
        exe_mtime: None,
        source: source.to_string(),
    }
}

/// Names currently being learned, so two panes typing `git ` at the same
/// moment spawn one child, not two.
fn inflight() -> &'static Mutex<HashSet<String>> {
    static INFLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    INFLIGHT.get_or_init(|| Mutex::new(HashSet::new()))
}

struct InflightGuard(String);

impl Drop for InflightGuard {
    fn drop(&mut self) {
        if let Ok(mut set) = inflight().lock() {
            set.remove(&self.0);
        }
    }
}

/// On-disk cache of learned specs (`runtime/command-specs/<name>.json`).
#[derive(Debug, Clone)]
pub struct SpecStore {
    dir: PathBuf,
}

impl SpecStore {
    /// `runtime_dir` is the same directory that holds `command-history.jsonl`.
    pub fn new(runtime_dir: &Path) -> Self {
        Self {
            dir: runtime_dir.join("command-specs"),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn file_for(&self, command: &str) -> PathBuf {
        self.dir.join(format!("{}.json", command.to_ascii_lowercase()))
    }

    /// Read the cached spec without running anything. `None` when there is
    /// none, when it is older than the TTL, or when the executable it was
    /// learned from moved or changed.
    pub fn cached(&self, command: &str) -> Option<CommandSpec> {
        if !is_safe_command_name(command) {
            return None;
        }
        let text = std::fs::read_to_string(self.file_for(command)).ok()?;
        let spec: CommandSpec = serde_json::from_str(&text).ok()?;
        if now_ms().saturating_sub(spec.fetched_at) > TTL_MS {
            return None;
        }
        if let Some(recorded) = spec.exe_path.as_deref() {
            let current = resolve_in_path(command)?;
            if current.to_string_lossy() != recorded {
                return None;
            }
            if spec.exe_mtime.is_some() && mtime_ms(&current) != spec.exe_mtime {
                return None;
            }
        }
        Some(spec)
    }

    fn write(&self, spec: &CommandSpec) {
        let _ = std::fs::create_dir_all(&self.dir);
        if let Ok(json) = serde_json::to_string_pretty(spec) {
            let _ = std::fs::write(self.file_for(&spec.command), json);
        }
    }

    /// Cached spec, or learn one by running `<command> --help` exactly once.
    ///
    /// Blocking (up to [`HELP_TIMEOUT`]): call it off the UI thread. Returns
    /// `None` only when the command may not be probed at all.
    pub fn get_or_learn(&self, command: &str, refresh: bool) -> Option<CommandSpec> {
        if !is_safe_command_name(command) || is_denied(command) {
            return None;
        }
        if !refresh {
            if let Some(spec) = self.cached(command) {
                return Some(spec);
            }
        }
        let key = command.to_ascii_lowercase();
        {
            let mut set = inflight().lock().ok()?;
            if !set.insert(key.clone()) {
                // Someone else is already running it: don't spawn a second.
                return self.cached(command);
            }
        }
        let _guard = InflightGuard(key);

        let exe = resolve_in_path(command)?;
        let (help, source) = match run_capped(&exe, &["--help"], None, HELP_TIMEOUT, MAX_HELP_BYTES)
        {
            Ok(text) => (text, "--help"),
            Err(_) => match run_capped(&exe, &["-h"], None, HELP_TIMEOUT, MAX_HELP_BYTES) {
                Ok(text) => (text, "-h"),
                Err(_) => (String::new(), "none"),
            },
        };
        let mut spec = spec_from_help(command, &help, source);
        spec.exe_path = Some(exe.to_string_lossy().into_owned());
        spec.exe_mtime = mtime_ms(&exe);
        // Cache the empty result too: a program with no readable help must not
        // be re-run on every keystroke for the next two weeks.
        self.write(&spec);
        Some(spec)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_names_reject_anything_that_could_escape() {
        for ok in ["git", "npm", "cargo", "docker-compose", "python3.12", "g++", "_x"] {
            assert!(is_safe_command_name(ok), "{ok} should be allowed");
        }
        for bad in [
            "",
            "-rf",
            "../evil",
            "C:\\tmp\\evil.exe",
            "/usr/bin/evil",
            "git status",
            "git;rm",
            "git|sh",
            "git&whoami",
            "$(id)",
            "`id`",
            "git\"x",
            "a\nb",
            &"x".repeat(65),
        ] {
            assert!(!is_safe_command_name(bad), "{bad:?} must be rejected");
        }
    }

    #[test]
    fn deny_list_ignores_windows_extensions_and_case() {
        assert!(is_denied("sudo"));
        assert!(is_denied("SSH"));
        assert!(is_denied("python.exe"));
        assert!(!is_denied("git"));
        assert!(!is_denied("cargo"));
    }

    #[test]
    fn unresolvable_names_are_never_run() {
        assert!(resolve_in_path("definitely-not-a-real-program-9137").is_none());
        assert!(resolve_in_path("../git").is_none(), "paths never resolve");
        assert!(resolve_in_path("git status").is_none());
    }

    #[test]
    fn spec_from_help_reads_flags_and_subcommands() {
        let help = r#"
usage: demo [OPTIONS] <COMMAND>

Commands:
  build    Compile the current package
  test     Run the tests
  help     Print this message

Options:
  -v, --verbose           Use verbose output
  -o, --output FILE       Write here
      --offline           Do not access the network
"#;
        let spec = spec_from_help("demo", help, "--help");
        let names: Vec<_> = spec.subcommands.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["build", "test", "help"]);
        assert_eq!(
            spec.subcommands[0].description.as_deref(),
            Some("Compile the current package")
        );
        let flag = |n: &str| spec.flags.iter().find(|f| f.name == n).cloned();
        assert!(flag("--verbose").is_some());
        assert!(flag("-v").is_some());
        assert!(!flag("--verbose").unwrap().takes_value);
        assert!(flag("--output").unwrap().takes_value, "FILE placeholder");
        assert!(flag("--offline").is_some());
        assert!(!spec.is_empty());
    }

    #[test]
    fn cache_round_trips_and_expires() {
        let dir = std::env::temp_dir().join(format!("cortx-spec-{}", uuid::Uuid::new_v4()));
        let store = SpecStore::new(&dir);
        assert!(store.cached("demo").is_none(), "nothing cached yet");

        let mut spec = spec_from_help("demo", "Options:\n  -v, --verbose  Talk\n", "--help");
        store.write(&spec);
        let back = store.cached("demo").expect("cached");
        assert_eq!(back.flags.len(), spec.flags.len());
        assert_eq!(back.command, "demo");

        // Older than the TTL: gone.
        spec.fetched_at = now_ms() - TTL_MS - 1;
        store.write(&spec);
        assert!(store.cached("demo").is_none(), "stale specs are ignored");

        // A spec learned from an executable that no longer exists is dropped.
        spec.fetched_at = now_ms();
        spec.exe_path = Some("/nowhere/demo".into());
        store.write(&spec);
        assert!(store.cached("demo").is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_or_learn_refuses_unsafe_and_denied_names() {
        let dir = std::env::temp_dir().join(format!("cortx-spec-deny-{}", uuid::Uuid::new_v4()));
        let store = SpecStore::new(&dir);
        assert!(store.get_or_learn("rm -rf /", false).is_none());
        assert!(store.get_or_learn("../evil", false).is_none());
        assert!(store.get_or_learn("sudo", false).is_none());
        assert!(store.get_or_learn("definitely-not-a-real-program-9137", false).is_none());
        assert!(!dir.join("command-specs").exists(), "nothing was written");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_capped_bounds_output() {
        // Any platform has *some* program that prints; use the one that ships
        // with the OS and only assert the plumbing, not the text.
        let name = if cfg!(windows) { "cmd" } else { "echo" };
        let Some(exe) = resolve_in_path(name) else {
            return;
        };
        let args: &[&str] = if cfg!(windows) {
            &["/c", "echo hello"]
        } else {
            &["hello"]
        };
        let out = run_capped(&exe, args, None, Duration::from_secs(5), 1024).unwrap();
        assert!(out.contains("hello"), "got {out:?}");
    }

    /// Not run by default: it spawns the real `git` / `cargo` of this
    /// machine. `cargo test -p cortx-core --lib -- --ignored` to check the
    /// whole pipeline against actual help pages.
    #[test]
    #[ignore = "spawns the machine's own git/cargo"]
    fn learns_real_commands_end_to_end() {
        let dir = std::env::temp_dir().join(format!("cortx-spec-real-{}", uuid::Uuid::new_v4()));
        let store = SpecStore::new(&dir);
        for name in ["git", "cargo", "npm"] {
            if resolve_in_path(name).is_none() {
                continue;
            }
            let spec = store.get_or_learn(name, false).expect("learned");
            println!(
                "{name}: {} subcommands, {} flags (source {})",
                spec.subcommands.len(),
                spec.flags.len(),
                spec.source
            );
            assert!(!spec.is_empty(), "{name} produced an empty spec");
            assert!(store.cached(name).is_some(), "{name} was not cached");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
