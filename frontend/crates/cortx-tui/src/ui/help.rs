use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};

use crate::app::{App, InputMode};
use crate::ui::theme;

pub fn render(f: &mut Frame, app: &App) {
    if app.input_mode != InputMode::Help {
        return;
    }

    let area = f.area();
    let popup_width = 60u16.min(area.width.saturating_sub(4));
    let popup_height = 22u16.min(area.height.saturating_sub(4));

    let x = (area.width.saturating_sub(popup_width)) / 2;
    let y = (area.height.saturating_sub(popup_height)) / 2;

    let popup_area = Rect::new(x, y, popup_width, popup_height);

    f.render_widget(Clear, popup_area);

    let help_lines = vec![
        Line::from(Span::styled(
            "CortX TUI - Keyboard Shortcuts",
            Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        help_line("j / ↓", "Move down"),
        help_line("k / ↑", "Move up"),
        help_line("g", "Go to top"),
        help_line("G", "Go to bottom"),
        help_line("Tab", "Switch panel (Scripts / Output)"),
        help_line("Enter", "Run script (opens run form)"),
        help_line("C-Enter", "Quick-run with last params"),
        help_line("s", "Stop active script"),
        help_line("/", "Search scripts"),
        help_line("Esc", "Clear search filter"),
        help_line("r", "Reload scripts (clears filter)"),
        Line::from(""),
        Line::from(Span::styled(
            "Output Panel:",
            Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD),
        )),
        help_line("c", "Clear output"),
        help_line("f", "Toggle auto-scroll"),
        help_line("j / k", "Scroll output"),
        Line::from(""),
        help_line("?", "Toggle this help"),
        help_line("q", "Quit"),
    ];

    let block = Block::default()
        .title(" Help ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::BORDER_ACTIVE));

    let paragraph = Paragraph::new(help_lines)
        .block(block)
        .wrap(Wrap { trim: true });

    f.render_widget(paragraph, popup_area);
}

fn help_line<'a>(key: &'a str, desc: &'a str) -> Line<'a> {
    Line::from(vec![
        Span::styled(
            format!("  {:>10}", key),
            Style::default().fg(theme::TEXT_HIGHLIGHT),
        ),
        Span::raw("  "),
        Span::styled(desc, Style::default().fg(theme::TEXT_PRIMARY)),
    ])
}
