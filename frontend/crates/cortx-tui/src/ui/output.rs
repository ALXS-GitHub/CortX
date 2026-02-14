use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

use ansi_to_tui::IntoText;
use cortx_core::models::LogStream;

use crate::app::{App, ActivePanel};
use crate::ui::theme;

pub fn render(f: &mut Frame, area: Rect, app: &mut App) {
    let is_active = app.active_panel == ActivePanel::Output;

    let border_style = if is_active {
        theme::style_border_active()
    } else {
        theme::style_border_inactive()
    };

    let logs = app.get_active_logs();
    let log_count = logs.len();

    let scroll_indicator = if app.auto_scroll { "auto" } else { "manual" };
    let title = match &app.active_script_id {
        Some(id) => {
            let name = app
                .scripts
                .iter()
                .find(|s| s.id == *id)
                .map(|s| s.name.as_str())
                .unwrap_or("?");
            format!(" Output: {} [{}] ({} lines) ", name, scroll_indicator, log_count)
        }
        None => " Output ".to_string(),
    };

    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(border_style);

    if logs.is_empty() {
        let empty = Paragraph::new("No output. Run a script with Enter.")
            .style(Style::default().fg(theme::TEXT_MUTED))
            .block(block);
        f.render_widget(empty, area);
        return;
    }

    let lines: Vec<Line> = logs
        .iter()
        .flat_map(|log| {
            match log.stream {
                LogStream::Stdout => {
                    // Parse ANSI codes into styled spans
                    if let Ok(text) = log.content.as_bytes().into_text() {
                        text.lines.into_iter().collect::<Vec<_>>()
                    } else {
                        vec![Line::styled(log.content.clone(), Style::default().fg(theme::LOG_STDOUT))]
                    }
                }
                LogStream::Stderr => {
                    // Stderr always in red, strip any ANSI codes
                    vec![Line::styled(log.content.clone(), Style::default().fg(theme::LOG_STDERR))]
                }
            }
        })
        .collect();

    // Calculate visible height (area height minus 2 for borders)
    let visible_height = area.height.saturating_sub(2) as usize;
    let max_scroll = log_count.saturating_sub(visible_height);

    // Auto-scroll: always show latest
    if app.auto_scroll {
        app.output_scroll = max_scroll;
    } else {
        // Clamp manual scroll
        if app.output_scroll > max_scroll {
            app.output_scroll = max_scroll;
        }
    }

    let paragraph = Paragraph::new(lines)
        .block(block)
        .wrap(Wrap { trim: false })
        .scroll((app.output_scroll as u16, 0));

    f.render_widget(paragraph, area);
}
