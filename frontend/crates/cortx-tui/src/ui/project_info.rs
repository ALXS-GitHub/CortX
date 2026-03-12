use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

use crate::app::App;
use crate::ui::theme;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let block = Block::default()
        .title(" Project Info ")
        .borders(Borders::ALL)
        .border_style(theme::style_border_inactive());

    let project = match app.selected_project() {
        Some(p) => p,
        None => {
            let empty = Paragraph::new("No project selected")
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
                &project.name,
                Style::default()
                    .fg(theme::TEXT_PRIMARY)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
    ];

    // Status (colored from status definitions)
    if let Some(ref status) = project.status {
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

    // Root path
    lines.push(Line::from(vec![
        Span::styled("Path: ", Style::default().fg(theme::TEXT_SECONDARY)),
        Span::styled(&project.root_path, Style::default().fg(theme::TEXT_HIGHLIGHT)),
    ]));

    if let Some(ref desc) = project.description {
        if !desc.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Description: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(desc.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
            ]));
        }
    }

    if let Some(ref toolbox_url) = project.toolbox_url {
        if !toolbox_url.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Toolbox URL: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(toolbox_url.as_str(), Style::default().fg(theme::TEXT_HIGHLIGHT)),
            ]));
        }
    }

    if !project.tags.is_empty() {
        let mut spans = vec![Span::styled(
            "Tags: ",
            Style::default().fg(theme::TEXT_SECONDARY),
        )];
        for (i, tag) in project.tags.iter().enumerate() {
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

    // Services summary
    if !project.services.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled(
                format!("Services ({})", project.services.len()),
                Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD),
            ),
        ]));
        for svc in &project.services {
            let mut svc_spans = vec![
                Span::raw("  "),
                Span::styled("\u{25b8} ", Style::default().fg(theme::TEXT_MUTED)), // ▸
                Span::styled(&svc.name, Style::default().fg(theme::TEXT_PRIMARY)),
            ];
            if !svc.command.is_empty() {
                svc_spans.push(Span::styled(
                    format!(" [{}]", svc.command),
                    Style::default().fg(theme::TEXT_MUTED),
                ));
            }
            lines.push(Line::from(svc_spans));
        }
    }

    // Scripts summary
    if !project.scripts.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled(
                format!("Scripts ({})", project.scripts.len()),
                Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD),
            ),
        ]));
        for script in &project.scripts {
            lines.push(Line::from(vec![
                Span::raw("  "),
                Span::styled("\u{25b8} ", Style::default().fg(theme::TEXT_MUTED)), // ▸
                Span::styled(&script.name, Style::default().fg(theme::TEXT_PRIMARY)),
                Span::styled(
                    format!(" [{}]", script.command),
                    Style::default().fg(theme::TEXT_MUTED),
                ),
            ]));
        }
    }

    // Env files
    if !project.env_files.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled(
                format!("Env files ({})", project.env_files.len()),
                Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD),
            ),
        ]));
        for env in &project.env_files {
            lines.push(Line::from(vec![
                Span::raw("  "),
                Span::styled("\u{25b8} ", Style::default().fg(theme::TEXT_MUTED)),
                Span::styled(&env.filename, Style::default().fg(theme::TEXT_PRIMARY)),
                Span::styled(
                    format!(" ({})", env.relative_path),
                    Style::default().fg(theme::TEXT_MUTED),
                ),
            ]));
        }
    }

    let paragraph = Paragraph::new(lines)
        .block(block)
        .wrap(Wrap { trim: true });
    f.render_widget(paragraph, area);
}
