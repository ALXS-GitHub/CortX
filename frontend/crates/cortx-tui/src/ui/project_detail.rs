use ansi_to_tui::IntoText;
use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap};

use cortx_core::models::{LogStream, ServiceStatus};

use crate::app::{ActivePanel, App};
use crate::ui::theme;

pub fn render(f: &mut Frame, area: Rect, app: &mut App) {
    // Vertical split: 1-line header on top, body below.
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(0)])
        .split(area);

    render_header(f, chunks[0], app);

    // Horizontal split: services list (35%) | right column (65%)
    let h_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(35), Constraint::Percentage(65)])
        .split(chunks[1]);

    let left = h_chunks[0];
    let right = h_chunks[1];

    // Right column: info (10 lines) | output (rest)
    let r_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(10), Constraint::Min(0)])
        .split(right);

    render_services_list(f, left, app);
    render_service_info(f, r_chunks[0], app);
    render_service_output(f, r_chunks[1], app);
}

fn render_header(f: &mut Frame, area: Rect, app: &App) {
    let name = app
        .viewing_project()
        .map(|p| p.name.as_str())
        .unwrap_or("?");
    let line = Line::from(vec![
        Span::styled(" Project: ", Style::default().fg(theme::TEXT_SECONDARY)),
        Span::styled(
            name,
            Style::default()
                .fg(theme::TEXT_PRIMARY)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw("   "),
        Span::styled("Esc", Style::default().fg(theme::TEXT_HIGHLIGHT)),
        Span::styled(" Back to projects", Style::default().fg(theme::TEXT_SECONDARY)),
    ]);
    let p = Paragraph::new(line).style(Style::default().bg(Color::Rgb(30, 30, 40)));
    f.render_widget(p, area);
}

fn render_services_list(f: &mut Frame, area: Rect, app: &App) {
    let is_active = app.active_panel == ActivePanel::ScriptList;
    let border_style = if is_active {
        theme::style_border_active()
    } else {
        theme::style_border_inactive()
    };

    let services = app.viewing_project_services();
    let title = format!(" Services ({}) ", services.len());
    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(border_style);

    let items: Vec<ListItem> = services
        .iter()
        .map(|svc| {
            let status = app
                .service_runtimes
                .get(&svc.id)
                .map(|r| r.status)
                .unwrap_or(ServiceStatus::Stopped);
            let (sym, style) = service_status_style(status);
            let line = Line::from(vec![
                Span::styled(format!("{} ", sym), style),
                Span::styled(svc.name.as_str(), Style::default().fg(theme::TEXT_PRIMARY)),
            ]);
            ListItem::new(line)
        })
        .collect();

    let mut state = ListState::default();
    if !services.is_empty() {
        state.select(Some(app.services_selected_index.min(services.len() - 1)));
    }

    let list = List::new(items)
        .block(block)
        .highlight_style(theme::style_selected())
        .highlight_symbol("\u{25b6} "); // ▶

    f.render_stateful_widget(list, area, &mut state);
}

fn render_service_info(f: &mut Frame, area: Rect, app: &App) {
    let block = Block::default()
        .title(" Service ")
        .borders(Borders::ALL)
        .border_style(theme::style_border_inactive());

    let svc = match app.selected_service() {
        Some(s) => s,
        None => {
            let empty = Paragraph::new("No service selected")
                .style(Style::default().fg(theme::TEXT_MUTED))
                .block(block);
            f.render_widget(empty, area);
            return;
        }
    };

    let status = app
        .service_runtimes
        .get(&svc.id)
        .map(|r| r.status)
        .unwrap_or(ServiceStatus::Stopped);
    let (sym, status_style) = service_status_style(status);

    let mut lines = vec![
        Line::from(vec![
            Span::styled("Name: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(
                svc.name.as_str(),
                Style::default()
                    .fg(theme::TEXT_PRIMARY)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(vec![
            Span::styled("Status: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(format!("{} {:?}", sym, status), status_style),
        ]),
        Line::from(vec![
            Span::styled("Command: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(svc.command.as_str(), Style::default().fg(theme::TEXT_HIGHLIGHT)),
        ]),
        Line::from(vec![
            Span::styled("Working dir: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(
                svc.working_dir.as_str(),
                Style::default().fg(theme::TEXT_PRIMARY),
            ),
        ]),
    ];

    if let Some(port) = svc.port {
        lines.push(Line::from(vec![
            Span::styled("Port: ", Style::default().fg(theme::TEXT_SECONDARY)),
            Span::styled(port.to_string(), Style::default().fg(theme::TEXT_PRIMARY)),
        ]));
    }

    if let Some(runtime) = app.service_runtimes.get(&svc.id) {
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

    let p = Paragraph::new(lines).block(block).wrap(Wrap { trim: true });
    f.render_widget(p, area);
}

fn render_service_output(f: &mut Frame, area: Rect, app: &mut App) {
    let is_active = app.active_panel == ActivePanel::Output;
    let border_style = if is_active {
        theme::style_border_active()
    } else {
        theme::style_border_inactive()
    };

    let logs = app.get_active_service_logs();
    let log_count = logs.len();

    let scroll_indicator = if app.auto_scroll { "auto" } else { "manual" };
    let title = match app.active_service_id.as_ref() {
        Some(id) => {
            let name = app
                .viewing_project_services()
                .iter()
                .find(|s| &s.id == id)
                .map(|s| s.name.clone())
                .unwrap_or_else(|| "?".to_string());
            format!(
                " Output: {} [{}] ({} lines) ",
                name, scroll_indicator, log_count
            )
        }
        None => " Output ".to_string(),
    };

    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(border_style);

    if logs.is_empty() {
        let empty = Paragraph::new("No output. Press Enter to start the selected service.")
            .style(Style::default().fg(theme::TEXT_MUTED))
            .block(block);
        f.render_widget(empty, area);
        return;
    }

    let lines: Vec<Line> = logs
        .iter()
        .flat_map(|log| match log.stream {
            LogStream::Stdout => {
                if let Ok(text) = log.content.as_bytes().into_text() {
                    text.lines.into_iter().collect::<Vec<_>>()
                } else {
                    vec![Line::styled(
                        log.content.clone(),
                        Style::default().fg(theme::LOG_STDOUT),
                    )]
                }
            }
            LogStream::Stderr => vec![Line::styled(
                log.content.clone(),
                Style::default().fg(theme::LOG_STDERR),
            )],
        })
        .collect();

    let visible_height = area.height.saturating_sub(2) as usize;
    let max_scroll = log_count.saturating_sub(visible_height);

    if app.auto_scroll {
        app.output_scroll = max_scroll;
    } else if app.output_scroll > max_scroll {
        app.output_scroll = max_scroll;
    }

    let paragraph = Paragraph::new(lines)
        .block(block)
        .wrap(Wrap { trim: false })
        .scroll((app.output_scroll as u16, 0));

    f.render_widget(paragraph, area);
}

fn service_status_style(status: ServiceStatus) -> (&'static str, Style) {
    match status {
        ServiceStatus::Running => ("\u{25cf}", Style::default().fg(theme::STATUS_RUNNING)),
        ServiceStatus::Starting => ("\u{25cb}", Style::default().fg(theme::STATUS_RUNNING)),
        ServiceStatus::Stopped => ("\u{25cb}", Style::default().fg(theme::STATUS_IDLE)),
        ServiceStatus::Error => ("\u{25cf}", Style::default().fg(theme::STATUS_FAILED)),
    }
}
