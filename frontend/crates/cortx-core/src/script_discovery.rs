use std::path::Path;
use walkdir::WalkDir;

use crate::models::DiscoveredScript;

/// Scan a folder for script files matching the given extensions,
/// ignoring paths that match any of the ignored patterns.
pub fn scan_folder(
    folder: &str,
    extensions: &[String],
    ignored_patterns: &[String],
) -> Vec<DiscoveredScript> {
    let root = Path::new(folder);
    if !root.is_dir() {
        return Vec::new();
    }

    let mut results = Vec::new();

    for entry in WalkDir::new(root)
        .follow_links(true)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            // Skip ignored directories/files
            !ignored_patterns.iter().any(|p| name.contains(p.as_str()))
        })
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let ext = match path.extension().and_then(|e| e.to_str()) {
            Some(e) => format!(".{}", e),
            None => continue,
        };

        // Check if extension matches (handle both ".py" and "py" formats)
        let ext_no_dot = &ext[1..]; // "py" from ".py"
        if !extensions.iter().any(|scan_ext| {
            let s = scan_ext.trim();
            s.eq_ignore_ascii_case(&ext) || s.eq_ignore_ascii_case(ext_no_dot)
        }) {
            continue;
        }

        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        let abs_path = path
            .canonicalize()
            .unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy()
            .to_string();
        // On Windows, canonicalize() returns UNC paths like \\?\C:\...
        // Strip the prefix for cleaner, comparable paths
        #[cfg(target_os = "windows")]
        let abs_path = abs_path.strip_prefix(r"\\?\").unwrap_or(&abs_path).to_string();

        // Try to extract a description from the first comment line
        let description = extract_description(path);

        results.push(DiscoveredScript {
            path: abs_path,
            name,
            description,
            extension: ext,
        });
    }

    results.sort_by(|a, b| a.name.cmp(&b.name));
    results
}

/// Try to read the first comment line from a script file as its description.
fn extract_description(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut in_script_block = false;
    for line in content.lines() {
        let trimmed = line.trim();
        // Skip PEP 723 inline script metadata blocks (# /// script ... # ///)
        if trimmed == "# /// script" {
            in_script_block = true;
            continue;
        }
        if in_script_block {
            if trimmed == "# ///" {
                in_script_block = false;
            }
            continue;
        }
        // Skip empty lines
        if trimmed.is_empty() {
            continue;
        }
        // Skip shebang
        if trimmed.starts_with("#!") {
            continue;
        }
        // Shell/Python/PowerShell comments
        if let Some(comment) = trimmed.strip_prefix('#') {
            let desc = comment.trim();
            if !desc.is_empty() {
                return Some(desc.to_string());
            }
            continue;
        }
        // Batch REM comments
        if trimmed.to_uppercase().starts_with("REM ") {
            let desc = trimmed[4..].trim();
            if !desc.is_empty() {
                return Some(desc.to_string());
            }
        }
        // PowerShell <# block comments - just grab first line
        if let Some(rest) = trimmed.strip_prefix("<#") {
            let desc = rest.trim().trim_end_matches("#>").trim();
            if !desc.is_empty() {
                return Some(desc.to_string());
            }
        }
        // If we hit a non-empty, non-comment line, stop looking
        break;
    }
    None
}
