use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

use crate::app::App;
use crate::ui::theme;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let block = Block::default()
        .title(" Alias Info ")
        .borders(Borders::ALL)
        .border_style(theme::style_border_inactive());

    let alias = match app.selected_alias() {
        Some(a) => a,
        None => {
            let empty = Paragraph::new("No alias selected")
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
                &alias.name,
                Style::default()
                    .fg(theme::TEXT_PRIMARY)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(vec![
            Span::styled("Command: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(&alias.command, Style::default().fg(theme::TEXT_HIGHLIGHT)),
        ]),
    ];

    if let Some(ref desc) = alias.description {
        if !desc.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Description: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(desc.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
            ]));
        }
    }

    if !alias.tags.is_empty() {
        let mut spans = vec![Span::styled(
            "Tags: ",
            Style::default().fg(theme::TEXT_SECONDARY),
        )];
        for (i, tag) in alias.tags.iter().enumerate() {
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

    // Shell usage hint
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Shell Setup:",
        Style::default()
            .fg(theme::TEXT_PRIMARY)
            .add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::from(vec![
        Span::styled(
            "  PowerShell: ",
            Style::default().fg(theme::TEXT_SECONDARY),
        ),
        Span::styled(
            "Invoke-Expression (& cortx init powershell)",
            Style::default().fg(theme::TEXT_MUTED),
        ),
    ]));
    lines.push(Line::from(vec![
        Span::styled(
            "  Bash/Zsh:   ",
            Style::default().fg(theme::TEXT_SECONDARY),
        ),
        Span::styled(
            "eval \"$(cortx init bash)\"",
            Style::default().fg(theme::TEXT_MUTED),
        ),
    ]));
    lines.push(Line::from(vec![
        Span::styled(
            "  Fish:       ",
            Style::default().fg(theme::TEXT_SECONDARY),
        ),
        Span::styled(
            "cortx init fish | source",
            Style::default().fg(theme::TEXT_MUTED),
        ),
    ]));

    let paragraph = Paragraph::new(lines)
        .block(block)
        .wrap(Wrap { trim: true });
    f.render_widget(paragraph, area);
}
