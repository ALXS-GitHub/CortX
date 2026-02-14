use ratatui::style::{Color, Modifier, Style};

// Border colors
pub const BORDER_ACTIVE: Color = Color::Cyan;
pub const BORDER_INACTIVE: Color = Color::DarkGray;

// Status colors
pub const STATUS_RUNNING: Color = Color::Green;
pub const STATUS_COMPLETED: Color = Color::Blue;
pub const STATUS_FAILED: Color = Color::Red;
pub const STATUS_IDLE: Color = Color::DarkGray;

// Text colors
pub const TEXT_PRIMARY: Color = Color::White;
pub const TEXT_SECONDARY: Color = Color::Gray;
pub const TEXT_MUTED: Color = Color::DarkGray;
pub const TEXT_HIGHLIGHT: Color = Color::Yellow;

// Log colors
pub const LOG_STDOUT: Color = Color::White;
pub const LOG_STDERR: Color = Color::Red;

// Search
pub const SEARCH_MATCH: Color = Color::Yellow;

// Misc
pub const FOLDER_COLOR: Color = Color::Magenta;

/// Parse a hex color string (e.g. "#3b82f6") into a ratatui RGB Color.
/// Falls back to FOLDER_COLOR if parsing fails.
pub fn color_from_hex(hex: &str) -> Color {
    let hex = hex.trim_start_matches('#');
    if hex.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&hex[0..2], 16),
            u8::from_str_radix(&hex[2..4], 16),
            u8::from_str_radix(&hex[4..6], 16),
        ) {
            return Color::Rgb(r, g, b);
        }
    }
    FOLDER_COLOR
}
pub const TAG_COLOR: Color = Color::Cyan;
pub const SELECTED_BG: Color = Color::Rgb(40, 40, 60);

pub fn style_border_active() -> Style {
    Style::default().fg(BORDER_ACTIVE)
}

pub fn style_border_inactive() -> Style {
    Style::default().fg(BORDER_INACTIVE)
}

pub fn style_selected() -> Style {
    Style::default().bg(SELECTED_BG).fg(TEXT_PRIMARY).add_modifier(Modifier::BOLD)
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
