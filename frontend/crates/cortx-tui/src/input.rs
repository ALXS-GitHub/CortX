use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use crate::app::{App, InputMode, ActivePanel};
use cortx_core::models::ScriptParamType;

pub fn handle_key(app: &mut App, key: KeyEvent) {
    match app.input_mode {
        InputMode::Normal => handle_normal(app, key),
        InputMode::Search => handle_search(app, key),
        InputMode::Help => handle_help(app, key),
        InputMode::ParamForm => handle_param_form(app, key),
    }
}

fn handle_normal(app: &mut App, key: KeyEvent) {
    match key.code {
        // Quit
        KeyCode::Char('q') => app.should_quit = true,
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            app.should_quit = true;
        }

        // Navigation
        KeyCode::Char('j') | KeyCode::Down => {
            match app.active_panel {
                ActivePanel::ScriptList => app.move_down(),
                ActivePanel::Output => app.scroll_output_down(),
            }
        }
        KeyCode::Char('k') | KeyCode::Up => {
            match app.active_panel {
                ActivePanel::ScriptList => app.move_up(),
                ActivePanel::Output => app.scroll_output_up(),
            }
        }
        KeyCode::Char('g') => app.move_top(),
        KeyCode::Char('G') => app.move_bottom(),

        // Panel switch
        KeyCode::Tab => app.toggle_panel(),

        // Clear search filter
        KeyCode::Esc => app.clear_filter(),

        // Actions
        KeyCode::Enter if key.modifiers.contains(KeyModifiers::CONTROL) => {
            app.quick_run();
        }
        KeyCode::Enter => app.enter_run(),
        KeyCode::Char('s') => app.stop_selected(),

        // Search
        KeyCode::Char('/') => app.enter_search(),

        // Output controls
        KeyCode::Char('c') => {
            if app.active_panel == ActivePanel::Output {
                app.clear_active_logs();
            }
        }
        KeyCode::Char('f') => {
            if app.active_panel == ActivePanel::Output {
                app.toggle_auto_scroll();
            }
        }

        // Reload
        KeyCode::Char('r') => app.reload_scripts(),

        // Help
        KeyCode::Char('?') => app.input_mode = InputMode::Help,

        _ => {}
    }
}

fn handle_search(app: &mut App, key: KeyEvent) {
    match key.code {
        KeyCode::Esc => app.exit_search(),
        KeyCode::Enter => app.confirm_search(),
        KeyCode::Backspace => app.search_backspace(),
        KeyCode::Char(c) => app.search_input(c),
        _ => {}
    }
}

fn handle_help(app: &mut App, key: KeyEvent) {
    match key.code {
        KeyCode::Esc | KeyCode::Char('q') | KeyCode::Char('?') => {
            app.input_mode = InputMode::Normal;
        }
        _ => {}
    }
}

fn handle_param_form(app: &mut App, key: KeyEvent) {
    let form = match app.param_form.as_mut() {
        Some(f) => f,
        None => {
            app.input_mode = InputMode::Normal;
            return;
        }
    };

    // Preset picker mode
    if form.picking_preset {
        let preset_count = form.script.parameter_presets.len();
        match key.code {
            KeyCode::Esc | KeyCode::Char('q') | KeyCode::Char('p') => {
                form.picking_preset = false;
            }
            KeyCode::Char('j') | KeyCode::Down => {
                if form.preset_index + 1 < preset_count {
                    form.preset_index += 1;
                }
            }
            KeyCode::Char('k') | KeyCode::Up => {
                if form.preset_index > 0 {
                    form.preset_index -= 1;
                }
            }
            KeyCode::Enter => {
                if let Some(f) = app.param_form.as_mut() {
                    let idx = f.preset_index;
                    f.apply_preset(idx);
                }
            }
            _ => {}
        }
        return;
    }

    if form.editing {
        // Text editing mode for the focused field
        match key.code {
            KeyCode::Esc | KeyCode::Enter => {
                form.editing = false;
            }
            KeyCode::Left => {
                if form.cursor_pos > 0 {
                    form.cursor_pos -= 1;
                }
            }
            KeyCode::Right => {
                let len = if form.is_extra_args_focused() {
                    form.extra_args.len()
                } else if let Some(name) = form.focused_param_name() {
                    form.values.get(name).map_or(0, |v| v.len())
                } else {
                    0
                };
                if form.cursor_pos < len {
                    form.cursor_pos += 1;
                }
            }
            KeyCode::Home => {
                form.cursor_pos = 0;
            }
            KeyCode::End => {
                let len = if form.is_extra_args_focused() {
                    form.extra_args.len()
                } else if let Some(name) = form.focused_param_name() {
                    form.values.get(name).map_or(0, |v| v.len())
                } else {
                    0
                };
                form.cursor_pos = len;
            }
            KeyCode::Backspace => {
                if form.cursor_pos > 0 {
                    if form.is_extra_args_focused() {
                        form.extra_args.remove(form.cursor_pos - 1);
                    } else if let Some(name) = form.focused_param_name() {
                        let name = name.to_string();
                        if let Some(val) = form.values.get_mut(&name) {
                            val.remove(form.cursor_pos - 1);
                        }
                    }
                    form.cursor_pos -= 1;
                }
            }
            KeyCode::Delete => {
                let len = if form.is_extra_args_focused() {
                    form.extra_args.len()
                } else if let Some(name) = form.focused_param_name() {
                    form.values.get(name).map_or(0, |v| v.len())
                } else {
                    0
                };
                if form.cursor_pos < len {
                    if form.is_extra_args_focused() {
                        form.extra_args.remove(form.cursor_pos);
                    } else if let Some(name) = form.focused_param_name() {
                        let name = name.to_string();
                        if let Some(val) = form.values.get_mut(&name) {
                            val.remove(form.cursor_pos);
                        }
                    }
                }
            }
            KeyCode::Char(c) => {
                if form.is_extra_args_focused() {
                    form.extra_args.insert(form.cursor_pos, c);
                } else if let Some(name) = form.focused_param_name() {
                    let name = name.to_string();
                    form.values.entry(name).or_default().insert(form.cursor_pos, c);
                }
                form.cursor_pos += 1;
            }
            _ => {}
        }
        return;
    }

    // Navigation mode
    match key.code {
        KeyCode::Esc | KeyCode::Char('q') => {
            app.cancel_param_form();
        }
        // Confirm and run
        KeyCode::Char('x') => {
            app.confirm_param_form();
        }
        // Open preset picker
        KeyCode::Char('p') => {
            if let Some(f) = app.param_form.as_mut() {
                if !f.script.parameter_presets.is_empty() {
                    f.picking_preset = true;
                    f.preset_index = 0;
                }
            }
        }
        // Navigate fields
        KeyCode::Char('j') | KeyCode::Down | KeyCode::Tab => {
            if let Some(f) = app.param_form.as_mut() {
                f.move_down();
            }
        }
        KeyCode::Char('k') | KeyCode::Up | KeyCode::BackTab => {
            if let Some(f) = app.param_form.as_mut() {
                f.move_up();
            }
        }
        // Toggle enabled/disabled for optional params
        KeyCode::Char(' ') => {
            if let Some(f) = app.param_form.as_mut() {
                if f.is_extra_args_focused() {
                    // Space in extra_args starts editing
                    f.cursor_pos = f.extra_args.len();
                    f.editing = true;
                } else {
                    f.toggle_focused();
                }
            }
        }
        // Enter edit mode
        KeyCode::Enter => {
            if let Some(f) = app.param_form.as_mut() {
                if f.is_extra_args_focused() {
                    f.cursor_pos = f.extra_args.len();
                    f.editing = true;
                } else {
                    let focused_name = f.focused_param_name().map(|s| s.to_string());
                    if let Some(name) = focused_name {
                        let param = f.script.parameters.iter().find(|p| p.name == name);
                        if let Some(param) = param {
                            if param.param_type == ScriptParamType::Bool {
                                f.toggle_bool();
                                // Auto-enable the param when toggling its value
                                f.enabled.insert(name, true);
                            } else {
                                // Make sure param is enabled before editing
                                let len = f.values.get(&name).map_or(0, |v| v.len());
                                f.cursor_pos = len;
                                f.enabled.insert(name, true);
                                f.editing = true;
                            }
                        }
                    }
                }
            }
        }
        _ => {}
    }
}
