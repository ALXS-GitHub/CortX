use cortx_core::models::{GlobalScript, VirtualFolder, ScriptGroup, ScriptStatus, ScriptParamType, LogStream};
use cortx_core::process_manager::ProcessManager;
use cortx_core::storage::Storage;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::tui_emitter::TuiEmitter;

/// Current input mode
#[derive(Debug, Clone, PartialEq)]
pub enum InputMode {
    Normal,
    Search,
    Help,
    ParamForm,
}

/// Active panel
#[derive(Debug, Clone, PartialEq)]
pub enum ActivePanel {
    ScriptList,
    Output,
}

/// A log line for display
#[derive(Debug, Clone)]
pub struct LogLine {
    pub stream: LogStream,
    pub content: String,
}

/// Runtime state for a global script
#[derive(Debug, Clone)]
pub struct ScriptRuntime {
    pub status: ScriptStatus,
    pub pid: Option<u32>,
    pub logs: Vec<LogLine>,
    pub exit_code: Option<i32>,
    pub success: Option<bool>,
    /// The exact command that was executed (with resolved params)
    pub last_command: Option<String>,
}

impl Default for ScriptRuntime {
    fn default() -> Self {
        Self {
            status: ScriptStatus::Idle,
            pid: None,
            logs: Vec::new(),
            exit_code: None,
            success: None,
            last_command: None,
        }
    }
}

/// State for the parameter form overlay
#[derive(Debug, Clone)]
pub struct ParamFormState {
    pub script: GlobalScript,
    /// Ordered list of param names (same order as script.parameters)
    pub param_names: Vec<String>,
    /// Current values for each parameter
    pub values: HashMap<String, String>,
    /// Whether each param is enabled (toggle for optional params)
    pub enabled: HashMap<String, bool>,
    /// Extra arguments appended to the command
    pub extra_args: String,
    /// Currently focused field index (param_names.len() = extra_args field)
    pub focused: usize,
    /// Whether we're editing the focused field's value
    pub editing: bool,
    /// Whether the preset picker is open
    pub picking_preset: bool,
    /// Currently highlighted preset index
    pub preset_index: usize,
}

impl ParamFormState {
    /// Total number of focusable fields (params + extra_args)
    pub fn field_count(&self) -> usize {
        self.param_names.len() + 1
    }

    /// Whether the extra_args field is focused
    pub fn is_extra_args_focused(&self) -> bool {
        self.focused == self.param_names.len()
    }
}

impl ParamFormState {
    pub fn new(script: &GlobalScript) -> Self {
        let mut values = HashMap::new();
        let mut enabled = HashMap::new();
        let param_names: Vec<String> = script.parameters.iter().map(|p| p.name.clone()).collect();
        let mut extra_args = String::new();

        // Init with defaults (from default preset or param defaults)
        for param in &script.parameters {
            let mut val = param.default_value.clone().unwrap_or_default();

            // Bool params default to "false" unless they have a default
            if param.param_type == ScriptParamType::Bool && val.is_empty() {
                val = "false".to_string();
            }

            values.insert(param.name.clone(), val.clone());
            // Required always enabled; optional enabled if they have a default value
            enabled.insert(param.name.clone(), param.required || !val.is_empty());
        }

        // Apply default preset if available
        if let Some(ref preset_id) = script.default_preset_id {
            if let Some(preset) = script.parameter_presets.iter().find(|p| p.id == *preset_id) {
                for (key, value) in &preset.values {
                    values.insert(key.clone(), value.clone());
                }
                // Apply preset enabled state if available
                if !preset.enabled.is_empty() {
                    for param in &script.parameters {
                        if let Some(&en) = preset.enabled.get(&param.name) {
                            enabled.insert(param.name.clone(), param.required || en);
                        } else if preset.values.contains_key(&param.name) {
                            enabled.insert(param.name.clone(), true);
                        }
                    }
                } else {
                    // Legacy: no enabled map, enable all preset params
                    for key in preset.values.keys() {
                        enabled.insert(key.clone(), true);
                    }
                }
            }
        }

        // Restore saved state from last run (overrides defaults)
        if let Some(saved) = load_run_state(&script.id) {
            for param in &script.parameters {
                if let Some(val) = saved.param_values.get(&param.name) {
                    values.insert(param.name.clone(), val.clone());
                }
                if let Some(&en) = saved.param_enabled.get(&param.name) {
                    // Required params stay enabled regardless of saved state
                    enabled.insert(param.name.clone(), param.required || en);
                }
            }
            extra_args = saved.extra_args.unwrap_or_default();
        }

        Self {
            script: script.clone(),
            param_names,
            values,
            enabled,
            extra_args,
            focused: 0,
            editing: false,
            picking_preset: false,
            preset_index: 0,
        }
    }

    pub fn focused_param_name(&self) -> Option<&str> {
        self.param_names.get(self.focused).map(|s| s.as_str())
    }

    pub fn move_up(&mut self) {
        if self.focused > 0 {
            self.focused -= 1;
        }
    }

    pub fn move_down(&mut self) {
        if self.focused + 1 < self.field_count() {
            self.focused += 1;
        }
    }

    /// Toggle enable/disable for optional param at focus
    pub fn toggle_focused(&mut self) {
        if let Some(name) = self.focused_param_name() {
            let name = name.to_string();
            let param = self.script.parameters.iter().find(|p| p.name == name);
            if let Some(param) = param {
                if !param.required {
                    let current = self.enabled.get(&name).copied().unwrap_or(false);
                    self.enabled.insert(name, !current);
                }
            }
        }
    }

    /// Toggle bool value for the focused param
    pub fn toggle_bool(&mut self) {
        if let Some(name) = self.focused_param_name() {
            let name = name.to_string();
            let current = self.values.get(&name).map(|v| v == "true").unwrap_or(false);
            self.values.insert(name, if current { "false" } else { "true" }.to_string());
        }
    }

    /// Apply a preset's values and enabled state to the form
    pub fn apply_preset(&mut self, preset_index: usize) {
        if let Some(preset) = self.script.parameter_presets.get(preset_index) {
            for param in &self.script.parameters {
                if let Some(value) = preset.values.get(&param.name) {
                    self.values.insert(param.name.clone(), value.clone());
                }
                if !preset.enabled.is_empty() {
                    if let Some(&en) = preset.enabled.get(&param.name) {
                        self.enabled.insert(param.name.clone(), param.required || en);
                    } else if preset.values.contains_key(&param.name) {
                        self.enabled.insert(param.name.clone(), true);
                    }
                } else {
                    // Legacy preset: enable all params that have values
                    if preset.values.contains_key(&param.name) {
                        self.enabled.insert(param.name.clone(), true);
                    }
                }
            }
        }
        self.picking_preset = false;
    }

    /// Build the full command from the form state
    pub fn build_command(&self) -> String {
        let script = &self.script;

        let mut command = if let Some(ref script_path) = script.script_path {
            script.command.replace("{{SCRIPT_FILE}}", script_path)
        } else {
            script.command.clone()
        };

        for param in &script.parameters {
            let is_enabled = self.enabled.get(&param.name).copied().unwrap_or(false);
            if !is_enabled {
                continue;
            }

            let value = self.values.get(&param.name).cloned().unwrap_or_default();

            if param.param_type == ScriptParamType::Bool {
                if value == "true" {
                    if let Some(ref flag) = param.long_flag {
                        command = format!("{} {}", command, flag);
                    } else if let Some(ref flag) = param.short_flag {
                        command = format!("{} {}", command, flag);
                    }
                }
            } else if !value.is_empty() {
                if let Some(ref flag) = param.long_flag {
                    command = format!("{} {} {}", command, flag, value);
                } else if let Some(ref flag) = param.short_flag {
                    command = format!("{} {} {}", command, flag, value);
                } else {
                    // Positional argument
                    command = format!("{} {}", command, value);
                }
            }
        }

        // Append extra arguments
        let trimmed = self.extra_args.trim();
        if !trimmed.is_empty() {
            command = format!("{} {}", command, trimmed);
        }

        command
    }
}

pub struct App {
    pub storage: Arc<Storage>,
    pub process_manager: Arc<ProcessManager>,
    pub emitter: Arc<TuiEmitter>,

    // Data
    pub scripts: Vec<GlobalScript>,
    pub folders: Vec<VirtualFolder>,
    pub groups: Vec<ScriptGroup>,
    pub runtimes: HashMap<String, ScriptRuntime>,

    // UI state
    pub input_mode: InputMode,
    pub active_panel: ActivePanel,
    pub selected_index: usize,
    pub output_scroll: usize,
    pub auto_scroll: bool,
    pub should_quit: bool,

    // Search
    pub search_query: String,
    pub filtered_indices: Vec<usize>,

    // Currently viewed script in output panel
    pub active_script_id: Option<String>,

    // Parameter form state
    pub param_form: Option<ParamFormState>,
}

impl App {
    pub fn new(storage: Arc<Storage>, process_manager: Arc<ProcessManager>, emitter: Arc<TuiEmitter>) -> Self {
        let mut scripts = storage.get_all_global_scripts();
        let folders = storage.get_all_folders();
        let groups = storage.get_all_script_groups();

        // Sort scripts by folder (no-folder first, then by folder name)
        Self::sort_scripts_by_folder(&mut scripts, &folders);

        let script_count = scripts.len();
        let filtered_indices: Vec<usize> = (0..script_count).collect();

        Self {
            storage,
            process_manager,
            emitter,
            scripts,
            folders,
            groups,
            runtimes: HashMap::new(),
            input_mode: InputMode::Normal,
            active_panel: ActivePanel::ScriptList,
            selected_index: 0,
            output_scroll: 0,
            auto_scroll: true,
            should_quit: false,
            search_query: String::new(),
            filtered_indices,
            active_script_id: None,
            param_form: None,
        }
    }

    pub fn reload_scripts(&mut self) {
        self.scripts = self.storage.get_all_global_scripts();
        self.folders = self.storage.get_all_folders();
        self.groups = self.storage.get_all_script_groups();
        Self::sort_scripts_by_folder(&mut self.scripts, &self.folders);
        self.search_query.clear();
        self.apply_filter();
    }

    /// Sort scripts: no-folder first, then grouped by folder order (None order = last), then alphabetically by name
    fn sort_scripts_by_folder(scripts: &mut [GlobalScript], folders: &[VirtualFolder]) {
        scripts.sort_by(|a, b| {
            let fa = a.folder_id.as_ref().and_then(|fid| folders.iter().find(|f| f.id == *fid));
            let fb = b.folder_id.as_ref().and_then(|fid| folders.iter().find(|f| f.id == *fid));
            let folder_ord = match (fa, fb) {
                (None, None) => std::cmp::Ordering::Equal,
                (None, Some(_)) => std::cmp::Ordering::Less,
                (Some(_), None) => std::cmp::Ordering::Greater,
                // Folders with order come first, None order = last
                (Some(fa), Some(fb)) => match (fa.order, fb.order) {
                    (Some(ao), Some(bo)) => ao.cmp(&bo),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => std::cmp::Ordering::Equal,
                }.then_with(|| fa.name.to_lowercase().cmp(&fb.name.to_lowercase())),
            };
            folder_ord.then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
    }

    /// Clear the active search filter and show all scripts
    pub fn clear_filter(&mut self) {
        if !self.search_query.is_empty() {
            self.search_query.clear();
            self.apply_filter();
        }
    }

    pub fn selected_script(&self) -> Option<&GlobalScript> {
        self.filtered_indices
            .get(self.selected_index)
            .and_then(|&idx| self.scripts.get(idx))
    }

    pub fn selected_script_id(&self) -> Option<String> {
        self.selected_script().map(|s| s.id.clone())
    }

    pub fn move_up(&mut self) {
        if self.selected_index > 0 {
            self.selected_index -= 1;
        }
    }

    pub fn move_down(&mut self) {
        if !self.filtered_indices.is_empty() && self.selected_index < self.filtered_indices.len() - 1 {
            self.selected_index += 1;
        }
    }

    pub fn move_top(&mut self) {
        self.selected_index = 0;
    }

    pub fn move_bottom(&mut self) {
        if !self.filtered_indices.is_empty() {
            self.selected_index = self.filtered_indices.len() - 1;
        }
    }

    pub fn toggle_panel(&mut self) {
        self.active_panel = match self.active_panel {
            ActivePanel::ScriptList => ActivePanel::Output,
            ActivePanel::Output => ActivePanel::ScriptList,
        };
    }

    pub fn enter_search(&mut self) {
        self.input_mode = InputMode::Search;
        self.search_query.clear();
    }

    pub fn exit_search(&mut self) {
        self.input_mode = InputMode::Normal;
        self.search_query.clear();
        self.apply_filter();
    }

    pub fn confirm_search(&mut self) {
        self.input_mode = InputMode::Normal;
        // Keep current filter
    }

    pub fn search_input(&mut self, c: char) {
        self.search_query.push(c);
        self.apply_filter();
    }

    pub fn search_backspace(&mut self) {
        self.search_query.pop();
        self.apply_filter();
    }

    fn apply_filter(&mut self) {
        if self.search_query.is_empty() {
            self.filtered_indices = (0..self.scripts.len()).collect();
        } else {
            let q = self.search_query.to_lowercase();
            self.filtered_indices = self
                .scripts
                .iter()
                .enumerate()
                .filter(|(_, s)| {
                    s.name.to_lowercase().contains(&q)
                        || s.description.as_deref().unwrap_or("").to_lowercase().contains(&q)
                        || s.tags.iter().any(|t| t.to_lowercase().contains(&q))
                        || s.command.to_lowercase().contains(&q)
                })
                .map(|(i, _)| i)
                .collect();
        }
        // Clamp selection
        if self.filtered_indices.is_empty() {
            self.selected_index = 0;
        } else if self.selected_index >= self.filtered_indices.len() {
            self.selected_index = self.filtered_indices.len() - 1;
        }
    }

    /// Called when user presses Enter on a script.
    /// Always opens the run form (params + extra args).
    pub fn enter_run(&mut self) {
        let script = match self.selected_script() {
            Some(s) => s.clone(),
            None => return,
        };

        self.param_form = Some(ParamFormState::new(&script));
        self.input_mode = InputMode::ParamForm;
    }

    /// Confirm the param form and run the script with the filled parameters
    pub fn confirm_param_form(&mut self) {
        let form = match self.param_form.take() {
            Some(f) => f,
            None => return,
        };

        // Save run state for next time
        save_run_state(&form.script.id, &SavedRunState {
            param_values: form.values.clone(),
            param_enabled: form.enabled.clone(),
            extra_args: if form.extra_args.trim().is_empty() { None } else { Some(form.extra_args.clone()) },
        });

        let command = form.build_command();
        self.input_mode = InputMode::Normal;
        self.run_script_with_command(&form.script, command);
    }

    /// Quick-run: skip the param form and reuse last saved state.
    pub fn quick_run(&mut self) {
        let script = match self.selected_script() {
            Some(s) => s.clone(),
            None => return,
        };

        // Build a ParamFormState (which loads saved state automatically)
        let form = ParamFormState::new(&script);
        let command = form.build_command();

        // Save state again (refreshes the file)
        save_run_state(&script.id, &SavedRunState {
            param_values: form.values,
            param_enabled: form.enabled,
            extra_args: if form.extra_args.trim().is_empty() { None } else { Some(form.extra_args.clone()) },
        });

        self.run_script_with_command(&script, command);
    }

    /// Cancel the param form
    pub fn cancel_param_form(&mut self) {
        self.param_form = None;
        self.input_mode = InputMode::Normal;
    }

    fn run_script_with_command(&mut self, script: &GlobalScript, command: String) {
        let working_dir = std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string());

        // Store the resolved command in the runtime
        let runtime = self.runtimes.entry(script.id.clone()).or_default();
        runtime.last_command = Some(command.clone());

        let emitter = self.emitter.clone();
        // Split command into program + args for direct execution
        let mut tokens: Vec<String> = command.split_whitespace().map(|s| s.to_string()).collect();
        let program = if tokens.is_empty() { command.clone() } else { tokens.remove(0) };
        match self.process_manager.run_global_script(
            emitter,
            script.id.clone(),
            working_dir,
            program,
            tokens,
            script.env_vars.clone(),
        ) {
            Ok(_pid) => {
                self.active_script_id = Some(script.id.clone());
                self.auto_scroll = true;
                self.output_scroll = 0;
            }
            Err(e) => {
                let runtime = self.runtimes.entry(script.id.clone()).or_default();
                runtime.logs.push(LogLine {
                    stream: LogStream::Stderr,
                    content: format!("Failed to start: {}", e),
                });
                self.active_script_id = Some(script.id.clone());
            }
        }
    }

    pub fn stop_selected(&mut self) {
        let script_id = match self.active_script_id.clone().or_else(|| self.selected_script_id()) {
            Some(id) => id,
            None => return,
        };

        if let Some(runtime) = self.runtimes.get(&script_id) {
            if runtime.status == ScriptStatus::Running {
                let _ = self.process_manager.stop_global_script(&*self.emitter, &script_id);
            }
        }
    }

    pub fn get_active_logs(&self) -> &[LogLine] {
        self.active_script_id
            .as_ref()
            .and_then(|id| self.runtimes.get(id))
            .map(|r| r.logs.as_slice())
            .unwrap_or(&[])
    }

    pub fn clear_active_logs(&mut self) {
        if let Some(ref id) = self.active_script_id {
            if let Some(runtime) = self.runtimes.get_mut(id) {
                runtime.logs.clear();
                self.output_scroll = 0;
            }
        }
    }

    pub fn scroll_output_up(&mut self) {
        if self.output_scroll > 0 {
            self.output_scroll -= 1;
            self.auto_scroll = false;
        }
    }

    pub fn scroll_output_down(&mut self) {
        self.output_scroll += 1;
    }

    pub fn toggle_auto_scroll(&mut self) {
        self.auto_scroll = !self.auto_scroll;
    }

    /// Handle a process event from the TUI emitter channel
    pub fn handle_process_event(&mut self, event: ProcessEvent) {
        match event {
            ProcessEvent::Log { script_id, stream, content } => {
                let runtime = self.runtimes.entry(script_id).or_default();
                // Strip \r (carriage returns) which cause garbled display,
                // but keep ANSI color codes for rendering
                let clean = content.replace('\r', "");
                runtime.logs.push(LogLine { stream, content: clean });
                // Keep last 5000 lines
                if runtime.logs.len() > 5000 {
                    let drain = runtime.logs.len() - 5000;
                    runtime.logs.drain(..drain);
                }
            }
            ProcessEvent::Status { script_id, status, pid } => {
                let runtime = self.runtimes.entry(script_id).or_default();
                runtime.status = status;
                runtime.pid = pid;
            }
            ProcessEvent::Exit { script_id, exit_code, success } => {
                let runtime = self.runtimes.entry(script_id).or_default();
                runtime.exit_code = exit_code;
                runtime.success = Some(success);
                runtime.status = if success { ScriptStatus::Completed } else { ScriptStatus::Failed };
            }
        }
    }
}

/// Events sent from ProcessEventEmitter to the TUI
#[derive(Debug, Clone)]
pub enum ProcessEvent {
    Log {
        script_id: String,
        stream: LogStream,
        content: String,
    },
    Status {
        script_id: String,
        status: ScriptStatus,
        pid: Option<u32>,
    },
    Exit {
        script_id: String,
        exit_code: Option<i32>,
        success: bool,
    },
}

// === Parameter persistence ===

/// Saved run state for a script (persisted between runs)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedRunState {
    pub param_values: HashMap<String, String>,
    pub param_enabled: HashMap<String, bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_args: Option<String>,
}

/// All saved run states indexed by script ID
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct RunStateStore {
    scripts: HashMap<String, SavedRunState>,
}

fn run_state_path() -> Option<PathBuf> {
    let dirs = directories::ProjectDirs::from("com", "cortx", "Cortx")?;
    Some(dirs.data_dir().join("tui_run_state.json"))
}

pub fn load_run_state(script_id: &str) -> Option<SavedRunState> {
    let path = run_state_path()?;
    let content = std::fs::read_to_string(&path).ok()?;
    let store: RunStateStore = serde_json::from_str(&content).ok()?;
    store.scripts.get(script_id).cloned()
}

pub fn save_run_state(script_id: &str, state: &SavedRunState) {
    let Some(path) = run_state_path() else { return };
    let mut store: RunStateStore = std::fs::read_to_string(&path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();
    store.scripts.insert(script_id.to_string(), state.clone());
    if let Ok(json) = serde_json::to_string_pretty(&store) {
        let _ = std::fs::write(&path, json);
    }
}
