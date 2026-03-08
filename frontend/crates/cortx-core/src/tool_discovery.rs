use crate::models::DiscoveredTool;

fn home_dir() -> Option<std::path::PathBuf> {
    directories::UserDirs::new().map(|u| u.home_dir().to_path_buf())
}

/// Scan installed package managers (Scoop, Chocolatey) and return discovered tools.
pub fn scan_installed_tools() -> Vec<DiscoveredTool> {
    let mut tools = Vec::new();

    #[cfg(target_os = "windows")]
    {
        tools.extend(scan_scoop());
        tools.extend(scan_chocolatey());
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
}
