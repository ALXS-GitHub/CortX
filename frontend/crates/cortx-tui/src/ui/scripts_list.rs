use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, List, ListItem, ListState};

use crate::app::{App, ActivePanel};
use crate::ui::theme;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let is_active = app.active_panel == ActivePanel::ScriptList;

    let border_style = if is_active {
        theme::style_border_active()
    } else {
        theme::style_border_inactive()
    };

    let title = format!(" Scripts ({}) ", app.filtered_indices.len());
    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(border_style);

    let items: Vec<ListItem> = app
        .filtered_indices
        .iter()
        .map(|&idx| {
            let script = &app.scripts[idx];
            let status = app
                .runtimes
                .get(&script.id)
                .map(|r| &r.status)
                .unwrap_or(&cortx_core::models::ScriptStatus::Idle);

            let symbol = theme::style_status_symbol(status);
            let status_style = theme::style_status(status);

            // Build folder prefix with its configured color
            let (folder_prefix, folder_color) = script
                .folder_id
                .as_ref()
                .and_then(|fid| app.folders.iter().find(|f| f.id == *fid))
                .map(|folder| {
                    let color = folder.color.as_deref()
                        .map(theme::color_from_hex)
                        .unwrap_or(theme::FOLDER_COLOR);
                    (format!("[{}] ", folder.name), color)
                })
                .unwrap_or_default();

            let line = Line::from(vec![
                Span::styled(format!("{} ", symbol), status_style),
                Span::styled(folder_prefix, Style::default().fg(folder_color)),
                Span::styled(&script.name, Style::default().fg(theme::TEXT_PRIMARY)),
            ]);

            ListItem::new(line)
        })
        .collect();

    let mut state = ListState::default();
    if !app.filtered_indices.is_empty() {
        state.select(Some(app.selected_index));
    }

    let list = List::new(items)
        .block(block)
        .highlight_style(theme::style_selected())
        .highlight_symbol("▶ ");

    f.render_stateful_widget(list, area, &mut state);
}
