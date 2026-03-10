use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, ListState};

use crate::app::{App, InputMode};
use crate::ui::theme;

pub fn render(f: &mut Frame, app: &App) {
    if app.input_mode != InputMode::TagFilter {
        return;
    }

    let sorted_defs = app.sorted_tag_defs();

    let area = f.area();
    let popup_width = 36u16.min(area.width.saturating_sub(4));
    let content_height = 1 + sorted_defs.len() as u16; // "(All)" + each tag
    let popup_height = (content_height + 2).min(area.height.saturating_sub(4)); // +2 for borders

    let x = (area.width.saturating_sub(popup_width)) / 2;
    let y = (area.height.saturating_sub(popup_height)) / 2;

    let popup_area = Rect::new(x, y, popup_width, popup_height);
    f.render_widget(Clear, popup_area);

    let mut items: Vec<ListItem> = Vec::new();

    // "(All)" option
    let all_style = if app.active_tag_filter.is_none() {
        Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(theme::TEXT_PRIMARY)
    };
    items.push(ListItem::new(Line::from(Span::styled("(All)", all_style))));

    // Tag definitions
    for def in &sorted_defs {
        let color = def
            .color
            .as_deref()
            .and_then(theme::color_from_hex)
            .unwrap_or(theme::TAG_COLOR);
        let is_active = app
            .active_tag_filter
            .as_ref()
            .map(|f| f.eq_ignore_ascii_case(&def.name))
            .unwrap_or(false);
        let mut style = Style::default().fg(color);
        if is_active {
            style = style.add_modifier(Modifier::BOLD);
        }
        items.push(ListItem::new(Line::from(Span::styled(
            &def.name,
            style,
        ))));
    }

    let mut state = ListState::default();
    state.select(Some(app.tag_filter_index));

    let title = if app.active_tag_filter.is_some() {
        " Filter by Tag (active) "
    } else {
        " Filter by Tag "
    };

    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::BORDER_ACTIVE));

    let list = List::new(items)
        .block(block)
        .highlight_style(theme::style_selected())
        .highlight_symbol("\u{25b6} "); // ▶

    f.render_stateful_widget(list, popup_area, &mut state);
}
