use crate::models::{ShellAlias, TerminalBlockSpacing};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq)]
pub enum Shell {
    PowerShell,
    Bash,
    Zsh,
    Fish,
    Nu,
}

impl Shell {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "powershell" | "pwsh" | "ps" => Some(Shell::PowerShell),
            "bash" => Some(Shell::Bash),
            "zsh" => Some(Shell::Zsh),
            "fish" => Some(Shell::Fish),
            "nu" | "nushell" => Some(Shell::Nu),
            _ => None,
        }
    }

    fn key(&self) -> &'static str {
        match self {
            Shell::PowerShell => "powershell",
            Shell::Bash => "bash",
            Shell::Zsh => "zsh",
            Shell::Fish => "fish",
            Shell::Nu => "nu",
        }
    }
}

/// Every shell CortX can hand its integration to, spelled the way
/// [`Shell::from_str`] wants it. The list a message shows the user when their
/// shell is not one of them (see [`unsupported_shell_note`]).
pub const SUPPORTED_SHELLS: &[&str] = &["bash", "zsh", "fish", "nu", "powershell"];

/// What to tell the user about the shell they are actually running, or `None`
/// when it is one CortX knows.
///
/// Without the OSC 7 / OSC 133 block a CortX terminal has no blocks, no
/// enriched history, no command-finished notification, no universal input
/// editor and no block spacing — almost everything that makes it more than an
/// xterm. Today that happens *silently*: a `nu` user before this change, or a
/// `csh`, `xonsh` or `elvish` user after it, simply sees a CortX with its
/// features missing and never learns why.
///
/// This is only the sentence. Where it is shown is the caller's business —
/// see the note on this function in the terminal UI: it is meant to appear
/// once per unknown program, as a dismissible line, never per terminal.
pub fn unsupported_shell_note(program: &str) -> Option<String> {
    if shell_for_program(program).is_some() {
        return None;
    }
    let name = std::path::Path::new(program)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(program);
    if name.trim().is_empty() {
        return None;
    }
    Some(format!(
        "CortX has no shell integration for {name}. Blocks, command history, \
         completion notifications and block spacing stay off in this terminal. \
         Supported shells: {}.",
        SUPPORTED_SHELLS.join(", ")
    ))
}

const SHELL_BUILTINS: &[&str] = &[
    "cd", "exit", "source", "eval", "exec", "export", "alias", "unalias",
    "set", "unset", "return", "shift", "test", "true", "false", "echo",
    "printf", "read", "type", "which", "command",
];

/// Validate an alias name. Returns Ok(()) if valid, Err with message otherwise.
pub fn validate_alias_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Alias name cannot be empty".to_string());
    }
    if name.contains(char::is_whitespace) {
        return Err("Alias name cannot contain spaces".to_string());
    }
    if !name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return Err("Alias name can only contain alphanumeric characters, hyphens, and underscores".to_string());
    }
    Ok(())
}

/// Validate alias_type value.
pub fn validate_alias_type(alias_type: &str) -> Result<(), String> {
    match alias_type {
        "function" | "script" | "init" => Ok(()),
        _ => Err(format!(
            "Invalid alias type '{}'. Must be one of: function, script, init",
            alias_type
        )),
    }
}

/// Check if the alias name shadows a common shell builtin.
pub fn is_shell_builtin(name: &str) -> bool {
    SHELL_BUILTINS.iter().any(|b| b.eq_ignore_ascii_case(name))
}

/// Generate shell init script for the given aliases.
/// Aliases with `execution_order` set appear first (sorted ascending),
/// followed by those without (sorted by `order`). With `shell_integration`
/// the OSC 7 / 133 block from [`shell_integration_snippet`] is appended
/// last, so it wraps whatever prompt the aliases (starship, oh-my-posh…)
/// installed.
pub fn generate_init_script(shell: &Shell, aliases: &[ShellAlias], shell_integration: bool) -> String {
    generate_init_script_ext(
        shell,
        aliases,
        InitOptions {
            shell_integration,
            disable_shell_predictions: false,
        },
    )
}

/// Knobs of the generated init script (from `settings.terminal`).
#[derive(Debug, Clone, Copy, Default)]
pub struct InitOptions {
    /// Emit the OSC 7 / 133 block.
    pub shell_integration: bool,
    /// CortX draws its own history ghost text, so the shell's inline
    /// prediction (PSReadLine) is switched off inside CortX terminals to
    /// avoid two suggestions at once.
    pub disable_shell_predictions: bool,
}

pub fn generate_init_script_ext(shell: &Shell, aliases: &[ShellAlias], opts: InitOptions) -> String {
    let shell_integration = opts.shell_integration;
    let shell_key = shell.key();

    // Sort: execution_order set first (ascending), then the rest by order
    let mut sorted: Vec<&ShellAlias> = aliases.iter().collect();
    sorted.sort_by(|a, b| {
        match (a.execution_order, b.execution_order) {
            (Some(ao), Some(bo)) => ao.cmp(&bo),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.order.cmp(&b.order),
        }
    });

    let mut output = String::new();
    output.push_str("# CortX shell aliases — generated by `cortx init`\n");
    output.push_str(&format!(
        "# Do not edit manually; re-run `cortx init {}` to update.\n\n",
        shell_key
    ));

    // Track tool_ids whose setup has already been emitted (deduplicate)
    let mut setup_emitted: HashSet<String> = HashSet::new();

    for alias in &sorted {
        // 1. Description comment
        if let Some(ref desc) = alias.description {
            output.push_str(&format!("# {}\n", desc));
        }

        // 2. Setup code (deduplicated by tool_id)
        if let Some(ref setup_map) = alias.setup {
            if let Some(setup_code) = setup_map.get(shell_key) {
                if !setup_code.trim().is_empty() {
                    let should_emit = match &alias.tool_id {
                        Some(tid) => setup_emitted.insert(tid.clone()),
                        None => true, // no tool_id => always emit
                    };
                    if should_emit {
                        output.push_str(setup_code);
                        if !setup_code.ends_with('\n') {
                            output.push('\n');
                        }
                    }
                }
            }
        }

        // 3. Alias body
        let alias_type = alias.alias_type.as_str();
        match alias_type {
            "script" => {
                if let Some(ref script_map) = alias.script {
                    if let Some(script_code) = script_map.get(shell_key) {
                        if !script_code.trim().is_empty() {
                            output.push_str(script_code);
                            if !script_code.ends_with('\n') {
                                output.push('\n');
                            }
                        }
                    }
                }
            }
            "init" => {
                if let Some(ref script_map) = alias.script {
                    if let Some(init_cmd) = script_map.get(shell_key) {
                        if !init_cmd.trim().is_empty() {
                            match shell {
                                Shell::PowerShell => {
                                    output.push_str(&format!(
                                        "Invoke-Expression (& {{ ({} | Out-String) }})\n",
                                        init_cmd.trim()
                                    ));
                                }
                                Shell::Bash | Shell::Zsh => {
                                    output.push_str(&format!(
                                        "eval \"$({})\"\n",
                                        init_cmd.trim()
                                    ));
                                }
                                Shell::Fish => {
                                    output.push_str(&format!(
                                        "{} | source\n",
                                        init_cmd.trim()
                                    ));
                                }
                                Shell::Nu => {
                                    // Nushell has no `eval`: `source` is
                                    // resolved when the line is *parsed*, so
                                    // a string produced at run time can never
                                    // be sourced. The documented way round —
                                    // the one starship and zoxide tell their
                                    // Nushell users to take — is to write the
                                    // generated code into an autoload
                                    // directory, where the next shell picks
                                    // it up on its own.
                                    output.push_str(&format!(
                                        "mkdir ($nu.data-dir | path join \"vendor\" \"autoload\")\n\
                                         {} | save --force ($nu.data-dir | path join \"vendor\" \"autoload\" \"{}.nu\")\n",
                                        init_cmd.trim(),
                                        alias.name
                                    ));
                                }
                            }
                        }
                    }
                }
            }
            _ => {
                // "function" (default) — original wrapping logic
                match shell {
                    Shell::PowerShell => {
                        // A statement that starts with a quote parses in
                        // *expression* mode, where the splatting operator
                        // `@args` is illegal — and since `cortx init` output is
                        // consumed by a single Invoke-Expression, one such alias
                        // is a parse error that takes down the whole block, not
                        // just itself. The call operator `&` forces command mode.
                        //
                        // Quoting is required in the stored command as soon as
                        // the path holds a space (the .cmd and .sh shims have no
                        // call operator to fall back on), so the generator is
                        // where the PowerShell-specific syntax has to be added.
                        let cmd = alias.command.trim();
                        let call_op = if cmd.starts_with('"') || cmd.starts_with('\'') {
                            "& "
                        } else {
                            ""
                        };
                        output.push_str(&format!(
                            "function {} {{ {}{} @args }}\n",
                            alias.name, call_op, cmd
                        ));
                    }
                    Shell::Bash | Shell::Zsh => {
                        let escaped_cmd = alias.command.replace('\'', "'\\''");
                        output.push_str(&format!(
                            "{}() {{ {} \"$@\"; }}\n",
                            alias.name, escaped_cmd
                        ));
                    }
                    Shell::Fish => {
                        output.push_str(&format!(
                            "function {}\n    {} $argv\nend\n",
                            alias.name, alias.command
                        ));
                    }
                    Shell::Nu => {
                        // `--wrapped` is what makes this an alias rather than
                        // a command with a fixed signature: it lets the rest
                        // of the line through untouched, flags included,
                        // which is what `"$@"` and `@args` do elsewhere.
                        //
                        // A command that starts with a quote is a *value* in
                        // Nushell, not something to run, so it needs the `^`
                        // sigil for the same reason PowerShell needs `&`.
                        let cmd = alias.command.trim();
                        let sigil = if cmd.starts_with('"') || cmd.starts_with('\'') {
                            "^"
                        } else {
                            ""
                        };
                        output.push_str(&format!(
                            "def --wrapped {} [...rest] {{ {}{} ...$rest }}\n",
                            alias.name, sigil, cmd
                        ));
                    }
                }
            }
        }
    }

    if shell_integration {
        output.push('\n');
        output.push_str(&shell_integration_block(shell));
    }

    if opts.disable_shell_predictions && *shell == Shell::PowerShell {
        output.push_str(DISABLE_PSREADLINE_PREDICTION);
    }

    output
}

/// Turns PSReadLine's own inline prediction off inside a CortX terminal, so
/// it does not double up with our ghost text.
///
/// One line on purpose: it has to survive a line-by-line `Invoke-Expression`.
/// It checks that the parameter exists before using it — `-PredictionSource`
/// only arrived in PSReadLine 2.1, and Windows PowerShell 5.1 still ships 2.0,
/// where the call throws a binding error in the user's face at every prompt.
const DISABLE_PSREADLINE_PREDICTION: &str = "if ($env:CORTX_TERMINAL_ID -and (Get-Module -Name PSReadLine) -and (Get-Command Set-PSReadLineOption -ErrorAction SilentlyContinue | Where-Object { $_.Parameters.ContainsKey('PredictionSource') })) { Set-PSReadLineOption -PredictionSource None }\n";

/// Which shell a program name is, for the app-side injection (`pwsh.exe`,
/// `/bin/zsh`, `fish`…). `None` for anything we have no snippet for.
pub fn shell_for_program(program: &str) -> Option<Shell> {
    // Split on both separators by hand rather than through `Path`, which
    // only knows the host's own. `data/terminal/` is git-backed and shared
    // between machines, so a launch config written on Windows can carry a
    // backslash path and be read on macOS — where `Path` finds no separator,
    // hands back the whole string, and the shell goes unrecognised, silently
    // costing that terminal its shell integration. A Unix filename may
    // legally contain a backslash; misreading one costs nothing worse than
    // the default answer of "not a shell I know".
    let file = program.rsplit(['/', '\\']).next().unwrap_or(program);
    let base = file
        .rsplit_once('.')
        .map_or(file, |(stem, _)| stem)
        .to_ascii_lowercase();
    match base.as_str() {
        "pwsh" | "powershell" => Some(Shell::PowerShell),
        "bash" => Some(Shell::Bash),
        "zsh" => Some(Shell::Zsh),
        "fish" => Some(Shell::Fish),
        "nu" => Some(Shell::Nu),
        _ => None,
    }
}

/// The integration as *startup code* the app hands to a shell it spawns, so
/// it works even when the profile does not call `cortx init` (or calls an
/// older CLI). PowerShell gets one `Invoke-Expression` statement per line
/// (joined by `;` by the caller); other shells get the block verbatim.
pub fn shell_integration_startup(shell: &Shell, opts: InitOptions) -> String {
    let mut out = String::new();
    if opts.shell_integration {
        out.push_str(&shell_integration_block(shell));
    }
    if opts.disable_shell_predictions && *shell == Shell::PowerShell {
        out.push_str(DISABLE_PSREADLINE_PREDICTION);
    }
    out
}

/// The integration snippet in the form that goes into the init script.
/// PowerShell gets a single `Invoke-Expression` line carrying the block as
/// base64, so it survives both `| Out-String | Invoke-Expression` and a
/// line-by-line `| Invoke-Expression`. Other shells eval the whole output
/// at once and get the block verbatim.
pub fn shell_integration_block(shell: &Shell) -> String {
    shell_integration_block_for(shell, resolve_block_spacing())
}

/// [`shell_integration_block`] with the spacing spelled out (the pure half —
/// this is what the tests drive).
pub fn shell_integration_block_for(shell: &Shell, spacing: TerminalBlockSpacing) -> String {
    let snippet = shell_integration_snippet_for(shell, spacing);
    match shell {
        Shell::PowerShell => {
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(snippet.as_bytes());
            format!(
                "# CortX shell integration (OSC 7 / OSC 133); decoded and evaluated as one block\n\
                 Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}')))\n",
                b64
            )
        }
        _ => snippet,
    }
}

// ---------------------------------------------------------------------------
// Block spacing (DEV-13 #7 — Warp's `appearance.spacing`)
// ---------------------------------------------------------------------------

/// Placeholder the four snippets carry, replaced by the *number of blank
/// lines* the spacing asks for when the block is generated (see [`shell_integration_snippet_for`]).
const GAP_TOKEN: &str = "__CORTX_GAP__";

/// Placeholder for the *path of the settings file*, as a quoted literal for
/// the shell the snippet is written in. The snippets re-read
/// `terminal.blockSpacing` from it after every command, so a change to the
/// setting reaches shells that are already open (see [`settings_literal`]).
const SETTINGS_TOKEN: &str = "__CORTX_SETTINGS__";

/// Placeholder for the integration's *version stamp* — a hash of the snippet
/// itself, which the PowerShell wrapper leaves in the prompt it installs so a
/// newer block can tell an older CortX wrapper from its own (see
/// [`version_stamp`]).
const MARK_TOKEN: &str = "__CORTX_MARK__";

/// The file [`resolve_block_spacing`] reads, and the one the snippets re-read.
fn settings_file() -> Option<std::path::PathBuf> {
    let dirs = directories::ProjectDirs::from("com", "cortx", "Cortx")?;
    Some(dirs.data_dir().join("settings.json"))
}

/// [`settings_file`] as a quoted literal for `shell`, or an empty literal when
/// there is no settings file to point at (every snippet treats that as "don't
/// re-read" and keeps the value it was generated with).
fn settings_literal(shell: &Shell) -> String {
    quoted_path(shell, settings_file().as_deref())
}

/// The pure half of [`settings_literal`] — a path, quoted for `shell`.
///
/// Always single quotes, which is the one form that needs no thought about
/// what else is in the path: no shell expands anything inside them. The two
/// families differ only in how a `'` is escaped, and both have to survive
/// `C:\Users\Alexis Munch\…` — a space, and a backslash that a double-quoted
/// literal would have eaten.
///
/// `None` gives `''`. That is not a broken path but a deliberate one: every
/// snippet's re-read helper bows out on an empty file name and keeps the
/// spacing it was generated with, so a machine with no settings file yet
/// still gets a snippet that runs.
fn quoted_path(shell: &Shell, path: Option<&std::path::Path>) -> String {
    let Some(path) = path else {
        // An empty literal in the quoting each shell uses below.
        return match shell {
            Shell::Nu => "\"\"".to_string(),
            _ => "''".to_string(),
        };
    };
    let path = path.to_string_lossy();
    match shell {
        // PowerShell single quotes: only `'` is special, and it doubles.
        Shell::PowerShell => format!("'{}'", path.replace('\'', "''")),
        // Nushell is the one shell where single quotes are *no* answer: they
        // are strictly literal, which is perfect for the backslashes, but a
        // `'` inside them cannot be escaped at all — there is no closing and
        // reopening, the string simply ends. Double quotes take everything,
        // as long as the two characters they do read are doubled/escaped.
        Shell::Nu => nu_string(&path),
        // POSIX (and fish, which accepts the same `\'` outside the quotes):
        // close, escape, reopen.
        _ => sq(&path),
    }
}

/// A deterministic 64-bit FNV-1a of the snippet *template*, hex encoded.
///
/// This is what tells two CortX shell integrations apart. It has to be stable
/// for the same text forever and across machines — two different builds of
/// CortX carrying the same integration code must agree that they are the same
/// — which rules out `DefaultHasher` (explicitly not stable) and makes a
/// four-line hash cheaper than a dependency.
fn version_stamp(source: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in source.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The spacing the *current* settings ask for.
///
/// Deliberately not a field of [`InitOptions`]: that struct is spelled out
/// field by field at every call site (the Tauri commands, the `cortx init`
/// CLI, the sub-shell snippet), and a knob none of them has an opinion about
/// is better read once, here, at the moment the block is generated. It also
/// means every producer agrees — the `cortx init` a profile runs, the
/// start-up injection `process_manager` performs and the "warpify" line all
/// resolve the same value — and that a change to the setting reaches the very
/// next shell without anything having to be regenerated or restarted.
///
/// This is only the value a shell *starts* with: the snippets re-read the same
/// file after every command (`__cortx_read_gap`), so shells that are already
/// open follow the setting too, without CortX having to type anything into a
/// live PTY (ticket #41).
///
/// `settings.json` is read straight off disk rather than through `Storage`:
/// this is called once per shell start, the file is the one `Storage` itself
/// writes on every change, and shell_init has no business holding a handle to
/// the whole store. Anything unreadable falls back to the default.
pub fn resolve_block_spacing() -> TerminalBlockSpacing {
    fn read() -> Option<TerminalBlockSpacing> {
        let bytes = std::fs::read(settings_file()?).ok()?;
        let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
        let raw = json.get("terminal")?.get("blockSpacing")?.as_str()?;
        match raw {
            "compact" => Some(TerminalBlockSpacing::Compact),
            "normal" => Some(TerminalBlockSpacing::Normal),
            "comfortable" => Some(TerminalBlockSpacing::Comfortable),
            _ => None,
        }
    }
    read().unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Sub-shells (ticket #16 — "warpify")
// ---------------------------------------------------------------------------

/// Single quoting for POSIX shells (`'` closes, escapes, reopens).
fn sq(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// A Nushell string literal. Single quotes are literal in Nushell — which
/// suits a Windows path — but a `'` inside them cannot be escaped by any
/// means, so a double-quoted literal with the two characters it reads
/// escaped is the only form that holds arbitrary text.
pub fn nu_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', r"\\").replace('"', "\\\""))
}

/// The integration as **one line typed into an already-running shell**.
///
/// The startup injection in `process_manager::inject_shell_integration` only
/// reaches the shell CortX spawns itself. A shell started *inside* it — `bash`
/// from PowerShell, `docker exec -it … bash`, `ssh host`, `wsl` — has to be
/// handed the block after the fact, which is what Warp calls "warpifying" a
/// sub-shell. Warp does it by typing a bootstrap into the PTY; so do we.
///
/// The line is self-contained on purpose: it carries the block base64-encoded
/// and sets `CORTX_TERMINAL_ID` itself, so it also works where the variable
/// was not inherited (ssh, containers, WSL) and where `cortx` is not
/// installed. It starts with a space so shells configured to ignore
/// space-prefixed lines keep it out of the history.
///
/// **Never send this to something that is not a shell.** A CortX terminal
/// cannot tell an interactive `python` from a `bash`, so this is only ever
/// emitted on an explicit user action (see `components/terminal/subshell.ts`).
pub fn subshell_injection(shell: &Shell, terminal_id: &str, opts: InitOptions) -> String {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(shell_integration_snippet(shell).as_bytes());
    match shell {
        Shell::PowerShell => {
            // PowerShell needs no base64 helper on the far side: it decodes
            // the block itself. (Warp declines PowerShell sub-shells; we can
            // do them, because our block is already a single statement.)
            let mut line = format!(
                " $env:CORTX_TERMINAL_ID = '{}'; Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}')))",
                terminal_id.replace('\'', "''"),
                b64
            );
            if opts.disable_shell_predictions {
                line.push_str("; ");
                line.push_str(DISABLE_PSREADLINE_PREDICTION.trim_end());
            }
            line
        }
        Shell::Fish => format!(
            " set -gx CORTX_TERMINAL_ID {}; printf %s {} | base64 -d 2>/dev/null | source",
            sq(terminal_id),
            sq(&b64)
        ),
        // Nushell is the one shell the base64 trick cannot reach: it has no
        // `eval`, and `source` resolves its argument when the line is
        // *parsed*, which is before anything on that line has run — so a file
        // written by the same line cannot be sourced by it. The code itself
        // is what gets typed, which is why [`NU_INTEGRATION`] keeps every
        // statement on one line: dropping the comments and joining with `;`
        // is then a valid single line.
        Shell::Nu => {
            let body = shell_integration_snippet(shell)
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty() && !l.starts_with('#'))
                .collect::<Vec<_>>()
                .join("; ");
            format!(
                " $env.CORTX_TERMINAL_ID = {}; {}",
                nu_string(terminal_id),
                body
            )
        }
        // bash and zsh: `base64 -d` on GNU coreutils, `-D` on the older BSD
        // tool that still ships on macOS.
        _ => format!(
            " CORTX_TERMINAL_ID={0}; export CORTX_TERMINAL_ID; eval \"$(printf %s {1} | {{ base64 -d 2>/dev/null || base64 -D; }})\"",
            sq(terminal_id),
            sq(&b64)
        ),
    }
}

/// Shell-integration block appended by `cortx init` when
/// `settings.terminal.shell_integration` is on. Every shell guards on
/// `CORTX_TERMINAL_ID` (set by CortX's PTYs) so external terminals never see
/// the sequences. Protocol: OSC 7 for the cwd, OSC 133 A/B/C/D for prompt and
/// command boundaries, with `C;cmd=<base64 utf-8>` carrying the command line.
/// Parsed by `terminal::osc`.
///
/// The block also carries the *spacing* between two blocks: the shell prints
/// `terminal.blockSpacing` blank lines before a prompt that follows a command
/// — two by default, which is the air Warp leaves. It has to come from
/// the shell — CortX draws its blocks over xterm's grid, where every row is
/// exactly one row tall and no overlay can push two of them apart — and that
/// blank line is also what gives the divider and the action bar a row nobody
/// else wrote in.
///
/// **Two producers, newest wins.** The same block is emitted twice for the
/// same shell: once by the profile's `cortx init` (whatever CLI is installed)
/// and once by the app's own start-up injection (`process_manager`). They can
/// be different builds, and before ticket #41 the PowerShell wrapper bowed out
/// as soon as *any* CortX marker was on the prompt — so an older `cortx init`
/// held the prompt for the whole session while the newer block only got as far
/// as setting variables nothing read. The marker now carries a
/// [`version_stamp`] of the snippet, and a wrapper that is not this exact
/// version is replaced (its inner prompt, the user's real one, is inherited).
pub fn shell_integration_snippet(shell: &Shell) -> String {
    shell_integration_snippet_for(shell, resolve_block_spacing())
}

/// [`shell_integration_snippet`] with the spacing spelled out. The only thing
/// the setting changes is the number the snippet *initialises* its
/// `__cortx_gap` counter with, so every variant is the same script and the
/// PowerShell one stays a single base64 line — and so the version stamp, which
/// is taken from the template before anything is substituted, is the same for
/// all three spacings.
pub fn shell_integration_snippet_for(shell: &Shell, spacing: TerminalBlockSpacing) -> String {
    let template = match shell {
        Shell::PowerShell => POWERSHELL_INTEGRATION,
        Shell::Bash => BASH_INTEGRATION,
        Shell::Zsh => ZSH_INTEGRATION,
        Shell::Fish => FISH_INTEGRATION,
        Shell::Nu => NU_INTEGRATION,
    };
    let gap = match spacing {
        TerminalBlockSpacing::Compact => "0",
        TerminalBlockSpacing::Normal => "1",
        TerminalBlockSpacing::Comfortable => "2",
    };
    template
        .replace(GAP_TOKEN, gap)
        .replace(MARK_TOKEN, &version_stamp(template))
        .replace(SETTINGS_TOKEN, &settings_literal(shell))
}

const POWERSHELL_INTEGRATION: &str = r##"
# --- CortX shell integration (OSC 7 / OSC 133) — active only inside a CortX terminal ---
if ($env:CORTX_TERMINAL_ID) {
    $global:__cortx_ran = $false
    # How many blank lines between a command's output and the next prompt
    # 0 = compact, 1 = normal, 2 = comfortable (settings.terminal.blockSpacing).
    # Seeded with the value this block was generated with, then re-read from
    # the settings file after every command: a shell that is already open has
    # to follow a change to the setting too, and nothing else in the session
    # ever goes back to ask.
    $global:__cortx_gap = __CORTX_GAP__
    $global:__cortx_gap_file = __CORTX_SETTINGS__
    $global:__cortx_gap_stamp = ''
    function global:__cortx_read_gap {
        if (-not $global:__cortx_gap_file) { return }
        try {
            $f = Get-Item -LiteralPath $global:__cortx_gap_file -ErrorAction Stop
            $stamp = "$($f.LastWriteTimeUtc.Ticks)/$($f.Length)"
            if ($stamp -eq $global:__cortx_gap_stamp) { return }
            $global:__cortx_gap_stamp = $stamp
            $raw = [IO.File]::ReadAllText($f.FullName)
            if ($raw -match '"blockSpacing"\s*:\s*"(compact|normal|comfortable)"') {
                $v = $matches[1]
                if ($v -eq 'compact') { $global:__cortx_gap = 0 } elseif ($v -eq 'normal') { $global:__cortx_gap = 1 } else { $global:__cortx_gap = 2 }
            }
        } catch { }
    }
    function global:__cortx_urlencode([string]$p) {
        return $p.Replace('%', '%25').Replace(' ', '%20').Replace('#', '%23').Replace('?', '%3F')
    }
    function global:__cortx_wrap_prompt {
        $inner = $function:prompt
        if ($inner) {
            $src = $inner.ToString()
            # Already this exact version of the integration: nothing to do.
            if ($src.Contains('__cortx_marks:__CORTX_MARK__')) { return }
            if ($src.Contains('__cortx_marks')) {
                # A *different* CortX wrapper holds the prompt — the profile's
                # `cortx init` from an older CLI, run before the app injected
                # this block at start-up. Take its place instead of leaving it
                # in charge: the guard used to treat any CortX marker as "mine
                # already", so the oldest producer of the integration won for
                # the whole session and everything a newer one carries — the
                # block spacing, for one — was a dead letter (ticket #41).
                # Its own inner prompt is the user's real one; without it there
                # is nothing safe to re-wrap, so the old wrapper stays.
                if (-not $global:__cortx_inner_prompt) { return }
                $inner = $global:__cortx_inner_prompt
            }
        }
        $global:__cortx_inner_prompt = $inner
        function global:prompt {
            $lastSuccess = $?
            $gle = $global:LASTEXITCODE
            # __cortx_marks:__CORTX_MARK__
            $inner = $global:__cortx_inner_prompt
            $loc = $ExecutionContext.SessionState.Path.CurrentLocation
            $text = if ($inner) { & $inner } else { "PS $loc> " }
            $flat = ($text -join '')
            $e = [char]27; $b = [char]7
            $out = ''
            if ($global:__cortx_ran) {
                $code = if ($lastSuccess) { 0 } elseif ($gle -is [int] -and $gle -ne 0) { $gle } else { 1 }
                $out += "$e]133;D;$code$b"
                $global:__cortx_ran = $false
                __cortx_read_gap
                # The blank rows that separate two blocks. Only after a
                # command actually ran, so the first prompt of a session — and
                # an Enter on an empty line — never opens on a blank row.
                # CR LF and not just LF: a command that ended without a newline
                # of its own leaves the cursor mid-row, and a bare LF would
                # start the prompt in that column.
                if ($global:__cortx_gap -gt 0) {
                    $need = $global:__cortx_gap
                    # A command that ended mid-row (`Write-Host -NoNewline`)
                    # would spend the first CR LF merely *closing* its row
                    # instead of making a blank one, and the gap would come out
                    # a row short. Measured on pwsh 7 under ConPTY the host has
                    # already closed that row by the time it asks for a prompt,
                    # so this reads 0 and adds nothing; it is here for the
                    # hosts that do not (Windows PowerShell 5.1). Either way
                    # the column is a fact, which the prompt string is not.
                    try { if ($Host.UI.RawUI.CursorPosition.X -gt 0) { $need = $need + 1 } } catch { }
                    # And one row fewer when the prompt itself already opens on
                    # a new line (oh-my-posh, starship's add_newline), which
                    # would otherwise add a row on top of the gap. Read off the
                    # prompt the inner function actually returned; a prompt that
                    # writes to the console itself gives an empty string here,
                    # and an empty string asks for no correction, which is the
                    # safe way round.
                    $head = $flat -replace '^(?:\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07)+', ''
                    if ($head -match '^\r?\n') { $need = $need - 1 }
                    for ($i = 0; $i -lt $need; $i++) { $out += "`r`n" }
                }
            }
            if ($loc.Provider.Name -eq 'FileSystem') {
                $p = $loc.ProviderPath -replace '\\', '/'
                if (-not $p.StartsWith('/')) { $p = "/$p" }
                $out += "$e]7;file://localhost$(__cortx_urlencode $p)$b"
            }
            $out += "$e]133;A$b"
            $out += $flat
            $out += "$e]133;B$b"
            $global:LASTEXITCODE = $gle
            return $out
        }
    }
    __cortx_wrap_prompt
    if (Get-Module -Name PSReadLine) {
        Set-PSReadLineKeyHandler -Key Enter -BriefDescription CortXAcceptLine -Description 'Accept the line and mark the command start for CortX' -ScriptBlock {
            $line = $null; $cursor = $null
            [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
            if ($line -and $line.Trim()) {
                $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($line))
                [Console]::Write("$([char]27)]133;C;cmd=$b64$([char]7)")
                $global:__cortx_ran = $true
            }
            __cortx_wrap_prompt
            [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
        }
    }
}
"##;

const BASH_INTEGRATION: &str = r##"
# --- CortX shell integration (OSC 7 / OSC 133) — active only inside a CortX terminal ---
if [ -n "$CORTX_TERMINAL_ID" ] && [ -n "$BASH_VERSION" ]; then
  # How many blank lines between a command's output and the next prompt
  # 0 = compact, 1 = normal, 2 = comfortable (settings.terminal.blockSpacing).
  __cortx_gap=__CORTX_GAP__
  __cortx_gap_file=__CORTX_SETTINGS__
  __cortx_osc() { printf '\033]%s\007' "$1"; }
  __cortx_urlencode() { local s="$1"; s="${s//%/%25}"; s="${s// /%20}"; s="${s//#/%23}"; s="${s//\?/%3F}"; printf '%s' "$s"; }
  # Re-read the setting rather than trusting the value this block was written
  # with: a shell that is already open has to follow a change to
  # `terminal.blockSpacing` too. Builtins only, so it costs no process.
  __cortx_read_gap() {
    [ -r "$__cortx_gap_file" ] || return 0
    local line
    while IFS= read -r line; do
      case "$line" in
        *'"blockSpacing"'*)
          case "$line" in
            *compact*) __cortx_gap=0 ;;
            *comfortable*) __cortx_gap=2 ;;
            *normal*) __cortx_gap=1 ;;
          esac
          break
          ;;
      esac
    done 2>/dev/null < "$__cortx_gap_file"
    return 0
  }
  # The blank line that separates two blocks. Skipped when PS1 already opens
  # on a new line (a two-line prompt), which would otherwise double it.
  __cortx_gap_line() {
    __cortx_read_gap
    local n="$__cortx_gap"
    [ "$n" -gt 0 ] 2>/dev/null || return 0
    case "$PS1" in $'\n'*|'\n'*) n=$((n - 1)) ;; esac
    while [ "$n" -gt 0 ]; do printf '\n'; n=$((n - 1)); done
  }
  __cortx_preexec() {
    [ "$__cortx_mode" = on ] || return 0
    __cortx_mode=off
    [ -n "$COMP_LINE" ] && return 0
    local cmd
    cmd=$(HISTTIMEFORMAT= builtin history 1 2>/dev/null | sed 's/^ *[0-9]* *//')
    [ -z "$cmd" ] && cmd="$BASH_COMMAND"
    __cortx_osc "133;C;cmd=$(printf '%s' "$cmd" | base64 2>/dev/null | tr -d '\n')"
    __cortx_ran=1
  }
  __cortx_precmd() {
    local ec=$?
    # Only after a command really ran: the first prompt of a session, and an
    # Enter on an empty line, must not open on a blank row.
    if [ -n "$__cortx_ran" ]; then __cortx_osc "133;D;$ec"; __cortx_ran=; __cortx_gap_line; fi
    __cortx_osc "7;file://${HOSTNAME:-localhost}$(__cortx_urlencode "$PWD")"
    __cortx_osc "133;A"
  }
  __cortx_precmd_last() {
    case "$PS1" in *'133;B'*) ;; *) PS1="${PS1}"'\[\e]133;B\a\]' ;; esac
    __cortx_mode=on
  }
  # Once per shell, however many times the block is evaluated: the profile's
  # `cortx init` and the app's own start-up injection both run it, and hooking
  # twice means two `133;A` per prompt. The *functions* are redefined either
  # way, so the newest block still wins (ticket #41).
  case "$PROMPT_COMMAND" in
    *__cortx_precmd*) ;;
    *) PROMPT_COMMAND="__cortx_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND};__cortx_precmd_last" ;;
  esac
  trap '__cortx_preexec' DEBUG
fi
"##;

const ZSH_INTEGRATION: &str = r##"
# --- CortX shell integration (OSC 7 / OSC 133) — active only inside a CortX terminal ---
if [[ -n "$CORTX_TERMINAL_ID" && -n "$ZSH_VERSION" ]]; then
  autoload -Uz add-zsh-hook
  # How many blank lines between a command's output and the next prompt
  # 0 = compact, 1 = normal, 2 = comfortable (settings.terminal.blockSpacing).
  __cortx_gap=__CORTX_GAP__
  __cortx_gap_file=__CORTX_SETTINGS__
  __cortx_osc() { printf '\033]%s\007' "$1"; }
  __cortx_urlencode() { local s="$1"; s="${s//\%/%25}"; s="${s// /%20}"; s="${s//\#/%23}"; s="${s//\?/%3F}"; printf '%s' "$s"; }
  # Re-read the setting rather than trusting the value this block was written
  # with: a shell that is already open has to follow a change to
  # `terminal.blockSpacing` too. Builtins only, so it costs no process.
  __cortx_read_gap() {
    [ -r "$__cortx_gap_file" ] || return 0
    local line
    while IFS= read -r line; do
      case "$line" in
        *'"blockSpacing"'*)
          case "$line" in
            *compact*) __cortx_gap=0 ;;
            *comfortable*) __cortx_gap=2 ;;
            *normal*) __cortx_gap=1 ;;
          esac
          break
          ;;
      esac
    done 2>/dev/null < "$__cortx_gap_file"
    return 0
  }
  # The blank line that separates two blocks. Skipped when PS1 already opens
  # on a new line (a two-line prompt), which would otherwise double it.
  __cortx_gap_line() {
    __cortx_read_gap
    local n="$__cortx_gap"
    [[ "$n" -gt 0 ]] || return 0
    [[ "$PS1" == $'\n'* || "$PS1" == '\n'* ]] && n=$((n - 1))
    while [[ "$n" -gt 0 ]]; do printf '\n'; n=$((n - 1)); done
  }
  __cortx_preexec() {
    __cortx_osc "133;C;cmd=$(printf '%s' "$1" | base64 2>/dev/null | tr -d '\n')"
    __cortx_ran=1
  }
  __cortx_precmd() {
    local ec=$?
    # Only after a command really ran: the first prompt of a session, and an
    # Enter on an empty line, must not open on a blank row.
    if [[ -n "$__cortx_ran" ]]; then __cortx_osc "133;D;$ec"; __cortx_ran=; __cortx_gap_line; fi
    __cortx_osc "7;file://${HOST:-localhost}$(__cortx_urlencode "$PWD")"
    __cortx_osc "133;A"
    [[ "$PS1" == *'133;B'* ]] || PS1="${PS1}%{$(printf '\033]133;B\007')%}"
  }
  add-zsh-hook preexec __cortx_preexec
  add-zsh-hook precmd __cortx_precmd
fi
"##;

const FISH_INTEGRATION: &str = r##"
# --- CortX shell integration (OSC 7 / OSC 133) — active only inside a CortX terminal ---
if set -q CORTX_TERMINAL_ID
    # How many blank lines between a command's output and the next prompt
    # 0 = compact, 1 = normal, 2 = comfortable (settings.terminal.blockSpacing).
    set -g __cortx_gap __CORTX_GAP__
    set -g __cortx_gap_file __CORTX_SETTINGS__
    # Re-read the setting rather than trusting the value this block was written
    # with: a shell that is already open has to follow a change to
    # `terminal.blockSpacing` too.
    function __cortx_read_gap
        if test -r "$__cortx_gap_file"
            set -l m (string match -rg '"blockSpacing"\s*:\s*"(compact|normal|comfortable)"' < $__cortx_gap_file)
            if test "$m" = compact
                set -g __cortx_gap 0
            else if test "$m" = normal
                set -g __cortx_gap 1
            else if test "$m" = comfortable
                set -g __cortx_gap 2
            end
        end
    end
    function __cortx_osc
        printf '\033]%s\007' $argv[1]
    end
    function __cortx_urlencode
        string replace -a '%' '%25' -- $argv[1] | string replace -a ' ' '%20' | string replace -a '#' '%23' | string replace -a '?' '%3F'
    end
    function __cortx_preexec --on-event fish_preexec
        set -g __cortx_ran 1
        __cortx_osc "133;C;cmd="(printf '%s' $argv[1] | base64 2>/dev/null | string join '')
    end
    function __cortx_postexec --on-event fish_postexec
        set -l ec $status
        if set -q __cortx_ran
            __cortx_osc "133;D;$ec"
            set -e __cortx_ran
            set -g __cortx_gap_pending 1
        end
    end
    function __cortx_prompt --on-event fish_prompt
        # The blank line that separates two blocks — only after a command
        # really ran, so the first prompt of a session never opens on one.
        # fish gives no cheap way to look at the prompt before it is drawn, so
        # a fish_prompt that starts on a new line of its own doubles the gap;
        # `blockSpacing = compact` is the answer there.
        if set -q __cortx_gap_pending
            set -e __cortx_gap_pending
            __cortx_read_gap
            for __cortx_i in (seq $__cortx_gap)
                printf '\n'
            end
        end
        __cortx_osc "7;file://"(hostname)(__cortx_urlencode $PWD)
        __cortx_osc "133;A"
        __cortx_osc "133;B"
    end
end
"##;

/// Nushell. Three things about the language shape this block, and none of
/// them is a matter of taste:
///
/// 1. **Definitions are parse-time.** A `def` written inside an `if` belongs
///    to that block and is gone when it ends, so the helpers are defined
///    unconditionally and every one of them checks `CORTX_TERMINAL_ID` (or is
///    only ever reached from a hook that does). Outside a CortX terminal the
///    block defines five commands and emits nothing.
/// 2. **One statement per line.** The same block is also typed into a running
///    shell as a *single* line when a sub-shell is warpified
///    ([`subshell_injection`]), and Nushell cannot `eval` a string — `source`
///    resolves its path when the line is parsed, so there is no decoding a
///    base64 payload the way the other four shells do. The only way in is to
///    type the code itself, and the code can only be typed if every statement
///    already fits on one line.
/// 3. **State lives in `$env`.** A `let` at the top level cannot be mutated
///    and a `mut` cannot be captured by a closure, so the flags the hooks
///    hand each other (`__cortx_ran`, the spacing) have to be environment
///    variables. `def --env` is what lets a helper write one.
///
/// The two-producer problem of ticket #41 turns up here in a different shape:
/// hooks are *appended* to a list, so evaluating the block twice would emit
/// every sequence twice. `__cortx_hooked` stops the same version from
/// hooking twice, and `__cortx_owner` — the [`version_stamp`] of this very
/// template — is what an *older* CortX hook compares itself against: the last
/// block to run owns the stamp, and every hook another version installed sees
/// the mismatch and returns without printing. Nushell closures capture the
/// definitions in scope when they were made, so a newer block cannot redefine
/// the old hooks' bodies out from under them; making them bow out is the only
/// thing that works.
const NU_INTEGRATION: &str = r##"
# --- CortX shell integration (OSC 7 / OSC 133) — active only inside a CortX terminal ---
# How many blank lines between a command's output and the next prompt
# 0 = compact, 1 = normal, 2 = comfortable (settings.terminal.blockSpacing).
# Seeded with the value this block was generated with, then re-read from the
# settings file after every command, so a shell that is already open follows a
# change to the setting too.
$env.__cortx_gap = __CORTX_GAP__
$env.__cortx_gap_file = __CORTX_SETTINGS__
# Re-read the setting rather than trusting the value this block was written
# with. An unreadable or half-written file keeps the seeded value: `try` with
# no `catch` is Nushell's "and otherwise, nothing".
def --env __cortx_read_gap [] { if ($env.__cortx_gap_file | is-empty) { return }; try { let v = (open --raw $env.__cortx_gap_file | parse --regex '"blockSpacing"\s*:\s*"(?<v>compact|normal|comfortable)"' | get v.0); $env.__cortx_gap = (if $v == "compact" { 0 } else if $v == "normal" { 1 } else { 2 }) } }
def __cortx_osc [seq: string] { print --no-newline $"\u{1b}]($seq)\u{7}" }
def __cortx_urlencode [p: string] { $p | str replace --all "%" "%25" | str replace --all " " "%20" | str replace --all "#" "%23" | str replace --all "?" "%3F" }
# The command line is read by the hook and handed in, rather than read here:
# `commandline` answers about the prompt that is being submitted, and the hook
# is the only place that is certainly true.
def --env __cortx_preexec [cmd: string] { if ($env.__cortx_owner? | default "") != "__CORTX_MARK__" { return }; __cortx_osc $"133;C;cmd=($cmd | encode base64)"; $env.__cortx_ran = 1 }
# The blank rows that separate two blocks are printed here and only after a
# command really ran, so the first prompt of a session — and an Enter on an
# empty line — never opens on one. Spelled out instead of looped, because a
# Nushell range counts *down* when its end is below its start and `0..0` is
# one step, not none: two `if`s cannot be wrong, and the gap is at most two.
def --env __cortx_precmd [] { if ($env.__cortx_owner? | default "") != "__CORTX_MARK__" { return }; if ($env.__cortx_ran? | default 0) == 1 { __cortx_osc $"133;D;($env.LAST_EXIT_CODE? | default 0)"; $env.__cortx_ran = 0; __cortx_read_gap; if $env.__cortx_gap >= 1 { print --no-newline "\n" }; if $env.__cortx_gap >= 2 { print --no-newline "\n" } }; __cortx_osc $"7;file://localhost(__cortx_urlencode $env.PWD)"; __cortx_osc "133;A"; __cortx_osc "133;B" }
# Last to run owns the stamp; hooks installed by another version of this block
# read it, see someone else's, and stay quiet (ticket #41).
#
# The install-once guard carries the process id as well as the version,
# because everything Nushell keeps here is an *environment* variable — it has
# no other kind — and a nested `nu` inherits all of them. Without the pid, the
# child would read "already hooked" off its parent and install nothing, in a
# shell that has no hooks at all.
if ($env.CORTX_TERMINAL_ID? | default "") != "" { $env.__cortx_owner = "__CORTX_MARK__"; if ($env.__cortx_hooked? | default "") != $"__CORTX_MARK__:($nu.pid)" { $env.__cortx_hooked = $"__CORTX_MARK__:($nu.pid)"; $env.__cortx_ran = 0; $env.config.hooks.pre_execution = ($env.config.hooks.pre_execution? | default [] | append {|| __cortx_preexec (commandline) }); $env.config.hooks.pre_prompt = ($env.config.hooks.pre_prompt? | default [] | append {|| __cortx_precmd }) } }
"##;

#[cfg(test)]
mod tests {
    use super::*;

    /// Every shell CortX carries a snippet for. A test that loops over this
    /// rather than over a hand-written list is a test a new shell cannot be
    /// added behind the back of.
    const ALL_SHELLS: [Shell; 5] =
        [Shell::PowerShell, Shell::Bash, Shell::Zsh, Shell::Fish, Shell::Nu];

    #[test]
    fn every_supported_shell_is_reachable_by_name_and_by_program() {
        for name in SUPPORTED_SHELLS {
            let shell = Shell::from_str(name).unwrap_or_else(|| panic!("{name}"));
            assert!(ALL_SHELLS.contains(&shell), "{name}");
            // …and the program the app actually spawns resolves the same way.
            assert_eq!(shell_for_program(name), Some(shell.clone()), "{name}");
        }
        assert_eq!(SUPPORTED_SHELLS.len(), ALL_SHELLS.len());
        assert_eq!(Shell::from_str("nushell"), Some(Shell::Nu));
        assert_eq!(shell_for_program("/usr/local/bin/nu"), Some(Shell::Nu));
        assert_eq!(shell_for_program(r"C:\Program Files\nu\bin\nu.exe"), Some(Shell::Nu));
    }

    /// A shell CortX has no snippet for used to give a terminal with its
    /// features quietly missing and no way to find out why (issue #54).
    #[test]
    fn an_unknown_shell_has_something_to_say_and_a_known_one_does_not() {
        for name in SUPPORTED_SHELLS {
            assert_eq!(unsupported_shell_note(name), None, "{name}");
        }
        assert_eq!(unsupported_shell_note("/bin/zsh"), None);
        assert_eq!(unsupported_shell_note("nu.exe"), None);

        let note = unsupported_shell_note("/usr/bin/xonsh").expect("xonsh is not supported");
        // Names the shell the user is actually running, says what is off, and
        // says what would work instead — the three things a user needs to act.
        assert!(note.contains("xonsh"), "{note}");
        assert!(note.contains("Blocks"), "{note}");
        for name in SUPPORTED_SHELLS {
            assert!(note.contains(name), "{note} does not mention {name}");
        }
        // No path, no extension: the name, as the user thinks of it.
        assert!(!note.contains("/usr/bin"), "{note}");
        assert!(unsupported_shell_note("   ").is_none());
    }

    #[test]
    fn integration_block_is_appended_last_and_guarded() {
        for shell in ALL_SHELLS {
            let a = func_alias("hi", "echo hi");
            let with = generate_init_script(&shell, std::slice::from_ref(&a), true);
            let without = generate_init_script(&shell, std::slice::from_ref(&a), false);
            assert!(with.starts_with(&without), "{:?}", shell);
            assert!(!without.contains("133;A"), "{:?}", shell);
            let snippet = shell_integration_snippet(&shell);
            assert!(with.contains(&shell_integration_block(&shell)), "{:?}", shell);
            assert!(snippet.contains("CORTX_TERMINAL_ID"), "{:?}", shell);
            assert!(snippet.contains("133;A"), "{:?}", shell);
            assert!(snippet.contains("133;C;cmd="), "{:?}", shell);
            assert!(snippet.contains("133;D"), "{:?}", shell);
            assert!(snippet.contains("7;file://"), "{:?}", shell);
        }
    }

    /// Both spacings, because the PowerShell block only survives a
    /// line-by-line `Invoke-Expression` while it is exactly one statement.
    #[test]
    fn powershell_block_is_one_base64_line_that_decodes_to_the_snippet() {
        use base64::Engine;
        for spacing in [
            TerminalBlockSpacing::Normal,
            TerminalBlockSpacing::Compact,
            TerminalBlockSpacing::Comfortable,
        ] {
            let block = shell_integration_block_for(&Shell::PowerShell, spacing);
            let code_lines: Vec<&str> = block.lines().filter(|l| !l.starts_with('#')).collect();
            assert_eq!(code_lines.len(), 1, "{spacing:?}: {block}");
            let line = code_lines[0];
            let start = line.find("FromBase64String('").unwrap() + "FromBase64String('".len();
            let end = line[start..].find('\'').unwrap() + start;
            let decoded = base64::engine::general_purpose::STANDARD.decode(&line[start..end]).unwrap();
            assert_eq!(
                String::from_utf8(decoded).unwrap(),
                shell_integration_snippet_for(&Shell::PowerShell, spacing)
            );
        }
    }

    // -- Block spacing (DEV-13 #7) ------------------------------------------

    /// The blank line is one flag away, and the flag is the *only* thing the
    /// setting changes: same script, same structure, both ways.
    #[test]
    fn every_shell_carries_the_gap_flag_and_nothing_else_moves() {
        for shell in ALL_SHELLS {
            let on = shell_integration_snippet_for(&shell, TerminalBlockSpacing::Normal);
            let off = shell_integration_snippet_for(&shell, TerminalBlockSpacing::Compact);
            for snippet in [&on, &off] {
                for token in [GAP_TOKEN, SETTINGS_TOKEN, MARK_TOKEN] {
                    assert!(!snippet.contains(token), "{shell:?}: {token} left in place");
                }
                assert!(snippet.contains("__cortx_gap"), "{shell:?}: no spacing flag");
            }
            // Exactly one character apart: the digit the counter starts at.
            // (Spelled out as a diff rather than a `replace`, because the
            // re-read helper mentions every value the setting can take.)
            assert_eq!(on.len(), off.len(), "{shell:?}");
            let diffs: Vec<usize> = on
                .char_indices()
                .zip(off.chars())
                .filter(|((_, a), b)| a != b)
                .map(|((i, _), _)| i)
                .collect();
            assert_eq!(diffs.len(), 1, "{shell:?}: the setting changed more than the flag");
            let line = on[..diffs[0]].rfind('\n').map(|i| i + 1).unwrap_or(0);
            assert!(
                on[line..diffs[0]].contains("__cortx_gap"),
                "{shell:?}: the character that moved is not the spacing flag"
            );
        }
    }

    /// The spacing is not frozen at start-up: every snippet knows where the
    /// settings file is and goes back to it after a command, so a shell that
    /// is already open follows a change to `terminal.blockSpacing` too
    /// (ticket #41).
    #[test]
    fn every_shell_re_reads_the_spacing_from_the_settings_file() {
        for shell in ALL_SHELLS {
            let snippet = shell_integration_snippet_for(&shell, TerminalBlockSpacing::Normal);
            assert!(snippet.contains("__cortx_read_gap"), "{shell:?}: no re-read");
            assert!(snippet.contains("__cortx_gap_file"), "{shell:?}: no settings path");
            assert!(snippet.contains("blockSpacing"), "{shell:?}: the key is not looked for");
            // Every value the setting can take is understood, or a mode would
            // silently keep whatever the shell started with.
            for value in ["compact", "normal", "comfortable"] {
                assert!(snippet.contains(value), "{shell:?}: {value} not handled");
            }
            // The path is a quoted literal, not a bare word: it holds spaces
            // on every Windows machine. Single quotes everywhere except
            // Nushell, whose single quotes cannot hold a `'` at all (see
            // [`quoted_path`]) — there the literal is a double-quoted one.
            let literal = settings_literal(&shell);
            let opener = if shell == Shell::Nu { '"' } else { '\'' };
            assert!(literal.starts_with(opener), "{shell:?}: {literal}");
            assert!(literal.ends_with(opener), "{shell:?}: {literal}");
            assert!(snippet.contains(&literal), "{shell:?}: {literal} not embedded");
        }
        // bash and zsh match the value with globs (`*compact*`), which only
        // stays honest while no value contains another. `comfortable` and
        // `compact` share three letters and are one edit away from the bug.
        let values = ["compact", "normal", "comfortable"];
        for a in values {
            for b in values {
                assert!(a == b || !a.contains(b), "{b} hides inside {a}: the glob match would lie");
            }
        }
    }

    /// The PowerShell wrapper must be able to tell *its own* version from
    /// another CortX wrapper, and take over from the other one — otherwise the
    /// first block to reach the shell (the profile's `cortx init`, from
    /// whatever CLI happens to be installed) owns the prompt for the whole
    /// session and everything a newer block carries is dead (ticket #41).
    #[test]
    fn a_foreign_cortx_wrapper_is_taken_over_not_deferred_to() {
        let pwsh = shell_integration_snippet_for(&Shell::PowerShell, TerminalBlockSpacing::Normal);
        let stamp = version_stamp(POWERSHELL_INTEGRATION);
        assert_eq!(stamp.len(), 16, "{stamp}");
        // The stamp is in the marker the prompt carries *and* in the guard, so
        // the guard recognises a prompt this very snippet installed.
        let mark = format!("__cortx_marks:{stamp}");
        assert_eq!(pwsh.matches(&mark).count(), 2, "{pwsh}");
        assert!(pwsh.contains(&format!("$src.Contains('{mark}')")), "{pwsh}");
        // …and an older marker (no stamp) is inherited from, not deferred to.
        assert!(pwsh.contains("$inner = $global:__cortx_inner_prompt"), "{pwsh}");
        // The marker still sits inside the prompt function, which is the only
        // thing `$function:prompt.ToString()` can be searched for.
        let body = pwsh.find("function global:prompt {").unwrap();
        assert!(pwsh[body..].contains(&mark), "{pwsh}");
    }

    /// The stamp says "this integration code", not "this spacing": it is taken
    /// from the template, so the three spacings are the same version and a
    /// terminal does not re-wrap its prompt just because the setting moved.
    #[test]
    fn the_version_stamp_is_the_same_for_every_spacing_and_stable() {
        let a = shell_integration_snippet_for(&Shell::PowerShell, TerminalBlockSpacing::Compact);
        let b = shell_integration_snippet_for(&Shell::PowerShell, TerminalBlockSpacing::Comfortable);
        let stamp = version_stamp(POWERSHELL_INTEGRATION);
        assert!(a.contains(&stamp) && b.contains(&stamp));
        // FNV-1a, spelled out: the same text must hash the same in every build
        // of CortX, for ever, or two builds would fight over the prompt.
        assert_eq!(version_stamp(""), "cbf29ce484222325");
        assert_eq!(version_stamp("a"), "af63dc4c8601ec8c");
        assert_ne!(version_stamp("a"), version_stamp("b"));
    }

    /// The stamp is only worth carrying if it is *stable* for one text and
    /// *moves* for another: a wrapper compares it against its own to decide
    /// whether the prompt it is looking at is already its work. Stable-but-
    /// colliding and moving-but-unstable are both fatal — the first leaves an
    /// older integration in charge, the second re-wraps the prompt at every
    /// single command.
    #[test]
    fn the_version_stamp_is_stable_for_one_text_and_moves_for_another() {
        // Stable: the same text, hashed again, and hashed a third time after
        // other work. Nothing in it may depend on process state.
        assert_eq!(version_stamp(POWERSHELL_INTEGRATION), version_stamp(POWERSHELL_INTEGRATION));
        let once = version_stamp(POWERSHELL_INTEGRATION);
        let _ = version_stamp(BASH_INTEGRATION);
        assert_eq!(once, version_stamp(POWERSHELL_INTEGRATION));

        // Moves: every template is its own version, and so is the *same*
        // template with one character changed — which is the case that
        // matters, because that is what a real edit to the snippet looks like.
        let templates = [
            POWERSHELL_INTEGRATION,
            BASH_INTEGRATION,
            ZSH_INTEGRATION,
            FISH_INTEGRATION,
            NU_INTEGRATION,
        ];
        let stamps: Vec<String> = templates.iter().map(|t| version_stamp(t)).collect();
        for (i, a) in stamps.iter().enumerate() {
            for b in stamps.iter().skip(i + 1) {
                assert_ne!(a, b, "two templates share a version");
            }
        }
        let edited = POWERSHELL_INTEGRATION.replacen("__cortx_ran", "__cortx_RAN", 1);
        assert_ne!(version_stamp(&edited), once, "an edit to the snippet kept its version");
        // A fixed width, because it goes into the marker verbatim.
        for stamp in &stamps {
            assert_eq!(stamp.len(), 16, "{stamp}");
            assert!(stamp.chars().all(|c| c.is_ascii_hexdigit()), "{stamp}");
        }
    }

    /// The settings path goes into the snippet as a *literal*, in the quoting
    /// of the shell it is written for. It is `C:\Users\Alexis Munch\…` on
    /// every Windows machine — a space, and backslashes that a double-quoted
    /// literal would have eaten — so single quotes are the only safe form, and
    /// the one character they cannot hold has to be escaped each shell's way.
    #[test]
    fn the_settings_path_is_quoted_the_way_each_shell_quotes() {
        use std::path::Path;
        let windows = Path::new(r"C:\Users\Alexis Munch\AppData\Roaming\cortx\Cortx\data\settings.json");
        let unix = Path::new("/home/alexis/.local/share/cortx/settings.json");
        // A `'` in the path: the one character that can close the literal and
        // let the rest of the path run as code.
        let quoted = Path::new("/home/o'brien/.local/share/cortx/settings.json");

        for shell in [Shell::PowerShell, Shell::Bash, Shell::Zsh, Shell::Fish] {
            for path in [windows, unix] {
                let lit = quoted_path(&shell, Some(path));
                let raw = path.to_string_lossy();
                // Whole thing in one pair of single quotes, nothing escaped:
                // no shell expands anything in there, backslash included.
                assert_eq!(lit, format!("'{raw}'"), "{shell:?}");
            }
        }
        for shell in ALL_SHELLS {
            // The space and the backslashes came through untouched.
            let lit = quoted_path(&shell, Some(windows));
            assert!(lit.contains("Alexis Munch"), "{shell:?}: {lit}");
            let kept = if shell == Shell::Nu { r"\\AppData\\" } else { r"\AppData\" };
            assert!(lit.contains(kept), "{shell:?}: {lit}");
            // Every `'` is escaped — or, for Nushell, put where it needs no
            // escaping — and the literal still opens and closes exactly once
            // as far as the shell is concerned.
            let lit = quoted_path(&shell, Some(quoted));
            assert!(lit.contains("o") && lit.contains("brien"), "{shell:?}: {lit}");
            if shell != Shell::Nu {
                assert!(!lit.contains("o'brien"), "{shell:?}: bare quote left in {lit}");
            }
        }

        // PowerShell doubles the quote; the POSIX shells (and fish, which
        // takes the same `\'` outside the quotes) close, escape and reopen.
        assert_eq!(
            quoted_path(&Shell::PowerShell, Some(quoted)),
            "'/home/o''brien/.local/share/cortx/settings.json'"
        );
        for shell in [Shell::Bash, Shell::Zsh, Shell::Fish] {
            assert_eq!(
                quoted_path(&shell, Some(quoted)),
                r"'/home/o'\''brien/.local/share/cortx/settings.json'",
                "{shell:?}"
            );
        }
        // Nushell is the odd one out, and has to be: its single quotes are
        // strictly literal, so a path containing `'` cannot go inside them by
        // any escape — the string just ends there. A double-quoted literal
        // holds it, at the price of doubling every backslash.
        assert_eq!(
            quoted_path(&Shell::Nu, Some(quoted)),
            "\"/home/o'brien/.local/share/cortx/settings.json\""
        );
        assert_eq!(
            quoted_path(&Shell::Nu, Some(windows)),
            "\"C:\\\\Users\\\\Alexis Munch\\\\AppData\\\\Roaming\\\\cortx\\\\Cortx\\\\data\\\\settings.json\""
        );
        // A `"` in the path would otherwise close it and let the rest run.
        assert_eq!(
            nu_string(r#"a"b\c"#),
            r#""a\"b\\c""#
        );
    }

    /// No settings file to point at — a machine that has never opened the
    /// settings — must still produce a snippet that *runs*. The literal is
    /// empty and every re-read helper bows out on it, keeping the spacing the
    /// block was generated with rather than erroring at every prompt.
    #[test]
    fn without_a_settings_file_the_literal_is_empty_and_the_snippet_still_stands() {
        for shell in ALL_SHELLS {
            let empty = if shell == Shell::Nu { "\"\"" } else { "''" };
            assert_eq!(quoted_path(&shell, None), empty, "{shell:?}");
            let template = match shell {
                Shell::PowerShell => POWERSHELL_INTEGRATION,
                Shell::Bash => BASH_INTEGRATION,
                Shell::Zsh => ZSH_INTEGRATION,
                Shell::Fish => FISH_INTEGRATION,
                Shell::Nu => NU_INTEGRATION,
            };
            let snippet = template.replace(GAP_TOKEN, "2").replace(MARK_TOKEN, "0").replace(
                SETTINGS_TOKEN,
                &quoted_path(&shell, None),
            );
            assert!(!snippet.contains(SETTINGS_TOKEN), "{shell:?}");
            // The assignment is still an assignment, not a syntax hole.
            let assignment = match shell {
                Shell::PowerShell => "$global:__cortx_gap_file = ''",
                Shell::Fish => "set -g __cortx_gap_file ''",
                Shell::Nu => "$env.__cortx_gap_file = \"\"",
                _ => "__cortx_gap_file=''",
            };
            assert!(snippet.contains(assignment), "{shell:?}: {assignment} missing");
            // …and the helper refuses to read it rather than reading `''`.
            let bail = match shell {
                Shell::PowerShell => "if (-not $global:__cortx_gap_file) { return }",
                Shell::Fish => r#"if test -r "$__cortx_gap_file""#,
                Shell::Nu => "if ($env.__cortx_gap_file | is-empty) { return }",
                _ => r#"[ -r "$__cortx_gap_file" ] || return 0"#,
            };
            assert!(snippet.contains(bail), "{shell:?}: no guard on an empty path");
        }
    }

    /// A command that ended mid-row (`Write-Host -NoNewline`) would spend the
    /// first CR LF closing its row rather than making a blank one, and the gap
    /// would come out a row short. The cursor column is the only thing that
    /// knows — measured on pwsh 7 under ConPTY the host has already closed the
    /// row and it reads 0, but a host that has not is exactly the case this
    /// covers, and a fact is a better basis than the prompt string.
    #[test]
    fn the_gap_counts_rows_not_newlines() {
        let pwsh = shell_integration_snippet_for(&Shell::PowerShell, TerminalBlockSpacing::Normal);
        assert!(pwsh.contains("$Host.UI.RawUI.CursorPosition.X -gt 0"), "{pwsh}");
        // Guarded: a host without a real console throws on the cursor.
        let at = pwsh.find("$Host.UI.RawUI.CursorPosition.X").unwrap();
        let line_start = pwsh[..at].rfind('\n').unwrap() + 1;
        assert!(pwsh[line_start..at].trim_start().starts_with("try {"), "{pwsh}");
    }

    /// Evaluating the bash block twice — the profile's `cortx init` and the
    /// app's start-up injection both do — must not hook the prompt twice.
    #[test]
    fn the_bash_hook_is_installed_once_however_often_the_block_runs() {
        let bash = shell_integration_snippet_for(&Shell::Bash, TerminalBlockSpacing::Normal);
        let guard = bash.find("*__cortx_precmd*)").unwrap();
        let install = bash.find("PROMPT_COMMAND=\"__cortx_precmd").unwrap();
        assert!(guard < install, "{bash}");
    }

    /// Guarded on a command having run, so the first prompt of a session — and
    /// an Enter on an empty line — never opens on a blank row. Every shell
    /// prints the line from the branch that also emits `133;D`.
    #[test]
    fn the_blank_line_is_only_printed_after_a_command_ran() {
        // PowerShell: inside the `if ($global:__cortx_ran)` block, after `D`.
        let pwsh = shell_integration_snippet_for(&Shell::PowerShell, TerminalBlockSpacing::Normal);
        let ran = pwsh.find("if ($global:__cortx_ran) {").unwrap();
        let d = pwsh.find("133;D;$code").unwrap();
        let gap = pwsh.find("$out += \"`r`n\"").unwrap();
        let a = pwsh.find("133;A").unwrap();
        assert!(ran < d && d < gap && gap < a, "pwsh: {pwsh}");

        // bash / zsh: `__cortx_gap_line` on the same line as `133;D`.
        for shell in [Shell::Bash, Shell::Zsh] {
            let snippet = shell_integration_snippet_for(&shell, TerminalBlockSpacing::Normal);
            let line = snippet
                .lines()
                .find(|l| l.contains("133;D;$ec"))
                .unwrap_or_else(|| panic!("{shell:?}: no D"));
            assert!(line.contains("__cortx_ran"), "{shell:?}: {line}");
            assert!(line.contains("__cortx_gap_line"), "{shell:?}: {line}");
        }

        // fish emits `D` from fish_postexec and the prompt from another hook,
        // so the flag is handed from one to the other.
        let fish = shell_integration_snippet_for(&Shell::Fish, TerminalBlockSpacing::Normal);
        assert!(fish.contains("set -g __cortx_gap_pending 1"), "{fish}");
        assert!(fish.contains("set -e __cortx_gap_pending"), "{fish}");

        // Nushell: `D`, the flag and the blank rows are one statement in
        // `__cortx_precmd`, all inside the `__cortx_ran` branch, and `A`
        // comes after it.
        let nu = shell_integration_snippet_for(&Shell::Nu, TerminalBlockSpacing::Normal);
        let ran = nu.find("if ($env.__cortx_ran? | default 0) == 1 {").unwrap();
        let d = nu.find("133;D;($env.LAST_EXIT_CODE").unwrap();
        let gap = nu.find("if $env.__cortx_gap >= 1 {").unwrap();
        let a = nu.find(r#"__cortx_osc "133;A""#).unwrap();
        assert!(ran < d && d < gap && gap < a, "nu: {nu}");
        // Counted out rather than looped: `for _ in 1..$n` in Nushell walks
        // *backwards* when `n` is below the start, so a gap of 0 would print
        // two blank rows instead of none.
        assert!(nu.contains("if $env.__cortx_gap >= 2 {"), "{nu}");
        assert!(!nu.contains("seq $env.__cortx_gap"), "{nu}");
    }

    /// Nushell hooks are *appended* to a list, and the block is evaluated
    /// twice on a normal start-up (the profile's `cortx init`, then the app's
    /// own injection). Hooking twice would print every sequence twice, and
    /// deferring to whatever hooked first is what ticket #41 was: the oldest
    /// integration winning. So the newest block takes the stamp, and hooks
    /// belonging to any other version read it and return.
    #[test]
    fn the_nu_hooks_are_installed_once_and_the_newest_block_owns_them() {
        let nu = shell_integration_snippet_for(&Shell::Nu, TerminalBlockSpacing::Normal);
        let stamp = version_stamp(NU_INTEGRATION);
        assert_eq!(stamp.len(), 16, "{stamp}");

        // Claimed by the owner, compared in both hooks, and claimed and
        // compared again by the install-once guard: five mentions in all.
        assert_eq!(nu.matches(&stamp).count(), 5, "{nu}");
        assert!(nu.contains(&format!("$env.__cortx_owner = \"{stamp}\"")), "{nu}");
        for hook in ["__cortx_preexec", "__cortx_precmd"] {
            let at = nu.find(&format!("def --env {hook} [")).unwrap();
            let body = &nu[at..];
            let guard = body
                .find(&format!("if ($env.__cortx_owner? | default \"\") != \"{stamp}\" {{ return }}"))
                .unwrap_or_else(|| panic!("{hook} does not check the stamp: {nu}"));
            // …and it checks before it prints anything.
            assert!(guard < body.find("__cortx_osc").unwrap(), "{hook}: {nu}");
        }
        // The same version, evaluated twice in the same process, hooks once —
        // and a nested `nu`, which inherits every one of these variables
        // because Nushell has no other kind, is *not* the same process and
        // hooks itself.
        assert!(
            nu.contains(&format!(
                "if ($env.__cortx_hooked? | default \"\") != $\"{stamp}:($nu.pid)\""
            )),
            "{nu}"
        );
        assert!(nu.contains(&format!("$env.__cortx_hooked = $\"{stamp}:($nu.pid)\"")), "{nu}");
        let hooked = nu.find("$env.__cortx_hooked =").unwrap();
        let append = nu.find("$env.config.hooks.pre_execution =").unwrap();
        assert!(hooked < append, "the guard is set after the hooks: {nu}");
        // Both hooks, and neither replaces what the user already had.
        assert!(nu.contains("$env.config.hooks.pre_prompt = ($env.config.hooks.pre_prompt? | default [] | append"), "{nu}");
        assert!(nu.contains("$env.config.hooks.pre_execution = ($env.config.hooks.pre_execution? | default [] | append"), "{nu}");
    }

    /// Nushell resolves `def` at parse time, and a definition made inside an
    /// `if` block dies with the block — so the helpers have to sit at the top
    /// level, and the guard has to be somewhere else. It is: in the hooks,
    /// which are the only things that print.
    #[test]
    fn the_nu_helpers_are_defined_at_the_top_level_and_still_guarded() {
        let nu = shell_integration_snippet_for(&Shell::Nu, TerminalBlockSpacing::Normal);
        let guard = nu.find(r#"if ($env.CORTX_TERMINAL_ID? | default "") != "" {"#).unwrap();
        for def in ["__cortx_read_gap", "__cortx_osc", "__cortx_urlencode", "__cortx_preexec", "__cortx_precmd"] {
            let at = nu.find(&format!(" {def} [")).unwrap_or_else(|| panic!("{def} is not defined: {nu}"));
            assert!(at < guard, "{def} is defined inside the guard: {nu}");
        }
        // Nothing is emitted outside a CortX terminal all the same: defining
        // a command prints nothing, and the only things that *call* the
        // printing helpers are the two hooks, which are installed behind the
        // guard and nowhere else.
        assert_eq!(nu.matches("$env.config.hooks").count(), 4, "{nu}");
        assert!(nu[guard..].contains("$env.config.hooks.pre_execution ="), "{nu}");
        assert!(nu[guard..].contains("$env.config.hooks.pre_prompt ="), "{nu}");
        // Every statement on its own line, or the sub-shell one-liner
        // ([`subshell_injection`]) could not be built by joining them.
        for line in nu.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
            assert_eq!(
                line.matches('{').count(),
                line.matches('}').count(),
                "a statement spans two lines: {line}"
            );
        }
    }

    /// A prompt that already opens on a new line (oh-my-posh, starship's
    /// `add_newline`) must not get a second one.
    #[test]
    fn a_prompt_that_starts_on_a_new_line_is_left_alone() {
        let pwsh = shell_integration_snippet_for(&Shell::PowerShell, TerminalBlockSpacing::Normal);
        assert!(pwsh.contains("$head -match '^\\r?\\n'"), "{pwsh}");
        for shell in [Shell::Bash, Shell::Zsh] {
            let snippet = shell_integration_snippet_for(&shell, TerminalBlockSpacing::Normal);
            assert!(snippet.contains("$PS1"), "{shell:?}: the prompt is not looked at");
            assert!(snippet.contains("__cortx_gap_line"), "{shell:?}");
        }
    }

    /// A shell script that lost a brace is a broken profile, and the
    /// PowerShell one is evaluated as a single statement, so a stray `{`
    /// takes the whole session down.
    #[test]
    fn the_generated_snippets_stay_structurally_sound() {
        for spacing in [
            TerminalBlockSpacing::Normal,
            TerminalBlockSpacing::Compact,
            TerminalBlockSpacing::Comfortable,
        ] {
            let pwsh = shell_integration_snippet_for(&Shell::PowerShell, spacing);
            assert_eq!(
                pwsh.matches('{').count(),
                pwsh.matches('}').count(),
                "pwsh {spacing:?}: unbalanced braces"
            );
            for shell in [Shell::Bash, Shell::Zsh] {
                let snippet = shell_integration_snippet_for(&shell, spacing);
                assert_eq!(
                    snippet.matches('{').count(),
                    snippet.matches('}').count(),
                    "{shell:?} {spacing:?}: unbalanced braces"
                );
                assert!(snippet.trim_end().ends_with("fi"), "{shell:?}: the guard is not closed");
            }
            // Nushell: braces and parentheses both, because a closure and a
            // pipeline are both delimited and the whole block is also joined
            // into one line for a sub-shell, where a stray opener would eat
            // everything after it.
            // (Not `[]`: the `]` of the OSC introducer itself is a bracket
            // no signature ever opened.)
            let nu = shell_integration_snippet_for(&Shell::Nu, spacing);
            for (open, close) in [('{', '}'), ('(', ')')] {
                assert_eq!(
                    nu.matches(open).count(),
                    nu.matches(close).count(),
                    "nu {spacing:?}: unbalanced {open}{close}"
                );
            }
            let fish = shell_integration_snippet_for(&Shell::Fish, spacing);
            let opens = fish
                .lines()
                .map(str::trim_start)
                .filter(|l| {
                    l.starts_with("function ")
                        || l.starts_with("if ")
                        || l.starts_with("if(")
                        || l.starts_with("for ")
                        || l.starts_with("while ")
                })
                .count();
            let ends = fish.lines().map(str::trim).filter(|l| *l == "end").count();
            assert_eq!(opens, ends, "fish {spacing:?}: unbalanced blocks");
        }
    }

    fn func_alias(name: &str, command: &str) -> ShellAlias {
        ShellAlias::new(name.to_string(), command.to_string())
    }

    #[test]
    fn subshell_injection_is_a_single_space_prefixed_line_per_shell() {
        for shell in ALL_SHELLS {
            let line = subshell_injection(&shell, "shell:abc", InitOptions::default());
            assert!(line.starts_with(' '), "{shell:?}: {line}");
            assert!(!line.contains('\n'), "{shell:?}: {line}");
            assert!(line.contains("shell:abc"), "{shell:?}: {line}");
            assert!(line.contains("CORTX_TERMINAL_ID"), "{shell:?}: {line}");
        }
    }

    #[test]
    fn subshell_injection_carries_the_whole_block() {
        use base64::Engine;
        for shell in [Shell::PowerShell, Shell::Bash, Shell::Zsh, Shell::Fish] {
            let line = subshell_injection(&shell, "shell:abc", InitOptions::default());
            let b64 = base64::engine::general_purpose::STANDARD.encode(shell_integration_snippet(&shell).as_bytes());
            assert!(line.contains(&b64), "{shell:?} does not carry its own snippet");
        }
    }

    /// Nushell is the one shell the base64 payload cannot reach: it has no
    /// `eval`, and `source` resolves its path when the line is *parsed* —
    /// before anything on that line has run — so a file written by the same
    /// line can never be sourced by it. The code itself is what gets typed,
    /// which only works because every statement of the block fits on one
    /// line; joining them with `;` has to give back the whole block.
    #[test]
    fn the_nu_subshell_line_carries_the_code_itself() {
        let line = subshell_injection(&Shell::Nu, "shell:abc", InitOptions::default());
        let snippet = shell_integration_snippet(&Shell::Nu);
        let statements: Vec<&str> = snippet
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .collect();
        assert!(statements.len() >= 6, "{statements:?}");
        for statement in &statements {
            assert!(line.contains(statement), "missing from the line: {statement}");
        }
        assert!(line.contains(&statements.join("; ")), "{line}");
        // Nothing to decode and nothing to source on the far side: the two
        // things Nushell cannot do from a line it is currently running.
        assert!(!line.contains("decode base64"), "{line}");
        assert!(!line.contains("source "), "{line}");
    }

    #[test]
    fn subshell_injection_quotes_a_hostile_terminal_id() {
        let line = subshell_injection(&Shell::Bash, "shell:'; rm -rf /; #", InitOptions::default());
        // The quote is closed, escaped and reopened, so the rest stays a
        // literal value instead of becoming a second command.
        assert!(line.contains(r#"CORTX_TERMINAL_ID='shell:'\''; rm -rf /; #'"#), "{line}");
        let pwsh = subshell_injection(&Shell::PowerShell, "shell:'; rm x", InitOptions::default());
        assert!(pwsh.contains("$env:CORTX_TERMINAL_ID = 'shell:''; rm x'"), "{pwsh}");
        // Nushell reads `"` and `\` inside a double-quoted literal, and only
        // those two; a `'` is ordinary text there.
        let nu = subshell_injection(&Shell::Nu, r#"shell:"; rm x"#, InitOptions::default());
        assert!(nu.contains(r#"$env.CORTX_TERMINAL_ID = "shell:\"; rm x""#), "{nu}");
        let nu = subshell_injection(&Shell::Nu, "shell:'; rm x", InitOptions::default());
        assert!(nu.contains(r#"$env.CORTX_TERMINAL_ID = "shell:'; rm x""#), "{nu}");
    }

    /// Nushell's alias: `--wrapped` is what lets the rest of the line through
    /// untouched, flags included, the way `"$@"` and `@args` do elsewhere.
    #[test]
    fn nu_aliases_wrap_the_command_and_pass_everything_through() {
        let a = func_alias("onepack", r#"bun run script.ts"#);
        let out = generate_init_script(&Shell::Nu, std::slice::from_ref(&a), false);
        assert!(
            out.contains("def --wrapped onepack [...rest] { bun run script.ts ...$rest }"),
            "got: {out}"
        );
        // A quoted command word is a *value* in Nushell, not something to
        // run — `^` is its call operator, for the same reason PowerShell
        // needs `&`.
        let a = func_alias("payledger", r#""/opt/a b/payledger""#);
        let out = generate_init_script(&Shell::Nu, std::slice::from_ref(&a), false);
        assert!(out.contains(r#"{ ^"/opt/a b/payledger" ...$rest }"#), "got: {out}");
        assert!(!out.contains("^^"), "got: {out}");
    }

    /// Nushell has no `eval`, so an `init` alias (`starship init …`) cannot be
    /// run through one. The documented way — the one starship and zoxide give
    /// their Nushell users — is to write the generated code where the *next*
    /// shell autoloads it.
    #[test]
    fn nu_init_aliases_are_written_to_the_autoload_directory() {
        let mut a = func_alias("starship", "starship init nu");
        a.alias_type = "init".to_string();
        a.script = Some(std::collections::HashMap::from([
            ("nu".to_string(), "starship init nu".to_string()),
        ]));
        let out = generate_init_script(&Shell::Nu, std::slice::from_ref(&a), false);
        assert!(out.contains(r#"mkdir ($nu.data-dir | path join "vendor" "autoload")"#), "got: {out}");
        assert!(
            out.contains(r#"starship init nu | save --force ($nu.data-dir | path join "vendor" "autoload" "starship.nu")"#),
            "got: {out}"
        );
        // Not an eval, and not a `source` of something that does not exist
        // yet at parse time.
        assert!(!out.contains("| source"), "got: {out}");
    }

    #[test]
    fn powershell_subshell_injection_can_add_the_psreadline_guard() {
        let opts = InitOptions { shell_integration: true, disable_shell_predictions: true };
        let line = subshell_injection(&Shell::PowerShell, "shell:abc", opts);
        assert!(line.contains("Set-PSReadLineOption"), "{line}");
        assert!(!line.contains('\n'), "{line}");
    }

    #[test]
    fn powershell_quoted_command_gets_the_call_operator() {
        let a = func_alias("payledger", r#""C:\Users\Alexis Munch\payledger.exe""#);
        let out = generate_init_script(&Shell::PowerShell, std::slice::from_ref(&a), false);
        assert!(
            out.contains(r#"function payledger { & "C:\Users\Alexis Munch\payledger.exe" @args }"#),
            "got: {out}"
        );
    }

    #[test]
    fn powershell_bare_command_is_left_alone() {
        // Starts with a command word: already command mode, `&` would be noise.
        let a = func_alias("onepack", r#"bun run "C:\a b\x.ts""#);
        let out = generate_init_script(&Shell::PowerShell, std::slice::from_ref(&a), false);
        assert!(
            out.contains(r#"function onepack { bun run "C:\a b\x.ts" @args }"#),
            "got: {out}"
        );
        assert!(!out.contains("{ &"), "got: {out}");
    }

    #[test]
    fn powershell_existing_call_operator_is_not_doubled() {
        let a = func_alias("zorg", r#"& "C:\a b\zorg.exe""#);
        let out = generate_init_script(&Shell::PowerShell, std::slice::from_ref(&a), false);
        assert!(out.contains(r#"{ & "C:\a b\zorg.exe" @args }"#), "got: {out}");
        assert!(!out.contains("& &"), "got: {out}");
    }

    #[test]
    fn posix_shells_need_no_call_operator() {
        // In sh and fish a quoted string is a perfectly good command word.
        let a = func_alias("payledger", r#""/opt/a b/payledger""#);
        let bash = generate_init_script(&Shell::Bash, std::slice::from_ref(&a), false);
        assert!(bash.contains(r#"payledger() { "/opt/a b/payledger" "$@"; }"#), "got: {bash}");
        let fish = generate_init_script(&Shell::Fish, std::slice::from_ref(&a), false);
        assert!(fish.contains(r#""/opt/a b/payledger" $argv"#), "got: {fish}");
    }
}
