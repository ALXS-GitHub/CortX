use std::collections::HashMap;
use std::sync::Arc;

use cortx_core::models::{LogStream, ScriptStatus, ServiceStatus};
use cortx_core::process_manager::ProcessEventEmitter;
use parking_lot::Mutex;

use crate::process_state::{ProcessRunState, ProcessStatus};

pub struct McpEmitter {
    state: Arc<Mutex<HashMap<String, ProcessRunState>>>,
}

impl McpEmitter {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn state(&self) -> Arc<Mutex<HashMap<String, ProcessRunState>>> {
        self.state.clone()
    }
}

// Helper to map ServiceStatus -> ProcessStatus
fn map_service_status(status: &ServiceStatus) -> ProcessStatus {
    match status {
        ServiceStatus::Running | ServiceStatus::Starting => ProcessStatus::Running,
        ServiceStatus::Stopped => ProcessStatus::Stopped,
        ServiceStatus::Error => ProcessStatus::Failed,
    }
}

// Helper to map ScriptStatus -> ProcessStatus
fn map_script_status(status: &ScriptStatus) -> ProcessStatus {
    match status {
        ScriptStatus::Running => ProcessStatus::Running,
        ScriptStatus::Completed => ProcessStatus::Completed,
        ScriptStatus::Failed => ProcessStatus::Failed,
        ScriptStatus::Idle => ProcessStatus::Stopped,
    }
}

impl ProcessEventEmitter for McpEmitter {
    fn emit_service_log(&self, service_id: &str, _stream: LogStream, content: String) {
        let mut state = self.state.lock();
        let entry = state
            .entry(service_id.to_string())
            .or_insert_with(ProcessRunState::new);
        entry.push_log(content);
    }

    fn emit_service_status(
        &self,
        service_id: &str,
        status: ServiceStatus,
        pid: Option<u32>,
        _active_mode: Option<String>,
        _active_arg_preset: Option<String>,
    ) {
        let mut state = self.state.lock();
        let entry = state
            .entry(service_id.to_string())
            .or_insert_with(ProcessRunState::new);
        entry.pid = pid;
        entry.status = map_service_status(&status);
    }

    fn emit_service_exit(&self, service_id: &str, exit_code: Option<i32>) {
        let mut state = self.state.lock();
        if let Some(entry) = state.get_mut(service_id) {
            entry.exit_code = exit_code;
            let success = exit_code.map(|c| c == 0).unwrap_or(false);
            entry.success = Some(success);
            entry.status = if success {
                ProcessStatus::Completed
            } else {
                ProcessStatus::Failed
            };
        }
    }

    fn emit_script_log(&self, script_id: &str, _stream: LogStream, content: String) {
        let mut state = self.state.lock();
        let entry = state
            .entry(script_id.to_string())
            .or_insert_with(ProcessRunState::new);
        entry.push_log(content);
    }

    fn emit_script_status(&self, script_id: &str, status: ScriptStatus, pid: Option<u32>) {
        let mut state = self.state.lock();
        let entry = state
            .entry(script_id.to_string())
            .or_insert_with(ProcessRunState::new);
        entry.pid = pid;
        entry.status = map_script_status(&status);
    }

    fn emit_script_exit(&self, script_id: &str, exit_code: Option<i32>, success: bool) {
        let mut state = self.state.lock();
        if let Some(entry) = state.get_mut(script_id) {
            entry.exit_code = exit_code;
            entry.success = Some(success);
            entry.status = if success {
                ProcessStatus::Completed
            } else {
                ProcessStatus::Failed
            };
        }
    }

    fn emit_global_script_log(&self, script_id: &str, _stream: LogStream, content: String) {
        let mut state = self.state.lock();
        let entry = state
            .entry(script_id.to_string())
            .or_insert_with(ProcessRunState::new);
        entry.push_log(content);
    }

    fn emit_global_script_status(&self, script_id: &str, status: ScriptStatus, pid: Option<u32>) {
        let mut state = self.state.lock();
        let entry = state
            .entry(script_id.to_string())
            .or_insert_with(ProcessRunState::new);
        entry.pid = pid;
        entry.status = map_script_status(&status);
    }

    fn emit_global_script_exit(&self, script_id: &str, exit_code: Option<i32>, success: bool) {
        let mut state = self.state.lock();
        if let Some(entry) = state.get_mut(script_id) {
            entry.exit_code = exit_code;
            entry.success = Some(success);
            entry.status = if success {
                ProcessStatus::Completed
            } else {
                ProcessStatus::Failed
            };
        }
    }
}
