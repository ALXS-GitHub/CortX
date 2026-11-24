use cortx_core::models::{
    LogStream, ScriptExitPayload, ScriptLogPayload, ScriptStatus, ScriptStatusPayload,
    ServiceExitPayload, ServiceLogPayload, ServicePortsPayload, ServiceStatus,
    ServiceStatusPayload, ShellExitPayload,
};
use cortx_core::process_manager::ProcessEventEmitter;
use cortx_core::terminal::TerminalShellState;
use tauri::{AppHandle, Emitter};

pub struct TauriEmitter {
    app_handle: AppHandle,
}

impl TauriEmitter {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

impl ProcessEventEmitter for TauriEmitter {
    fn emit_service_log(&self, service_id: &str, stream: LogStream, content: String) {
        let _ = self.app_handle.emit(
            "service-log",
            ServiceLogPayload {
                service_id: service_id.to_string(),
                stream,
                content,
            },
        );
    }

    fn emit_service_status(
        &self,
        service_id: &str,
        status: ServiceStatus,
        pid: Option<u32>,
        active_mode: Option<String>,
        active_arg_preset: Option<String>,
    ) {
        let _ = self.app_handle.emit(
            "service-status",
            ServiceStatusPayload {
                service_id: service_id.to_string(),
                status,
                pid,
                active_mode,
                active_arg_preset,
            },
        );
    }

    fn emit_service_exit(&self, service_id: &str, exit_code: Option<i32>) {
        let _ = self.app_handle.emit(
            "service-exit",
            ServiceExitPayload {
                service_id: service_id.to_string(),
                exit_code,
            },
        );
    }

    fn emit_script_log(&self, script_id: &str, stream: LogStream, content: String) {
        let _ = self.app_handle.emit(
            "script-log",
            ScriptLogPayload {
                script_id: script_id.to_string(),
                stream,
                content,
            },
        );
    }

    fn emit_script_status(&self, script_id: &str, status: ScriptStatus, pid: Option<u32>) {
        let _ = self.app_handle.emit(
            "script-status",
            ScriptStatusPayload {
                script_id: script_id.to_string(),
                status,
                pid,
            },
        );
    }

    fn emit_script_exit(&self, script_id: &str, exit_code: Option<i32>, success: bool) {
        let _ = self.app_handle.emit(
            "script-exit",
            ScriptExitPayload {
                script_id: script_id.to_string(),
                exit_code,
                success,
            },
        );
    }

    fn emit_global_script_log(&self, script_id: &str, stream: LogStream, content: String) {
        let _ = self.app_handle.emit(
            "global-script-log",
            ScriptLogPayload {
                script_id: script_id.to_string(),
                stream,
                content,
            },
        );
    }

    fn emit_global_script_status(&self, script_id: &str, status: ScriptStatus, pid: Option<u32>) {
        let _ = self.app_handle.emit(
            "global-script-status",
            ScriptStatusPayload {
                script_id: script_id.to_string(),
                status,
                pid,
            },
        );
    }

    fn emit_global_script_exit(&self, script_id: &str, exit_code: Option<i32>, success: bool) {
        let _ = self.app_handle.emit(
            "global-script-exit",
            ScriptExitPayload {
                script_id: script_id.to_string(),
                exit_code,
                success,
            },
        );
    }

    fn emit_service_ports(&self, service_id: &str, ports: Vec<u16>) {
        let _ = self.app_handle.emit(
            "service-ports",
            ServicePortsPayload {
                service_id: service_id.to_string(),
                ports,
            },
        );
    }

    fn emit_shell_exit(&self, shell_id: &str, exit_code: Option<i32>) {
        let _ = self.app_handle.emit(
            "shell-exit",
            ShellExitPayload {
                shell_id: shell_id.to_string(),
                exit_code,
            },
        );
    }

    fn emit_terminal_state(&self, state: &TerminalShellState) {
        let _ = self.app_handle.emit("terminal-state", state);
    }

    /// Light on purpose: a frozen block can be thousands of lines, so the
    /// event only says that something changed and the view fetches what it
    /// is missing with `get_terminal_blocks`.
    fn emit_terminal_block(&self, terminal_id: &str, event: &cortx_core::terminal::blocks::BlockEvent) {
        use cortx_core::terminal::blocks::BlockEvent;
        let payload = match event {
            BlockEvent::Frozen(block) => TerminalBlockPayload {
                terminal_id: terminal_id.to_string(),
                kind: "frozen",
                block_id: Some(block.id),
                generation: block.generation,
                alt_screen: None,
            },
            BlockEvent::Cleared { generation } => TerminalBlockPayload {
                terminal_id: terminal_id.to_string(),
                kind: "cleared",
                block_id: None,
                generation: *generation,
                alt_screen: None,
            },
            BlockEvent::AltScreen(on) => TerminalBlockPayload {
                terminal_id: terminal_id.to_string(),
                kind: "alt-screen",
                block_id: None,
                generation: 0,
                alt_screen: Some(*on),
            },
        };
        let _ = self.app_handle.emit("terminal-block", payload);
    }
}

/// `terminal-block` event (CORT-57): `kind` is `frozen`, `cleared` or
/// `alt-screen`.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalBlockPayload {
    terminal_id: String,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    block_id: Option<u64>,
    generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    alt_screen: Option<bool>,
}
