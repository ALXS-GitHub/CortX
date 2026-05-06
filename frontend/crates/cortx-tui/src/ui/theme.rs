use ratatui::style::{Color, Modifier, Style};

// Border colors
pub const BORDER_ACTIVE: Color = Color::Cyan;
pub const BORDER_INACTIVE: Color = Color::DarkGray;

// Status colors — named ANSI colors render with adequate contrast on both
// light and dark themes for the saturated palette (Red/Green/Blue/Yellow).
pub const STATUS_RUNNING: Color = Color::Green;
pub const STATUS_COMPLETED: Color = Color::Blue;
pub const STATUS_FAILED: Color = Color::Red;
pub const STATUS_IDLE: Color = Color::DarkGray;

// Text colors. Color::Reset adopts the terminal's default foreground, so the
// TUI is readable on both dark and light terminal themes. Secondary/muted use
// fixed mid-grays that keep contrast against either background.
pub const TEXT_PRIMARY: Color = Color::Reset;
pub const TEXT_SECONDARY: Color = Color::Rgb(140, 140, 140);
pub const TEXT_MUTED: Color = Color::Rgb(110, 110, 110);
pub const TEXT_HIGHLIGHT: Color = Color::Yellow;

// Log colors
pub const LOG_STDOUT: Color = Color::Reset;
pub const LOG_STDERR: Color = Color::Red;

// Search
pub const SEARCH_MATCH: Color = Color::Yellow;

// Misc
pub const TAG_COLOR: Color = Color::Cyan;
pub const SEPARATOR_COLOR: Color = Color::DarkGray;

/// Parse a hex color string like "#3b82f6" into a ratatui Color
pub fn color_from_hex(hex: &str) -> Option<Color> {
    let hex = hex.trim_start_matches('#');
    if hex.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&hex[0..2], 16),
            u8::from_str_radix(&hex[2..4], 16),
            u8::from_str_radix(&hex[4..6], 16),
        ) {
            return Some(Color::Rgb(r, g, b));
        }
    }
    None
}

/// Resolve the color for a tag name from tag definitions, falling back to TAG_COLOR
pub fn tag_color(tag: &str, tag_defs: &[cortx_core::models::TagDefinition]) -> Color {
    tag_defs
        .iter()
        .find(|d| d.name.eq_ignore_ascii_case(tag))
        .and_then(|d| d.color.as_deref())
        .and_then(color_from_hex)
        .unwrap_or(TAG_COLOR)
}

pub fn style_border_active() -> Style {
    Style::default().fg(BORDER_ACTIVE)
}

pub fn style_border_inactive() -> Style {
    Style::default().fg(BORDER_INACTIVE)
}

pub fn style_selected() -> Style {
    // REVERSED swaps foreground and background using terminal-defined colors,
    // so the highlight stays readable regardless of the active terminal theme.
    Style::default().add_modifier(Modifier::REVERSED | Modifier::BOLD)
}

pub fn style_status(status: &cortx_core::models::ScriptStatus) -> Style {
    use cortx_core::models::ScriptStatus;
    let color = match status {
        ScriptStatus::Running => STATUS_RUNNING,
        ScriptStatus::Completed => STATUS_COMPLETED,
        ScriptStatus::Failed => STATUS_FAILED,
        ScriptStatus::Idle => STATUS_IDLE,
    };
    Style::default().fg(color)
}

pub fn style_status_symbol(status: &cortx_core::models::ScriptStatus) -> &'static str {
    use cortx_core::models::ScriptStatus;
    match status {
        ScriptStatus::Running => "●",
        ScriptStatus::Completed => "✓",
        ScriptStatus::Failed => "✗",
        ScriptStatus::Idle => "○",
    }
}
