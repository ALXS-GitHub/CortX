use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};

use crate::app::{App, InputMode};
use crate::ui::theme;
use cortx_core::models::ScriptParamType;

pub fn render(f: &mut Frame, app: &App) {
    if app.input_mode != InputMode::ParamForm {
        return;
    }

    let form = match &app.param_form {
        Some(f) => f,
        None => return,
    };

    let area = f.area();
    let param_count = form.param_names.len();

    // Size: width 70, height = command(2) + params(2 each) + extra_args(3) + hints(2) + padding
    let popup_height = (4 + param_count * 2 + 5 + 3) as u16;
    let popup_width = 70u16.min(area.width.saturating_sub(4));
    let popup_height = popup_height.min(area.height.saturating_sub(2));

    let x = (area.width.saturating_sub(popup_width)) / 2;
    let y = (area.height.saturating_sub(popup_height)) / 2;
    let popup_area = Rect::new(x, y, popup_width, popup_height);

    f.render_widget(Clear, popup_area);

    let title = format!(" Run: {} ", form.script.name);
    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::BORDER_ACTIVE));

    let inner = block.inner(popup_area);
    f.render_widget(block, popup_area);

    // Build lines
    let mut lines: Vec<Line> = Vec::new();

    // Command preview
    let (prog, cmd_args) = form.build_command();
    let preview = format!("{} {}", prog, cmd_args.join(" "));
    lines.push(Line::from(vec![
        Span::styled("Command: ", Style::default().fg(theme::TEXT_SECONDARY)),
        Span::styled(
            truncate_str(&preview, (popup_width as usize).saturating_sub(14)),
            Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::ITALIC),
        ),
    ]));
    lines.push(Line::from(""));

    // Parameters
    for (i, param_def) in form.script.parameters.iter().enumerate() {
        let name = &param_def.name;
        let is_focused = i == form.focused;
        let is_enabled = form.enabled.get(name).copied().unwrap_or(false);
        let value = form.values.get(name).cloned().unwrap_or_default();

        // Build the parameter line
        let mut spans: Vec<Span> = Vec::new();

        // Focus indicator
        if is_focused {
            spans.push(Span::styled("▶ ", Style::default().fg(theme::TEXT_HIGHLIGHT)));
        } else {
            spans.push(Span::raw("  "));
        }

        // Enable checkbox (for optional params)
        if param_def.required {
            spans.push(Span::styled("[*] ", Style::default().fg(theme::STATUS_RUNNING)));
        } else if is_enabled {
            spans.push(Span::styled("[x] ", Style::default().fg(theme::STATUS_RUNNING)));
        } else {
            spans.push(Span::styled("[ ] ", Style::default().fg(theme::TEXT_MUTED)));
        }

        // Name + flag
        let flag_str = param_def.long_flag.as_deref()
            .or(param_def.short_flag.as_deref())
            .unwrap_or("(positional)");

        let name_style = if is_focused {
            Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD)
        } else if is_enabled {
            Style::default().fg(theme::TEXT_PRIMARY)
        } else {
            Style::default().fg(theme::TEXT_MUTED)
        };

        spans.push(Span::styled(name.clone(), name_style));
        spans.push(Span::styled(
            format!(" {}", flag_str),
            Style::default().fg(theme::TEXT_SECONDARY),
        ));

        lines.push(Line::from(spans));

        // Value line (indented)
        let mut val_spans: Vec<Span> = Vec::new();
        val_spans.push(Span::raw("      ")); // indent

        if param_def.param_type == ScriptParamType::Bool {
            if value == "true" {
                val_spans.push(Span::styled("[ON] ", Style::default().fg(theme::STATUS_RUNNING)));
            } else {
                val_spans.push(Span::styled("[OFF]", Style::default().fg(theme::TEXT_MUTED)));
            }
            if is_focused {
                val_spans.push(Span::styled(
                    " (Space/Enter to toggle)",
                    Style::default().fg(theme::TEXT_SECONDARY),
                ));
            }
        } else if !is_enabled {
            val_spans.push(Span::styled("(disabled)", Style::default().fg(theme::TEXT_MUTED)));
        } else if is_focused && form.editing {
            // Show editable value with cursor at position
            let pos = form.cursor_pos.min(value.len());
            let (before, after) = value.split_at(pos);
            val_spans.push(Span::styled(before.to_string(), Style::default().fg(theme::TEXT_HIGHLIGHT)));
            val_spans.push(Span::styled("█", Style::default().fg(theme::TEXT_HIGHLIGHT)));
            val_spans.push(Span::styled(after.to_string(), Style::default().fg(theme::TEXT_HIGHLIGHT)));
        } else if value.is_empty() {
            let placeholder = param_def.default_value.as_deref().unwrap_or("(empty)");
            val_spans.push(Span::styled(
                placeholder.to_string(),
                Style::default().fg(theme::TEXT_MUTED),
            ));
            if is_focused {
                val_spans.push(Span::styled(
                    " (Enter to edit)",
                    Style::default().fg(theme::TEXT_SECONDARY),
                ));
            }
        } else {
            val_spans.push(Span::styled(
                value,
                Style::default().fg(theme::TEXT_PRIMARY),
            ));
            if is_focused && !form.editing {
                val_spans.push(Span::styled(
                    " (Enter to edit)",
                    Style::default().fg(theme::TEXT_SECONDARY),
                ));
            }
        }

        lines.push(Line::from(val_spans));
    }

    // Extra arguments field
    let extra_focused = form.is_extra_args_focused();
    lines.push(Line::from(""));
    {
        let mut spans: Vec<Span> = Vec::new();
        if extra_focused {
            spans.push(Span::styled("▶ ", Style::default().fg(theme::TEXT_HIGHLIGHT)));
        } else {
            spans.push(Span::raw("  "));
        }
        let label_style = if extra_focused {
            Style::default().fg(theme::TEXT_PRIMARY).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(theme::TEXT_SECONDARY)
        };
        spans.push(Span::styled("Extra arguments", label_style));
        lines.push(Line::from(spans));

        let mut val_spans: Vec<Span> = Vec::new();
        val_spans.push(Span::raw("      "));
        if extra_focused && form.editing {
            let pos = form.cursor_pos.min(form.extra_args.len());
            let (before, after) = form.extra_args.split_at(pos);
            val_spans.push(Span::styled(before.to_string(), Style::default().fg(theme::TEXT_HIGHLIGHT)));
            val_spans.push(Span::styled("█", Style::default().fg(theme::TEXT_HIGHLIGHT)));
            val_spans.push(Span::styled(after.to_string(), Style::default().fg(theme::TEXT_HIGHLIGHT)));
        } else if form.extra_args.is_empty() {
            val_spans.push(Span::styled(
                "(none)",
                Style::default().fg(theme::TEXT_MUTED),
            ));
            if extra_focused {
                val_spans.push(Span::styled(
                    " (Enter to edit)",
                    Style::default().fg(theme::TEXT_SECONDARY),
                ));
            }
        } else {
            val_spans.push(Span::styled(
                form.extra_args.clone(),
                Style::default().fg(theme::TEXT_PRIMARY),
            ));
            if extra_focused && !form.editing {
                val_spans.push(Span::styled(
                    " (Enter to edit)",
                    Style::default().fg(theme::TEXT_SECONDARY),
                ));
            }
        }
        lines.push(Line::from(val_spans));
    }

    // Separator
    lines.push(Line::from(""));

    // Hints
    let hint_line = if form.picking_preset {
        Line::from(vec![
            Span::styled("j/k", Style::default().fg(theme::TEXT_HIGHLIGHT)),
            Span::raw(" Nav  "),
            Span::styled("Enter", Style::default().fg(theme::TEXT_HIGHLIGHT)),
            Span::raw(" Apply  "),
            Span::styled("Esc", Style::default().fg(theme::TEXT_HIGHLIGHT)),
            Span::raw(" Cancel"),
        ])
    } else if form.editing {
        Line::from(vec![
            Span::styled("Esc/Enter", Style::default().fg(theme::TEXT_HIGHLIGHT)),
            Span::raw(" Stop editing"),
        ])
    } else {
        let mut spans = vec![
            Span::styled("j/k", Style::default().fg(theme::TEXT_HIGHLIGHT)),
            Span::raw(" Nav  "),
            Span::styled("Enter", Style::default().fg(theme::TEXT_HIGHLIGHT)),
            Span::raw(" Edit/Toggle  "),
            Span::styled("Space", Style::default().fg(theme::TEXT_HIGHLIGHT)),
            Span::raw(" Enable  "),
        ];
        if !form.script.parameter_presets.is_empty() {
            spans.push(Span::styled("p", Style::default().fg(theme::TEXT_HIGHLIGHT)));
            spans.push(Span::raw(" Preset  "));
        }
        spans.push(Span::styled("x", Style::default().fg(theme::TEXT_HIGHLIGHT)));
        spans.push(Span::raw(" Run  "));
        spans.push(Span::styled("Esc", Style::default().fg(theme::TEXT_HIGHLIGHT)));
        spans.push(Span::raw(" Cancel"));
        Line::from(spans)
    };
    lines.push(hint_line);

    let paragraph = Paragraph::new(lines).wrap(Wrap { trim: false });
    f.render_widget(paragraph, inner);

    // Render preset picker overlay if active
    if form.picking_preset {
        render_preset_picker(f, popup_area, form);
    }
}

fn render_preset_picker(f: &mut Frame, parent_area: Rect, form: &crate::app::ParamFormState) {
    let presets = &form.script.parameter_presets;
    if presets.is_empty() {
        return;
    }

    let picker_height = (presets.len() as u16 + 2).min(parent_area.height.saturating_sub(4));
    let picker_width = 40u16.min(parent_area.width.saturating_sub(6));

    let x = parent_area.x + (parent_area.width.saturating_sub(picker_width)) / 2;
    let y = parent_area.y + (parent_area.height.saturating_sub(picker_height)) / 2;
    let picker_area = Rect::new(x, y, picker_width, picker_height);

    f.render_widget(Clear, picker_area);

    let block = Block::default()
        .title(" Presets ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::TEXT_HIGHLIGHT));

    let inner = block.inner(picker_area);
    f.render_widget(block, picker_area);

    let mut lines: Vec<Line> = Vec::new();
    for (i, preset) in presets.iter().enumerate() {
        let is_selected = i == form.preset_index;
        let prefix = if is_selected { "▶ " } else { "  " };
        let style = if is_selected {
            Style::default().fg(theme::TEXT_HIGHLIGHT).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(theme::TEXT_PRIMARY)
        };
        lines.push(Line::from(Span::styled(format!("{}{}", prefix, preset.name), style)));
    }

    let paragraph = Paragraph::new(lines);
    f.render_widget(paragraph, inner);
}

fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len.saturating_sub(3)])
    }
}
