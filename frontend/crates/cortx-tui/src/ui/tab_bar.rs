use ratatui::prelude::*;
use ratatui::widgets::Paragraph;

use crate::app::{App, ActiveTab};
use crate::ui::theme;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let (scripts_style, tools_style) = match app.active_tab {
        ActiveTab::Scripts => (
            Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD),
            Style::default().fg(theme::TEXT_MUTED),
        ),
        ActiveTab::Tools => (
            Style::default().fg(theme::TEXT_MUTED),
            Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD),
        ),
    };

    let line = Line::from(vec![
        Span::raw(" "),
        Span::styled("[1]", Style::default().fg(theme::TEXT_HIGHLIGHT)),
        Span::styled(" Scripts", scripts_style),
        Span::styled(" | ", Style::default().fg(theme::TEXT_MUTED)),
        Span::styled("[2]", Style::default().fg(theme::TEXT_HIGHLIGHT)),
        Span::styled(" Tools", tools_style),
        Span::raw(" "),
    ]);

    let para = Paragraph::new(line).style(Style::default().bg(Color::Rgb(30, 30, 40)));
    f.render_widget(para, area);
}
