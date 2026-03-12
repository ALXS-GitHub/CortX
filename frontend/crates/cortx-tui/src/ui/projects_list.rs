use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, List, ListItem, ListState};

use crate::app::App;
use crate::ui::theme;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let border_style = theme::style_border_active();

    let title = format!(" Projects ({}) ", app.projects_filtered_indices.len());
    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(border_style);

    let mut items: Vec<ListItem> = Vec::new();
    let mut display_selected: usize = 0;
    let mut last_primary_tag: Option<&str> = None;

    for (fi, &idx) in app.projects_filtered_indices.iter().enumerate() {
        let project = &app.projects[idx];
        let primary_tag = project.tags.first().map(|s| s.as_str());

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

            if fi <= app.projects_selected_index {
                display_selected += 1;
            }
            last_primary_tag = primary_tag;
        }

        // Build item with status indicator
        let mut spans = Vec::new();

        // Status indicator from status definitions
        if let Some(ref status) = project.status {
            let status_color = app
                .status_definitions
                .iter()
                .find(|d| d.name.eq_ignore_ascii_case(status))
                .and_then(|d| d.color.as_deref())
                .and_then(theme::color_from_hex)
                .unwrap_or(theme::TEXT_MUTED);
            spans.push(Span::styled("\u{25cf} ", Style::default().fg(status_color))); // ●
        } else {
            spans.push(Span::styled("\u{25cb} ", Style::default().fg(theme::TEXT_MUTED))); // ○
        }

        spans.push(Span::styled(&project.name, Style::default().fg(theme::TEXT_PRIMARY)));

        // Show service count if any
        if !project.services.is_empty() {
            spans.push(Span::styled(
                format!(" ({}svc)", project.services.len()),
                Style::default().fg(theme::TEXT_MUTED),
            ));
        }

        let line = Line::from(spans);
        items.push(ListItem::new(line));
    }

    display_selected += app.projects_selected_index;

    let mut state = ListState::default();
    if !app.projects_filtered_indices.is_empty() {
        state.select(Some(display_selected));
    }

    let list = List::new(items)
        .block(block)
        .highlight_style(theme::style_selected())
        .highlight_symbol("\u{25b6} "); // ▶

    f.render_stateful_widget(list, area, &mut state);
}
