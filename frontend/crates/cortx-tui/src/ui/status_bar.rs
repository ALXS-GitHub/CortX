use ratatui::prelude::*;
use ratatui::widgets::Paragraph;

use crate::app::{App, InputMode, ActivePanel, ActiveTab};
use crate::ui::theme;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let (left_text, right_text) = match app.input_mode {
        InputMode::ParamForm => {
            let left = Line::from(vec![
                Span::styled(" Parameters", Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD)),
            ]);
            let editing = app.param_form.as_ref().map(|f| f.editing).unwrap_or(false);
            let right = if editing {
                Line::from(vec![
                    Span::styled("Esc/Enter", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                    Span::raw(" Stop editing"),
                ])
            } else {
                Line::from(vec![
                    Span::styled("x", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                    Span::raw(" Run  "),
                    Span::styled("Esc", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                    Span::raw(" Cancel"),
                ])
            };
            (left, right)
        }
        InputMode::Search => {
            let query = match app.active_tab {
                ActiveTab::Scripts => &app.search_query,
                ActiveTab::Tools => &app.tools_search_query,
            };
            let left = Line::from(vec![
                Span::styled(" /", Style::default().fg(theme::SEARCH_MATCH).add_modifier(Modifier::BOLD)),
                Span::styled(query, Style::default().fg(theme::TEXT_PRIMARY)),
                Span::styled("\u{2588}", Style::default().fg(theme::TEXT_PRIMARY)),
            ]);
            let right = Line::from(vec![
                Span::styled("Enter", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                Span::raw(" Confirm  "),
                Span::styled("Esc", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                Span::raw(" Cancel"),
            ]);
            (left, right)
        }
        InputMode::Help => {
            let left = Line::from(vec![
                Span::styled(" Help", Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD)),
            ]);
            let right = Line::from(vec![
                Span::styled("Esc/q/?", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                Span::raw(" Close"),
            ]);
            (left, right)
        }
        InputMode::Normal => {
            match app.active_tab {
                ActiveTab::Scripts => {
                    let script_count = app.filtered_indices.len();
                    let running_count = app
                        .runtimes
                        .values()
                        .filter(|r| r.status == cortx_core::models::ScriptStatus::Running)
                        .count();

                    let hints = match app.active_panel {
                        ActivePanel::ScriptList => {
                            let mut hints = vec![
                                Span::styled(" q", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                                Span::raw(" Quit  "),
                                Span::styled("/", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                                Span::raw(" Search  "),
                                Span::styled("Enter", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                                Span::raw(" Run  "),
                                Span::styled("C-Enter", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                                Span::raw(" Quick  "),
                                Span::styled("s", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                                Span::raw(" Stop  "),
                                Span::styled("Tab", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                                Span::raw(" Output  "),
                                Span::styled("1/2", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                                Span::raw(" Tabs  "),
                                Span::styled("?", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                                Span::raw(" Help"),
                            ];
                            if !app.search_query.is_empty() {
                                hints.push(Span::raw("  "));
                                hints.push(Span::styled("Esc", Style::default().fg(theme::TEXT_HIGHLIGHT)));
                                hints.push(Span::raw(" Clear"));
                            }
                            hints
                        },
                        ActivePanel::Output => vec![
                            Span::styled(" c", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                            Span::raw(" Clear  "),
                            Span::styled("f", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                            Span::raw(" Auto-scroll  "),
                            Span::styled("j/k", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                            Span::raw(" Scroll  "),
                            Span::styled("Tab", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                            Span::raw(" Scripts  "),
                            Span::styled("1/2", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                            Span::raw(" Tabs  "),
                            Span::styled("?", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                            Span::raw(" Help"),
                        ],
                    };

                    let left = Line::from(hints);
                    let right = Line::from(vec![
                        Span::styled(
                            format!("{} scripts", script_count),
                            Style::default().fg(theme::TEXT_SECONDARY),
                        ),
                        if running_count > 0 {
                            Span::styled(
                                format!("  {} running ", running_count),
                                Style::default().fg(theme::STATUS_RUNNING),
                            )
                        } else {
                            Span::raw(" ")
                        },
                    ]);
                    (left, right)
                }
                ActiveTab::Tools => {
                    let tool_count = app.tools_filtered_indices.len();
                    let mut hints = vec![
                        Span::styled(" q", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                        Span::raw(" Quit  "),
                        Span::styled("/", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                        Span::raw(" Search  "),
                        Span::styled("r", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                        Span::raw(" Reload  "),
                        Span::styled("1/2", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                        Span::raw(" Tabs  "),
                        Span::styled("?", Style::default().fg(theme::TEXT_HIGHLIGHT)),
                        Span::raw(" Help"),
                    ];
                    if !app.tools_search_query.is_empty() {
                        hints.push(Span::raw("  "));
                        hints.push(Span::styled("Esc", Style::default().fg(theme::TEXT_HIGHLIGHT)));
                        hints.push(Span::raw(" Clear"));
                    }
                    let left = Line::from(hints);
                    let right = Line::from(vec![
                        Span::styled(
                            format!("{} tools ", tool_count),
                            Style::default().fg(theme::TEXT_SECONDARY),
                        ),
                    ]);
                    (left, right)
                }
            }
        }
    };

    // Split area: left side for hints, right side for stats
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Min(0), Constraint::Length(right_text.width() as u16 + 1)])
        .split(area);

    let left_para = Paragraph::new(left_text).style(Style::default().bg(Color::Rgb(30, 30, 40)));
    let right_para = Paragraph::new(right_text)
        .style(Style::default().bg(Color::Rgb(30, 30, 40)))
        .alignment(Alignment::Right);

    f.render_widget(left_para, chunks[0]);
    f.render_widget(right_para, chunks[1]);
}
