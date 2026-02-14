mod theme;
mod scripts_list;
mod script_info;
mod output;
mod status_bar;
mod search;
mod help;
mod param_form;

use ratatui::prelude::*;

use crate::app::App;

pub fn draw(f: &mut Frame, app: &mut App) {
    let area = f.area();

    // Main layout: body + status bar (1 line)
    let main_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(0), Constraint::Length(1)])
        .split(area);

    let body = main_chunks[0];
    let status = main_chunks[1];

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

    // Render panels
    scripts_list::render(f, left, app);
    script_info::render(f, info_area, app);
    output::render(f, output_area, app);
    status_bar::render(f, status, app);

    // Overlays (search popup, help screen, param form)
    search::render(f, app);
    help::render(f, app);
    param_form::render(f, app);
}
