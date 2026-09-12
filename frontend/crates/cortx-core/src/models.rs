use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Re-exported so `models::AgentsSettings` works alongside `agents::AgentsSettings`.
pub use crate::agents::AgentsSettings;

// ============================================================================
// Optional-text helpers
// ============================================================================

/// Normalize an optional text field coming from a *create* payload:
/// trims, and turns a blank value into `None`.
pub fn opt_text(value: Option<String>) -> Option<String> {
    opt_text_patch(value).flatten()
}

/// Interpret an optional text field coming from an *update* payload.
///
/// Update inputs use a single `Option`, where `None` means "field absent —
/// keep the current value". That alone makes a field impossible to clear, so
/// every surface sends an empty string to mean "clear it":
///
/// - `None` → `None`: no change.
/// - `Some("")` (or whitespace only) → `Some(None)`: clear the field.
/// - `Some(text)` → `Some(Some(trimmed))`: set the field.
pub fn opt_text_patch(value: Option<String>) -> Option<Option<String>> {
    value.map(|v| {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[cfg(test)]
mod opt_text_tests {
    use super::*;

    #[test]
    fn absent_field_is_no_change() {
        assert_eq!(opt_text_patch(None), None);
    }

    #[test]
    fn blank_field_clears() {
        assert_eq!(opt_text_patch(Some(String::new())), Some(None));
        assert_eq!(opt_text_patch(Some("   ".to_string())), Some(None));
    }

    #[test]
    fn text_is_trimmed_and_set() {
        assert_eq!(
            opt_text_patch(Some("  Active  ".to_string())),
            Some(Some("Active".to_string()))
        );
    }

    #[test]
    fn create_path_flattens_blanks_to_none() {
        assert_eq!(opt_text(Some("  ".to_string())), None);
        assert_eq!(opt_text(None), None);
        assert_eq!(opt_text(Some(" Active ".to_string())), Some("Active".to_string()));
    }
}

// ============================================================================
// Existing models (extracted from frontend/src-tauri/src/models.rs)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub name: String,
    pub working_dir: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modes: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra_args: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arg_presets: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_arg_preset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_vars: Option<HashMap<String, String>>,
    pub order: u32,
}

impl Service {
    pub fn new(name: String, working_dir: String, command: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            working_dir,
            command,
            modes: None,
            default_mode: None,
            extra_args: None,
            arg_presets: None,
            default_arg_preset: None,
            color: None,
            port: None,
            env_vars: None,
            order: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Script {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script_path: Option<String>,
    pub working_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub linked_service_ids: Vec<String>,
    pub order: u32,
}

impl Script {
    pub fn new(name: String, working_dir: String, command: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            description: None,
            command,
            script_path: None,
            working_dir,
            color: None,
            linked_service_ids: Vec::new(),
            order: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<DateTime<Utc>>,
    pub services: Vec<Service>,
    #[serde(default)]
    pub scripts: Vec<Script>,
    #[serde(default)]
    pub env_files: Vec<EnvFile>,
    #[serde(default)]
    pub env_files_discovered: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub toolbox_url: Option<String>,
    /// Pinned by the user: favorites are listed first and can be filtered on.
    #[serde(default)]
    pub favorite: bool,
}

impl Project {
    pub fn new(name: String, root_path: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            root_path,
            description: None,
            image_path: None,
            created_at: now,
            updated_at: now,
            last_opened_at: None,
            services: Vec::new(),
            scripts: Vec::new(),
            env_files: Vec::new(),
            env_files_discovered: false,
            tags: Vec::new(),
            status: None,
            toolbox_url: None,
            favorite: false,
        }
    }

    /// Clone with every `env_files[].variables[].value` cleared.
    ///
    /// Must be called before serializing a Project to any external surface
    /// (CLI `--json`, MCP tool result, `export_scripts_config`). Keeps the
    /// keys, line numbers, and file paths — only the secret values are
    /// stripped. Tauri IPC for the local GUI does **not** sanitize, because
    /// the GUI displays env values on the user's own machine.
    pub fn sanitized_for_output(&self) -> Self {
        let mut clone = self.clone();
        for env_file in &mut clone.env_files {
            for var in &mut env_file.variables {
                var.value.clear();
            }
        }
        clone
    }
}

// Environment file models

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVariable {
    pub key: String,
    pub value: String,
    pub line_number: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EnvFileVariant {
    Base,
    Local,
    Development,
    Production,
    Test,
    Staging,
    Example,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvFile {
    pub id: String,
    pub path: String,
    pub relative_path: String,
    pub filename: String,
    pub variant: EnvFileVariant,
    pub variables: Vec<EnvVariable>,
    pub is_manually_added: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_service_id: Option<String>,
    pub discovered_at: DateTime<Utc>,
    pub last_read_at: DateTime<Utc>,
}

impl EnvFile {
    pub fn new(
        path: String,
        relative_path: String,
        filename: String,
        variant: EnvFileVariant,
        variables: Vec<EnvVariable>,
        is_manually_added: bool,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            path,
            relative_path,
            filename,
            variant,
            variables,
            is_manually_added,
            linked_service_id: None,
            discovered_at: now,
            last_read_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvComparison {
    pub base_file_id: String,
    pub example_file_id: String,
    pub missing_in_base: Vec<String>,
    pub extra_in_base: Vec<String>,
    pub common_keys: Vec<String>,
}

/// Deserialize a string-valued enum without letting an unknown value take the
/// whole settings file down.
///
/// The app and the `cortx` CLI are installed separately and a newer CortX may
/// write a variant an older binary has never heard of. Refusing to parse then
/// stops the app from starting and breaks every shell whose profile calls
/// `cortx init` — which is exactly what `preset: cortxterminal` did. An
/// unknown value falls back to the default instead; the next save rewrites it.
fn lenient_enum<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    use serde::de::IntoDeserializer;
    let raw = String::deserialize(deserializer)?;
    let value: serde::de::value::StringDeserializer<serde::de::value::Error> = raw.into_deserializer();
    Ok(T::deserialize(value).unwrap_or_default())
}

// Terminal configuration

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TerminalPreset {
    WindowsTerminal,
    PowerShell,
    Cmd,
    Warp,
    MacTerminal,
    ITerm2,
    Custom,
    /// CortX's own Terminal window: "external" launches run in a PTY and
    /// open there instead of in the dock (handled by the GUI, not by
    /// `spawn_in_terminal`).
    CortxTerminal,
}

impl Default for TerminalPreset {
    fn default() -> Self {
        // CortX's own Terminal window, on every platform (ticket #39).
        //
        // This used to be `WindowsTerminal` / `MacTerminal` / `Custom` by
        // target. Two things were wrong with that. On Linux the default was
        // `Custom` with an empty `custom_path`, so "launch outside the app"
        // did nothing at all on a fresh install. And on the other two it sent
        // the user straight out of the app that ships a terminal window of its
        // own — blocks, shell integration, themes and all — to a program that
        // has none of it.
        //
        // It is also the only preset that behaves the same everywhere, which
        // is why the frontend could hard-code `'cortxterminal'` as its own
        // fallback without the two ends disagreeing (they used to: the
        // Settings page assumed `windowsterminal` on macOS, where that preset
        // is not even offered, and showed an empty select).
        Self::CortxTerminal
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TerminalConfig {
    #[serde(deserialize_with = "lenient_enum")]
    pub preset: TerminalPreset,
    #[serde(default)]
    pub custom_path: String,
    #[serde(default)]
    pub custom_args: Vec<String>,
    /// Shell launched by the integrated terminal's "new terminal" tabs, as a
    /// command line (e.g. `pwsh -NoLogo`, `/bin/zsh -l`). None/empty =
    /// auto-detect (see `process_manager::resolve_shell`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integrated_shell: Option<String>,
    /// `cortx init` emits OSC 7 / OSC 133 (cwd, command boundaries, exit
    /// codes) when the shell runs inside a CortX terminal. Off = plain aliases.
    #[serde(default = "default_true")]
    pub shell_integration: bool,
    /// Toast + OS notification when a command that ran at least
    /// `long_command_seconds` finishes in a terminal you are not looking at.
    #[serde(default = "default_true")]
    pub notify_on_long_command: bool,
    #[serde(default = "default_long_command_seconds")]
    pub long_command_seconds: u32,
    /// Which finished commands are worth a notification (DEV-13 #5). None =
    /// derived from `notify_on_long_command` for settings written before this
    /// existed: `false` → `Never`, anything else → `Failed`.
    #[serde(default, deserialize_with = "lenient_opt_enum")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notify_when: Option<TerminalNotifyWhen>,
    /// How a notification is delivered. None = `Both`.
    #[serde(default, deserialize_with = "lenient_opt_enum")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notify_style: Option<TerminalNotifyStyle>,
    /// Only notify for a terminal that is not on screen (the tab is hidden,
    /// or its window is in the background). Off = notify even for the
    /// terminal you are looking at.
    #[serde(default = "default_true")]
    pub notify_only_when_hidden: bool,
    /// Commands that never notify, matched on the program name (or on a
    /// whole prefix such as `npm run dev`). None = the built-in list of
    /// long-lived interactive programs (`claude`, `codex`, `vim`, `ssh`…).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify_muted_commands: Option<Vec<String>>,
    /// Terminal window: where the tab list lives. One or the other, never both.
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub tabs_placement: TabsPlacement,
    /// What Ctrl+Tab walks: the tab list, or the order the tabs were last
    /// used in. See [`CtrlTabBehavior`]. Only the frontend reads this.
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub ctrl_tab_behavior: CtrlTabBehavior,
    /// A tab whose shells `cd` into another project's root moves to that
    /// project's group in the sessions rail, and to "No project" once they are
    /// outside every root. A tab placed by hand stays where it was put. Only
    /// the frontend reads this.
    #[serde(default = "default_true")]
    pub follow_project_on_cd: bool,
    /// Font of every terminal (dock and window). None = bundled default stack.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    /// Font size in px. None = 12.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<u16>,
    /// Line height multiplier, 1.0–2.0. None = 1.2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f32>,
    /// Extra space between glyphs in px. None = auto (CortX compensates for
    /// fonts whose advance is not a whole number of pixels).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<f32>,
    /// Font weight of normal / bold text (100–900). None = 400 / 700.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_weight_bold: Option<u16>,
    /// How the terminals are drawn. The GPU renderer is faster on heavy
    /// output; the DOM one uses the browser's own text rendering, whose
    /// glyphs are noticeably finer.
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub renderer: TerminalRenderer,
    /// Selection colour of the terminals (any CSS colour). None = the theme's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_color: Option<String>,
    /// Lines of output kept behind the viewport, per terminal. Clamped to
    /// 1 000–200 000 by the frontend, which is the only reader.
    ///
    /// The non-obvious part: trimming the scrollback destroys the `OSC 133`
    /// markers the command blocks are built on, so this number is also how
    /// far back the block navigation (Ctrl+Up / Ctrl+Down) can still go. And
    /// it is paid per terminal — twenty open tabs hold twenty buffers.
    ///
    /// Not to be confused with [`TerminalConfig::restore_scrollback_lines`],
    /// which is how much of the *previous* session is replayed on start.
    #[serde(default = "default_scrollback_lines")]
    pub scrollback_lines: u32,
    /// Size cap of the shared command-history file, in megabytes. Past it the
    /// file is rewritten keeping only its most recent half, so what stays
    /// searchable is between half and all of this. At roughly 250 bytes a
    /// command, 10 MB is about 40 000 of them. Clamped to 1-200.
    #[serde(default = "default_history_max_mb")]
    pub history_max_mb: u32,
    /// Reopen the Terminal window's tabs (shells in their last directory,
    /// nothing re-run) when the app starts.
    #[serde(default = "default_true")]
    pub restore_sessions: bool,
    /// Seed restored shells with the tail of their previous scrollback.
    #[serde(default = "default_true")]
    pub restore_scrollback: bool,
    /// How many lines of the previous session are replayed into a restored
    /// shell — a one-off seed at start, not the live buffer size (that is
    /// [`TerminalConfig::scrollback_lines`]).
    #[serde(default = "default_restore_scrollback_lines")]
    pub restore_scrollback_lines: u32,
    /// Where a started service / script shows up.
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub open_processes_in: TerminalTarget,
    /// Where "open a dev session" (launch configuration) opens its tabs.
    #[serde(default = "default_dev_sessions_target")]
    #[serde(deserialize_with = "lenient_enum")]
    pub open_dev_sessions_in: TerminalTarget,
    /// Terminal window shortcuts: action id → key combo (e.g. `"split.right": "Ctrl+Shift+D"`).
    /// Missing ids use the built-in defaults (`keybindings.ts`).
    #[serde(default)]
    pub keybindings: std::collections::HashMap<String, String>,
    /// Terminal theme names (files under `data/terminal/themes/`) for the
    /// app's dark and light modes. None = bundled defaults.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_dark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_light: Option<String>,
    /// Pick `theme_dark` / `theme_light` from the app's light/dark mode
    /// (true) or always use `theme_dark` (false).
    #[serde(default = "default_true")]
    pub theme_follows_app: bool,
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub cursor_style: CursorStyle,
    #[serde(default = "default_true")]
    pub cursor_blink: bool,
    /// The cursor of a pane that does not have the focus. See
    /// [`CursorInactiveStyle`].
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub cursor_inactive_style: CursorInactiveStyle,
    /// Inner padding of every terminal, in px.
    #[serde(default = "default_terminal_padding")]
    pub padding: u16,
    /// Terminal window opacity, 50–100 (%).
    #[serde(default = "default_window_opacity")]
    pub window_opacity: u8,
    /// Terminal window backdrop effect (Windows: acrylic / mica; macOS: vibrancy).
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub window_effect: WindowEffect,
    /// Ghost-text completions from the command history (→ to accept). When
    /// on, `cortx init` turns PSReadLine's own prediction off so only one
    /// suggestion shows.
    #[serde(default = "default_true")]
    pub inline_suggestions: bool,
    /// Wallpaper overrides (None = the theme file's own values).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wallpaper_opacity: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wallpaper_blur: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wallpaper_fit: Option<String>,
    /// Darkening overlay on the wallpaper, 0–90 (%): how much the theme
    /// colour tones the picture down.
    #[serde(default)]
    pub wallpaper_dim: u8,
    /// Title bar + sessions rail background alpha, 0–100 (%).
    #[serde(default = "default_chrome_opacity")]
    pub chrome_opacity: u8,
    /// Title bar + sessions rail backdrop blur, px.
    #[serde(default = "default_chrome_blur")]
    pub chrome_blur: u16,
    /// How much of the terminal theme the main window's dock takes (ticket
    /// #38). `None` = fall back to [`TerminalConfig::dock_uses_terminal_theme`],
    /// which is how a settings file written before this existed is read.
    /// Only the frontend reads it (`lib/terminalTheme.rs` has no equivalent —
    /// see `lib/terminalTheme.ts › dockThemeMode`).
    #[serde(default, deserialize_with = "lenient_opt_enum")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dock_theme: Option<DockThemeMode>,
    /// Superseded by [`TerminalConfig::dock_theme`]: `true` reads as
    /// `Chrome`, `false` as `App`. Still written by the UI alongside the new
    /// field so a downgrade keeps the dock looking the same.
    #[serde(default)]
    pub dock_uses_terminal_theme: bool,
    /// A mouse selection lands in the clipboard as soon as it ends (Warp /
    /// X11 style). While on, Ctrl+C keeps interrupting the running program
    /// instead of copying — the text is already copied.
    #[serde(default = "default_true")]
    pub copy_on_select: bool,
    /// What Shift+Enter sends to the program under the PTY.
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub shift_enter: ShiftEnterKey,
    /// Wheel scrolling animation, in ms. 0 scrolls instantly (line by line).
    #[serde(default = "default_smooth_scroll_duration")]
    pub smooth_scroll_duration: u16,
    /// Ask before closing a terminal — or quitting CortX — while a command is
    /// running in it. Nothing running: it closes straight away either way.
    #[serde(default = "default_true")]
    pub confirm_close_running: bool,
    /// What a tab shows in the sessions rail and the tab strip.
    #[serde(default)]
    pub tab_display: TerminalTabDisplay,
    /// Draw kitty graphics (`ESC _ G …`). CortX translates them into the
    /// iTerm2 inline-image sequence its renderer already knows.
    #[serde(default = "default_true")]
    pub kitty_graphics: bool,
    /// Underline existing file paths in the output and open them on click.
    #[serde(default = "default_true")]
    pub file_path_links: bool,
    /// Which key opens the completion menu above the prompt (#17). `Off`
    /// leaves the ghost text alone and never intercepts anything; `Tab`
    /// takes Tab away from the shell's own completion, so it isn't the
    /// default.
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub completion_menu: CompletionMenuKey,
    /// Learn a command's flags and subcommands by running `<cmd> --help`
    /// once and remembering the result (`runtime/command-specs/`). Only ever
    /// for a bare program name already on the PATH — see the safety policy on
    /// `terminal::spec`. Off = history and context completions only.
    #[serde(default = "default_true")]
    pub completion_specs: bool,
    /// Context-aware completions in the terminal's own directory: git refs
    /// (`git checkout <TAB>`), `package.json` scripts (`npm run <TAB>`) and
    /// file paths.
    #[serde(default = "default_true")]
    pub completion_context: bool,
    /// Read the output of the command that just finished for what to run
    /// next: the `git push --set-upstream …` git printed itself, the session
    /// id a coding agent left behind, the subcommand a program says you
    /// meant. Extraction is deliberately conservative — see
    /// `lib/terminalCompletionOutput.ts`.
    #[serde(default = "default_true")]
    pub suggestions_from_output: bool,
    /// How sure the engine has to be before it draws a ghost at all. Below
    /// the threshold nothing is shown: a wrong suggestion costs more than a
    /// missing one.
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub suggestion_confidence: SuggestionConfidence,
    /// Where the input line sits in a pane (ticket #15, U0). `Flow` is what
    /// CortX has always done — the prompt follows the output down the pane;
    /// `Bottom` pins it to the bottom and stacks the output above it, like
    /// Warp's `pinned_to_bottom`. Purely visual: it is a CSS offset on the
    /// xterm host, `rows` / `cols` and the PTY never change.
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub input_position: TerminalInputPosition,
    /// Beta (ticket #15, U1): type the command into a CortX editor at the
    /// prompt instead of the shell's own line editor. Only ever active
    /// between the shell's `OSC 133;B` and the submission, so a session
    /// without shell integration — `ssh`, a REPL, a TUI, a broken profile —
    /// behaves exactly as it does today.
    #[serde(default)]
    pub input_editor: bool,
    /// A key the editor cannot honour (Tab, Ctrl+R, ↑/↓…) writes the line to
    /// the PTY *without* a CR and gives the key to the shell, which completes
    /// or searches it as it does today. Off: the key is swallowed.
    #[serde(default = "default_true")]
    pub input_editor_handoff: bool,
    /// Command blocks (DEV-13 P4, ticket #7): the `OSC 133` markers the shell
    /// already emits become one block per command — Ctrl+Up / Ctrl+Down jump
    /// prompt to prompt, and a block can be copied, folded or run again. It is
    /// an overlay and nothing else: the grid, the PTY and the classic flow are
    /// untouched, and a session without shell integration never sees it.
    #[serde(default = "default_true")]
    pub blocks: bool,
    /// The clickable status bars in the pane's left padding (green / red per
    /// exit code). Off keeps navigation, copying and folding.
    #[serde(default = "default_true")]
    pub block_gutter: bool,
    /// The 1 px rule the full width of the pane on each block's top edge —
    /// the thing that makes a block visible rather than merely tracked. Warp
    /// calls it `appearance.blocks.show_block_dividers` and defaults it on.
    #[serde(default = "default_true")]
    pub block_dividers: bool,
    /// The toolbar that appears at a block's top-right corner on hover: copy
    /// the command, the output or both, run it again, fold it away, and `…`
    /// for the rest. Off leaves the gutter bar's right-click menu.
    #[serde(default = "default_true")]
    pub block_actions: bool,
    /// A 10 % wash of the palette's own red over a block whose command
    /// failed, plus the full-height flag pole in the gutter beside it. It is
    /// what makes an `exit 1` findable in a pane full of output; the gutter
    /// bar alone is three pixels in the margin. Off leaves the gutter bar.
    #[serde(default = "default_true")]
    pub block_failed_wash: bool,
    /// A background plate under each block, so a command and its output read
    /// as a card rather than as scrollback — Warp's `draw_block_background`.
    /// **Terminal window only**: the plate is drawn beneath the xterm canvas
    /// and only shows through where that canvas is transparent, which a docked
    /// pane's is not.
    #[serde(default = "default_true")]
    pub block_cards: bool,
    /// Once you have scrolled past the command that produced what you are
    /// reading, pin it to the top of the pane; click it to go back to it.
    /// Warp's snackbar. Hidden while the command is still running.
    #[serde(default = "default_true")]
    pub block_sticky_header: bool,
    /// A button at the bottom-right of a block whose output runs off the
    /// bottom of the pane: one click goes to its end. Warp's
    /// `appearance.blocks.show_jump_to_bottom_of_block_button`.
    #[serde(default = "default_true")]
    pub block_jump_to_bottom: bool,
    /// Mask what looks like a secret — a token, a password, an API key — in
    /// the command line before it is written to the shared history file.
    /// That file is read back by the history view, by Ctrl+R and by the
    /// ranking behind ghost text, so masking on the way in covers all three.
    /// Only the file: what is already on screen is untouched.
    #[serde(default = "default_true")]
    pub redact_secrets: bool,
    /// Vertical air between two blocks — Warp's `appearance.spacing`.
    /// `Comfortable` by default, because that is what Warp's own `normal`
    /// amounts to (see [`TerminalBlockSpacing`]). Read by
    /// [`crate::shell_init::resolve_block_spacing`] when the shell
    /// integration is generated: the shell prints that many blank lines
    /// before a prompt that follows a command, which is the only way to get
    /// real space in an xterm grid where every row is the same height.
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub block_spacing: TerminalBlockSpacing,
    /// How ⌥ (Option) behaves on macOS. Ignored everywhere else — Windows and
    /// Linux always send `ESC` + key for Alt, which is what the shells expect
    /// and what CortX has always done there.
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub mac_option_as_meta: MacOptionAsMeta,
    /// Show a link's target in a tooltip while the pointer is on it, before
    /// the click.
    #[serde(default = "default_true")]
    pub link_tooltip: bool,
    /// What a program running in the terminal may do with the system
    /// clipboard through the OSC 52 escape sequence. `Deny` by default — see
    /// [`Osc52Access`].
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub osc52: Osc52Access,
    /// What a `BEL` byte does (issue 11). See [`TerminalBell`].
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub bell: TerminalBell,
    /// Join `!=`, `=>`, `->` into the ligature the font draws for them.
    ///
    /// Off by default: the addon registers a character joiner that runs over
    /// every rendered row, and the ligatures a terminal grid can show are
    /// only the ones that fit the cells they replace. Only the frontend reads
    /// this (`lib/terminalSessions.ts`).
    #[serde(default)]
    pub ligatures: bool,
    /// Minimum contrast ratio between a cell's text and its background, 1–21
    /// (issue 52).
    ///
    /// `1` — the default, and xterm's — leaves every colour exactly as the
    /// theme and the program wrote it. `4.5` is WCAG AA, `7` AAA: xterm then
    /// lightens or darkens a foreground, cell by cell, only where the pair
    /// falls short. Offered because CortX ships many third-party themes and
    /// some of them have a `bright_black` that is unreadable on their own
    /// background; left at `1` by default because raising it rewrites colours
    /// the theme author chose on purpose.
    ///
    /// Only the frontend reads this (`lib/terminalSessions.ts`).
    #[serde(default = "default_minimum_contrast_ratio")]
    pub minimum_contrast_ratio: f32,
    /// Expose the terminal's rows as live DOM elements so VoiceOver and NVDA
    /// can read them (issue 52).
    ///
    /// Off by default, as in xterm: the mirror is maintained on every render.
    /// Without it a screen reader gets nothing at all from the terminal, so
    /// it has to be reachable — behind a setting is where it belongs.
    ///
    /// Only the frontend reads this (`lib/terminalSessions.ts`).
    #[serde(default)]
    pub screen_reader_mode: bool,
}

fn default_minimum_contrast_ratio() -> f32 {
    1.0
}

/// What a `BEL` (`0x07`) does (issue 11).
///
/// Warp has a dedicated `audible_bell` module; these are the same three
/// levels every terminal offers. The signal stays **inside the pane** — a
/// flash, or a short tone — and never becomes a toast or a desktop
/// notification: those belong to the command-finished policy
/// (`settings/notificationPolicy.ts`), and one event must not be announced
/// twice on two channels.
///
/// Only the frontend reads this: `BEL` is handled by the terminal emulator,
/// never in the backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum TerminalBell {
    /// Nothing at all.
    Off,
    /// The default: a brief flash of the pane the bell came from. Says
    /// *which* terminal rang, which a sound cannot, and disturbs nobody.
    #[default]
    Visual,
    /// A short tone, on top of the flash.
    Audible,
}

/// What OSC 52 is allowed to do (issue 36).
///
/// Warp calls this `terminal.osc52_clipboard_access` and denies it by
/// default; CortX does the same. OSC 52 is an escape sequence like any
/// other, so **anything that writes to the PTY can emit one**: a program
/// behind `ssh`, a process in a container, a script nobody read, a `cat` on
/// a crafted file. The write path replaces what the user copied — the
/// classic trick swaps the command they believe they copied from a doc — and
/// the read path hands the program whatever they last copied anywhere, a
/// password or a token included.
///
/// Only the frontend reads this (`lib/terminalSessions.ts`): the sequence is
/// handled in the terminal emulator, never in the backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Osc52Access {
    /// The default: the clipboard addon is not loaded at all, and an OSC 52
    /// sequence is swallowed. The first attempt of a session raises one
    /// notice naming the command that made it.
    #[default]
    Deny,
    /// A program may *set* the clipboard, never read it. This is the level
    /// for tmux and neovim over `ssh`, whose yank is exactly this.
    WriteOnly,
    /// Both directions, including reading the clipboard back into the PTY.
    ReadWrite,
}

/// What ⌥ (Option) sends on macOS.
///
/// xterm.js has a single boolean, `macOptionIsMeta`: on it turns every ⌥ +
/// key into `ESC` + key, off it lets macOS compose the character. Neither end
/// of that is usable on its own. Off, `Alt+B` / `Alt+F` — word-by-word motion
/// in bash, zsh and every readline program — stop working. On, `[ ] { } | @ #
/// \ ~` become **untypable** on the French, Swiss and AZERTY layouts, where
/// all of them live on the ⌥ layer.
///
/// So the default is neither: xterm composes as macOS intends, and CortX
/// intercepts a closed list of five keys itself. See `lib/terminalKeys.ts`
/// for that list and why it is safe to fix it in code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum MacOptionAsMeta {
    /// ⌥ is left entirely to macOS: every character composes, no chord is
    /// reserved. `Alt+B` / `Alt+F` do not reach the shell.
    Never,
    /// The default. macOS composes everything except ⌥B, ⌥F, ⌥D, ⌥V and ⌥⌫,
    /// which CortX sends to the PTY as `ESC` + key.
    #[default]
    WordKeys,
    /// `macOptionIsMeta: true` — every ⌥ chord becomes `ESC` + key. Meta
    /// everywhere, at the price of the ⌥ layer of the keyboard.
    Always,
}

/// How much room a command block gets above it (DEV-13 #7).
///
/// Warp reserves pixels because it draws its own blocks; CortX draws over
/// xterm's grid, where a row is a row and no CSS can push two of them apart.
/// So the space is a *real* blank line, emitted by the shell integration just
/// before the prompt — which also gives the divider and the action bar a row
/// of their own instead of hovering over one the shell wrote in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum TerminalBlockSpacing {
    /// One blank line between a command's output and the next prompt.
    Normal,
    /// Nothing is added: the prompt follows the output immediately, which is
    /// what CortX did before this setting existed.
    Compact,
    /// Two blank lines, and the default — what Warp actually leaves. Its own
    /// spacing is given in *grid cells* (1.1 above a block, 1.0 below), so
    /// ~2.1 cells of air; a grid can only be spaced in whole rows, and two is
    /// the nearest we can express. One row, `Normal`, is a quarter of that
    /// and reads as a plain line break rather than a boundary — which is why
    /// it is no longer the default.
    #[default]
    Comfortable,
}

/// How much of the terminal theme the main window's dock takes (ticket #38).
///
/// The dock is one panel of a window whose other half is the app, so the
/// answer is not a yes/no: the panes can wear the theme while the header and
/// the tab rows stay the app's — which is exactly what the old
/// `dock_uses_terminal_theme: true` did, and exactly what read badly in a
/// light interface. `Chrome` is the coherent version of "on", and what the
/// boolean is now read as.
///
/// Only the frontend reads this (`lib/terminalTheme.ts`): the dock's tokens
/// are CSS variables set on one element, never anything the backend touches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DockThemeMode {
    /// The dock keeps the app skin, panes included.
    #[default]
    App,
    /// The panes only: the xterm palette follows the theme, the chrome does not.
    Canvas,
    /// The whole dock, the way the Terminal window does it.
    Chrome,
}

/// Where the input line sits in a terminal pane (ticket #15, U0).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum TerminalInputPosition {
    /// The prompt follows the output down the pane (CortX's behaviour so far).
    Flow,
    /// The prompt is pinned to the bottom of the pane; output stacks above it.
    ///
    /// The default since ticket #39: it is Warp's own
    /// (`appearance.input.input_mode = pinned_to_bottom`) and it is half of
    /// what makes the blocks read as blocks — the prompt stays put at the
    /// bottom edge and the output stacks above it instead of the whole page
    /// crawling down. Purely visual: it is a CSS offset on the xterm host, so
    /// `rows` / `cols` and the PTY never learn about it.
    #[default]
    Bottom,
}

/// What opens the completion menu (#17).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CompletionMenuKey {
    /// No menu at all; ghost text only.
    Off,
    /// Ctrl+Space (default): never competes with the shell's own bindings.
    #[default]
    CtrlSpace,
    /// Tab. Takes it away from PSReadLine / zsh completion while at a prompt.
    Tab,
}

/// How sure an inline suggestion has to be before it is drawn (#17).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SuggestionConfidence {
    /// Only when the answer is all but certain (the program printed it, or a
    /// long prefix matches one command and nothing else).
    Strict,
    /// The default: ambiguous prefixes and lone filename matches say nothing.
    #[default]
    Balanced,
    /// Show whatever matches, as CortX did before this pass.
    Loose,
}

/// What a terminal tab shows (sessions rail and tab strip alike).
///
/// The title is never optional — a tab needs a name. Everything around it is:
/// the second line (directory, running command), the status glyph, the agent
/// running inside, and the Ctrl+N number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalTabDisplay {
    /// Second line: the directory the shell is in.
    #[serde(default = "default_true")]
    pub cwd: bool,
    /// Second line while a command runs: the command itself (takes over the
    /// directory).
    #[serde(default = "default_true")]
    pub command: bool,
    /// Status glyph (spinner, finished pill, runtime dot).
    #[serde(default = "default_true")]
    pub status: bool,
    /// Detected agent: its icon, the title it gave itself, and its own state.
    #[serde(default = "default_true")]
    pub agent: bool,
    /// When the Ctrl+N number is shown.
    #[serde(default)]
    #[serde(deserialize_with = "lenient_enum")]
    pub index: TabIndexDisplay,
    /// Also draw the tab colour as a bar down the left edge, on top of the
    /// tint. Off by default: the tint alone carries the colour, as Warp does.
    #[serde(default)]
    pub color_bar: bool,
}

impl Default for TerminalTabDisplay {
    fn default() -> Self {
        Self {
            cwd: true,
            command: true,
            status: true,
            agent: true,
            index: TabIndexDisplay::default(),
            color_bar: false,
        }
    }
}

/// When a tab shows its Ctrl+N number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TabIndexDisplay {
    Never,
    /// Only while Ctrl is held — the moment the number is of any use.
    #[default]
    Ctrl,
    Always,
}

/// What the terminal sends when Shift+Enter is pressed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ShiftEnterKey {
    /// ESC + CR, i.e. what Alt/Option+Enter already sends: the sequence
    /// Claude Code's `/terminal-setup` binds to Shift+Enter, and the one
    /// zsh and fish insert a new line for.
    #[default]
    EscapeEnter,
    /// The plain CR of Enter — the program cannot tell the two apart.
    Enter,
}

fn default_smooth_scroll_duration() -> u16 {
    100
}

fn default_chrome_opacity() -> u8 {
    72
}

fn default_chrome_blur() -> u16 {
    20
}

fn default_terminal_padding() -> u16 {
    8
}

fn default_window_opacity() -> u8 {
    100
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CursorStyle {
    Block,
    Underline,
    #[default]
    Bar,
}

/// What the cursor of a pane that does **not** have the focus looks like
/// (issue 52).
///
/// xterm's default is `Outline` — the same shape as the focused cursor, drawn
/// hollow — and CortX keeps it: with a single terminal open it is the right
/// look, and taking it away would be a change nobody asked for. The value
/// exists because the Terminal window has splits, where the first thing you
/// need to know is which pane your keys are going to; `None` answers that
/// without ambiguity.
///
/// Only the frontend reads this (`lib/terminalSessions.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CursorInactiveStyle {
    #[default]
    Outline,
    Block,
    Underline,
    Bar,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum WindowEffect {
    #[default]
    None,
    Acrylic,
    Mica,
    Vibrancy,
}

fn default_long_command_seconds() -> u32 {
    10
}

/// Which finished commands deserve a notification (DEV-13 #5). A long
/// threshold alone is not enough: a Claude Code session lasts hours, so every
/// one of them ends up "long".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TerminalNotifyWhen {
    /// Never notify when a command ends.
    Never,
    /// Only a non-zero exit code (the default).
    #[default]
    Failed,
    /// A failure, or a successful command that ran at least
    /// `long_command_seconds`.
    FailedOrLong,
    /// Every finished command.
    All,
}

/// How a terminal notification reaches the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TerminalNotifyStyle {
    /// A toast inside the app only.
    Toast,
    /// An OS notification only.
    System,
    /// A toast, plus an OS notification when the window is in the background.
    #[default]
    Both,
}

/// Like [`lenient_enum`], for an optional field: an unknown string falls back
/// to `None` instead of failing the whole settings file.
fn lenient_opt_enum<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    use serde::de::IntoDeserializer;
    let raw = Option::<String>::deserialize(deserializer)?;
    Ok(raw.and_then(|s| {
        let value: serde::de::value::StringDeserializer<serde::de::value::Error> =
            s.into_deserializer();
        T::deserialize(value).ok()
    }))
}

fn default_restore_scrollback_lines() -> u32 {
    200
}

fn default_history_max_mb() -> u32 {
    10
}

/// Lines a fresh install keeps per terminal (ticket #39).
///
/// 10 000 for a long time, which is the classic emulator default and was
/// chosen when the scrollback was only a scrollback. It is now also the depth
/// of the **command blocks**: trimming the buffer destroys the `OSC 133`
/// markers a block is built on, so at 10 000 lines a talkative agent session
/// loses its blocks within the hour. Warp keeps 50 000
/// (`terminal.maximum_grid_size`), but its buffers are in Rust and ours are in
/// a WebView, so 25 000 is the compromise — still under the 50 000 the UI
/// already warns about.
///
/// The backend budget derived from this number does not move at all:
/// [`crate::terminal::scrollback_bytes_for_lines`] prices 25 000 lines at
/// 3.05 MiB and clamps that up to the 4 MiB floor, exactly where 10 000 landed.
fn default_scrollback_lines() -> u32 {
    25_000
}

fn default_dev_sessions_target() -> TerminalTarget {
    TerminalTarget::Window
}

/// Glyph renderer of the integrated terminals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TerminalRenderer {
    /// Canvas (default): draws box / block / powerline characters itself at
    /// the cell size — no seams — while the text is rasterised by the
    /// platform engine, so the letters stay fine.
    #[default]
    Canvas,
    /// GPU atlas: fastest on very heavy output, slightly heavier glyphs.
    Webgl,
    /// No acceleration: the browser draws every character, block glyphs
    /// included, which can leave hairlines between cells.
    Dom,
}

/// A surface terminals can be shown in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TerminalTarget {
    #[default]
    Dock,
    Window,
}

/// Terminal window layout for the list of tabs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TabsPlacement {
    /// Sessions rail on the left (default).
    #[default]
    Sidebar,
    /// Tab strip above the panes.
    Top,
}

/// What Ctrl+Tab does (issue 45b) — Warp's `keys.ctrl_tab_behavior_setting`.
///
/// Only the frontend reads it (`lib/tabCycle.ts` and
/// `components/terminal/actions.ts`): switching tabs never reaches the
/// backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CtrlTabBehavior {
    /// The next tab in the list, then the one after it — what CortX has
    /// always done, and the default: a key pressed a hundred times a day does
    /// not change meaning unless it is asked to.
    #[default]
    Sequential,
    /// Alt+Tab between tabs: the first press goes to the tab used before this
    /// one, and holding Ctrl walks further back through the ones before that.
    RecentlyUsed,
}

impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            preset: TerminalPreset::default(),
            custom_path: String::new(),
            custom_args: Vec::new(),
            integrated_shell: None,
            shell_integration: true,
            notify_on_long_command: true,
            long_command_seconds: default_long_command_seconds(),
            notify_when: None,
            notify_style: None,
            notify_only_when_hidden: true,
            notify_muted_commands: None,
            tabs_placement: TabsPlacement::default(),
            ctrl_tab_behavior: CtrlTabBehavior::default(),
            follow_project_on_cd: true,
            font_family: None,
            font_size: None,
            line_height: None,
            letter_spacing: None,
            font_weight: None,
            font_weight_bold: None,
            renderer: TerminalRenderer::default(),
            selection_color: None,
            scrollback_lines: default_scrollback_lines(),
            history_max_mb: default_history_max_mb(),
            restore_sessions: true,
            restore_scrollback: true,
            restore_scrollback_lines: default_restore_scrollback_lines(),
            open_processes_in: TerminalTarget::Dock,
            open_dev_sessions_in: TerminalTarget::Window,
            keybindings: std::collections::HashMap::new(),
            theme_dark: None,
            theme_light: None,
            theme_follows_app: true,
            cursor_style: CursorStyle::default(),
            cursor_blink: true,
            cursor_inactive_style: CursorInactiveStyle::default(),
            padding: default_terminal_padding(),
            window_opacity: default_window_opacity(),
            window_effect: WindowEffect::default(),
            inline_suggestions: true,
            wallpaper_opacity: None,
            wallpaper_blur: None,
            wallpaper_fit: None,
            wallpaper_dim: 0,
            chrome_opacity: default_chrome_opacity(),
            chrome_blur: default_chrome_blur(),
            dock_theme: None,
            dock_uses_terminal_theme: false,
            copy_on_select: true,
            shift_enter: ShiftEnterKey::default(),
            smooth_scroll_duration: default_smooth_scroll_duration(),
            confirm_close_running: true,
            tab_display: TerminalTabDisplay::default(),
            kitty_graphics: true,
            file_path_links: true,
            completion_menu: CompletionMenuKey::default(),
            completion_specs: true,
            completion_context: true,
            suggestions_from_output: true,
            suggestion_confidence: SuggestionConfidence::default(),
            input_position: TerminalInputPosition::default(),
            input_editor: false,
            input_editor_handoff: true,
            blocks: true,
            block_gutter: true,
            block_dividers: true,
            block_actions: true,
            block_failed_wash: true,
            block_cards: true,
            block_sticky_header: true,
            block_jump_to_bottom: true,
            redact_secrets: true,
            block_spacing: TerminalBlockSpacing::default(),
            mac_option_as_meta: MacOptionAsMeta::default(),
            link_tooltip: true,
            osc52: Osc52Access::default(),
            bell: TerminalBell::default(),
            ligatures: false,
            minimum_contrast_ratio: default_minimum_contrast_ratio(),
            screen_reader_mode: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceConfig {
    #[serde(deserialize_with = "lenient_enum")]
    pub theme: Theme,
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            theme: Theme::System,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    #[default]
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultsConfig {
    #[serde(deserialize_with = "lenient_enum")]
    pub launch_method: LaunchMethod,
}

impl Default for DefaultsConfig {
    fn default() -> Self {
        Self {
            launch_method: LaunchMethod::Integrated,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum LaunchMethod {
    Clipboard,
    External,
    #[default]
    Integrated,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub terminal: TerminalConfig,
    pub appearance: AppearanceConfig,
    pub defaults: DefaultsConfig,
    /// Global scripts configuration
    #[serde(default)]
    pub scripts_config: ScriptsConfig,
    /// Base URL for toolbox documentation links
    #[serde(default)]
    pub toolbox_base_url: String,
    /// Path to a local git repo for backing up CortX data
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_repo_path: Option<String>,
    /// Global hotkey combo for opening the command palette from anywhere.
    /// Empty string or None means "disabled". Uses tauri-plugin-global-shortcut
    /// syntax: e.g. "CmdOrCtrl+Shift+Space", "Alt+F1".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub global_hotkey: Option<String>,
    /// Directory where alias "shims" (real launcher files) are written so that
    /// shimmed aliases are callable from any process once this dir is on PATH.
    /// Empty/None means use the platform default (see `shim::resolve_shim_dir`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shim_dir: Option<String>,
    /// Agents section (DEV-11): provider roots, toggles, live threshold.
    #[serde(default)]
    pub agents: AgentsSettings,
}

// Input types for commands

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    pub root_path: String,
    pub description: Option<String>,
    pub image_path: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub status: Option<String>,
    pub toolbox_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub root_path: Option<String>,
    pub description: Option<String>,
    pub image_path: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub toolbox_url: Option<String>,
    pub favorite: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateServiceInput {
    pub name: String,
    pub working_dir: String,
    pub command: String,
    pub modes: Option<HashMap<String, String>>,
    pub default_mode: Option<String>,
    pub extra_args: Option<String>,
    pub arg_presets: Option<HashMap<String, String>>,
    pub default_arg_preset: Option<String>,
    pub color: Option<String>,
    pub port: Option<u16>,
    pub env_vars: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateServiceInput {
    pub name: Option<String>,
    pub working_dir: Option<String>,
    pub command: Option<String>,
    pub modes: Option<HashMap<String, String>>,
    pub default_mode: Option<String>,
    pub extra_args: Option<String>,
    pub arg_presets: Option<HashMap<String, String>>,
    pub default_arg_preset: Option<String>,
    pub color: Option<String>,
    pub port: Option<u16>,
    pub env_vars: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScriptInput {
    pub name: String,
    pub description: Option<String>,
    pub command: String,
    pub script_path: Option<String>,
    pub working_dir: String,
    pub color: Option<String>,
    pub linked_service_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScriptInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub command: Option<String>,
    pub script_path: Option<String>,
    pub working_dir: Option<String>,
    pub color: Option<String>,
    pub linked_service_ids: Option<Vec<String>>,
}

// Environment file input types

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverEnvFilesInput {
    pub force: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddEnvFileInput {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkEnvToServiceInput {
    pub service_id: Option<String>,
}

// Runtime state types (not persisted)

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceStatus {
    Stopped,
    Starting,
    Running,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceState {
    pub service_id: String,
    pub status: ServiceStatus,
    pub pid: Option<u32>,
    pub active_mode: Option<String>,
    pub active_arg_preset: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp: DateTime<Utc>,
    pub stream: LogStream,
    pub content: String,
}

// Event payloads

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLogPayload {
    pub service_id: String,
    pub stream: LogStream,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatusPayload {
    pub service_id: String,
    pub status: ServiceStatus,
    pub pid: Option<u32>,
    pub active_mode: Option<String>,
    pub active_arg_preset: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceExitPayload {
    pub service_id: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServicePortsPayload {
    pub service_id: String,
    pub ports: Vec<u16>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScriptStatus {
    Idle,
    Running,
    Completed,
    Failed,
}

/// Emitted when an interactive shell tab's process exits (or is killed).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellExitPayload {
    pub shell_id: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptLogPayload {
    pub script_id: String,
    pub stream: LogStream,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptStatusPayload {
    pub script_id: String,
    pub status: ScriptStatus,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptExitPayload {
    pub script_id: String,
    pub exit_code: Option<i32>,
    pub success: bool,
}

// ============================================================================
// New models for Global Scripts feature
// ============================================================================

// Script parameter types

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ScriptParamType {
    String,
    Bool,
    Number,
    Enum,
    Path,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptParameter {
    pub name: String,
    pub param_type: ScriptParamType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_flag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub long_flag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,
    pub required: bool,
    #[serde(default)]
    pub enum_values: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nargs: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParameterPreset {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub values: HashMap<String, String>,
    /// Which parameters are enabled/disabled in this preset
    #[serde(default)]
    pub enabled: HashMap<String, bool>,
}

// Global Script

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalScript {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub parameters: Vec<ScriptParameter>,
    #[serde(default)]
    pub parameter_presets: Vec<ParameterPreset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_preset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_vars: Option<HashMap<String, String>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub order: u32,
    #[serde(default)]
    pub auto_discovered: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Pinned by the user: favorites are listed first and can be filtered on.
    #[serde(default)]
    pub favorite: bool,
}

impl GlobalScript {
    pub fn new(name: String, command: String, working_dir: Option<String>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            description: None,
            command,
            script_path: None,
            working_dir,
            color: None,
            tags: Vec::new(),
            parameters: Vec::new(),
            parameter_presets: Vec::new(),
            default_preset_id: None,
            env_vars: None,
            created_at: now,
            updated_at: now,
            order: 0,
            auto_discovered: false,
            status: None,
            favorite: false,
        }
    }
}

// Tag Definitions (enriched tags with color/order)

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagDefinition {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
}

// Execution History

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRecord {
    pub id: String,
    pub script_id: String,
    pub started_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub parameters_used: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset_name: Option<String>,
}

impl ExecutionRecord {
    pub fn new(script_id: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            script_id,
            started_at: Utc::now(),
            finished_at: None,
            duration_ms: None,
            success: false,
            exit_code: None,
            parameters_used: HashMap::new(),
            preset_name: None,
        }
    }
}

// Scripts Configuration

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptsConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main_folder: Option<String>,
    #[serde(default = "default_scan_extensions")]
    pub scan_extensions: Vec<String>,
    #[serde(default = "default_ignored_patterns")]
    pub ignored_patterns: Vec<String>,
    #[serde(default)]
    pub auto_scan_on_startup: bool,
    #[serde(default = "default_command_templates")]
    pub command_templates: HashMap<String, String>,
}

fn default_scan_extensions() -> Vec<String> {
    vec![
        "sh".into(),
        "bash".into(),
        "zsh".into(),
        "ps1".into(),
        "bat".into(),
        "cmd".into(),
        "py".into(),
        "js".into(),
        "ts".into(),
        "rb".into(),
        "pl".into(),
    ]
}

fn default_command_templates() -> HashMap<String, String> {
    let mut templates: HashMap<String, String> = HashMap::from([
        ("py".into(), "python {{SCRIPT_FILE}}".into()),
        ("js".into(), "node {{SCRIPT_FILE}}".into()),
        ("ts".into(), "npx tsx {{SCRIPT_FILE}}".into()),
        ("rb".into(), "ruby {{SCRIPT_FILE}}".into()),
        ("pl".into(), "perl {{SCRIPT_FILE}}".into()),
    ]);

    // Shell-script extensions vary in usefulness by host OS; only seed the ones
    // the user is likely to actually run there. Custom templates can still be
    // added manually from Settings.
    #[cfg(target_os = "windows")]
    {
        templates.insert(
            "ps1".into(),
            "powershell -ExecutionPolicy Bypass -File {{SCRIPT_FILE}}".into(),
        );
        templates.insert("bat".into(), "{{SCRIPT_FILE}}".into());
        templates.insert("cmd".into(), "{{SCRIPT_FILE}}".into());
    }

    #[cfg(unix)]
    {
        templates.insert("sh".into(), "bash {{SCRIPT_FILE}}".into());
        templates.insert("bash".into(), "bash {{SCRIPT_FILE}}".into());
        templates.insert("zsh".into(), "zsh {{SCRIPT_FILE}}".into());
    }

    templates
}

fn default_ignored_patterns() -> Vec<String> {
    vec![
        "node_modules".into(),
        ".git".into(),
        "target".into(),
        "__pycache__".into(),
        ".venv".into(),
    ]
}

impl Default for ScriptsConfig {
    fn default() -> Self {
        Self {
            main_folder: None,
            scan_extensions: default_scan_extensions(),
            ignored_patterns: default_ignored_patterns(),
            auto_scan_on_startup: false,
            command_templates: default_command_templates(),
        }
    }
}

// Discovered script (from folder scanning)

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredScript {
    pub path: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub extension: String,
}

// Discovered tool (from package manager scanning)

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredTool {
    pub name: String,
    pub version: Option<String>,
    pub source: String,
    pub description: Option<String>,
    pub install_location: Option<String>,
    pub homepage: Option<String>,
}

// Input types for new commands

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGlobalScriptInput {
    pub name: String,
    pub description: Option<String>,
    pub command: String,
    pub script_path: Option<String>,
    pub working_dir: Option<String>,
    pub color: Option<String>,
    pub tags: Option<Vec<String>>,
    pub parameters: Option<Vec<ScriptParameter>>,
    pub parameter_presets: Option<Vec<ParameterPreset>>,
    pub env_vars: Option<HashMap<String, String>>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGlobalScriptInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub command: Option<String>,
    pub script_path: Option<String>,
    pub working_dir: Option<String>,
    pub color: Option<String>,
    pub tags: Option<Vec<String>>,
    pub parameters: Option<Vec<ScriptParameter>>,
    pub parameter_presets: Option<Vec<ParameterPreset>>,
    pub default_preset_id: Option<String>,
    pub env_vars: Option<HashMap<String, String>>,
    pub status: Option<String>,
    pub favorite: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagDefinitionInput {
    pub name: String,
    pub color: Option<String>,
    pub order: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTagDefinitionInput {
    pub name: Option<String>,
    pub color: Option<String>,
    pub order: Option<u32>,
}

// Script export/import

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptExport {
    pub version: String,
    pub scripts: Vec<GlobalScript>,
    /// Legacy field from v <= 4.x exports — kept so old export files still
    /// deserialize, but ignored on import. Never written by current code.
    #[serde(default, skip_serializing)]
    pub groups: Vec<serde_json::Value>,
    #[serde(default)]
    pub tools: Vec<Tool>,
    #[serde(default)]
    pub tag_definitions: Vec<TagDefinition>,
    #[serde(default)]
    pub aliases: Vec<ShellAlias>,
    #[serde(default)]
    pub apps: Vec<App>,
    #[serde(default)]
    pub status_definitions: Vec<StatusDefinition>,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<AppSettings>,
    pub exported_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub scripts_added: u32,
    pub skipped: u32,
    pub tools_added: u32,
    pub tag_definitions_added: u32,
    pub aliases_added: u32,
    pub apps_added: u32,
    pub status_definitions_added: u32,
    pub projects_added: u32,
    pub settings_imported: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    #[serde(default = "default_true")]
    pub projects: bool,
    #[serde(default = "default_true")]
    pub scripts: bool,
    #[serde(default = "default_true")]
    pub tools: bool,
    #[serde(default = "default_true")]
    pub apps: bool,
    #[serde(default = "default_true")]
    pub shell_config: bool,
    #[serde(default = "default_true")]
    pub tags_and_statuses: bool,
    #[serde(default = "default_true")]
    pub settings: bool,
}

impl Default for ImportOptions {
    fn default() -> Self {
        Self {
            projects: true,
            scripts: true,
            tools: true,
            apps: true,
            shell_config: true,
            tags_and_statuses: true,
            settings: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub version: String,
    pub exported_at: DateTime<Utc>,
    pub projects_count: usize,
    pub scripts_count: usize,
    pub tools_count: usize,
    pub apps_count: usize,
    pub aliases_count: usize,
    pub tag_definitions_count: usize,
    pub status_definitions_count: usize,
    pub has_settings: bool,
}

// ============================================================================
// Shell Aliases
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellAlias {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub order: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Alias type: "function" (default), "script", or "init"
    #[serde(default = "default_alias_type")]
    pub alias_type: String,
    /// Per-shell setup code (runs before alias definition)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup: Option<HashMap<String, String>>,
    /// Per-shell script/init content (used for "script" and "init" types)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<HashMap<String, String>>,
    /// Link to a Tool entry
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_id: Option<String>,
    /// Execution order for `cortx init` output. Aliases with this set appear first (sorted ascending). Those without appear after.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_order: Option<u32>,
    /// When true, CortX materializes this alias as a real launcher file ("shim")
    /// in the shim bin directory (which can be added to PATH) so it is callable
    /// by ANY process — agents, scheduled tasks, non-interactive shells — not
    /// only shells that source `cortx init`. Only honored for "function" type.
    #[serde(default)]
    pub shim: bool,
    /// Pinned by the user: favorites are listed first and can be filtered on.
    #[serde(default)]
    pub favorite: bool,
}

fn default_alias_type() -> String {
    "function".to_string()
}

impl ShellAlias {
    pub fn new(name: String, command: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            command,
            description: None,
            tags: Vec::new(),
            created_at: now,
            updated_at: now,
            order: 0,
            status: None,
            alias_type: default_alias_type(),
            setup: None,
            script: None,
            tool_id: None,
            execution_order: None,
            shim: false,
            favorite: false,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShellAliasInput {
    pub name: String,
    pub command: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub alias_type: Option<String>,
    pub setup: Option<HashMap<String, String>>,
    pub script: Option<HashMap<String, String>>,
    pub tool_id: Option<String>,
    pub execution_order: Option<u32>,
    pub shim: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateShellAliasInput {
    pub name: Option<String>,
    pub command: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub alias_type: Option<String>,
    pub setup: Option<HashMap<String, String>>,
    pub script: Option<HashMap<String, String>>,
    pub tool_id: Option<String>,
    pub execution_order: Option<u32>,
    pub shim: Option<bool>,
    pub favorite: Option<bool>,
}

// ============================================================================
// Tools & Config Registry
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolConfigPath {
    pub label: String,
    pub path: String,
    #[serde(default)]
    pub is_directory: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replaced_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default)]
    pub config_paths: Vec<ToolConfigPath>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toolbox_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub order: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Pinned by the user: favorites are listed first and can be filtered on.
    #[serde(default)]
    pub favorite: bool,
}

impl Tool {
    pub fn new(name: String, status: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            description: None,
            tags: Vec::new(),
            status,
            replaced_by: None,
            install_method: None,
            install_location: None,
            version: None,
            homepage: None,
            config_paths: Vec::new(),
            toolbox_url: None,
            notes: None,
            color: None,
            order: 0,
            created_at: now,
            updated_at: now,
            favorite: false,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateToolInput {
    pub name: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub replaced_by: Option<String>,
    pub install_method: Option<String>,
    pub install_location: Option<String>,
    pub version: Option<String>,
    pub homepage: Option<String>,
    pub config_paths: Option<Vec<ToolConfigPath>>,
    pub toolbox_url: Option<String>,
    pub notes: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateToolInput {
    pub name: Option<String>,
    pub tags: Option<Vec<String>>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub replaced_by: Option<String>,
    pub install_method: Option<String>,
    pub install_location: Option<String>,
    pub version: Option<String>,
    pub homepage: Option<String>,
    pub config_paths: Option<Vec<ToolConfigPath>>,
    pub toolbox_url: Option<String>,
    pub notes: Option<String>,
    pub color: Option<String>,
    pub favorite: Option<bool>,
}

// ============================================================================
// Status Definitions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusDefinition {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStatusDefinitionInput {
    pub name: String,
    pub color: Option<String>,
    pub order: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusDefinitionInput {
    pub name: Option<String>,
    pub color: Option<String>,
    pub order: Option<u32>,
}

// ============================================================================
// Apps (GUI Applications)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct App {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_args: Option<String>,
    #[serde(default)]
    pub config_paths: Vec<ToolConfigPath>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toolbox_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub order: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Pinned by the user: favorites are listed first and can be filtered on.
    #[serde(default)]
    pub favorite: bool,
}

impl App {
    pub fn new(name: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            description: None,
            tags: Vec::new(),
            status: None,
            version: None,
            homepage: None,
            executable_path: None,
            launch_args: None,
            config_paths: Vec::new(),
            toolbox_url: None,
            notes: None,
            color: None,
            order: 0,
            created_at: now,
            updated_at: now,
            favorite: false,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAppInput {
    pub name: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub version: Option<String>,
    pub homepage: Option<String>,
    pub executable_path: Option<String>,
    pub launch_args: Option<String>,
    pub config_paths: Option<Vec<ToolConfigPath>>,
    pub toolbox_url: Option<String>,
    pub notes: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAppInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub version: Option<String>,
    pub homepage: Option<String>,
    pub executable_path: Option<String>,
    pub launch_args: Option<String>,
    pub config_paths: Option<Vec<ToolConfigPath>>,
    pub toolbox_url: Option<String>,
    pub notes: Option<String>,
    pub color: Option<String>,
    pub favorite: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A settings file written by a newer CortX must still load: the unknown
    /// value falls back to the default instead of failing the whole parse and
    /// taking the app (and every shell running `cortx init`) down with it.
    #[test]
    fn unknown_enum_values_fall_back_to_the_default() {
        let json = r#"{
            "terminal": { "preset": "somethingnew", "renderer": "nextgen", "cursorStyle": "beam" },
            "appearance": { "theme": "midnight" },
            "defaults": { "launchMethod": "teleport" }
        }"#;
        let settings: AppSettings = serde_json::from_str(json).expect("unknown values must not fail the parse");
        assert_eq!(settings.terminal.preset, TerminalPreset::default());
        assert_eq!(settings.terminal.renderer, TerminalRenderer::default());
        assert_eq!(settings.terminal.cursor_style, CursorStyle::default());
        assert!(matches!(settings.appearance.theme, Theme::System));
        assert!(matches!(settings.defaults.launch_method, LaunchMethod::Integrated));
    }

    /// Ticket #39 / #41. There is no snapshot of `TerminalConfig::default()`
    /// on the frontend side any more: it asks this process for it through the
    /// `terminal_default_settings` command, so a default changed here reaches
    /// the settings panel's "changed" markers with nothing to regenerate and
    /// nothing that can go stale. What the frontend still owns are the
    /// `Option` fields, which serde skips entirely — and that boundary is the
    /// one thing worth pinning down here.
    #[test]
    fn the_optional_fields_are_the_ones_the_frontend_has_to_answer_for() {
        let json = serde_json::to_value(TerminalConfig::default()).unwrap();
        let written = json.as_object().expect("an object");
        // Skipped, so the frontend's own fallback is the effective default.
        for absent in [
            "integratedShell",
            "fontFamily",
            "fontSize",
            "lineHeight",
            "letterSpacing",
            "fontWeight",
            "fontWeightBold",
            "selectionColor",
            "themeDark",
            "themeLight",
            "wallpaperOpacity",
            "wallpaperBlur",
            "wallpaperFit",
            "dockTheme",
            "notifyWhen",
            "notifyStyle",
            "notifyMutedCommands",
        ] {
            assert!(
                !written.contains_key(absent),
                "{absent} is now written by serde, so `terminalDefaults.ts` must stop \
                 carrying a fallback for it — its `checkTerminalDefaults` says so at startup"
            );
        }
        // Everything else is written, which is what makes the command a
        // complete answer for the settings the panel marks.
        for present in ["scrollbackLines", "inputPosition", "redactSecrets", "tabDisplay"] {
            assert!(written.contains_key(present), "{present} must be written by serde");
        }
    }

    /// Ticket #39. A fresh install opens "launch outside the app" in CortX's
    /// own Terminal window, on every platform — not in Windows Terminal, not
    /// in Terminal.app, and above all not in `Custom` with an empty path,
    /// which is what Linux used to get and which did nothing at all.
    #[test]
    fn a_fresh_install_launches_into_cortxs_own_terminal() {
        assert_eq!(TerminalConfig::default().preset, TerminalPreset::CortxTerminal);
    }

    /// Ticket #38/#39: the dock's three modes. A settings file written before
    /// the enum existed carries only the boolean, and the frontend reads
    /// `true` as `chrome` (`lib/terminalTheme.ts › dockThemeMode`), so the
    /// field must survive a round trip and stay absent when it was never set.
    #[test]
    fn dock_theme_is_optional_and_falls_back_to_the_old_boolean() {
        let legacy: TerminalConfig =
            serde_json::from_str(r#"{ "dockUsesTerminalTheme": true }"#).unwrap();
        assert_eq!(legacy.dock_theme, None);
        assert!(legacy.dock_uses_terminal_theme);
        // Absent, not `null`: the frontend tells "never set" from "set to app".
        let json = serde_json::to_string(&legacy).unwrap();
        assert!(!json.contains("dockTheme"), "{json}");

        let modern: TerminalConfig = serde_json::from_str(r#"{ "dockTheme": "canvas" }"#).unwrap();
        assert_eq!(modern.dock_theme, Some(DockThemeMode::Canvas));
        // An unknown value must not take the settings file down with it.
        let bogus: TerminalConfig = serde_json::from_str(r#"{ "dockTheme": "neon" }"#).unwrap();
        assert_eq!(bogus.dock_theme, None);
    }

    /// Known values still parse exactly as before.
    #[test]
    fn known_enum_values_still_parse() {
        let json = r#"{
            "terminal": { "preset": "warp", "renderer": "webgl" },
            "appearance": { "theme": "dark" },
            "defaults": { "launchMethod": "external" }
        }"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.terminal.preset, TerminalPreset::Warp);
        assert_eq!(settings.terminal.renderer, TerminalRenderer::Webgl);
        assert!(matches!(settings.appearance.theme, Theme::Dark));
        assert!(matches!(settings.defaults.launch_method, LaunchMethod::External));
    }
}
