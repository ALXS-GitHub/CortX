use std::path::Path;

/// Format a command for display: replace {{SCRIPT_FILE}} with {{SCRIPT_FILE:filename}}
pub fn format_command_display(command: &str, script_path: Option<&str>) -> String {
    match script_path {
        Some(path) if command.contains("{{SCRIPT_FILE}}") => {
            let filename = Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path);
            command.replace("{{SCRIPT_FILE}}", &format!("{{{{SCRIPT_FILE:{}}}}}", filename))
        }
        _ => command.to_string(),
    }
}
