use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

use crate::app::App;
use crate::ui::theme;
use crate::util::format_command_display;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let block = Block::default()
        .title(" Info ")
        .borders(Borders::ALL)
        .border_style(theme::style_border_inactive());

    let script = match app.selected_script() {
        Some(s) => s,
        None => {
            let empty = Paragraph::new("No script selected")
                .style(Style::default().fg(theme::TEXT_MUTED))
                .block(block);
            f.render_widget(empty, area);
            return;
        }
    };

    let status = app
        .runtimes
        .get(&script.id)
        .map(|r| &r.status)
        .unwrap_or(&cortx_core::models::ScriptStatus::Idle);
    let status_sym = theme::style_status_symbol(status);
    let status_style = theme::style_status(status);

    let mut lines = vec![
        Line::from(vec![
            Span::styled("Name: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(&script.name, Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD)),
        ]),
        Line::from(vec![
            Span::styled("Status: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(format!("{} {:?}", status_sym, status), status_style),
        ]),
        Line::from(vec![
            Span::styled("Command: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(format_command_display(&script.command, script.script_path.as_deref()), Style::default().fg(theme::TEXT_HIGHLIGHT)),
        ]),
        Line::from(vec![
            Span::styled("Working dir: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(
                script.working_dir.as_deref().unwrap_or("(CWD)"),
                Style::default().fg(theme::TEXT_PRIMARY),
            ),
        ]),
    ];

    if let Some(ref desc) = script.description {
        if !desc.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Description: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(desc.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
            ]));
        }
    }

    if !script.tags.is_empty() {
        let tags_str = script.tags.join(", ");
        lines.push(Line::from(vec![
            Span::styled("Tags: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(tags_str, Style::default().fg(theme::TAG_COLOR)),
        ]));
    }

    if !script.parameters.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Parameters: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(
                format!("{} defined", script.parameters.len()),
                Style::default().fg(theme::TEXT_PRIMARY),
            ),
        ]));
    }

    // Show runtime info
    if let Some(runtime) = app.runtimes.get(&script.id) {
        if let Some(ref cmd) = runtime.last_command {
            lines.push(Line::from(vec![
                Span::styled("Last run: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(cmd.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
            ]));
        }
        if let Some(pid) = runtime.pid {
            lines.push(Line::from(vec![
                Span::styled("PID: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(pid.to_string(), Style::default().fg(theme::TEXT_PRIMARY)),
            ]));
        }
        if let Some(exit_code) = runtime.exit_code {
            lines.push(Line::from(vec![
                Span::styled("Exit code: ", Style::default().fg(theme::TEXT_SECONDARY)),
                Span::styled(
                    exit_code.to_string(),
                    if exit_code == 0 {
                        Style::default().fg(theme::STATUS_COMPLETED)
                    } else {
                        Style::default().fg(theme::STATUS_FAILED)
                    },
                ),
            ]));
        }
    }

    let paragraph = Paragraph::new(lines).block(block).wrap(Wrap { trim: true });

    f.render_widget(paragraph, area);
}
