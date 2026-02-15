use regex::Regex;

use crate::models::{ScriptParamType, ScriptParameter};

/// Parse the output of `<command> --help` and extract script parameters.
///
/// Supports:
/// - GNU/POSIX style: `-f, --flag  Description`
/// - Python argparse style (description on next line)
/// - Long-only options: `--option VALUE`
/// - Value placeholders: `VALUE`, `<value>`, `[VALUE]`, `[VALUE ...]`
/// - Positional arguments (argparse `positional arguments:` section)
pub fn parse_help_output(help_text: &str) -> Vec<ScriptParameter> {
    let mut params = Vec::new();
    let mut seen_names = std::collections::HashSet::new();

    let lines: Vec<&str> = help_text.lines().collect();
    let line_count = lines.len();

    // Regex for option lines:
    // Matches: "  -s, --long [VALUE]   description" or "  --long VALUE" etc.
    // The description part is optional (may be on the next line in argparse format)
    // Value hints support multi-value patterns: PLAYER [PLAYER ...], MIN MAX, etc.
    let value_hint = r"[A-Z][A-Z0-9_.*-]*(?:[ \t]+(?:\.\.\.|[A-Z][A-Z0-9_.*-]*(?:[ \t]+\.\.\.)?|\[[^\]\n]+\]))*|<[^>\n]+>|\[[^\]\n]+\]";
    let option_with_short_re = Regex::new(
        &format!(r"^[ \t]{{1,8}}(-[a-zA-Z0-9])(?:[ \t]*,?[ \t]*(--[\w][\w-]*))?(?:[ \t]+(?:=[ \t]*)?({value_hint}))?(?:[ \t]{{2,}}(.+))?$")
    ).unwrap();

    let long_only_re = Regex::new(
        &format!(r"^[ \t]{{2,}}(--[\w][\w-]*)(?:[ \t]+(?:=[ \t]*)?({value_hint}))?(?:[ \t]{{2,}}(.+))?$")
    ).unwrap();

    // Continuation line: starts with lots of whitespace, no dashes
    let continuation_re = Regex::new(r"^[ \t]{10,}(\S.*)$").unwrap();

    // Section header: "positional arguments:", "options:", "optional arguments:", etc.
    let section_header_re = Regex::new(r"^[a-zA-Z][\w\s]*:\s*$").unwrap();

    // Positional argument line: "  argname             Description text"
    // Must be a simple word (no dashes) followed by enough spacing and a description
    let positional_re = Regex::new(
        r"^[ \t]{2,8}([a-zA-Z][a-zA-Z0-9_-]*)(?:[ \t]{2,}(.+))?$"
    ).unwrap();

    let mut in_positional_section = false;
    let mut i = 0;
    while i < line_count {
        let line = lines[i];

        // Detect section headers
        if section_header_re.is_match(line) {
            let header_lower = line.trim().to_lowercase();
            in_positional_section = header_lower.starts_with("positional argument");
            i += 1;
            continue;
        }

        // Empty line resets positional section tracking (new section may follow)
        if line.trim().is_empty() {
            // Don't reset here — argparse has blank lines between sections
            // but the section header detection handles transitions
            i += 1;
            continue;
        }

        // Try short+long pattern first (works in any section)
        if let Some(caps) = option_with_short_re.captures(line) {
            in_positional_section = false; // option lines mean we left positional section
            let short = caps.get(1).map(|m| m.as_str().to_string());
            let long = caps.get(2).map(|m| m.as_str().to_string());
            let value_hint = caps.get(3).map(|m| m.as_str());
            let mut description = caps.get(4).map(|m| m.as_str().trim().to_string());

            // Check next line for continuation description
            if description.is_none() && i + 1 < line_count {
                if let Some(cont_caps) = continuation_re.captures(lines[i + 1]) {
                    description = Some(cont_caps.get(1).unwrap().as_str().trim().to_string());
                    i += 1;
                }
            } else if description.is_some() && i + 1 < line_count {
                // Append continuation lines to existing description
                while i + 1 < line_count {
                    if let Some(cont_caps) = continuation_re.captures(lines[i + 1]) {
                        let more = cont_caps.get(1).unwrap().as_str().trim();
                        description = Some(format!("{} {}", description.unwrap(), more));
                        i += 1;
                    } else {
                        break;
                    }
                }
            }

            let name = derive_name(long.as_deref(), short.as_deref());
            if !seen_names.contains(&name) {
                seen_names.insert(name.clone());
                let (param_type, _) = deduce_type(value_hint, description.as_deref(), false);
                let default_value = extract_default(description.as_deref());
                let nargs = detect_nargs(value_hint);

                params.push(ScriptParameter {
                    name,
                    param_type,
                    short_flag: short,
                    long_flag: long,
                    description,
                    default_value,
                    required: false,
                    enum_values: Vec::new(),
                    nargs,
                });
            }

            i += 1;
            continue;
        }

        // Try long-only pattern (works in any section)
        if let Some(caps) = long_only_re.captures(line) {
            in_positional_section = false;
            let long = caps.get(1).map(|m| m.as_str().to_string());
            let value_hint = caps.get(2).map(|m| m.as_str());
            let mut description = caps.get(3).map(|m| m.as_str().trim().to_string());

            // Check next line for continuation description
            if description.is_none() && i + 1 < line_count {
                if let Some(cont_caps) = continuation_re.captures(lines[i + 1]) {
                    description = Some(cont_caps.get(1).unwrap().as_str().trim().to_string());
                    i += 1;
                }
            } else if description.is_some() && i + 1 < line_count {
                while i + 1 < line_count {
                    if let Some(cont_caps) = continuation_re.captures(lines[i + 1]) {
                        let more = cont_caps.get(1).unwrap().as_str().trim();
                        description = Some(format!("{} {}", description.unwrap(), more));
                        i += 1;
                    } else {
                        break;
                    }
                }
            }

            let name = derive_name(long.as_deref(), None);
            if !seen_names.contains(&name) {
                seen_names.insert(name.clone());
                let (param_type, _) = deduce_type(value_hint, description.as_deref(), false);
                let default_value = extract_default(description.as_deref());
                let nargs = detect_nargs(value_hint);

                params.push(ScriptParameter {
                    name,
                    param_type,
                    short_flag: None,
                    long_flag: long,
                    description,
                    default_value,
                    required: false,
                    enum_values: Vec::new(),
                    nargs,
                });
            }

            i += 1;
            continue;
        }

        // Try positional argument pattern (only in positional section)
        if in_positional_section {
            if let Some(caps) = positional_re.captures(line) {
                let name = caps.get(1).unwrap().as_str().to_string();
                let mut description = caps.get(2).map(|m| m.as_str().trim().to_string());

                // Check next line for continuation description
                if description.is_none() && i + 1 < line_count {
                    if let Some(cont_caps) = continuation_re.captures(lines[i + 1]) {
                        description = Some(cont_caps.get(1).unwrap().as_str().trim().to_string());
                        i += 1;
                    }
                } else if description.is_some() && i + 1 < line_count {
                    while i + 1 < line_count {
                        if let Some(cont_caps) = continuation_re.captures(lines[i + 1]) {
                            let more = cont_caps.get(1).unwrap().as_str().trim();
                            description = Some(format!("{} {}", description.unwrap(), more));
                            i += 1;
                        } else {
                            break;
                        }
                    }
                }

                if !seen_names.contains(&name) {
                    seen_names.insert(name.clone());
                    // Deduce type from description (no value hint for positional)
                    let (param_type, _) = deduce_type(None, description.as_deref(), true);
                    // Positional args that are typed as Bool from description don't make sense;
                    // default to String for positional args
                    let param_type = if param_type == ScriptParamType::Bool {
                        ScriptParamType::String
                    } else {
                        param_type
                    };
                    let default_value = extract_default(description.as_deref());

                    params.push(ScriptParameter {
                        name,
                        param_type,
                        short_flag: None,
                        long_flag: None,
                        description,
                        default_value,
                        required: true, // positional args are required
                        enum_values: Vec::new(),
                        nargs: None,
                    });
                }

                i += 1;
                continue;
            }
        }

        i += 1;
    }

    params
}

/// Run `<command> --help` and parse the output
pub fn detect_parameters(command: &str) -> Result<Vec<ScriptParameter>, String> {
    // Try --help first, then -h
    let output = try_help_flag(command, "--help")
        .or_else(|_| try_help_flag(command, "-h"))
        .map_err(|e| format!("Failed to run help command: {}", e))?;

    Ok(parse_help_output(&output))
}

fn try_help_flag(command: &str, flag: &str) -> Result<String, String> {
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Empty command".to_string());
    }

    let program = parts[0];
    let mut args: Vec<&str> = parts[1..].to_vec();
    args.push(flag);

    let mut cmd = std::process::Command::new(program);
    cmd.args(&args);

    // Force UTF-8 and avoid console allocation on Windows
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd.env("PYTHONUTF8", "1");
        cmd.env("PYTHONIOENCODING", "utf-8");
    }

    let result = cmd.output().map_err(|e| e.to_string())?;

    // Many programs output help to stderr or stdout regardless of exit code
    let stdout = String::from_utf8_lossy(&result.stdout);
    let stderr = String::from_utf8_lossy(&result.stderr);

    let combined = if stdout.len() > stderr.len() {
        stdout.to_string()
    } else if !stderr.is_empty() {
        stderr.to_string()
    } else {
        stdout.to_string()
    };

    if combined.trim().is_empty() {
        return Err("No help output received".to_string());
    }

    Ok(combined)
}

/// Detect nargs from a value hint string.
/// Returns Some("+") for "PLAYER [PLAYER ...]", Some("2") for "MIN MAX", etc.
fn detect_nargs(value_hint: Option<&str>) -> Option<String> {
    let hint = value_hint?;
    // Contains [...] with "..." inside → nargs='+'  e.g. "PLAYER [PLAYER ...]"
    if hint.contains("[") && hint.contains("...") {
        return Some("+".to_string());
    }
    // Multiple uppercase words without brackets → fixed nargs  e.g. "MIN MAX"
    let words: Vec<&str> = hint.split_whitespace()
        .filter(|w| w.chars().next().map_or(false, |c| c.is_ascii_uppercase()) && !w.starts_with('['))
        .collect();
    if words.len() > 1 {
        return Some(words.len().to_string());
    }
    None
}

/// Derive a human-readable name from the long or short flag
fn derive_name(long: Option<&str>, short: Option<&str>) -> String {
    if let Some(l) = long {
        l.trim_start_matches('-').replace('-', "_")
    } else if let Some(s) = short {
        s.trim_start_matches('-').to_string()
    } else {
        "unknown".to_string()
    }
}

/// Deduce the parameter type from the value hint and description.
/// `is_positional` indicates a positional argument (no flags), where description
/// hints are used to infer the type. For flag-based options without a value hint,
/// the type is always Bool.
fn deduce_type(value_hint: Option<&str>, description: Option<&str>, is_positional: bool) -> (ScriptParamType, bool) {
    let has_value = value_hint.is_some();

    if !has_value {
        if is_positional {
            // For positional args, use description to guess the type
            if let Some(desc) = description {
                let desc_lower = desc.to_lowercase();
                if desc_lower.contains("number") || desc_lower.contains("count") || desc_lower.contains("port") {
                    return (ScriptParamType::Number, true);
                }
                if desc_lower.contains("path") || desc_lower.contains("directory") || desc_lower.contains("file") {
                    return (ScriptParamType::Path, true);
                }
            }
            return (ScriptParamType::String, true);
        }
        // Flag-based option with no value placeholder = boolean flag
        return (ScriptParamType::Bool, false);
    }

    let hint = value_hint.unwrap().to_uppercase();
    // Strip brackets and ... suffix
    let hint_clean = hint
        .trim_matches(|c| c == '<' || c == '>' || c == '[' || c == ']')
        .trim_end_matches("...")
        .trim();

    match hint_clean {
        "NUM" | "NUMBER" | "COUNT" | "N" | "PORT" | "INT" | "INTEGER" => {
            (ScriptParamType::Number, true)
        }
        "FILE" | "PATH" | "DIR" | "DIRECTORY" | "FOLDER" => {
            (ScriptParamType::Path, true)
        }
        _ => (ScriptParamType::String, true),
    }
}

/// Try to extract a default value from the description
fn extract_default(description: Option<&str>) -> Option<String> {
    let desc = description?;
    // Match patterns like: (default: value), [default: value], (default: val1 val2)
    // Require opening bracket to avoid matching "Default number..." as a default value
    let default_re = Regex::new(
        r#"(?i)(?:\(|\[)\s*defaults?\s*[:=]\s*['"]?([^'"\)\]]+?)['"]?\s*(?:\)|\])"#
    ).unwrap();

    default_re.captures(desc).map(|caps| {
        caps.get(1).unwrap().as_str().trim().to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_gnu_style() {
        let help = r#"
Usage: myapp [OPTIONS]

Options:
  -v, --verbose           Enable verbose output
  -o, --output FILE       Output file path
  -n, --count NUM         Number of items
      --no-color          Disable colors
  -h, --help              Show help
  -V, --version           Show version
"#;
        let params = parse_help_output(help);
        assert_eq!(params.len(), 6); // verbose, output, count, no-color, help, version

        let verbose = params.iter().find(|p| p.name == "verbose").unwrap();
        assert_eq!(verbose.param_type, ScriptParamType::Bool);
        assert_eq!(verbose.short_flag.as_deref(), Some("-v"));
        assert_eq!(verbose.long_flag.as_deref(), Some("--verbose"));

        let output = params.iter().find(|p| p.name == "output").unwrap();
        assert_eq!(output.param_type, ScriptParamType::Path);

        let count = params.iter().find(|p| p.name == "count").unwrap();
        assert_eq!(count.param_type, ScriptParamType::Number);
    }

    #[test]
    fn test_parse_python_argparse_style() {
        let help = r#"usage: dir_tree.py [-h] [--exclude [EXCLUDE ...]] [--files] directory

Print a tree structure of a directory.

positional arguments:
  directory             The root directory to print the tree from.

options:
  -h, --help            show this help message and exit
  --exclude [EXCLUDE ...]
                        List of folders to exclude.
  --files               Include files in the tree structure.
"#;
        let params = parse_help_output(help);

        // Should find: directory (positional), help, exclude, files
        assert_eq!(params.len(), 4, "Expected 4 params, got {}: {:?}", params.len(), params.iter().map(|p| &p.name).collect::<Vec<_>>());

        // Positional argument
        let directory = params.iter().find(|p| p.name == "directory").unwrap();
        assert_eq!(directory.param_type, ScriptParamType::Path); // description says "directory"
        assert!(directory.short_flag.is_none());
        assert!(directory.long_flag.is_none());
        assert!(directory.required);
        assert!(directory.description.as_deref().unwrap().contains("root directory"));

        let exclude = params.iter().find(|p| p.name == "exclude").unwrap();
        assert_eq!(exclude.long_flag.as_deref(), Some("--exclude"));
        assert!(exclude.description.as_deref().unwrap().contains("folders to exclude"));

        let files = params.iter().find(|p| p.name == "files").unwrap();
        assert_eq!(files.param_type, ScriptParamType::Bool); // flag with no value hint = bool
        assert_eq!(files.long_flag.as_deref(), Some("--files"));
    }

    #[test]
    fn test_parse_positional_args_multiple() {
        let help = r#"usage: mytool [-h] [--verbose] source destination

Copy files from source to destination.

positional arguments:
  source                Source file path
  destination           Destination directory path

options:
  -h, --help            show this help message and exit
  --verbose             Enable verbose output
"#;
        let params = parse_help_output(help);

        assert_eq!(params.len(), 4, "Expected 4 params, got {}: {:?}", params.len(), params.iter().map(|p| &p.name).collect::<Vec<_>>());

        let source = params.iter().find(|p| p.name == "source").unwrap();
        assert!(source.required);
        assert!(source.short_flag.is_none());
        assert!(source.long_flag.is_none());
        assert_eq!(source.param_type, ScriptParamType::Path); // "file path" in description

        let dest = params.iter().find(|p| p.name == "destination").unwrap();
        assert!(dest.required);
        assert_eq!(dest.param_type, ScriptParamType::Path); // "directory path" in description

        let verbose = params.iter().find(|p| p.name == "verbose").unwrap();
        assert!(!verbose.required);
        assert_eq!(verbose.param_type, ScriptParamType::Bool);
    }

    #[test]
    fn test_parse_multi_value_args() {
        let help = r#"usage: imposter_game [-h] [--player-list] [--players PLAYER [PLAYER ...]]
                     [--speed-range MIN MAX] [--nb-impostor N]
                     [--special-impostor-odds JSON] [--dry-run]

Imposter Game

options:
  -h, --help            show this help message and exit
  --player-list         Show all configured players from user_map.json and exit.
  --players PLAYER [PLAYER ...]
                        Players for this session (by name or discord ID). At
                        least 1 required.
  --speed-range MIN MAX
                        Speed range in km/h (default: 0 150).
  --nb-impostor N       Default number of impostors (default: 1).
  --special-impostor-odds JSON
                        Odds for special impostor counts as JSON. Example:
                        '{"2": 0.1, "all": 0.01}'
  --special-rank-game PROB
                        Probability (0-1) of a special rank game.
  --dry-run             Run the game logic without sending Discord DMs.
"#;
        let params = parse_help_output(help);

        // --players with nargs='+' (PLAYER [PLAYER ...])
        let players = params.iter().find(|p| p.name == "players").expect("players param not found");
        assert_eq!(players.long_flag.as_deref(), Some("--players"));
        assert_eq!(players.param_type, ScriptParamType::String);
        assert_eq!(players.nargs.as_deref(), Some("+"));
        assert!(players.description.as_deref().unwrap().contains("Players for this session"));

        // --speed-range with nargs=2 (MIN MAX)
        let speed_range = params.iter().find(|p| p.name == "speed_range").expect("speed_range param not found");
        assert_eq!(speed_range.long_flag.as_deref(), Some("--speed-range"));
        assert_eq!(speed_range.nargs.as_deref(), Some("2"));
        assert_eq!(speed_range.default_value.as_deref(), Some("0 150"));

        // --nb-impostor with single value N
        let nb_impostor = params.iter().find(|p| p.name == "nb_impostor").expect("nb_impostor param not found");
        assert_eq!(nb_impostor.long_flag.as_deref(), Some("--nb-impostor"));
        assert_eq!(nb_impostor.param_type, ScriptParamType::Number);
        assert_eq!(nb_impostor.default_value.as_deref(), Some("1"));
        assert!(nb_impostor.nargs.is_none());

        // --special-impostor-odds JSON
        let odds = params.iter().find(|p| p.name == "special_impostor_odds").expect("special_impostor_odds param not found");
        assert_eq!(odds.param_type, ScriptParamType::String);

        // --player-list (bool flag)
        let player_list = params.iter().find(|p| p.name == "player_list").expect("player_list param not found");
        assert_eq!(player_list.param_type, ScriptParamType::Bool);

        // --dry-run (bool flag)
        let dry_run = params.iter().find(|p| p.name == "dry_run").expect("dry_run param not found");
        assert_eq!(dry_run.param_type, ScriptParamType::Bool);
    }

    #[test]
    fn test_extract_default_value() {
        assert_eq!(
            extract_default(Some("Output directory (default: ./out)")),
            Some("./out".to_string())
        );
        assert_eq!(
            extract_default(Some("Port number [default: 8080]")),
            Some("8080".to_string())
        );
        assert_eq!(extract_default(Some("Simple description")), None);
        // Multi-value default
        assert_eq!(
            extract_default(Some("Speed range in km/h (default: 0 150).")),
            Some("0 150".to_string())
        );
        // Should not match "Default" at start of description
        assert_eq!(
            extract_default(Some("Default number of impostors (default: 1).")),
            Some("1".to_string())
        );
    }
}
