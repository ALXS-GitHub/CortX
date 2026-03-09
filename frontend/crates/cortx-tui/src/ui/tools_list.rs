use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, List, ListItem, ListState};

use crate::app::App;
use crate::ui::theme;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let border_style = theme::style_border_active();

    let title = format!(" Tools ({}) ", app.tools_filtered_indices.len());
    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(border_style);

    let items: Vec<ListItem> = app
        .tools_filtered_indices
        .iter()
        .map(|&idx| {
            let tool = &app.tools[idx];

            let (symbol, status_color) = match tool.status.as_str() {
                "Active" => ("\u{25cf}", theme::STATUS_RUNNING),    // ●
                "Inactive" => ("\u{25cb}", theme::TEXT_MUTED),       // ○
                "Archived" | "Replaced" => ("\u{2717}", theme::STATUS_FAILED), // ✗
                _ => ("\u{25cb}", theme::TEXT_MUTED),                // ○
            };

            let mut spans = vec![
                Span::styled(format!("{} ", symbol), Style::default().fg(status_color)),
            ];

            if let Some(ref cat) = tool.category {
                spans.push(Span::styled(
                    format!("[{}] ", cat),
                    Style::default().fg(theme::FOLDER_COLOR),
                ));
            }

            spans.push(Span::styled(&tool.name, Style::default().fg(theme::TEXT_PRIMARY)));

            ListItem::new(Line::from(spans))
        })
        .collect();

    let mut state = ListState::default();
    if !app.tools_filtered_indices.is_empty() {
        state.select(Some(app.tools_selected_index));
    }

    let list = List::new(items)
        .block(block)
        .highlight_style(theme::style_selected())
        .highlight_symbol("\u{25b6} "); // ▶

    f.render_stateful_widget(list, area, &mut state);
}
