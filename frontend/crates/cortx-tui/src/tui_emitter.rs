use cortx_core::models::{LogStream, ScriptStatus, ServiceStatus};
use cortx_core::process_manager::ProcessEventEmitter;
use std::sync::mpsc;

use crate::app::ProcessEvent;

/// TUI implementation of ProcessEventEmitter
/// Sends events through an mpsc channel to the main TUI loop
pub struct TuiEmitter {
    tx: mpsc::Sender<ProcessEvent>,
}

impl TuiEmitter {
    pub fn new(tx: mpsc::Sender<ProcessEvent>) -> Self {
        Self { tx }
    }
}

impl ProcessEventEmitter for TuiEmitter {
    // Service events - not used in TUI V1 (global scripts only)
    fn emit_service_log(&self, _service_id: &str, _stream: LogStream, _content: String) {}
    fn emit_service_status(&self, _service_id: &str, _status: ServiceStatus, _pid: Option<u32>,
                           _active_mode: Option<String>, _active_arg_preset: Option<String>) {}
    fn emit_service_exit(&self, _service_id: &str, _exit_code: Option<i32>) {}

    // Project script events - not used in TUI V1
    fn emit_script_log(&self, _script_id: &str, _stream: LogStream, _content: String) {}
    fn emit_script_status(&self, _script_id: &str, _status: ScriptStatus, _pid: Option<u32>) {}
    fn emit_script_exit(&self, _script_id: &str, _exit_code: Option<i32>, _success: bool) {}

    // Global script events - these are the ones we care about
    fn emit_global_script_log(&self, script_id: &str, stream: LogStream, content: String) {
        let _ = self.tx.send(ProcessEvent::Log {
            script_id: script_id.to_string(),
            stream,
            content,
        });
    }

    fn emit_global_script_status(&self, script_id: &str, status: ScriptStatus, pid: Option<u32>) {
        let _ = self.tx.send(ProcessEvent::Status {
            script_id: script_id.to_string(),
            status,
            pid,
        });
    }

    fn emit_global_script_exit(&self, script_id: &str, exit_code: Option<i32>, success: bool) {
        let _ = self.tx.send(ProcessEvent::Exit {
            script_id: script_id.to_string(),
            exit_code,
            success,
        });
    }
}
