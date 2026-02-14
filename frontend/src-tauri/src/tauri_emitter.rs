use cortx_core::models::{
    LogStream, ScriptExitPayload, ScriptLogPayload, ScriptStatus, ScriptStatusPayload,
    ServiceExitPayload, ServiceLogPayload, ServiceStatus, ServiceStatusPayload,
};
use cortx_core::process_manager::ProcessEventEmitter;
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
}
