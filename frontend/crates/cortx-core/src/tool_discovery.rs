use crate::models::DiscoveredTool;

#[allow(dead_code)]
fn home_dir() -> Option<std::path::PathBuf> {
    directories::UserDirs::new().map(|u| u.home_dir().to_path_buf())
}

/// Scan installed package managers (Scoop, Chocolatey, Homebrew) and return discovered tools.
pub fn scan_installed_tools() -> Vec<DiscoveredTool> {
    let mut tools: Vec<DiscoveredTool> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        tools.extend(scan_scoop());
        tools.extend(scan_chocolatey());
    }

    #[cfg(target_os = "macos")]
    {
        tools.extend(scan_homebrew());
    }

    tools.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    tools
}

#[cfg(target_os = "windows")]
fn is_command_available(cmd: &str) -> bool {
    std::process::Command::new("cmd")
        .args(["/C", &format!("{} --version", cmd)])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn scan_scoop() -> Vec<DiscoveredTool> {
    if !is_command_available("scoop") {
        return Vec::new();
    }

    let output = match std::process::Command::new("cmd")
        .args(["/C", "scoop export"])
        .output()
    {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => return Vec::new(),
    };

    let mut tools = parse_scoop_export(&output);

    // Enrich from manifest files
    if let Some(home) = home_dir() {
        for tool in &mut tools {
            let manifest_path = home
                .join("scoop")
                .join("apps")
                .join(&tool.name)
                .join("current")
                .join("manifest.json");

            if let Ok(content) = std::fs::read_to_string(&manifest_path) {
                if let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&content) {
                    if tool.description.is_none() {
                        tool.description = manifest
                            .get("description")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                    }
                    if tool.homepage.is_none() {
                        tool.homepage = manifest
                            .get("homepage")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                    }
                }
            }
        }
    }

    tools
}

#[cfg(target_os = "windows")]
fn scan_chocolatey() -> Vec<DiscoveredTool> {
    if !is_command_available("choco") {
        return Vec::new();
    }

    let output = match std::process::Command::new("cmd")
        .args(["/C", "choco list --limit-output"])
        .output()
    {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => return Vec::new(),
    };

    parse_choco_list(&output)
}

#[allow(dead_code)]
fn parse_scoop_export(json: &str) -> Vec<DiscoveredTool> {
    #[derive(serde::Deserialize)]
    struct ScoopApp {
        #[serde(alias = "Name")]
        name: Option<String>,
        #[serde(alias = "Version")]
        version: Option<String>,
        #[serde(alias = "Source")]
        #[allow(dead_code)]
        source: Option<String>,
    }

    // scoop export outputs JSON with an "apps" array (PowerShell ConvertTo-Json format)
    // But it can also output a simpler line-based format depending on version.
    // Try JSON first.
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(json) {
        let apps = value
            .get("apps")
            .or_else(|| value.as_array().map(|_| &value))
            .and_then(|v| serde_json::from_value::<Vec<ScoopApp>>(v.clone()).ok())
            .unwrap_or_default();

        let home = home_dir();

        return apps
            .into_iter()
            .filter_map(|app| {
                let name = app.name?;
                let install_location = home.as_ref().map(|h| {
                    h.join("scoop")
                        .join("apps")
                        .join(&name)
                        .join("current")
                        .to_string_lossy()
                        .to_string()
                });

                Some(DiscoveredTool {
                    name,
                    version: app.version,
                    source: "scoop".to_string(),
                    description: None,
                    install_location,
                    homepage: None,
                })
            })
            .collect();
    }

    // Fallback: line-based format "name (v:version) [bucket]"
    json.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let name = line.split_whitespace().next()?;
            let version = line
                .find("(v:")
                .and_then(|start| {
                    let rest = &line[start + 3..];
                    rest.find(')').map(|end| rest[..end].to_string())
                });

            let home = home_dir();
            let install_location = home.map(|h| {
                h.join("scoop")
                    .join("apps")
                    .join(name)
                    .join("current")
                    .to_string_lossy()
                    .to_string()
            });

            Some(DiscoveredTool {
                name: name.to_string(),
                version,
                source: "scoop".to_string(),
                description: None,
                install_location,
                homepage: None,
            })
        })
        .collect()
}

// ============================================================================
// macOS — Homebrew
// ============================================================================

#[cfg(target_os = "macos")]
fn brew_prefix() -> Option<String> {
    let output = std::process::Command::new("brew")
        .arg("--prefix")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(target_os = "macos")]
fn scan_homebrew() -> Vec<DiscoveredTool> {
    let prefix = match brew_prefix() {
        Some(p) => p,
        None => return Vec::new(), // brew not installed / not in PATH
    };

    let mut tools = Vec::new();

    // Formulae
    if let Ok(out) = std::process::Command::new("brew")
        .args(["list", "--formula", "--versions"])
        .output()
    {
        if out.status.success() {
            tools.extend(parse_brew_versions(
                &String::from_utf8_lossy(&out.stdout),
                "homebrew",
                Some(&prefix),
                false,
            ));
        }
    }

    // Casks (GUI apps installed via brew)
    if let Ok(out) = std::process::Command::new("brew")
        .args(["list", "--cask", "--versions"])
        .output()
    {
        if out.status.success() {
            tools.extend(parse_brew_versions(
                &String::from_utf8_lossy(&out.stdout),
                "homebrew-cask",
                Some(&prefix),
                true,
            ));
        }
    }

    tools
}

/// Parse the output of `brew list --versions` (formulae) or
/// `brew list --cask --versions` (casks). Each line looks like:
///   `name 1.2.3` or `name 1.2.3 1.2.4` (multiple installed versions)
/// We only keep the latest token as the version.
#[allow(dead_code)]
fn parse_brew_versions(
    output: &str,
    source: &str,
    prefix: Option<&str>,
    is_cask: bool,
) -> Vec<DiscoveredTool> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let mut parts = line.split_whitespace();
            let name = parts.next()?.to_string();
            // Take the last whitespace-separated token as the version
            // (handles both single-version and multi-version output).
            let version = parts.last().map(|s| s.to_string());

            let install_location = prefix.map(|p| {
                if is_cask {
                    format!("{}/Caskroom/{}", p, name)
                } else {
                    format!("{}/opt/{}", p, name)
                }
            });

            Some(DiscoveredTool {
                name,
                version,
                source: source.to_string(),
                description: None,
                install_location,
                homepage: None,
            })
        })
        .collect()
}

#[allow(dead_code)]
fn parse_choco_list(output: &str) -> Vec<DiscoveredTool> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let mut parts = line.splitn(2, '|');
            let name = parts.next()?.trim();
            let version = parts.next().map(|v| v.trim().to_string());

            if name.is_empty() {
                return None;
            }

            let install_location = format!(r"C:\ProgramData\chocolatey\lib\{}\", name);

            Some(DiscoveredTool {
                name: name.to_string(),
                version,
                source: "chocolatey".to_string(),
                description: None,
                install_location: Some(install_location),
                homepage: None,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_scoop_export_json() {
        let json = r#"{
            "apps": [
                { "Name": "git", "Version": "2.43.0", "Source": "main" },
                { "Name": "nodejs", "Version": "21.5.0", "Source": "main" }
            ]
        }"#;

        let tools = parse_scoop_export(json);
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "git");
        assert_eq!(tools[0].version.as_deref(), Some("2.43.0"));
        assert_eq!(tools[0].source, "scoop");
        assert!(tools[0].install_location.is_some());
        assert_eq!(tools[1].name, "nodejs");
    }

    #[test]
    fn test_parse_scoop_export_line_format() {
        let output = "git (v:2.43.0) [main]\nnodejs (v:21.5.0) [main]\n";
        let tools = parse_scoop_export(output);
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "git");
        assert_eq!(tools[0].version.as_deref(), Some("2.43.0"));
        assert_eq!(tools[1].name, "nodejs");
    }

    #[test]
    fn test_parse_scoop_export_empty() {
        let tools = parse_scoop_export("");
        assert!(tools.is_empty());
    }

    #[test]
    fn test_parse_choco_list() {
        let output = "chocolatey|2.2.2\ngit|2.43.0\nnodejs|21.5.0\n";
        let tools = parse_choco_list(output);
        assert_eq!(tools.len(), 3);
        assert_eq!(tools[0].name, "chocolatey");
        assert_eq!(tools[0].version.as_deref(), Some("2.2.2"));
        assert_eq!(tools[0].source, "chocolatey");
        assert_eq!(tools[1].name, "git");
        assert_eq!(tools[2].name, "nodejs");
    }

    #[test]
    fn test_parse_choco_list_empty() {
        let tools = parse_choco_list("");
        assert!(tools.is_empty());
    }

    #[test]
    fn test_parse_choco_list_with_blank_lines() {
        let output = "git|2.43.0\n\nnodejs|21.5.0\n";
        let tools = parse_choco_list(output);
        assert_eq!(tools.len(), 2);
    }

    #[test]
    fn test_parse_brew_versions_simple() {
        let output = "git 2.43.0\nnode 21.5.0\nzsh 5.9\n";
        let tools = parse_brew_versions(output, "homebrew", Some("/opt/homebrew"), false);
        assert_eq!(tools.len(), 3);
        assert_eq!(tools[0].name, "git");
        assert_eq!(tools[0].version.as_deref(), Some("2.43.0"));
        assert_eq!(tools[0].source, "homebrew");
        assert_eq!(
            tools[0].install_location.as_deref(),
            Some("/opt/homebrew/opt/git"),
        );
    }

    #[test]
    fn test_parse_brew_versions_multi() {
        // brew can list several versions for one formula; we keep the last one.
        let output = "python@3.12 3.12.1 3.12.2\n";
        let tools = parse_brew_versions(output, "homebrew", None, false);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "python@3.12");
        assert_eq!(tools[0].version.as_deref(), Some("3.12.2"));
        assert!(tools[0].install_location.is_none());
    }

    #[test]
    fn test_parse_brew_versions_cask() {
        let output = "firefox 120.0\nvisual-studio-code 1.85.0\n";
        let tools = parse_brew_versions(output, "homebrew-cask", Some("/opt/homebrew"), true);
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].source, "homebrew-cask");
        assert_eq!(
            tools[0].install_location.as_deref(),
            Some("/opt/homebrew/Caskroom/firefox"),
        );
    }

    #[test]
    fn test_parse_brew_versions_empty() {
        let tools = parse_brew_versions("", "homebrew", None, false);
        assert!(tools.is_empty());
    }
}
