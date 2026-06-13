use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    CallToolResult, Content, ErrorCode, Implementation, ProtocolVersion, ServerCapabilities,
    ServerInfo,
};
use rmcp::{tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler};

use cortx_core::command_builder;
use cortx_core::help_parser;
use cortx_core::models::*;
use cortx_core::process_manager::{ProcessManager, RuntimeMeta};
use cortx_core::runtime_state::RuntimeStore;
use cortx_core::script_discovery;
use cortx_core::storage::Storage;
use cortx_core::tool_discovery;

use crate::mcp_emitter::McpEmitter;
use crate::params::*;
use crate::process_state::ProcessRunState;

#[derive(Clone)]
pub struct CortxMcp {
    storage: Arc<Storage>,
    process_manager: Arc<ProcessManager>,
    emitter: Arc<McpEmitter>,
    process_state: Arc<Mutex<HashMap<String, ProcessRunState>>>,
    tool_router: ToolRouter<CortxMcp>,
}

impl CortxMcp {
    pub fn new() -> anyhow::Result<Self> {
        let storage = Arc::new(Storage::new()?);
        let runtime_store = Arc::new(RuntimeStore::new(storage.app_dir())?);
        let emitter = Arc::new(McpEmitter::new());
        let process_state = emitter.state();
        let process_manager = Arc::new(ProcessManager::new(runtime_store));

        Ok(Self {
            storage,
            process_manager,
            emitter,
            process_state,
            tool_router: Self::tool_router(),
        })
    }

    fn reload(&self) -> Result<(), McpError> {
        self.storage.reload_all().map_err(|e| mcp_err(e.to_string()))
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn mcp_err(msg: impl Into<String>) -> McpError {
    McpError {
        code: ErrorCode::INTERNAL_ERROR,
        message: msg.into().into(),
        data: None,
    }
}

fn ok_json<T: serde::Serialize>(val: &T) -> Result<CallToolResult, McpError> {
    let json = serde_json::to_string_pretty(val).map_err(|e| mcp_err(e.to_string()))?;
    Ok(CallToolResult::success(vec![Content::text(json)]))
}

fn ok_text(msg: impl Into<String>) -> Result<CallToolResult, McpError> {
    Ok(CallToolResult::success(vec![Content::text(msg.into())]))
}

/// Read the last `n` lines of `path`, returning [] if the file is missing
/// or can't be read. Used by get_process_status / get_process_logs to
/// surface log content captured by ProcessManager's tee.
fn tail_log_file(path: &std::path::Path, n: usize) -> Vec<String> {
    let Ok(content) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].iter().map(|s| s.to_string()).collect()
}

// ============================================================================
// Tool implementations
// ============================================================================

#[tool_router]
impl CortxMcp {
    // ========================================================================
    // Global Scripts (8)
    // ========================================================================

    #[tool(description = "List all global scripts, optionally filtered by tag. Returns script details including name, command, tags, parameters, and presets.", annotations(read_only_hint = true))]
    fn list_global_scripts(
        &self,
        Parameters(p): Parameters<ListGlobalScriptsParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let mut scripts = self.storage.get_all_global_scripts();
        if let Some(tag) = p.tag {
            scripts.retain(|s| s.tags.iter().any(|t| t.eq_ignore_ascii_case(&tag)));
        }
        ok_json(&scripts)
    }

    #[tool(description = "Get a global script by ID or name. Returns full details including parameters, presets, tags, and command. Use 'id' for exact lookup or 'name' for case-insensitive search.", annotations(read_only_hint = true))]
    fn get_global_script(
        &self,
        Parameters(p): Parameters<GetGlobalScriptParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let script = if let Some(id) = p.id {
            self.storage.get_global_script(&id)
        } else if let Some(name) = p.name {
            self.storage
                .get_all_global_scripts()
                .into_iter()
                .find(|s| s.name.eq_ignore_ascii_case(&name))
        } else {
            return Err(mcp_err("Either 'id' or 'name' must be provided"));
        };
        match script {
            Some(s) => ok_json(&s),
            None => Err(mcp_err("Global script not found")),
        }
    }

    #[tool(description = "Create a new global script. After creation, use detect_script_parameters to auto-detect CLI flags, then update the script with the discovered parameters.")]
    fn create_global_script(
        &self,
        Parameters(p): Parameters<CreateGlobalScriptParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let mut script = GlobalScript::new(p.name, p.command, p.working_dir);
        script.description = p.description;
        script.script_path = p.script_path;
        script.color = p.color;
        script.tags = p.tags.unwrap_or_default();
        script.env_vars = p.env_vars;
        script.status = p.status;
        // Set order to end of list
        let count = self.storage.get_all_global_scripts().len() as u32;
        script.order = count;
        let created = self
            .storage
            .create_global_script(script)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&created)
    }

    #[tool(description = "Update a global script's properties. Only provided fields are changed; omitted fields are left untouched.", annotations(idempotent_hint = true))]
    fn update_global_script(
        &self,
        Parameters(p): Parameters<UpdateGlobalScriptParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let updated = self
            .storage
            .update_global_script(&p.id, |s| {
                if let Some(v) = p.name {
                    s.name = v;
                }
                if let Some(v) = p.description {
                    s.description = Some(v);
                }
                if let Some(v) = p.command {
                    s.command = v;
                }
                if let Some(v) = p.script_path {
                    s.script_path = Some(v);
                }
                if let Some(v) = p.working_dir {
                    s.working_dir = Some(v);
                }
                if let Some(v) = p.color {
                    s.color = Some(v);
                }
                if let Some(v) = p.tags {
                    s.tags = v;
                }
                if let Some(v) = p.default_preset_id {
                    s.default_preset_id = Some(v);
                }
                if let Some(v) = p.env_vars {
                    s.env_vars = Some(v);
                }
                if let Some(v) = p.status {
                    s.status = Some(v);
                }
            })
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&updated)
    }

    #[tool(description = "Delete a global script permanently.", annotations(destructive_hint = true, idempotent_hint = true))]
    fn delete_global_script(
        &self,
        Parameters(p): Parameters<DeleteGlobalScriptParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        self.storage
            .delete_global_script(&p.id)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_text(format!("Deleted global script {}", p.id))
    }

    #[tool(
        description = "EXECUTES: Run a global script. Resolves parameters from: (1) the default preset, (2) the specified 'preset_id', (3) explicit 'parameter_values' (highest priority). Use get_global_script first to see available parameters and presets. Returns immediately with PID; use get_process_status/get_process_logs to monitor.",
        annotations(open_world_hint = true)
    )]
    fn run_global_script(
        &self,
        Parameters(p): Parameters<RunGlobalScriptParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let script = self
            .storage
            .get_global_script(&p.id)
            .ok_or_else(|| mcp_err("Global script not found"))?;

        // Resolve parameter values
        let mut param_values: HashMap<String, String> = HashMap::new();

        // Start with preset values if specified
        if let Some(preset_id) = &p.preset_id {
            if let Some(preset) = script.parameter_presets.iter().find(|pr| pr.id == *preset_id) {
                param_values.extend(preset.values.clone());
            }
        } else if let Some(ref default_id) = script.default_preset_id {
            if let Some(preset) = script.parameter_presets.iter().find(|pr| pr.id == *default_id) {
                param_values.extend(preset.values.clone());
            }
        }

        // Override with explicit parameter values
        if let Some(explicit) = p.parameter_values {
            param_values.extend(explicit);
        }

        let extra_args = p.extra_args.unwrap_or_default();

        // Build command
        let (program, args) = command_builder::build_command(&script, &param_values, &extra_args)
            .ok_or_else(|| mcp_err("Failed to build command (empty command)"))?;

        let working_dir = script.working_dir.clone().unwrap_or_else(|| ".".to_string());

        let pid = self
            .process_manager
            .run_global_script(
                self.emitter.clone(),
                p.id.clone(),
                working_dir,
                program,
                args,
                script.env_vars.clone(),
                RuntimeMeta::new(script.name.clone()),
            )
            .map_err(|e| mcp_err(e))?;

        // Record execution
        let record = ExecutionRecord::new(p.id.clone());
        let _ = self.storage.add_execution_record(record);

        ok_json(&serde_json::json!({
            "status": "running",
            "pid": pid,
            "script_id": p.id,
        }))
    }

    #[tool(description = "Stop a running global script by killing its process tree.")]
    fn stop_global_script(
        &self,
        Parameters(p): Parameters<StopGlobalScriptParams>,
    ) -> Result<CallToolResult, McpError> {
        self.process_manager
            .stop_global_script(self.emitter.as_ref(), &p.id)
            .map_err(|e| mcp_err(e))?;
        ok_text(format!("Stopped global script {}", p.id))
    }

    #[tool(
        description = "EXECUTES: Run --help on a command to auto-detect its CLI parameters (flags, options, positional arguments). Returns structured parameter definitions that can be saved to a script via update_global_script.",
        annotations(read_only_hint = true, open_world_hint = true)
    )]
    fn detect_script_parameters(
        &self,
        Parameters(p): Parameters<DetectScriptParametersParams>,
    ) -> Result<CallToolResult, McpError> {
        let params =
            help_parser::detect_parameters(&p.command).map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&params)
    }

    // ========================================================================
    // Projects (5)
    // ========================================================================

    #[tool(description = "List all projects, optionally filtered by tag. Each project includes its services, scripts, and env file metadata (paths, keys, line numbers) — env variable VALUES are never exposed.", annotations(read_only_hint = true))]
    fn list_projects(
        &self,
        Parameters(p): Parameters<ListProjectsParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let mut projects = self.storage.get_all_projects();
        if let Some(tag) = p.tag {
            projects.retain(|proj| proj.tags.iter().any(|t| t.eq_ignore_ascii_case(&tag)));
        }
        let sanitized: Vec<_> = projects.iter().map(|p| p.sanitized_for_output()).collect();
        ok_json(&sanitized)
    }

    #[tool(description = "Get a project by ID with its services, scripts, and env file metadata (paths, keys, line numbers). Env variable VALUES are never exposed — read the .env file directly if needed.", annotations(read_only_hint = true))]
    fn get_project(
        &self,
        Parameters(p): Parameters<GetProjectParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        match self.storage.get_project(&p.id) {
            Some(proj) => ok_json(&proj.sanitized_for_output()),
            None => Err(mcp_err("Project not found")),
        }
    }

    #[tool(description = "Create a new project. The root_path should point to an existing directory on disk.")]
    fn create_project(
        &self,
        Parameters(p): Parameters<CreateProjectParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let mut project = Project::new(p.name, p.root_path);
        project.description = p.description;
        project.image_path = p.image_path;
        project.tags = p.tags.unwrap_or_default();
        project.status = p.status;
        project.toolbox_url = p.toolbox_url;
        let created = self
            .storage
            .create_project(project)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&created)
    }

    #[tool(description = "Update a project's properties. Only provided fields are changed.", annotations(idempotent_hint = true))]
    fn update_project(
        &self,
        Parameters(p): Parameters<UpdateProjectParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let updated = self
            .storage
            .update_project(&p.id, |proj| {
                if let Some(v) = p.name {
                    proj.name = v;
                }
                if let Some(v) = p.root_path {
                    proj.root_path = v;
                }
                if let Some(v) = p.description {
                    proj.description = Some(v);
                }
                if let Some(v) = p.image_path {
                    proj.image_path = Some(v);
                }
                if let Some(v) = p.tags {
                    proj.tags = v;
                }
                if let Some(v) = p.status {
                    proj.status = Some(v);
                }
                if let Some(v) = p.toolbox_url {
                    proj.toolbox_url = Some(v);
                }
            })
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&updated)
    }

    #[tool(description = "Delete a project and all its services and scripts permanently.", annotations(destructive_hint = true, idempotent_hint = true))]
    fn delete_project(
        &self,
        Parameters(p): Parameters<DeleteProjectParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        self.storage
            .delete_project(&p.id)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_text(format!("Deleted project {}", p.id))
    }

    // ========================================================================
    // Services (5)
    // ========================================================================

    #[tool(description = "Add a service to a project. Services are long-running processes (servers, watchers) that can be started/stopped. Use 'modes' for different launch configurations (e.g. dev/prod).")]
    fn add_service(
        &self,
        Parameters(p): Parameters<AddServiceParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let mut service = Service::new(p.name, p.working_dir, p.command);
        service.modes = p.modes;
        service.default_mode = p.default_mode;
        service.extra_args = p.extra_args;
        service.arg_presets = p.arg_presets;
        service.default_arg_preset = p.default_arg_preset;
        service.color = p.color;
        service.port = p.port;
        service.env_vars = p.env_vars;
        let created = self
            .storage
            .add_service(&p.project_id, service)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&created)
    }

    #[tool(description = "Update a service configuration. Only provided fields are changed.", annotations(idempotent_hint = true))]
    fn update_service(
        &self,
        Parameters(p): Parameters<UpdateServiceParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let updated = self
            .storage
            .update_service(&p.service_id, |s| {
                if let Some(v) = p.name {
                    s.name = v;
                }
                if let Some(v) = p.working_dir {
                    s.working_dir = v;
                }
                if let Some(v) = p.command {
                    s.command = v;
                }
                if let Some(v) = p.modes {
                    s.modes = Some(v);
                }
                if let Some(v) = p.default_mode {
                    s.default_mode = Some(v);
                }
                if let Some(v) = p.extra_args {
                    s.extra_args = Some(v);
                }
                if let Some(v) = p.arg_presets {
                    s.arg_presets = Some(v);
                }
                if let Some(v) = p.default_arg_preset {
                    s.default_arg_preset = Some(v);
                }
                if let Some(v) = p.color {
                    s.color = Some(v);
                }
                if let Some(v) = p.port {
                    s.port = Some(v);
                }
                if let Some(v) = p.env_vars {
                    s.env_vars = Some(v);
                }
            })
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&updated)
    }

    #[tool(description = "Delete a service from its project permanently.", annotations(destructive_hint = true, idempotent_hint = true))]
    fn delete_service(
        &self,
        Parameters(p): Parameters<DeleteServiceParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        self.storage
            .delete_service(&p.service_id)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_text(format!("Deleted service {}", p.service_id))
    }

    #[tool(
        description = "EXECUTES: Start a service process. Resolves mode and arg_preset from defaults if not specified. Use get_project to see available modes and presets. Returns immediately with PID; use get_process_status to monitor.",
        annotations(open_world_hint = true)
    )]
    fn start_service(
        &self,
        Parameters(p): Parameters<StartServiceParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let (project, service) = self
            .storage
            .get_service(&p.service_id)
            .ok_or_else(|| mcp_err("Service not found"))?;

        // Build the command with mode
        let mut command = service.command.clone();
        if let Some(ref mode) = p.mode {
            if let Some(ref modes) = service.modes {
                if let Some(suffix) = modes.get(mode) {
                    command = format!("{} {}", command, suffix);
                }
            }
        } else if let Some(ref default_mode) = service.default_mode {
            if let Some(ref modes) = service.modes {
                if let Some(suffix) = modes.get(default_mode) {
                    command = format!("{} {}", command, suffix);
                }
            }
        }

        // Append extra args or arg preset
        if let Some(ref preset_name) = p.arg_preset {
            if let Some(ref presets) = service.arg_presets {
                if let Some(args) = presets.get(preset_name) {
                    command = format!("{} {}", command, args);
                }
            }
        } else if let Some(ref default_preset) = service.default_arg_preset {
            if let Some(ref presets) = service.arg_presets {
                if let Some(args) = presets.get(default_preset) {
                    command = format!("{} {}", command, args);
                }
            }
        }

        if let Some(ref extra) = service.extra_args {
            if !extra.is_empty() {
                command = format!("{} {}", command, extra);
            }
        }

        let pid = self
            .process_manager
            .start_service(
                self.emitter.clone(),
                p.service_id.clone(),
                service.working_dir.clone(),
                command,
                service.env_vars.clone(),
                p.mode.clone(),
                p.arg_preset.clone(),
                RuntimeMeta::new(service.name.clone())
                    .with_project(project.id.clone(), project.name.clone()),
            )
            .map_err(|e| mcp_err(e))?;

        ok_json(&serde_json::json!({
            "status": "running",
            "pid": pid,
            "service_id": p.service_id,
            "project": project.name,
        }))
    }

    #[tool(description = "Stop a running service by killing its process tree.")]
    fn stop_service(
        &self,
        Parameters(p): Parameters<StopServiceParams>,
    ) -> Result<CallToolResult, McpError> {
        self.process_manager
            .stop_service(self.emitter.as_ref(), &p.service_id)
            .map_err(|e| mcp_err(e))?;
        ok_text(format!("Stopped service {}", p.service_id))
    }

    // ========================================================================
    // Project Scripts (5)
    // ========================================================================

    #[tool(description = "Add a script to a project. Project scripts are one-shot commands (build, test, deploy) scoped to a project.")]
    fn add_project_script(
        &self,
        Parameters(p): Parameters<AddProjectScriptParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let mut script = Script::new(p.name, p.working_dir, p.command);
        script.description = p.description;
        script.script_path = p.script_path;
        script.color = p.color;
        script.linked_service_ids = p.linked_service_ids.unwrap_or_default();
        let created = self
            .storage
            .add_script(&p.project_id, script)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&created)
    }

    #[tool(description = "Update a project script. Only provided fields are changed.", annotations(idempotent_hint = true))]
    fn update_project_script(
        &self,
        Parameters(p): Parameters<UpdateProjectScriptParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let updated = self
            .storage
            .update_script(&p.script_id, |s| {
                if let Some(v) = p.name {
                    s.name = v;
                }
                if let Some(v) = p.command {
                    s.command = v;
                }
                if let Some(v) = p.working_dir {
                    s.working_dir = v;
                }
                if let Some(v) = p.description {
                    s.description = Some(v);
                }
                if let Some(v) = p.script_path {
                    s.script_path = Some(v);
                }
                if let Some(v) = p.color {
                    s.color = Some(v);
                }
                if let Some(v) = p.linked_service_ids {
                    s.linked_service_ids = v;
                }
            })
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&updated)
    }

    #[tool(description = "Delete a project script permanently.", annotations(destructive_hint = true, idempotent_hint = true))]
    fn delete_project_script(
        &self,
        Parameters(p): Parameters<DeleteProjectScriptParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        self.storage
            .delete_script(&p.script_id)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_text(format!("Deleted project script {}", p.script_id))
    }

    #[tool(description = "EXECUTES: Run a project script. Returns immediately with PID; use get_process_status/get_process_logs to monitor.", annotations(open_world_hint = true))]
    fn run_project_script(
        &self,
        Parameters(p): Parameters<RunProjectScriptParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let (project, script) = self
            .storage
            .get_script(&p.script_id)
            .ok_or_else(|| mcp_err("Project script not found"))?;

        let pid = self
            .process_manager
            .run_script(
                self.emitter.clone(),
                p.script_id.clone(),
                script.working_dir.clone(),
                script.command.clone(),
                RuntimeMeta::new(script.name.clone())
                    .with_project(project.id.clone(), project.name.clone()),
            )
            .map_err(|e| mcp_err(e))?;

        ok_json(&serde_json::json!({
            "status": "running",
            "pid": pid,
            "script_id": p.script_id,
            "project": project.name,
        }))
    }

    #[tool(description = "Stop a running project script by killing its process tree.")]
    fn stop_project_script(
        &self,
        Parameters(p): Parameters<StopProjectScriptParams>,
    ) -> Result<CallToolResult, McpError> {
        self.process_manager
            .stop_script(self.emitter.as_ref(), &p.script_id)
            .map_err(|e| mcp_err(e))?;
        ok_text(format!("Stopped project script {}", p.script_id))
    }

    // ========================================================================
    // Tags (4)
    // ========================================================================

    #[tool(description = "List all tag definitions with their display colors and sort order. Tags are used to categorize scripts, projects, and tools.", annotations(read_only_hint = true))]
    fn list_tag_definitions(&self) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let defs = self.storage.get_all_tag_definitions();
        ok_json(&defs)
    }

    #[tool(description = "Create a tag definition with optional color and sort order. Tag names must be unique (case-insensitive).")]
    fn create_tag_definition(
        &self,
        Parameters(p): Parameters<CreateTagDefinitionParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let def = TagDefinition {
            name: p.name,
            color: p.color,
            order: p.order,
        };
        let created = self
            .storage
            .create_tag_definition(def)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&created)
    }

    #[tool(description = "Update a tag definition's name, color, or sort order. Looked up by current 'name'.", annotations(idempotent_hint = true))]
    fn update_tag_definition(
        &self,
        Parameters(p): Parameters<UpdateTagDefinitionParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let updated = self
            .storage
            .update_tag_definition(&p.name, |d| {
                if let Some(v) = p.new_name {
                    d.name = v;
                }
                if let Some(v) = p.color {
                    d.color = Some(v);
                }
                if let Some(v) = p.order {
                    d.order = Some(v);
                }
            })
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&updated)
    }

    #[tool(description = "Delete a tag definition permanently. Tags referencing this definition remain on items but lose their color/order metadata.", annotations(destructive_hint = true, idempotent_hint = true))]
    fn delete_tag_definition(
        &self,
        Parameters(p): Parameters<DeleteTagDefinitionParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        self.storage
            .delete_tag_definition(&p.name)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_text(format!("Deleted tag definition '{}'", p.name))
    }

    // ========================================================================
    // Tools Registry (4)
    // ========================================================================

    #[tool(description = "List all registered tools (CLI utilities, package managers, etc.), optionally filtered by tag or installation status.", annotations(read_only_hint = true))]
    fn list_tools(
        &self,
        Parameters(p): Parameters<ListToolsParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let mut tools = self.storage.get_all_tools();
        if let Some(tag) = p.tag {
            tools.retain(|t| t.tags.iter().any(|tg| tg.eq_ignore_ascii_case(&tag)));
        }
        if let Some(status) = p.status {
            tools.retain(|t| t.status.eq_ignore_ascii_case(&status));
        }
        ok_json(&tools)
    }

    #[tool(description = "Get detailed info about a tool by its ID, including version, install method, homepage, and notes.", annotations(read_only_hint = true))]
    fn get_tool_info(
        &self,
        Parameters(p): Parameters<GetToolInfoParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        match self.storage.get_tool(&p.id) {
            Some(t) => ok_json(&t),
            None => Err(mcp_err("Tool not found")),
        }
    }

    #[tool(description = "Register a new tool in the registry. Use scan_installed_tools to auto-discover tools first.")]
    fn create_tool(
        &self,
        Parameters(p): Parameters<CreateToolParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let mut tool = Tool::new(p.name, p.status.unwrap_or_else(|| "Active".to_string()));
        tool.description = p.description;
        tool.tags = p.tags.unwrap_or_default();
        tool.replaced_by = p.replaced_by;
        tool.install_method = p.install_method;
        tool.install_location = p.install_location;
        tool.version = p.version;
        tool.homepage = p.homepage;
        if let Some(cp) = p.config_paths {
            tool.config_paths = cp.into_iter().map(|c| c.into()).collect();
        }
        tool.toolbox_url = p.toolbox_url;
        tool.notes = p.notes;
        tool.color = p.color;
        let count = self.storage.get_all_tools().len() as u32;
        tool.order = count;
        let created = self
            .storage
            .create_tool(tool)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&created)
    }

    #[tool(description = "Update a tool entry. Only provided fields are changed.", annotations(idempotent_hint = true))]
    fn update_tool(
        &self,
        Parameters(p): Parameters<UpdateToolParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let updated = self
            .storage
            .update_tool(&p.id, |t| {
                if let Some(v) = p.name {
                    t.name = v;
                }
                if let Some(v) = p.description {
                    t.description = Some(v);
                }
                if let Some(v) = p.tags {
                    t.tags = v;
                }
                if let Some(v) = p.status {
                    t.status = v;
                }
                if let Some(v) = p.replaced_by {
                    t.replaced_by = Some(v);
                }
                if let Some(v) = p.install_method {
                    t.install_method = Some(v);
                }
                if let Some(v) = p.install_location {
                    t.install_location = Some(v);
                }
                if let Some(v) = p.version {
                    t.version = Some(v);
                }
                if let Some(v) = p.homepage {
                    t.homepage = Some(v);
                }
                if let Some(v) = p.config_paths {
                    t.config_paths = v.into_iter().map(|c| c.into()).collect();
                }
                if let Some(v) = p.toolbox_url {
                    t.toolbox_url = Some(v);
                }
                if let Some(v) = p.notes {
                    t.notes = Some(v);
                }
                if let Some(v) = p.color {
                    t.color = Some(v);
                }
            })
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&updated)
    }

    // ========================================================================
    // Process Management (3)
    // ========================================================================

    #[tool(description = "Get status and recent logs for a process. Reads the canonical runtime store + log file on disk, so processes started by any CortX surface (GUI, CLI, MCP, TUI) are visible. Returns status, PID, exit code if known, and last 5 log lines.", annotations(read_only_hint = true))]
    fn get_process_status(
        &self,
        Parameters(p): Parameters<GetProcessStatusParams>,
    ) -> Result<CallToolResult, McpError> {
        let store = self.process_manager.runtime_store();
        let entry = store.get(&p.id);
        let alive = entry
            .as_ref()
            .map(|e| cortx_core::runtime_state::is_pid_alive(e.pid))
            .unwrap_or(false);

        // In-memory MCP state still holds exit_code / success for processes
        // MCP itself spawned. Cross-instance processes won't have these.
        let in_mem = self.process_state.lock();
        let local = in_mem.get(&p.id);

        let last_lines = tail_log_file(&store.log_path(&p.id), 5);

        match (entry, alive, local) {
            (Some(e), true, _) => ok_json(&serde_json::json!({
                "id": p.id,
                "status": "running",
                "pid": e.pid,
                "display_name": e.display_name,
                "project_name": e.project_name,
                "started_at": e.started_at,
                "exit_code": serde_json::Value::Null,
                "success": serde_json::Value::Null,
                "last_lines": last_lines,
            })),
            (entry_opt, false, Some(ps)) => ok_json(&serde_json::json!({
                "id": p.id,
                "status": ps.status.to_string(),
                "pid": ps.pid.or(entry_opt.as_ref().map(|e| e.pid)),
                "display_name": entry_opt.as_ref().map(|e| e.display_name.clone()),
                "exit_code": ps.exit_code,
                "success": ps.success,
                "last_lines": last_lines,
            })),
            (Some(e), false, None) => ok_json(&serde_json::json!({
                "id": p.id,
                "status": "stopped",
                "pid": e.pid,
                "display_name": e.display_name,
                "last_lines": last_lines,
            })),
            (None, _, None) => Err(mcp_err(format!(
                "No process state found for '{}'. It may have never been started.",
                p.id
            ))),
            // Unreachable: alive is derived from entry, so alive=true implies
            // entry=Some. Compiler can't prove it though.
            (None, true, Some(_)) => unreachable!(),
        }
    }

    #[tool(description = "Get log output for a process. Reads the on-disk log file at <app_dir>/runtime/<id>.log written by every CortX surface, so logs of GUI/CLI-started processes are visible. Returns the last N lines (default 100).", annotations(read_only_hint = true))]
    fn get_process_logs(
        &self,
        Parameters(p): Parameters<GetProcessLogsParams>,
    ) -> Result<CallToolResult, McpError> {
        let tail = p.tail.unwrap_or(100);
        let log_path = self.process_manager.runtime_store().log_path(&p.id);

        if log_path.exists() {
            let lines = tail_log_file(&log_path, tail);
            let entry = self.process_manager.runtime_store().get(&p.id);
            let status = match entry {
                Some(ref e) if cortx_core::runtime_state::is_pid_alive(e.pid) => "running",
                Some(_) => "stopped",
                None => self
                    .process_state
                    .lock()
                    .get(&p.id)
                    .map(|ps| match ps.status {
                        crate::process_state::ProcessStatus::Running => "running",
                        crate::process_state::ProcessStatus::Completed => "completed",
                        crate::process_state::ProcessStatus::Failed => "failed",
                        crate::process_state::ProcessStatus::Stopped => "stopped",
                    })
                    .unwrap_or("unknown"),
            };
            return ok_json(&serde_json::json!({
                "id": p.id,
                "status": status,
                "returned_lines": lines.len(),
                "logs": lines,
            }));
        }

        // Fallback to in-memory buffer (legacy path for MCP-spawned processes
        // that ran before the log file existed for whatever reason).
        let state = self.process_state.lock();
        match state.get(&p.id) {
            Some(ps) => {
                let lines: Vec<&str> = ps
                    .logs
                    .iter()
                    .rev()
                    .take(tail)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .map(|s| s.as_str())
                    .collect();
                ok_json(&serde_json::json!({
                    "id": p.id,
                    "status": ps.status.to_string(),
                    "total_lines": ps.logs.len(),
                    "returned_lines": lines.len(),
                    "logs": lines,
                }))
            }
            None => Err(mcp_err(format!("No logs found for '{}'", p.id))),
        }
    }

    #[tool(description = "List ALL currently running services and scripts across every CortX surface (GUI, CLI, MCP, TUI). Sourced from the shared runtime store on disk, so processes started by other CortX instances are visible here too.", annotations(read_only_hint = true))]
    fn list_running_processes(&self) -> Result<CallToolResult, McpError> {
        let entries = self.process_manager.runtime_store().list();
        let processes: Vec<serde_json::Value> = entries
            .into_iter()
            .filter(|(_, alive)| *alive)
            .map(|(entry, _)| {
                serde_json::json!({
                    "id": entry.id,
                    "type": entry.kind.as_str(),
                    "status": "running",
                    "pid": entry.pid,
                    "display_name": entry.display_name,
                    "project_id": entry.project_id,
                    "project_name": entry.project_name,
                    "started_at": entry.started_at,
                    "mode": entry.mode,
                    "arg_preset": entry.arg_preset,
                    "command": entry.command,
                    "working_dir": entry.working_dir,
                })
            })
            .collect();
        ok_json(&processes)
    }

    // ========================================================================
    // Execution History (2)
    // ========================================================================

    #[tool(description = "Get execution history for a global script. Returns timestamped records with exit codes, durations, and parameter values used. Default limit: 20.", annotations(read_only_hint = true))]
    fn get_execution_history(
        &self,
        Parameters(p): Parameters<GetExecutionHistoryParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let limit = p.limit.unwrap_or(20);
        let history = self.storage.get_execution_history(&p.script_id, limit);
        ok_json(&history)
    }

    #[tool(description = "Clear all execution history records for a global script.", annotations(destructive_hint = true, idempotent_hint = true))]
    fn clear_execution_history(
        &self,
        Parameters(p): Parameters<ClearExecutionHistoryParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        self.storage
            .clear_execution_history(&p.script_id)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_text(format!(
            "Cleared execution history for script {}",
            p.script_id
        ))
    }

    // ========================================================================
    // Discovery (3)
    // ========================================================================

    #[tool(description = "EXECUTES: Scan a folder for script files (.py, .sh, .ps1, .bat, .js, etc.). Uses the configured main scripts folder if no folder is specified. Returns discovered files that can be imported as global scripts.", annotations(read_only_hint = true, open_world_hint = true))]
    fn scan_scripts_folder(
        &self,
        Parameters(p): Parameters<ScanScriptsFolderParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let settings = self.storage.get_settings();
        let folder = p.folder.unwrap_or_else(|| {
            settings
                .scripts_config
                .main_folder
                .clone()
                .unwrap_or_default()
        });
        if folder.is_empty() {
            return Err(mcp_err(
                "No folder specified and no main scripts folder configured in settings",
            ));
        }
        let scripts = script_discovery::scan_folder(
            &folder,
            &settings.scripts_config.scan_extensions,
            &settings.scripts_config.ignored_patterns,
        );
        ok_json(&scripts)
    }

    #[tool(description = "EXECUTES: Discover installed tools from Scoop and Chocolatey package managers. Returns tool names and versions found on the system. Use create_tool to register discovered tools.", annotations(read_only_hint = true, open_world_hint = true))]
    fn scan_installed_tools(&self) -> Result<CallToolResult, McpError> {
        let tools = tool_discovery::scan_installed_tools();
        ok_json(&tools)
    }

    #[tool(description = "Discover .env files in a project's root directory. Lists files matching .env* pattern without reading their contents.", annotations(read_only_hint = true))]
    fn discover_env_files(
        &self,
        Parameters(p): Parameters<DiscoverEnvFilesParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let project = self
            .storage
            .get_project(&p.project_id)
            .ok_or_else(|| mcp_err("Project not found"))?;

        let root = std::path::Path::new(&project.root_path);
        if !root.is_dir() {
            return Err(mcp_err(format!(
                "Project root path does not exist: {}",
                project.root_path
            )));
        }

        let mut env_files: Vec<serde_json::Value> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with(".env") && entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    env_files.push(serde_json::json!({
                        "filename": name,
                        "path": entry.path().to_string_lossy(),
                    }));
                }
            }
        }

        ok_json(&serde_json::json!({
            "project_id": p.project_id,
            "project_name": project.name,
            "root_path": project.root_path,
            "env_files_found": env_files,
            "existing_env_files": project.env_files.len(),
        }))
    }

    // ========================================================================
    // Settings & Config (3)
    // ========================================================================

    #[tool(description = "Get application settings including scripts folder config, scan extensions, and ignored patterns.", annotations(read_only_hint = true))]
    fn get_settings(&self) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let settings = self.storage.get_settings();
        ok_json(&settings)
    }

    #[tool(description = "Update application settings. Pass the full settings JSON object (use get_settings first to get the current values). Replaces the entire settings.", annotations(idempotent_hint = true))]
    fn update_settings(
        &self,
        Parameters(p): Parameters<UpdateSettingsParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let settings: AppSettings =
            serde_json::from_value(p.settings).map_err(|e| mcp_err(format!("Invalid settings: {}", e)))?;
        self.storage
            .update_settings(settings)
            .map_err(|e| mcp_err(e.to_string()))?;
        let updated = self.storage.get_settings();
        ok_json(&updated)
    }

    #[tool(description = "Export all scripts, groups, tools, and tag definitions as a JSON backup. Returns the full export as a JSON string.", annotations(read_only_hint = true))]
    fn export_config(&self) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let json = self
            .storage
            .export_scripts_config()
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_text(json)
    }

    // ========================================================================
    // Shell Aliases (5)
    // ========================================================================

    #[tool(description = "List all shell aliases. Aliases are shell shortcuts (e.g. 'cc' → 'claude --dangerously-skip-permissions') managed by CortX and activated via `cortx init <shell>`. Optionally filter by tag.", annotations(read_only_hint = true))]
    fn list_aliases(
        &self,
        Parameters(p): Parameters<ListAliasesParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let mut aliases = self.storage.get_all_aliases();
        if let Some(ref tag) = p.tag {
            aliases.retain(|a| a.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)));
        }
        ok_json(&aliases)
    }

    #[tool(description = "Get details of a specific shell alias by ID or name.", annotations(read_only_hint = true))]
    fn get_alias(
        &self,
        Parameters(p): Parameters<GetAliasParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let alias = if let Some(ref id) = p.id {
            self.storage.get_alias(id)
        } else if let Some(ref name) = p.name {
            self.storage.get_alias_by_name(name)
        } else {
            return Err(mcp_err("Provide either 'id' or 'name'".to_string()));
        };
        alias.map(|a| ok_json(&a)).unwrap_or_else(|| {
            Err(mcp_err(format!(
                "Alias not found: {}",
                p.id.as_deref().or(p.name.as_deref()).unwrap_or("?")
            )))
        })
    }

    #[tool(description = "Create a new shell alias. The alias will be available in shells that source `cortx init <shell>` output.")]
    fn create_alias(
        &self,
        Parameters(p): Parameters<CreateAliasParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        cortx_core::shell_init::validate_alias_name(&p.name)
            .map_err(|e| mcp_err(e))?;
        if let Some(ref at) = p.alias_type {
            cortx_core::shell_init::validate_alias_type(at)
                .map_err(|e| mcp_err(e))?;
        }
        let mut alias = cortx_core::models::ShellAlias::new(p.name, p.command);
        alias.description = p.description;
        if let Some(tags) = p.tags {
            alias.tags = tags;
        }
        alias.status = p.status;
        if let Some(at) = p.alias_type {
            alias.alias_type = at;
        }
        alias.setup = p.setup;
        alias.script = p.script;
        alias.tool_id = p.tool_id;
        alias.execution_order = p.execution_order;
        alias.shim = p.shim.unwrap_or(false);
        let count = self.storage.get_all_aliases().len() as u32;
        alias.order = count;
        let created = self.storage.create_alias(alias).map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&created)
    }

    #[tool(description = "Update a shell alias. Only provided fields are changed.", annotations(idempotent_hint = true))]
    fn update_alias(
        &self,
        Parameters(p): Parameters<UpdateAliasParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        if let Some(ref name) = p.name {
            cortx_core::shell_init::validate_alias_name(name)
                .map_err(|e| mcp_err(e))?;
        }
        if let Some(ref at) = p.alias_type {
            cortx_core::shell_init::validate_alias_type(at)
                .map_err(|e| mcp_err(e))?;
        }
        let updated = self.storage.update_alias(&p.id, |a| {
            if let Some(v) = p.name {
                a.name = v;
            }
            if let Some(v) = p.command {
                a.command = v;
            }
            if let Some(v) = p.description {
                a.description = Some(v);
            }
            if let Some(v) = p.tags {
                a.tags = v;
            }
            if let Some(v) = p.status {
                a.status = Some(v);
            }
            if let Some(v) = p.alias_type {
                a.alias_type = v;
            }
            if let Some(v) = p.setup {
                a.setup = Some(v);
            }
            if let Some(v) = p.script {
                a.script = Some(v);
            }
            if let Some(v) = p.tool_id {
                a.tool_id = if v.is_empty() { None } else { Some(v) };
            }
            if p.execution_order.is_some() {
                a.execution_order = p.execution_order;
            }
            if let Some(v) = p.shim {
                a.shim = v;
            }
        }).map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&updated)
    }

    #[tool(description = "Delete a shell alias.", annotations(destructive_hint = true, idempotent_hint = true))]
    fn delete_alias(
        &self,
        Parameters(p): Parameters<DeleteAliasParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        self.storage.delete_alias(&p.id).map_err(|e| mcp_err(e.to_string()))?;
        ok_text(format!("Deleted alias {}", p.id))
    }

    // ========================================================================
    // Status Definitions (4)
    // ========================================================================

    #[tool(description = "List all status definitions with their display colors and sort order. Status definitions provide metadata (color, order) for status labels used on scripts, projects, aliases, and apps.", annotations(read_only_hint = true))]
    fn list_status_definitions(&self) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let defs = self.storage.get_all_status_definitions();
        ok_json(&defs)
    }

    #[tool(description = "Create a status definition with optional color and sort order. Status names must be unique (case-insensitive).")]
    fn create_status_definition(
        &self,
        Parameters(p): Parameters<CreateStatusDefinitionParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let def = StatusDefinition {
            name: p.name,
            color: p.color,
            order: p.order,
        };
        let created = self
            .storage
            .create_status_definition(def)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&created)
    }

    #[tool(description = "Update a status definition's name, color, or sort order. Looked up by current 'name'.", annotations(idempotent_hint = true))]
    fn update_status_definition(
        &self,
        Parameters(p): Parameters<UpdateStatusDefinitionParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let updated = self
            .storage
            .update_status_definition(&p.name, |d| {
                if let Some(v) = p.new_name {
                    d.name = v;
                }
                if let Some(v) = p.color {
                    d.color = Some(v);
                }
                if let Some(v) = p.order {
                    d.order = Some(v);
                }
            })
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&updated)
    }

    #[tool(description = "Delete a status definition permanently. Items referencing this status keep their status string but lose color/order metadata.", annotations(destructive_hint = true, idempotent_hint = true))]
    fn delete_status_definition(
        &self,
        Parameters(p): Parameters<DeleteStatusDefinitionParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        self.storage
            .delete_status_definition(&p.name)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_text(format!("Deleted status definition '{}'", p.name))
    }

    // ========================================================================
    // Apps (6)
    // ========================================================================

    #[tool(description = "List all registered apps (GUI applications), optionally filtered by tag or status.", annotations(read_only_hint = true))]
    fn list_apps(
        &self,
        Parameters(p): Parameters<ListAppsParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let mut apps = self.storage.get_all_apps();
        if let Some(tag) = p.tag {
            apps.retain(|a| a.tags.iter().any(|t| t.eq_ignore_ascii_case(&tag)));
        }
        if let Some(status) = p.status {
            apps.retain(|a| {
                a.status
                    .as_deref()
                    .map(|s| s.eq_ignore_ascii_case(&status))
                    .unwrap_or(false)
            });
        }
        ok_json(&apps)
    }

    #[tool(description = "Get detailed info about an app by its ID, including version, executable path, launch args, and notes.", annotations(read_only_hint = true))]
    fn get_app_info(
        &self,
        Parameters(p): Parameters<GetAppParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        match self.storage.get_app(&p.id) {
            Some(app) => ok_json(&app),
            None => Err(mcp_err("App not found")),
        }
    }

    #[tool(description = "Register a new app in the registry.")]
    fn create_app(
        &self,
        Parameters(p): Parameters<CreateAppParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let mut app = App::new(p.name);
        app.description = p.description;
        app.tags = p.tags.unwrap_or_default();
        app.status = p.status;
        app.version = p.version;
        app.homepage = p.homepage;
        app.executable_path = p.executable_path;
        app.launch_args = p.launch_args;
        if let Some(cp) = p.config_paths {
            app.config_paths = cp.into_iter().map(|c| c.into()).collect();
        }
        app.toolbox_url = p.toolbox_url;
        app.notes = p.notes;
        app.color = p.color;
        let count = self.storage.get_all_apps().len() as u32;
        app.order = count;
        let created = self
            .storage
            .create_app(app)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&created)
    }

    #[tool(description = "Update an app entry. Only provided fields are changed.", annotations(idempotent_hint = true))]
    fn update_app(
        &self,
        Parameters(p): Parameters<UpdateAppParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let updated = self
            .storage
            .update_app(&p.id, |a| {
                if let Some(v) = p.name {
                    a.name = v;
                }
                if let Some(v) = p.description {
                    a.description = Some(v);
                }
                if let Some(v) = p.tags {
                    a.tags = v;
                }
                if let Some(v) = p.status {
                    a.status = Some(v);
                }
                if let Some(v) = p.version {
                    a.version = Some(v);
                }
                if let Some(v) = p.homepage {
                    a.homepage = Some(v);
                }
                if let Some(v) = p.executable_path {
                    a.executable_path = Some(v);
                }
                if let Some(v) = p.launch_args {
                    a.launch_args = Some(v);
                }
                if let Some(v) = p.config_paths {
                    a.config_paths = v.into_iter().map(|c| c.into()).collect();
                }
                if let Some(v) = p.toolbox_url {
                    a.toolbox_url = Some(v);
                }
                if let Some(v) = p.notes {
                    a.notes = Some(v);
                }
                if let Some(v) = p.color {
                    a.color = Some(v);
                }
            })
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_json(&updated)
    }

    #[tool(description = "Delete an app from the registry permanently.", annotations(destructive_hint = true, idempotent_hint = true))]
    fn delete_app(
        &self,
        Parameters(p): Parameters<DeleteAppParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        self.storage
            .delete_app(&p.id)
            .map_err(|e| mcp_err(e.to_string()))?;
        ok_text(format!("Deleted app {}", p.id))
    }

    #[tool(
        description = "EXECUTES: Launch an app's executable. Opens the application using the configured executable_path and optional launch_args. The app must have an executable_path set.",
        annotations(open_world_hint = true)
    )]
    fn launch_app(
        &self,
        Parameters(p): Parameters<LaunchAppParams>,
    ) -> Result<CallToolResult, McpError> {
        self.reload()?;
        let app = self
            .storage
            .get_app(&p.id)
            .ok_or_else(|| mcp_err("App not found"))?;
        let path = app
            .executable_path
            .ok_or_else(|| mcp_err("App has no executable_path configured"))?;

        let extra_args: Vec<String> = app
            .launch_args
            .as_deref()
            .map(|s| s.split_whitespace().map(String::from).collect())
            .unwrap_or_default();

        #[cfg(target_os = "windows")]
        {
            let mut cmd = std::process::Command::new("cmd");
            cmd.args(["/C", "start", "", &path]);
            for arg in &extra_args {
                cmd.arg(arg);
            }
            cmd.spawn().map_err(|e| mcp_err(format!("Failed to launch app: {}", e)))?;
        }

        #[cfg(target_os = "macos")]
        {
            if path.ends_with(".app") || path.contains(".app/") {
                let mut cmd = std::process::Command::new("open");
                cmd.args(["-n", "-a", &path]);
                if !extra_args.is_empty() {
                    cmd.arg("--args");
                    for arg in &extra_args {
                        cmd.arg(arg);
                    }
                }
                cmd.spawn().map_err(|e| mcp_err(format!("Failed to launch app: {}", e)))?;
            } else {
                let mut cmd = std::process::Command::new(&path);
                for arg in &extra_args {
                    cmd.arg(arg);
                }
                cmd.spawn().map_err(|e| mcp_err(format!("Failed to launch app: {}", e)))?;
            }
        }

        #[cfg(target_os = "linux")]
        {
            let mut cmd = std::process::Command::new(&path);
            for arg in &extra_args {
                cmd.arg(arg);
            }
            cmd.spawn().map_err(|e| mcp_err(format!("Failed to launch app: {}", e)))?;
        }

        ok_text(format!("Launched app '{}' ({})", app.name, path))
    }
}

// ============================================================================
// ServerHandler
// ============================================================================

#[tool_handler]
impl ServerHandler for CortxMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::from_build_env())
            .with_protocol_version(ProtocolVersion::V_2024_11_05)
            .with_instructions(
                "CortX MCP Server - Manage local scripts, projects, services, tools, and tags. \
                 Use list_* tools to discover available items. Tools marked with EXECUTES: will \
                 run commands on the system. Use get_process_status/get_process_logs to monitor \
                 running processes."
                    .to_string(),
            )
    }
}
