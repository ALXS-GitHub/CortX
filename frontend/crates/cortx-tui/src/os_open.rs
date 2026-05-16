use std::process::Command;

/// Open a path (file or directory) with the OS default handler.
/// File manager for directories, default associated app for files.
pub fn open_path(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", path])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open '{}': {}", path, e))
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open '{}': {}", path, e))
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open '{}': {}", path, e))
    }
}

/// Open a URL in the system's default browser.
pub fn open_url(url: &str) -> Result<(), String> {
    // Same handlers — `start`, `open`, and `xdg-open` all route URLs to the
    // default browser. Kept as a distinct function so callers can be intent-clear.
    open_path(url)
}

/// Launch an executable detached from the TUI process.
/// Handles macOS `.app` bundles via `open -n -a`. Extra args are forwarded.
pub fn launch_executable(exe: &str, args: &[String]) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", exe]);
        for arg in args {
            cmd.arg(arg);
        }
        cmd.spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to launch '{}': {}", exe, e))
    }
    #[cfg(target_os = "macos")]
    {
        if exe.ends_with(".app") || exe.contains(".app/") {
            let mut cmd = Command::new("open");
            cmd.args(["-n", "-a", exe]);
            if !args.is_empty() {
                cmd.arg("--args");
                for arg in args {
                    cmd.arg(arg);
                }
            }
            cmd.spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to launch '{}': {}", exe, e))
        } else {
            let mut cmd = Command::new(exe);
            for arg in args {
                cmd.arg(arg);
            }
            cmd.spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to launch '{}': {}", exe, e))
        }
    }
    #[cfg(target_os = "linux")]
    {
        let mut cmd = Command::new(exe);
        for arg in args {
            cmd.arg(arg);
        }
        cmd.spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to launch '{}': {}", exe, e))
    }
}
