//! Alias "shims" — real launcher files materialized on disk so that a
//! `function`-type alias becomes callable by ANY process (agents, scheduled
//! tasks, non-interactive shells), not only shells that source `cortx init`.
//!
//! A shell-function alias (`function zorg { zorg.exe @args }`) lives only in the
//! memory of a shell that evaluated `cortx init`. A shim, by contrast, is a file
//! on disk in a directory that the user adds to PATH once — after that, toggling
//! a shim on/off is instant (write/delete a file), no shell restart required.
//!
//! On Windows we emit TWO files per shimmed alias so every shell resolves it:
//!   - `<name>`      — POSIX `sh` script (shebang, LF endings) for Git Bash / agents
//!   - `<name>.cmd`  — batch launcher for PowerShell / cmd.exe (found via PATHEXT)
//! On Unix we emit a single executable `<name>` script.
//!
//! Only `function`-type aliases are shimmable: `script`/`init` aliases inject
//! shell state (functions, `eval`'d init output) and cannot be reduced to a file.

use crate::models::{AppSettings, ShellAlias};
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Marker line embedded in every generated shim so we can safely identify and
/// clean up our own files without ever touching unrelated files in the bin dir.
const SH_MARKER: &str = "# cortx-shim";
const CMD_MARKER: &str = ":: cortx-shim";

/// Platform default shim directory: `%LOCALAPPDATA%\CortX\bin` on Windows,
/// `~/.local/share/CortX/bin` (or `$XDG_DATA_HOME/CortX/bin`) on Linux,
/// `~/Library/Application Support/CortX/bin` on macOS.
pub fn default_shim_dir() -> PathBuf {
    if let Some(base) = directories::BaseDirs::new() {
        return base.data_local_dir().join("CortX").join("bin");
    }
    PathBuf::from("CortX").join("bin")
}

/// Resolve the effective shim directory: the user-configured `shim_dir` setting
/// if set and non-empty, otherwise the platform default.
pub fn resolve_shim_dir(settings: &AppSettings) -> PathBuf {
    match settings.shim_dir.as_deref() {
        Some(s) if !s.trim().is_empty() => PathBuf::from(s.trim()),
        _ => default_shim_dir(),
    }
}

/// An alias is shimmable only if shimming is enabled, it's a `function` alias,
/// and it has a non-empty command to wrap.
pub fn is_shimmable(alias: &ShellAlias) -> bool {
    alias.shim && alias.alias_type == "function" && !alias.command.trim().is_empty()
}

/// All file paths a shim for `name` occupies on the current platform.
fn shim_files(dir: &Path, name: &str) -> Vec<PathBuf> {
    let mut v = vec![dir.join(name)];
    if cfg!(windows) {
        v.push(dir.join(format!("{name}.cmd")));
    }
    v
}

/// The command as it must appear in a POSIX `sh` shim. On Windows the command
/// is written UNQUOTED (so `bun run x.ts` stays multiple words), which means an
/// unquoted backslash path like `C:\Windows\app.exe` would have its backslashes
/// eaten by `sh` as escapes. Windows accepts forward slashes in paths, so we
/// convert `\` → `/` for the sh variant. On Unix the command is used verbatim.
fn sh_exec_command(command: &str) -> String {
    if cfg!(windows) {
        command.replace('\\', "/")
    } else {
        command.to_string()
    }
}

/// POSIX `sh` launcher content (LF endings — Rust does not translate newlines).
fn sh_content(command: &str) -> String {
    format!("#!/bin/sh\n{SH_MARKER}\nexec {command} \"$@\"\n")
}

/// Windows batch launcher content (CRLF endings).
fn cmd_content(command: &str) -> String {
    format!("@echo off\r\n{CMD_MARKER}\r\n{command} %*\r\n")
}

/// Write the shim file(s) for `alias` into `dir`, creating `dir` if needed.
pub fn write_shim(dir: &Path, alias: &ShellAlias) -> io::Result<()> {
    fs::create_dir_all(dir)?;

    // Extensionless POSIX shim (used by bash/zsh and Windows Git Bash / agents).
    let sh_path = dir.join(&alias.name);
    fs::write(&sh_path, sh_content(&sh_exec_command(&alias.command)))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&sh_path)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&sh_path, perms)?;
    }

    // Windows-only batch shim for PowerShell / cmd.exe.
    #[cfg(windows)]
    {
        fs::write(
            dir.join(format!("{}.cmd", alias.name)),
            cmd_content(&alias.command),
        )?;
    }

    Ok(())
}

/// Remove the shim file(s) for `name` from `dir` (no-op if absent).
pub fn remove_shim(dir: &Path, name: &str) -> io::Result<()> {
    for p in shim_files(dir, name) {
        if p.exists() {
            fs::remove_file(&p)?;
        }
    }
    Ok(())
}

/// Reconcile a single alias: write its shim if shimmable, otherwise remove it.
/// Used by storage on every alias create/update/delete for real-time sync.
pub fn sync_alias(dir: &Path, alias: &ShellAlias) -> io::Result<()> {
    if is_shimmable(alias) {
        write_shim(dir, alias)
    } else {
        remove_shim(dir, &alias.name)
    }
}

/// Summary of a full reconciliation.
#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub written: Vec<String>,
    pub removed: Vec<String>,
}

/// Reconcile the whole bin directory against `aliases`:
/// write a shim for every shimmable alias, and remove any orphan shim files
/// (files bearing our marker whose alias no longer exists or is no longer
/// shimmed). Files that don't carry our marker are never touched.
pub fn sync_all(dir: &Path, aliases: &[ShellAlias]) -> io::Result<SyncReport> {
    let mut report = SyncReport::default();

    let desired: HashSet<String> = aliases
        .iter()
        .filter(|a| is_shimmable(a))
        .map(|a| a.name.clone())
        .collect();

    for a in aliases.iter().filter(|a| is_shimmable(a)) {
        write_shim(dir, a)?;
        report.written.push(a.name.clone());
    }

    if dir.exists() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let fname = match path.file_name().and_then(|f| f.to_str()) {
                Some(f) => f.to_string(),
                None => continue,
            };
            let stem = fname.strip_suffix(".cmd").unwrap_or(&fname).to_string();
            if desired.contains(&stem) {
                continue;
            }
            // Only delete files we own (carry the marker).
            if let Ok(content) = fs::read_to_string(&path) {
                if content.contains(SH_MARKER) || content.contains(CMD_MARKER) {
                    let _ = fs::remove_file(&path);
                    if !report.removed.contains(&stem) {
                        report.removed.push(stem);
                    }
                }
            }
        }
    }

    Ok(report)
}

/// Compare two directory paths for "same location" (separator/trailing-slash/
/// case-insensitive on Windows; trailing-slash-insensitive elsewhere).
fn same_dir(a: &Path, b: &Path) -> bool {
    if a.as_os_str().is_empty() {
        return false;
    }
    #[cfg(windows)]
    {
        let norm = |p: &Path| {
            p.to_string_lossy()
                .replace('/', "\\")
                .trim_end_matches('\\')
                .to_lowercase()
        };
        norm(a) == norm(b)
    }
    #[cfg(not(windows))]
    {
        let norm = |p: &Path| p.to_string_lossy().trim_end_matches('/').to_string();
        norm(a) == norm(b)
    }
}

/// On Windows, the persisted PATH new processes inherit (User + Machine scopes),
/// read directly from the registry. This must NOT spawn a process — it runs on
/// every Settings-page load, and shelling out to PowerShell caused a visible
/// console window + UI freeze.
#[cfg(windows)]
fn persisted_path() -> String {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let read = |root: RegKey, subkey: &str| -> String {
        root.open_subkey(subkey)
            .and_then(|k| k.get_value::<String, _>("Path"))
            .unwrap_or_default()
    };
    let user = read(RegKey::predef(HKEY_CURRENT_USER), "Environment");
    let machine = read(
        RegKey::predef(HKEY_LOCAL_MACHINE),
        r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
    );
    format!("{user};{machine}")
}

/// Whether `dir` is on the PATH that newly-spawned processes (agents, new
/// terminals) would inherit. On Windows this checks the persisted User+Machine
/// PATH; elsewhere it checks the current process PATH.
pub fn path_contains(dir: &Path) -> bool {
    #[cfg(windows)]
    let (raw, sep) = (persisted_path(), ';');
    #[cfg(not(windows))]
    let (raw, sep) = (std::env::var("PATH").unwrap_or_default(), ':');

    raw.split(sep).any(|p| same_dir(Path::new(p.trim()), dir))
}

/// Result of attempting to add the shim dir to PATH.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum InstallOutcome {
    /// Added to the persisted user PATH. New shells/agents will see it; existing
    /// ones must be restarted once.
    Added,
    /// Was already on PATH — nothing to do.
    AlreadyPresent,
    /// Could not modify PATH automatically; manual line to add is provided.
    Manual { instruction: String },
}

/// Add the shim directory to the user's persistent PATH (idempotent).
/// Creates the directory first so it exists when PATH is updated.
pub fn install_to_path(dir: &Path) -> Result<InstallOutcome, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    if path_contains(dir) {
        return Ok(InstallOutcome::AlreadyPresent);
    }

    #[cfg(windows)]
    {
        let dir_str = dir.to_string_lossy().replace('/', "\\");
        let dir_lit = dir_str.replace('\'', "''");
        // Use [Environment]::SetEnvironmentVariable (not setx) to avoid the 1024-char
        // truncation bug; it also broadcasts WM_SETTINGCHANGE so new processes pick
        // it up without a reboot.
        let script = format!(
            "$d = '{dir_lit}'\n\
             $u = [Environment]::GetEnvironmentVariable('PATH','User')\n\
             if (-not $u) {{ $u = '' }}\n\
             $hit = $u.Split(';') | Where-Object {{ $_ -ne '' }} | ForEach-Object {{ $_.TrimEnd('\\') }}\n\
             if ($hit -contains $d.TrimEnd('\\')) {{ exit 2 }}\n\
             $new = if ($u -eq '') {{ $d }} elseif ($u.EndsWith(';')) {{ $u + $d }} else {{ $u + ';' + $d }}\n\
             [Environment]::SetEnvironmentVariable('PATH', $new, 'User')\n\
             exit 0"
        );
        // CREATE_NO_WINDOW (0x08000000): keep the PowerShell call invisible so no
        // console window flashes when the user clicks "Add to PATH".
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x0800_0000)
            .output()
            .map_err(|e| e.to_string())?;
        match out.status.code() {
            Some(0) => Ok(InstallOutcome::Added),
            Some(2) => Ok(InstallOutcome::AlreadyPresent),
            _ => Err(format!(
                "Failed to update PATH: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )),
        }
    }
    #[cfg(not(windows))]
    {
        Ok(InstallOutcome::Manual {
            instruction: format!("export PATH=\"{}:$PATH\"", dir.display()),
        })
    }
}

/// Aggregated status for UI/CLI display.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShimStatus {
    pub dir: String,
    pub on_path: bool,
    /// Number of aliases currently materialized as shims.
    pub count: usize,
    /// Names of shimmed aliases.
    pub names: Vec<String>,
}

pub fn status(settings: &AppSettings, aliases: &[ShellAlias]) -> ShimStatus {
    let dir = resolve_shim_dir(settings);
    let names: Vec<String> = aliases
        .iter()
        .filter(|a| is_shimmable(a))
        .map(|a| a.name.clone())
        .collect();
    ShimStatus {
        dir: dir.to_string_lossy().to_string(),
        on_path: path_contains(&dir),
        count: names.len(),
        names,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ShellAlias;

    fn func_alias(name: &str, command: &str, shim: bool) -> ShellAlias {
        let mut a = ShellAlias::new(name.to_string(), command.to_string());
        a.shim = shim;
        a
    }

    #[test]
    fn shimmable_requires_function_type_and_flag() {
        let mut a = func_alias("zorg", "zorg.exe", true);
        assert!(is_shimmable(&a));
        a.shim = false;
        assert!(!is_shimmable(&a));
        a.shim = true;
        a.alias_type = "init".to_string();
        assert!(!is_shimmable(&a));
        a.alias_type = "function".to_string();
        a.command = "   ".to_string();
        assert!(!is_shimmable(&a));
    }

    #[test]
    fn sh_content_has_shebang_marker_and_lf() {
        let c = sh_content("bun run x.ts");
        assert!(c.starts_with("#!/bin/sh\n"));
        assert!(c.contains(SH_MARKER));
        assert!(c.contains("exec bun run x.ts \"$@\""));
        assert!(!c.contains('\r'));
    }

    #[test]
    fn cmd_content_has_marker_and_crlf() {
        let c = cmd_content("payledger.exe");
        assert!(c.starts_with("@echo off\r\n"));
        assert!(c.contains(CMD_MARKER));
        assert!(c.contains("payledger.exe %*"));
    }

    #[test]
    #[cfg(windows)]
    fn sh_exec_command_converts_backslashes_on_windows() {
        // Unquoted backslash paths would be mangled by `sh`; we convert to slashes.
        assert_eq!(
            sh_exec_command("C:\\Windows\\System32\\whoami.exe"),
            "C:/Windows/System32/whoami.exe"
        );
        // Forward-slash commands (e.g. `bun run C:/x.ts`) are unaffected.
        assert_eq!(sh_exec_command("bun run C:/x.ts"), "bun run C:/x.ts");
    }

    #[test]
    fn write_then_sync_off_removes_orphan() {
        let tmp = std::env::temp_dir().join(format!("cortx-shim-ut-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);

        let a = func_alias("uttool", "uttool.exe", true);
        write_shim(&tmp, &a).unwrap();
        assert!(tmp.join("uttool").exists());

        // Now alias is no longer shimmed → sync_all should remove it.
        let off = func_alias("uttool", "uttool.exe", false);
        let report = sync_all(&tmp, std::slice::from_ref(&off)).unwrap();
        assert!(report.removed.contains(&"uttool".to_string()));
        assert!(!tmp.join("uttool").exists());

        let _ = fs::remove_dir_all(&tmp);
    }
}
