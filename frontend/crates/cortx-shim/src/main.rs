//! The launcher behind every alias shim on Windows.
//!
//! CortX copies this binary into the shim directory as `<alias>.exe`, next to
//! a `<alias>.shim` file that holds the command to run (see
//! `cortx_core::shim`). Launched as `zorg.exe`, it reads `zorg.shim`, appends
//! its own arguments and runs the result, then exits with the child's code.
//!
//! It exists because the `.cmd` launcher it replaces hands the command line to
//! cmd.exe, which stops at the first newline and expands `%`, `^`, `&` and `!`
//! — a multi-line ticket description passed by an agent arrived cut after its
//! first line. Here the arguments go from `argv` to `CreateProcess` without a
//! shell in between.
//!
//! `.shim` format: a marker line, then one argument per line, program first.
//! No quoting: a path with a space is simply a line with a space in it.

use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{self, Command};

/// First line of every `.shim` file — keep in sync with `cortx_core::shim`.
const MARKER: &str = "# cortx-shim";

/// Counts nested shim launches, so a shim that ends up running itself (an
/// alias pointing at its own shim, or two pointing at each other) fails with a
/// message instead of spawning processes until the machine gives up.
const DEPTH_VAR: &str = "CORTX_SHIM_DEPTH";
const MAX_DEPTH: u32 = 16;

fn main() {
    match run() {
        Ok(code) => process::exit(code),
        Err(msg) => {
            eprintln!("cortx-shim: {msg}");
            process::exit(1);
        }
    }
}

fn run() -> Result<i32, String> {
    let me = env::current_exe().map_err(|e| format!("cannot locate itself: {e}"))?;
    let spec_path = me.with_extension("shim");
    let spec = fs::read_to_string(&spec_path)
        .map_err(|e| format!("cannot read {}: {e}", spec_path.display()))?;
    let argv = parse_spec(&spec).ok_or_else(|| {
        format!(
            "{} is not a CortX shim file — re-sync shims from CortX",
            spec_path.display()
        )
    })?;

    let depth: u32 = env::var(DEPTH_VAR)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if depth >= MAX_DEPTH {
        return Err(format!(
            "`{}` keeps launching shims ({MAX_DEPTH} levels deep) — does the alias point at itself?",
            argv[0]
        ));
    }

    let own_dir = me.parent().map(Path::to_path_buf);
    let path_var = env::var_os("PATH").unwrap_or_default();
    let program = resolve_program(&argv[0], own_dir.as_deref(), &path_var)
        .ok_or_else(|| format!("`{}` not found on PATH", argv[0]))?;

    ignore_ctrl_c();

    let status = Command::new(&program)
        .args(&argv[1..])
        .args(env::args_os().skip(1))
        .env(DEPTH_VAR, (depth + 1).to_string())
        .status()
        .map_err(|e| format!("cannot run {}: {e}", program.display()))?;
    Ok(status.code().unwrap_or(1))
}

/// The arguments stored in a `.shim` file, program first. `None` when the
/// marker is missing or no program follows it.
fn parse_spec(spec: &str) -> Option<Vec<String>> {
    let mut lines = spec.lines();
    if lines.next()?.trim() != MARKER {
        return None;
    }
    let argv: Vec<String> = lines.map(str::to_string).collect();
    match argv.first() {
        Some(p) if !p.trim().is_empty() => Some(argv),
        _ => None,
    }
}

/// Where `program` lives. A path (anything with a separator) is used as is; a
/// bare name is looked up on PATH by hand rather than left to `Command`.
///
/// The reason is the shim's own directory: Windows searches the directory of
/// the running executable first, so `Command::new("zorg.exe")` launched from
/// the shim `zorg.exe` would find… the shim, and launch itself forever. The
/// lookup skips that directory.
fn resolve_program(program: &str, own_dir: Option<&Path>, path_var: &OsString) -> Option<PathBuf> {
    if program.contains(['\\', '/', ':']) {
        return Some(PathBuf::from(program));
    }
    let names = candidate_names(program);
    env::split_paths(path_var)
        .filter(|dir| !dir.as_os_str().is_empty())
        .filter(|dir| own_dir.map_or(true, |own| !same_dir(dir, own)))
        .flat_map(|dir| names.iter().map(move |n| dir.join(n)))
        .find(|p| p.is_file())
}

/// File names `program` may have on disk: itself when it already carries an
/// extension, then the runnable PATHEXT extensions, in PATHEXT order.
/// `Command` can start `.exe`/`.com` directly and `.bat`/`.cmd` through
/// cmd.exe (with its own argument escaping), nothing else.
fn candidate_names(program: &str) -> Vec<String> {
    let mut names = Vec::new();
    if !cfg!(windows) {
        names.push(program.to_string());
        return names;
    }
    if Path::new(program).extension().is_some() {
        names.push(program.to_string());
    }
    let pathext = env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    for ext in pathext.split(';').map(|e| e.trim().to_ascii_lowercase()) {
        if matches!(ext.as_str(), ".exe" | ".com" | ".bat" | ".cmd") {
            names.push(format!("{program}{ext}"));
        }
    }
    names
}

fn same_dir(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        let s = p.to_string_lossy().replace('/', "\\");
        let s = s.trim_end_matches('\\').to_string();
        if cfg!(windows) {
            s.to_lowercase()
        } else {
            s
        }
    };
    norm(a) == norm(b)
}

/// Ctrl+C reaches every process attached to the console, the child included.
/// The child decides what to do with it; the shim must not die first, or the
/// shell prints its prompt while the child is still writing. A handler is set
/// rather than `SetConsoleCtrlHandler(NULL, TRUE)`, whose "ignore" flag would
/// be inherited by the child and stop Ctrl+C from reaching it at all.
#[cfg(windows)]
fn ignore_ctrl_c() {
    type Handler = unsafe extern "system" fn(u32) -> i32;
    #[link(name = "kernel32")]
    extern "system" {
        fn SetConsoleCtrlHandler(handler: Option<Handler>, add: i32) -> i32;
    }
    unsafe extern "system" fn handler(event: u32) -> i32 {
        // CTRL_C_EVENT (0) and CTRL_BREAK_EVENT (1): handled, i.e. ignored.
        (event <= 1) as i32
    }
    unsafe {
        SetConsoleCtrlHandler(Some(handler), 1);
    }
}

#[cfg(not(windows))]
fn ignore_ctrl_c() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_needs_the_marker_and_a_program() {
        assert_eq!(parse_spec("zorg.exe\n"), None);
        assert_eq!(parse_spec("# cortx-shim\n"), None);
        assert_eq!(parse_spec("# cortx-shim\n  \n"), None);
        assert_eq!(
            parse_spec("# cortx-shim\r\nC:\\Program Files\\Zorg\\zorg.exe\r\n"),
            Some(vec!["C:\\Program Files\\Zorg\\zorg.exe".to_string()])
        );
    }

    #[test]
    fn spec_keeps_one_argument_per_line_spaces_and_empties_included() {
        let spec = "# cortx-shim\nbun\nrun\nC:/My Projects/cli/index.ts\n\n";
        assert_eq!(
            parse_spec(spec).unwrap(),
            vec!["bun", "run", "C:/My Projects/cli/index.ts", ""]
        );
    }

    #[test]
    fn a_path_is_used_as_is() {
        let path = OsString::new();
        assert_eq!(
            resolve_program("C:\\Tools\\x.exe", None, &path),
            Some(PathBuf::from("C:\\Tools\\x.exe"))
        );
    }

    #[test]
    fn lookup_skips_the_shim_directory() {
        let root = env::temp_dir().join(format!("cortx-shim-launcher-ut-{}", process::id()));
        let shims = root.join("shims");
        let tools = root.join("tools");
        fs::create_dir_all(&shims).unwrap();
        fs::create_dir_all(&tools).unwrap();
        let file = if cfg!(windows) { "uttool.exe" } else { "uttool" };
        fs::write(shims.join(file), b"shim").unwrap();
        fs::write(tools.join(file), b"tool").unwrap();

        let path = env::join_paths([&shims, &tools]).unwrap();
        // Without its own directory to skip, the shim finds itself first…
        assert_eq!(resolve_program("uttool", None, &path), Some(shims.join(file)));
        // …which is exactly what the lookup has to avoid.
        assert_eq!(
            resolve_program("uttool", Some(&shims), &path),
            Some(tools.join(file))
        );
        assert_eq!(resolve_program("nothere", Some(&shims), &path), None);

        let _ = fs::remove_dir_all(&root);
    }
}
