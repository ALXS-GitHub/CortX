use std::collections::HashMap;

use crate::models::GlobalScript;
use crate::models::ScriptParamType;

/// Build `(program, args)` from a GlobalScript, parameter values, and extra arguments.
///
/// Returns `None` if the resolved command is empty.
pub fn build_command(
    script: &GlobalScript,
    param_values: &HashMap<String, String>,
    extra_args: &[String],
) -> Option<(String, Vec<String>)> {
    // 1. Replace {{SCRIPT_FILE}} placeholder
    let base_command = if let Some(ref script_path) = script.script_path {
        script.command.replace("{{SCRIPT_FILE}}", script_path)
    } else {
        script.command.clone()
    };

    // 2. Split into program + base args
    let mut tokens: Vec<String> = base_command.split_whitespace().map(|s| s.to_string()).collect();
    if tokens.is_empty() {
        return None;
    }
    let program = tokens.remove(0);
    let mut args = tokens;

    // 3. Append parameter values in definition order
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
                    for v in value.split_whitespace() {
                        args.push(v.to_string());
                    }
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

    // 4. Append extra args
    args.extend_from_slice(extra_args);

    Some((program, args))
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
            folder_id: None,
            tags: vec![],
            parameters: params,
            parameter_presets: vec![],
            default_preset_id: None,
            env_vars: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            order: 0,
            auto_discovered: false,
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
}
