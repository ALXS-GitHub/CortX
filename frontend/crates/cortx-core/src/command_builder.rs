use std::collections::HashMap;

use crate::models::GlobalScript;
use crate::models::ScriptParamType;

/// Split a command string into argv, honouring `"..."` and `'...'` grouping so
/// an argument containing spaces survives as one token.
///
/// Deliberately NOT a full shell lexer: a backslash is never an escape
/// character, because on Windows every path is made of them (`C:\Users\...`)
/// and treating them as escapes would mangle the common case. Quotes only
/// group — they are consumed and never appear in the returned tokens.
pub fn split_args(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut started = false;
    let mut in_single = false;
    let mut in_double = false;

    for c in input.chars() {
        match c {
            '"' if !in_single => {
                in_double = !in_double;
                started = true;
            }
            '\'' if !in_double => {
                in_single = !in_single;
                started = true;
            }
            c if c.is_whitespace() && !in_single && !in_double => {
                if started {
                    out.push(std::mem::take(&mut cur));
                    started = false;
                }
            }
            c => {
                cur.push(c);
                started = true;
            }
        }
    }
    if started {
        out.push(cur);
    }
    out
}

/// Tokenize a command template, then substitute `{{SCRIPT_FILE}}` *inside* the
/// resulting tokens.
///
/// The order is the whole point: substituting first and splitting afterwards
/// tears a path containing spaces (`C:\Users\Alexis Munch\x.py`) into several
/// arguments. Splitting first keeps the placeholder — which never contains
/// whitespace — as exactly one token, so the path stays one argument no matter
/// what it holds. Callers pass the result straight to `Command::args`, which
/// applies the platform's own quoting.
pub fn tokenize_command(command: &str, script_path: Option<&str>) -> Vec<String> {
    let tokens = split_args(command);
    match script_path {
        Some(path) => tokens
            .into_iter()
            .map(|t| t.replace("{{SCRIPT_FILE}}", path))
            .collect(),
        None => tokens,
    }
}

/// Build `(program, args)` from a GlobalScript, parameter values, and extra arguments.
///
/// Returns `None` if the resolved command is empty.
pub fn build_command(
    script: &GlobalScript,
    param_values: &HashMap<String, String>,
    extra_args: &[String],
) -> Option<(String, Vec<String>)> {
    // 1. Tokenize, then expand {{SCRIPT_FILE}} per token (see tokenize_command)
    let mut tokens = tokenize_command(&script.command, script.script_path.as_deref());
    if tokens.is_empty() {
        return None;
    }
    let program = tokens.remove(0);
    let mut args = tokens;

    // 2. Append parameter values in definition order
    for param_def in &script.parameters {
        if let Some(value) = param_values.get(&param_def.name) {
            if value.is_empty() {
                continue;
            }
            if param_def.param_type == ScriptParamType::Bool {
                if value == "true" {
                    if let Some(ref flag) = param_def.long_flag {
                        args.push(flag.clone());
                    } else if let Some(ref flag) = param_def.short_flag {
                        args.push(flag.clone());
                    }
                }
            } else {
                // Push the flag
                if let Some(ref flag) = param_def.long_flag {
                    args.push(flag.clone());
                } else if let Some(ref flag) = param_def.short_flag {
                    args.push(flag.clone());
                }
                // Push value(s)
                if param_def.nargs.is_some() {
                    // Quote-aware so a multi-value list can carry paths with spaces
                    args.extend(split_args(value));
                } else {
                    // Strip surrounding quotes if present
                    let clean = value
                        .strip_prefix('\'')
                        .and_then(|s| s.strip_suffix('\''))
                        .or_else(|| value.strip_prefix('"').and_then(|s| s.strip_suffix('"')))
                        .unwrap_or(value);
                    args.push(clean.to_string());
                }
            }
        }
    }

    // 3. Append extra args
    args.extend_from_slice(extra_args);

    Some((program, args))
}

/// Decide which directory a global script runs in.
///
/// The working directory is optional everywhere: a script that doesn't care
/// where it runs should not force the user to pick a folder. Resolution order,
/// first non-blank wins:
///
/// 1. `override_dir` — the per-run value typed in the UI.
/// 2. `script.working_dir` — the script's own configured directory.
/// 3. The folder holding `script.script_path`, when the script is a file.
/// 4. The process's current directory (`.` if even that is unavailable).
///
/// Never returns an empty string: `Command::current_dir("")` fails to spawn.
pub fn resolve_working_dir(script: &GlobalScript, override_dir: Option<&str>) -> String {
    let non_blank = |s: &str| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    };

    override_dir
        .and_then(non_blank)
        .or_else(|| script.working_dir.as_deref().and_then(non_blank))
        .or_else(|| {
            script
                .script_path
                .as_deref()
                .and_then(non_blank)
                .and_then(|p| {
                    std::path::Path::new(&p)
                        .parent()
                        .map(|d| d.to_string_lossy().to_string())
                })
                .and_then(|d| non_blank(&d))
        })
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|p| p.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| ".".to_string())
}

// ===========================================================================
// PATH for a command run *in a project* (ticket #33)
// ===========================================================================
//
// A service, a project script and a global script are not typed at a prompt:
// CortX spawns them with `cmd /C <line>` (Windows) or `sh -c <line>` (Unix).
// That shell reads no profile and, unlike `npm run` / `bun run` / `yarn run`,
// puts nothing project-local on PATH. So a command that names a dependency of
// the project — `vite`, `nodemon`, `next`, `tsx` — cannot be found, while the
// exact same word works in the integrated terminal or under `bun run`.
//
// The two halves of the answer, both of them *inside the process we are about
// to start* — CortX never writes to the machine's PATH, nor to any shell
// startup file:
//
// 1. every `node_modules/.bin` from the working directory up to the root,
//    nearest first — precisely what a package manager prepends when it runs a
//    script, so `vite` resolves the way the user's own `bun run dev` resolves
//    it (workspaces included, since the walk goes up);
// 2. on macOS and Linux, the PATH of the user's *login* shell, merged in
//    behind. This is where `~/.bun/bin`, fnm / volta / mise shims and
//    Homebrew live: a rc file builds them, and a GUI app started from the
//    Dock never read that rc. Windows needs none of it — the PTY layer
//    rebuilds the child's PATH from the `HKLM` + `HKCU` `Environment` keys,
//    which is the same PATH a fresh terminal gets.

/// PATH separator of the platform.
pub const PATH_SEP: char = if cfg!(windows) { ';' } else { ':' };

/// How far up the tree we look for `node_modules/.bin`. A workspace root is
/// two or three levels above a package; the cap only stops a pathological
/// path from turning into a long PATH.
const MAX_LOCAL_BIN_DEPTH: usize = 12;

/// Are these two PATH entries the same directory? Compared as text, the way
/// a shell does, plus Windows's case- and slash-insensitivity.
fn same_path_entry(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        let t = s.trim().trim_end_matches(['/', '\\']);
        if cfg!(windows) {
            t.replace('/', "\\").to_ascii_lowercase()
        } else {
            t.to_string()
        }
    };
    !a.trim().is_empty() && norm(a) == norm(b)
}

/// The `node_modules/.bin` directories that apply to `working_dir`, nearest
/// first. Only directories that exist are returned.
pub fn local_bin_dirs(working_dir: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut dir = std::path::Path::new(working_dir.trim());
    if dir.as_os_str().is_empty() {
        return out;
    }
    for _ in 0..MAX_LOCAL_BIN_DEPTH {
        let candidate = dir.join("node_modules").join(".bin");
        if candidate.is_dir() {
            out.push(candidate.to_string_lossy().into_owned());
        }
        match dir.parent() {
            Some(parent) if parent != dir && !parent.as_os_str().is_empty() => dir = parent,
            _ => break,
        }
    }
    out
}

/// The PATH of the user's login shell, asked once and remembered.
///
/// `$SHELL -lc 'printf %s "$PATH"'` is the same question a terminal answers
/// by existing. It is only ever *read*: nothing is written, anywhere.
/// Windows has no such thing (and no `$SHELL` worth trusting), so the answer
/// there is simply "no opinion".
pub fn login_shell_path() -> Option<&'static str> {
    static CACHE: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    CACHE.get_or_init(probe_login_shell_path).as_deref()
}

fn probe_login_shell_path() -> Option<String> {
    if cfg!(windows) {
        return None;
    }
    let shell = std::env::var("SHELL").ok()?;
    let shell = shell.trim();
    if shell.is_empty() || !std::path::Path::new(shell).is_absolute() {
        return None;
    }
    let mut command = std::process::Command::new(shell);
    command
        .args(["-lc", r#"printf %s "$PATH""#])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    // A login shell can hang (a prompt in an rc file, a slow version
    // manager). Give it a few seconds on a thread of its own and forget it
    // otherwise — a missing answer only means "no extra directories".
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("cortx-login-path".into())
        .spawn(move || {
            let _ = tx.send(command.output().ok());
        })
        .ok()?;
    let output = rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .ok()
        .flatten()?;
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

/// The PATH a command launched by CortX in `working_dir` should see, built on
/// top of `base` (the PATH the child would have had otherwise).
///
/// Project-local bins go first — they are the most specific answer and the
/// one a package manager would give. The login shell's entries go last and
/// only when `base` does not already have them, so nothing is ever reordered
/// or dropped.
pub fn run_path(working_dir: &str, base: &str) -> String {
    let mut entries: Vec<String> = Vec::new();
    let push = |entry: String, entries: &mut Vec<String>| {
        if entry.trim().is_empty() || entries.iter().any(|e| same_path_entry(e, &entry)) {
            return;
        }
        entries.push(entry);
    };
    for dir in local_bin_dirs(working_dir) {
        push(dir, &mut entries);
    }
    for entry in base.split(PATH_SEP) {
        push(entry.to_string(), &mut entries);
    }
    if let Some(extra) = login_shell_path() {
        for entry in extra.split(PATH_SEP) {
            push(entry.to_string(), &mut entries);
        }
    }
    entries.join(&PATH_SEP.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{GlobalScript, ScriptParameter, ScriptParamType};
    use chrono::Utc;

    fn make_script(command: &str, script_path: Option<&str>, params: Vec<ScriptParameter>) -> GlobalScript {
        GlobalScript {
            id: "test".to_string(),
            name: "test".to_string(),
            description: None,
            command: command.to_string(),
            script_path: script_path.map(|s| s.to_string()),
            working_dir: None,
            color: None,
            status: None,
            tags: vec![],
            parameters: params,
            parameter_presets: vec![],
            default_preset_id: None,
            env_vars: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            order: 0,
            auto_discovered: false,
            favorite: false,
        }
    }

    fn make_param(name: &str, param_type: ScriptParamType, long_flag: Option<&str>, short_flag: Option<&str>, nargs: Option<&str>) -> ScriptParameter {
        ScriptParameter {
            name: name.to_string(),
            param_type,
            long_flag: long_flag.map(|s| s.to_string()),
            short_flag: short_flag.map(|s| s.to_string()),
            description: None,
            default_value: None,
            required: false,
            enum_values: vec![],
            nargs: nargs.map(|s| s.to_string()),
        }
    }

    #[test]
    fn template_substitution() {
        let script = make_script("python {{SCRIPT_FILE}}", Some("/path/to/script.py"), vec![]);
        let result = build_command(&script, &HashMap::new(), &[]);
        assert_eq!(result, Some(("python".to_string(), vec!["/path/to/script.py".to_string()])));
    }

    #[test]
    fn script_path_with_spaces_stays_one_arg() {
        let script = make_script(
            "uv run {{SCRIPT_FILE}}",
            Some(r"C:\Users\Alexis Munch\Scripts\rm_bg.py"),
            vec![],
        );
        let result = build_command(&script, &HashMap::new(), &[]);
        assert_eq!(
            result,
            Some((
                "uv".to_string(),
                vec![
                    "run".to_string(),
                    r"C:\Users\Alexis Munch\Scripts\rm_bg.py".to_string(),
                ]
            ))
        );
    }

    #[test]
    fn pre_quoted_placeholder_is_not_double_wrapped() {
        // A template the user already quoted by hand must not leak literal quotes.
        let script = make_script(
            "python \"{{SCRIPT_FILE}}\"",
            Some(r"C:\Users\Alexis Munch\x.py"),
            vec![],
        );
        let result = build_command(&script, &HashMap::new(), &[]);
        assert_eq!(
            result,
            Some((
                "python".to_string(),
                vec![r"C:\Users\Alexis Munch\x.py".to_string()]
            ))
        );
    }

    #[test]
    fn split_args_groups_quoted_segments() {
        assert_eq!(split_args("uv run x.py"), vec!["uv", "run", "x.py"]);
        assert_eq!(
            split_args(r#"app --msg "hello world" --out 'a b'"#),
            vec!["app", "--msg", "hello world", "--out", "a b"]
        );
        // Backslashes are literal, never escapes.
        assert_eq!(split_args(r"C:\Users\a\b.exe"), vec![r"C:\Users\a\b.exe"]);
        assert_eq!(split_args("   "), Vec::<String>::new());
    }

    #[test]
    fn nargs_keeps_quoted_paths_together() {
        let params = vec![make_param("files", ScriptParamType::String, Some("--files"), None, Some("+"))];
        let script = make_script("myapp", None, params);
        let mut values = HashMap::new();
        values.insert("files".to_string(), "\"a b.txt\" c.txt".to_string());
        let result = build_command(&script, &values, &[]);
        assert_eq!(result, Some(("myapp".to_string(), vec![
            "--files".to_string(), "a b.txt".to_string(), "c.txt".to_string()
        ])));
    }

    #[test]
    fn no_template_no_script_path() {
        let script = make_script("echo hello world", None, vec![]);
        let result = build_command(&script, &HashMap::new(), &[]);
        assert_eq!(result, Some(("echo".to_string(), vec!["hello".to_string(), "world".to_string()])));
    }

    #[test]
    fn bool_param_true() {
        let params = vec![make_param("verbose", ScriptParamType::Bool, Some("--verbose"), None, None)];
        let script = make_script("myapp", None, params);
        let mut values = HashMap::new();
        values.insert("verbose".to_string(), "true".to_string());
        let result = build_command(&script, &values, &[]);
        assert_eq!(result, Some(("myapp".to_string(), vec!["--verbose".to_string()])));
    }

    #[test]
    fn bool_param_false() {
        let params = vec![make_param("verbose", ScriptParamType::Bool, Some("--verbose"), None, None)];
        let script = make_script("myapp", None, params);
        let mut values = HashMap::new();
        values.insert("verbose".to_string(), "false".to_string());
        let result = build_command(&script, &values, &[]);
        assert_eq!(result, Some(("myapp".to_string(), vec![])));
    }

    #[test]
    fn bool_param_short_flag() {
        let params = vec![make_param("verbose", ScriptParamType::Bool, None, Some("-v"), None)];
        let script = make_script("myapp", None, params);
        let mut values = HashMap::new();
        values.insert("verbose".to_string(), "true".to_string());
        let result = build_command(&script, &values, &[]);
        assert_eq!(result, Some(("myapp".to_string(), vec!["-v".to_string()])));
    }

    #[test]
    fn nargs_splits_whitespace() {
        let params = vec![make_param("files", ScriptParamType::String, Some("--files"), None, Some("+"))];
        let script = make_script("myapp", None, params);
        let mut values = HashMap::new();
        values.insert("files".to_string(), "a.txt b.txt c.txt".to_string());
        let result = build_command(&script, &values, &[]);
        assert_eq!(result, Some(("myapp".to_string(), vec![
            "--files".to_string(), "a.txt".to_string(), "b.txt".to_string(), "c.txt".to_string()
        ])));
    }

    #[test]
    fn quote_stripping() {
        let params = vec![make_param("msg", ScriptParamType::String, Some("--msg"), None, None)];
        let script = make_script("myapp", None, params);

        // Double quotes
        let mut values = HashMap::new();
        values.insert("msg".to_string(), "\"hello world\"".to_string());
        let result = build_command(&script, &values, &[]);
        assert_eq!(result, Some(("myapp".to_string(), vec!["--msg".to_string(), "hello world".to_string()])));

        // Single quotes
        let mut values = HashMap::new();
        values.insert("msg".to_string(), "'hello world'".to_string());
        let result = build_command(&script, &values, &[]);
        assert_eq!(result, Some(("myapp".to_string(), vec!["--msg".to_string(), "hello world".to_string()])));
    }

    #[test]
    fn extra_args_appended() {
        let script = make_script("myapp", None, vec![]);
        let extra = vec!["--flag".to_string(), "value".to_string()];
        let result = build_command(&script, &HashMap::new(), &extra);
        assert_eq!(result, Some(("myapp".to_string(), vec!["--flag".to_string(), "value".to_string()])));
    }

    #[test]
    fn empty_command_returns_none() {
        let script = make_script("", None, vec![]);
        let result = build_command(&script, &HashMap::new(), &[]);
        assert_eq!(result, None);
    }

    #[test]
    fn empty_value_skipped() {
        let params = vec![make_param("name", ScriptParamType::String, Some("--name"), None, None)];
        let script = make_script("myapp", None, params);
        let mut values = HashMap::new();
        values.insert("name".to_string(), "".to_string());
        let result = build_command(&script, &values, &[]);
        assert_eq!(result, Some(("myapp".to_string(), vec![])));
    }

    #[test]
    fn definition_order_preserved() {
        let params = vec![
            make_param("beta", ScriptParamType::String, Some("--beta"), None, None),
            make_param("alpha", ScriptParamType::String, Some("--alpha"), None, None),
        ];
        let script = make_script("myapp", None, params);
        let mut values = HashMap::new();
        values.insert("alpha".to_string(), "1".to_string());
        values.insert("beta".to_string(), "2".to_string());
        let result = build_command(&script, &values, &[]);
        // beta is defined first, so it should appear first
        assert_eq!(result, Some(("myapp".to_string(), vec![
            "--beta".to_string(), "2".to_string(),
            "--alpha".to_string(), "1".to_string(),
        ])));
    }

    #[test]
    fn working_dir_override_wins() {
        let mut script = make_script("myapp", Some("/scripts/run.py"), vec![]);
        script.working_dir = Some("/configured".to_string());
        assert_eq!(resolve_working_dir(&script, Some("/typed")), "/typed");
    }

    #[test]
    fn blank_override_falls_back_to_configured_dir() {
        let mut script = make_script("myapp", None, vec![]);
        script.working_dir = Some("/configured".to_string());
        assert_eq!(resolve_working_dir(&script, Some("   ")), "/configured");
        assert_eq!(resolve_working_dir(&script, None), "/configured");
    }

    #[test]
    fn falls_back_to_script_folder() {
        let script = make_script("python {{SCRIPT_FILE}}", Some("/scripts/run.py"), vec![]);
        assert_eq!(resolve_working_dir(&script, None), "/scripts");
    }

    #[test]
    fn falls_back_to_current_dir_without_any_hint() {
        let script = make_script("myapp", None, vec![]);
        let resolved = resolve_working_dir(&script, None);
        assert!(!resolved.trim().is_empty());
    }

    // -- ticket #33: PATH for a command run in a project --------------------

    fn sep(parts: &[&str]) -> String {
        parts.join(&PATH_SEP.to_string())
    }

    #[test]
    fn local_bins_are_collected_from_the_nearest_up() {
        let root = tempfile::tempdir().unwrap();
        let outer = root.path().join("node_modules").join(".bin");
        let inner_dir = root.path().join("packages").join("web");
        let inner = inner_dir.join("node_modules").join(".bin");
        std::fs::create_dir_all(&outer).unwrap();
        std::fs::create_dir_all(&inner).unwrap();

        let dirs = local_bin_dirs(&inner_dir.to_string_lossy());
        assert_eq!(dirs.len(), 2, "{dirs:?}");
        assert_eq!(std::path::Path::new(&dirs[0]), inner.as_path());
        assert_eq!(std::path::Path::new(&dirs[1]), outer.as_path());
    }

    #[test]
    fn a_directory_without_node_modules_adds_nothing() {
        let root = tempfile::tempdir().unwrap();
        assert!(local_bin_dirs(&root.path().to_string_lossy()).is_empty());
        assert!(local_bin_dirs("   ").is_empty());
    }

    #[test]
    fn run_path_prepends_local_bins_and_keeps_the_rest_in_order() {
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("node_modules").join(".bin");
        std::fs::create_dir_all(&bin).unwrap();
        let base = sep(&["/usr/bin", "/bin"]);

        let path = run_path(&root.path().to_string_lossy(), &base);
        let parts: Vec<&str> = path.split(PATH_SEP).collect();
        assert_eq!(std::path::Path::new(parts[0]), bin.as_path());
        assert_eq!(parts[1], "/usr/bin");
        assert_eq!(parts[2], "/bin");
    }

    #[test]
    fn run_path_never_duplicates_or_drops_an_entry() {
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("node_modules").join(".bin");
        std::fs::create_dir_all(&bin).unwrap();
        let bin_str = bin.to_string_lossy().into_owned();
        // The directory is already on PATH, plus an empty entry to skip.
        let base = sep(&[&bin_str, "/usr/bin", "", "/usr/bin"]);

        let path = run_path(&root.path().to_string_lossy(), &base);
        let parts: Vec<&str> = path.split(PATH_SEP).collect();
        assert_eq!(parts.len(), 2, "{path}");
        assert_eq!(std::path::Path::new(parts[0]), bin.as_path());
        assert_eq!(parts[1], "/usr/bin");
    }

    #[test]
    fn same_path_entry_is_forgiving_where_the_platform_is() {
        assert!(same_path_entry("/usr/bin", "/usr/bin/"));
        assert!(!same_path_entry("", ""));
        assert!(!same_path_entry("/usr/bin", "/usr/local/bin"));
        if cfg!(windows) {
            assert!(same_path_entry(r"C:\Tools\Bin", "c:/tools/bin"));
        }
    }
}
