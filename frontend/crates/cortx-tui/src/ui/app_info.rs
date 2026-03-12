use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

use crate::app::App;
use crate::ui::theme;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let block = Block::default()
        .title(" App Info ")
        .borders(Borders::ALL)
        .border_style(theme::style_border_inactive());

    let core_app = match app.selected_app() {
        Some(a) => a,
        None => {
            let empty = Paragraph::new("No app selected")
                .style(Style::default().fg(theme::TEXT_MUTED))
                .block(block);
            f.render_widget(empty, area);
            return;
        }
    };

    let mut lines = vec![
        Line::from(vec![
            Span::styled("Name: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(
                &core_app.name,
                Style::default()
                    .fg(theme::TEXT_PRIMARY)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
    ];

    // Status (colored from status definitions)
    if let Some(ref status) = core_app.status {
        let status_color = app
            .status_definitions
            .iter()
            .find(|d| d.name.eq_ignore_ascii_case(status))
            .and_then(|d| d.color.as_deref())
            .and_then(theme::color_from_hex)
            .unwrap_or(theme::TEXT_MUTED);
        lines.push(Line::from(vec![
            Span::styled("Status: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(status.as_str(), Style::default().fg(status_color)),
        ]));
    }

    if let Some(ref desc) = core_app.description {
        if !desc.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Description: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(desc.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
            ]));
        }
    }

    if let Some(ref ver) = core_app.version {
        if !ver.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Version: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(ver.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
            ]));
        }
    }

    if let Some(ref exe) = core_app.executable_path {
        if !exe.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Executable: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(exe.as_str(), Style::default().fg(theme::TEXT_HIGHLIGHT)),
            ]));
        }
    }

    if let Some(ref args) = core_app.launch_args {
        if !args.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Launch args: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(args.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
            ]));
        }
    }

    if let Some(ref homepage) = core_app.homepage {
        if !homepage.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Homepage: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(homepage.as_str(), Style::default().fg(theme::TEXT_HIGHLIGHT)),
            ]));
        }
    }

    if let Some(ref toolbox_url) = core_app.toolbox_url {
        if !toolbox_url.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Toolbox URL: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(toolbox_url.as_str(), Style::default().fg(theme::TEXT_HIGHLIGHT)),
            ]));
        }
    }

    if !core_app.tags.is_empty() {
        let mut spans = vec![Span::styled(
            "Tags: ",
            Style::default().fg(theme::TEXT_SECONDARY),
        )];
        for (i, tag) in core_app.tags.iter().enumerate() {
            if i > 0 {
                spans.push(Span::styled(
                    ", ",
                    Style::default().fg(theme::TEXT_MUTED),
                ));
            }
            let color = theme::tag_color(tag, &app.tag_definitions);
            spans.push(Span::styled(tag.as_str(), Style::default().fg(color)));
        }
        lines.push(Line::from(spans));
    }

    if !core_app.config_paths.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Config paths:", Style::default().fg(theme::TEXT_SECONDARY)),
        ]));
        for cp in &core_app.config_paths {
            lines.push(Line::from(vec![
                Span::raw("  "),
                Span::styled(&cp.label, Style::default().fg(theme::TEXT_SECONDARY)),
                Span::raw(": "),
                Span::styled(&cp.path, Style::default().fg(theme::TEXT_PRIMARY)),
            ]));
        }
    }

    if let Some(ref notes) = core_app.notes {
        if !notes.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Notes: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(notes.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
            ]));
        }
    }

    let paragraph = Paragraph::new(lines)
        .block(block)
        .wrap(Wrap { trim: true });
    f.render_widget(paragraph, area);
}
