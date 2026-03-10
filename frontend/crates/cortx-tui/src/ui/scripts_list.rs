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

    let mut items: Vec<ListItem> = Vec::new();
    let mut display_selected: usize = 0;
    let mut last_primary_tag: Option<&str> = None;

    for (fi, &idx) in app.filtered_indices.iter().enumerate() {
        let script = &app.scripts[idx];
        let primary_tag = script.tags.first().map(|s| s.as_str());

        // Insert separator when primary tag changes
        if primary_tag != last_primary_tag {
            let (label, color) = match primary_tag {
                Some(t) => (t, theme::tag_color(t, &app.tag_definitions)),
                None => ("other", theme::TEXT_MUTED),
            };
            let sep_line = Line::from(vec![
                Span::styled("── ", Style::default().fg(theme::SEPARATOR_COLOR)),
                Span::styled(label, Style::default().fg(color)),
                Span::styled(" ──", Style::default().fg(theme::SEPARATOR_COLOR)),
            ]);
            items.push(ListItem::new(sep_line));

            if fi <= app.selected_index {
                display_selected += 1;
            }
            last_primary_tag = primary_tag;
        }

        // Build normal item
        let status = app
            .runtimes
            .get(&script.id)
            .map(|r| &r.status)
            .unwrap_or(&cortx_core::models::ScriptStatus::Idle);

        let symbol = theme::style_status_symbol(status);
        let status_style = theme::style_status(status);

        let line = Line::from(vec![
            Span::styled(format!("{} ", symbol), status_style),
            Span::styled(&script.name, Style::default().fg(theme::TEXT_PRIMARY)),
        ]);

        items.push(ListItem::new(line));
    }

    display_selected += app.selected_index;

    let mut state = ListState::default();
    if !app.filtered_indices.is_empty() {
        state.select(Some(display_selected));
    }

    let list = List::new(items)
        .block(block)
        .highlight_style(theme::style_selected())
        .highlight_symbol("\u{25b6} "); // ▶

    f.render_stateful_widget(list, area, &mut state);
}
