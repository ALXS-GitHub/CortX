use ratatui::prelude::*;
use ratatui::widgets::Paragraph;

use crate::app::{App, ActiveTab};
use crate::ui::theme;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let active_style = Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD);
    let inactive_style = Style::default().fg(theme::TEXT_MUTED);

    let projects_style = if app.active_tab == ActiveTab::Projects { active_style } else { inactive_style };
    let scripts_style = if app.active_tab == ActiveTab::Scripts { active_style } else { inactive_style };
    let tools_style = if app.active_tab == ActiveTab::Tools { active_style } else { inactive_style };
    let aliases_style = if app.active_tab == ActiveTab::Aliases { active_style } else { inactive_style };
    let apps_style = if app.active_tab == ActiveTab::Apps { active_style } else { inactive_style };

    let line = Line::from(vec![
        Span::raw(" "),
        Span::styled("[1]", Style::default().fg(theme::TEXT_HIGHLIGHT)),
        Span::styled(" Projects", projects_style),
        Span::styled(" | ", Style::default().fg(theme::TEXT_MUTED)),
        Span::styled("[2]", Style::default().fg(theme::TEXT_HIGHLIGHT)),
        Span::styled(" Scripts", scripts_style),
        Span::styled(" | ", Style::default().fg(theme::TEXT_MUTED)),
        Span::styled("[3]", Style::default().fg(theme::TEXT_HIGHLIGHT)),
        Span::styled(" Tools", tools_style),
        Span::styled(" | ", Style::default().fg(theme::TEXT_MUTED)),
        Span::styled("[4]", Style::default().fg(theme::TEXT_HIGHLIGHT)),
        Span::styled(" Aliases", aliases_style),
        Span::styled(" | ", Style::default().fg(theme::TEXT_MUTED)),
        Span::styled("[5]", Style::default().fg(theme::TEXT_HIGHLIGHT)),
        Span::styled(" Apps", apps_style),
        Span::raw(" "),
    ]);

    let para = Paragraph::new(line).style(Style::default().bg(Color::Rgb(30, 30, 40)));
    f.render_widget(para, area);
}
