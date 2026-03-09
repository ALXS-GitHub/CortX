mod theme;
mod scripts_list;
mod script_info;
mod output;
mod status_bar;
mod search;
mod help;
mod param_form;
mod tab_bar;
mod tools_list;
mod tool_info;

use ratatui::prelude::*;

use crate::app::{App, ActiveTab};

pub fn draw(f: &mut Frame, app: &mut App) {
    let area = f.area();

    // Main layout: tab bar (1 line) + body + status bar (1 line)
    let main_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(0),
            Constraint::Length(1),
        ])
        .split(area);

    let tab_area = main_chunks[0];
    let body = main_chunks[1];
    let status = main_chunks[2];

    // Tab bar
    tab_bar::render(f, tab_area, app);

    match app.active_tab {
        ActiveTab::Scripts => {
            // Body: left panel (scripts list) | right panel (info + output)
            let h_chunks = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(35), Constraint::Percentage(65)])
                .split(body);

            let left = h_chunks[0];
            let right = h_chunks[1];

            // Right panel: info (top) + output (bottom)
            let right_chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Length(10), Constraint::Min(0)])
                .split(right);

            let info_area = right_chunks[0];
            let output_area = right_chunks[1];

            scripts_list::render(f, left, app);
            script_info::render(f, info_area, app);
            output::render(f, output_area, app);
        }
        ActiveTab::Tools => {
            // Body: left panel (tools list) | right panel (tool info, full height)
            let h_chunks = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(35), Constraint::Percentage(65)])
                .split(body);

            tools_list::render(f, h_chunks[0], app);
            tool_info::render(f, h_chunks[1], app);
        }
    }

    status_bar::render(f, status, app);

    // Overlays (search popup, help screen, param form)
    search::render(f, app);
    help::render(f, app);
    param_form::render(f, app);
}
