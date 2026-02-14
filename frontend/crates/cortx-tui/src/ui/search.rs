use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Clear, Paragraph};

use crate::app::{App, InputMode};
use crate::ui::theme;

pub fn render(f: &mut Frame, app: &App) {
    if app.input_mode != InputMode::Search {
        return;
    }

    // Overlay in center top area
    let area = f.area();
    let popup_width = 50u16.min(area.width.saturating_sub(4));
    let popup_height = 3u16;

    let x = (area.width.saturating_sub(popup_width)) / 2;
    let y = area.height / 4;

    let popup_area = Rect::new(x, y, popup_width, popup_height);

    // Clear background
    f.render_widget(Clear, popup_area);

    let input_text = format!("/{}", app.search_query);

    let block = Block::default()
        .title(" Search ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::SEARCH_MATCH));

    let paragraph = Paragraph::new(Line::from(vec![
        Span::styled(&input_text, Style::default().fg(theme::TEXT_PRIMARY)),
        Span::styled("█", Style::default().fg(theme::SEARCH_MATCH)),
    ]))
    .block(block);

    f.render_widget(paragraph, popup_area);
}
