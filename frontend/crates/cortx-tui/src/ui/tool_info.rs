use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

use crate::app::App;
use crate::ui::theme;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let block = Block::default()
        .title(" Tool Info ")
        .borders(Borders::ALL)
        .border_style(theme::style_border_inactive());

    let tool = match app.selected_tool() {
        Some(t) => t,
        None => {
            let empty = Paragraph::new("No tool selected")
                .style(Style::default().fg(theme::TEXT_MUTED))
                .block(block);
            f.render_widget(empty, area);
            return;
        }
    };

    let status_color = match tool.status.as_str() {
        "Active" => theme::STATUS_RUNNING,
        "Inactive" => theme::TEXT_MUTED,
        "Archived" | "Replaced" => theme::STATUS_FAILED,
        _ => theme::TEXT_MUTED,
    };

    let mut lines = vec![
        Line::from(vec![
            Span::styled("Name: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(&tool.name, Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD)),
        ]),
        Line::from(vec![
            Span::styled("Status: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(&tool.status, Style::default().fg(status_color)),
        ]),
    ];

    if let Some(ref desc) = tool.description {
        if !desc.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Description: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(desc.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
            ]));
        }
    }

    if let Some(ref cat) = tool.category {
        lines.push(Line::from(vec![
            Span::styled("Category: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(cat.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
        ]));
    }

    if let Some(ref ver) = tool.version {
        lines.push(Line::from(vec![
            Span::styled("Version: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(ver.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
        ]));
    }

    if let Some(ref loc) = tool.install_location {
        lines.push(Line::from(vec![
            Span::styled("Location: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(loc.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
        ]));
    }

    if let Some(ref method) = tool.install_method {
        lines.push(Line::from(vec![
            Span::styled("Install: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(method.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
        ]));
    }

    if let Some(ref homepage) = tool.homepage {
        lines.push(Line::from(vec![
            Span::styled("Homepage: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(homepage.as_str(), Style::default().fg(theme::TEXT_HIGHLIGHT)),
        ]));
    }

    if !tool.tags.is_empty() {
        let tags_str = tool.tags.join(", ");
        lines.push(Line::from(vec![
            Span::styled("Tags: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(tags_str, Style::default().fg(theme::TAG_COLOR)),
        ]));
    }

    if !tool.config_paths.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Config paths:", Style::default().fg(theme::TEXT_SECONDARY)),
        ]));
        for cp in &tool.config_paths {
            lines.push(Line::from(vec![
                Span::raw("  "),
                Span::styled(&cp.label, Style::default().fg(theme::TEXT_SECONDARY)),
                Span::raw(": "),
                Span::styled(&cp.path, Style::default().fg(theme::TEXT_PRIMARY)),
            ]));
        }
    }

    if let Some(ref notes) = tool.notes {
        if !notes.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Notes: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(notes.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
            ]));
        }
    }

    if let Some(ref replaced_by) = tool.replaced_by {
        lines.push(Line::from(vec![
            Span::styled("Replaced by: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(replaced_by.as_str(), Style::default().fg(theme::STATUS_FAILED)),
        ]));
    }

    let paragraph = Paragraph::new(lines).block(block).wrap(Wrap { trim: true });
    f.render_widget(paragraph, area);
}
