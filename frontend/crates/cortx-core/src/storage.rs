use crate::models::*;
use directories::ProjectDirs;
use fs2::FileExt;
use parking_lot::RwLock;
use std::fs::{self, File, OpenOptions};
use std::io::Write as IoWrite;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("Failed to get application directory")]
    NoAppDir,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Project not found: {0}")]
    ProjectNotFound(String),
    #[error("Service not found: {0}")]
    ServiceNotFound(String),
    #[error("Script not found: {0}")]
    ScriptNotFound(String),
    #[error("Global script not found: {0}")]
    GlobalScriptNotFound(String),
    #[error("Folder not found: {0}")]
    FolderNotFound(String),
    #[error("Script group not found: {0}")]
    ScriptGroupNotFound(String),
    #[error("Tool not found: {0}")]
    ToolNotFound(String),
}

pub struct Storage {
    app_dir: PathBuf,
    projects: RwLock<Vec<Project>>,
    settings: RwLock<AppSettings>,
    global_scripts: RwLock<Vec<GlobalScript>>,
    tag_definitions: RwLock<Vec<TagDefinition>>,
    script_groups: RwLock<Vec<ScriptGroup>>,
    execution_history: RwLock<Vec<ExecutionRecord>>,
    tools: RwLock<Vec<Tool>>,
}

// File locking helpers

fn read_json_locked<T: serde::de::DeserializeOwned>(path: &PathBuf) -> Result<T, StorageError> {
    let file = File::open(path)?;
    file.lock_shared().map_err(|e| StorageError::Io(e))?;
    let content = std::io::read_to_string(&file)?;
    file.unlock().map_err(|e| StorageError::Io(e))?;
    Ok(serde_json::from_str(&content)?)
}

fn write_json_locked<T: serde::Serialize>(path: &PathBuf, data: &T) -> Result<(), StorageError> {
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)?;
    file.lock_exclusive().map_err(|e| StorageError::Io(e))?;
    let content = serde_json::to_string_pretty(data)?;
    (&file).write_all(content.as_bytes())?;
    file.unlock().map_err(|e| StorageError::Io(e))?;
    Ok(())
}

impl Storage {
    pub fn new() -> Result<Self, StorageError> {
        let project_dirs =
            ProjectDirs::from("com", "cortx", "Cortx").ok_or(StorageError::NoAppDir)?;

        let app_dir = project_dirs.data_dir().to_path_buf();

        // Create directories if they don't exist
        fs::create_dir_all(&app_dir)?;
        fs::create_dir_all(app_dir.join("images"))?;

        let storage = Self {
            app_dir,
            projects: RwLock::new(Vec::new()),
            settings: RwLock::new(AppSettings::default()),
            global_scripts: RwLock::new(Vec::new()),
            tag_definitions: RwLock::new(Vec::new()),
            script_groups: RwLock::new(Vec::new()),
            execution_history: RwLock::new(Vec::new()),
            tools: RwLock::new(Vec::new()),
        };

        // Load existing data
        storage.load_projects()?;
        storage.load_settings()?;
        storage.load_global_scripts()?;
        storage.load_tag_definitions()?;
        storage.load_script_groups()?;
        storage.load_execution_history()?;
        storage.load_tools()?;

        Ok(storage)
    }

    // Path helpers

    fn projects_path(&self) -> PathBuf {
        self.app_dir.join("projects.json")
    }

    fn settings_path(&self) -> PathBuf {
        self.app_dir.join("settings.json")
    }

    pub fn images_dir(&self) -> PathBuf {
        self.app_dir.join("images")
    }

    fn global_scripts_path(&self) -> PathBuf {
        self.app_dir.join("global_scripts.json")
    }

    fn tag_definitions_path(&self) -> PathBuf {
        self.app_dir.join("tag_definitions.json")
    }

    fn script_groups_path(&self) -> PathBuf {
        self.app_dir.join("script_groups.json")
    }

    fn execution_history_path(&self) -> PathBuf {
        self.app_dir.join("execution_history.json")
    }

    fn tools_path(&self) -> PathBuf {
        self.app_dir.join("tools.json")
    }

    // ========================================================================
    // Projects
    // ========================================================================

    fn load_projects(&self) -> Result<(), StorageError> {
        let path = self.projects_path();
        if path.exists() {
            let projects: Vec<Project> = read_json_locked(&path)?;
            *self.projects.write() = projects;
        }
        Ok(())
    }

    fn save_projects(&self) -> Result<(), StorageError> {
        let path = self.projects_path();
        let projects = self.projects.read();
        write_json_locked(&path, &*projects)
    }

    pub fn get_all_projects(&self) -> Vec<Project> {
        self.projects.read().clone()
    }

    pub fn get_project(&self, id: &str) -> Option<Project> {
        self.projects.read().iter().find(|p| p.id == id).cloned()
    }

    pub fn create_project(&self, project: Project) -> Result<Project, StorageError> {
        {
            let mut projects = self.projects.write();
            projects.push(project.clone());
        }
        self.save_projects()?;
        Ok(project)
    }

    pub fn update_project(
        &self,
        id: &str,
        updater: impl FnOnce(&mut Project),
    ) -> Result<Project, StorageError> {
        let project = {
            let mut projects = self.projects.write();
            let project = projects
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or_else(|| StorageError::ProjectNotFound(id.to_string()))?;

            updater(project);
            project.updated_at = chrono::Utc::now();
            project.clone()
        };
        self.save_projects()?;
        Ok(project)
    }

    pub fn delete_project(&self, id: &str) -> Result<(), StorageError> {
        {
            let mut projects = self.projects.write();
            let initial_len = projects.len();
            projects.retain(|p| p.id != id);
            if projects.len() == initial_len {
                return Err(StorageError::ProjectNotFound(id.to_string()));
            }
        }
        self.save_projects()?;
        Ok(())
    }

    // ========================================================================
    // Services (within projects)
    // ========================================================================

    pub fn add_service(
        &self,
        project_id: &str,
        service: Service,
    ) -> Result<Service, StorageError> {
        let service_clone = service.clone();
        {
            let mut projects = self.projects.write();
            let project = projects
                .iter_mut()
                .find(|p| p.id == project_id)
                .ok_or_else(|| StorageError::ProjectNotFound(project_id.to_string()))?;

            project.services.push(service);
            project.updated_at = chrono::Utc::now();
        }
        self.save_projects()?;
        Ok(service_clone)
    }

    pub fn update_service(
        &self,
        service_id: &str,
        updater: impl FnOnce(&mut Service),
    ) -> Result<Service, StorageError> {
        let service = {
            let mut projects = self.projects.write();
            let mut found_service = None;

            for project in projects.iter_mut() {
                if let Some(service) = project.services.iter_mut().find(|s| s.id == service_id) {
                    updater(service);
                    found_service = Some(service.clone());
                    project.updated_at = chrono::Utc::now();
                    break;
                }
            }

            found_service.ok_or_else(|| StorageError::ServiceNotFound(service_id.to_string()))?
        };
        self.save_projects()?;
        Ok(service)
    }

    pub fn delete_service(&self, service_id: &str) -> Result<(), StorageError> {
        {
            let mut projects = self.projects.write();
            let mut found = false;

            for project in projects.iter_mut() {
                let initial_len = project.services.len();
                project.services.retain(|s| s.id != service_id);
                if project.services.len() != initial_len {
                    project.updated_at = chrono::Utc::now();
                    found = true;
                    break;
                }
            }

            if !found {
                return Err(StorageError::ServiceNotFound(service_id.to_string()));
            }
        }
        self.save_projects()?;
        Ok(())
    }

    pub fn get_service(&self, service_id: &str) -> Option<(Project, Service)> {
        let projects = self.projects.read();
        for project in projects.iter() {
            if let Some(service) = project.services.iter().find(|s| s.id == service_id) {
                return Some((project.clone(), service.clone()));
            }
        }
        None
    }

    // ========================================================================
    // Scripts (within projects)
    // ========================================================================

    pub fn add_script(
        &self,
        project_id: &str,
        script: Script,
    ) -> Result<Script, StorageError> {
        let script_clone = script.clone();
        {
            let mut projects = self.projects.write();
            let project = projects
                .iter_mut()
                .find(|p| p.id == project_id)
                .ok_or_else(|| StorageError::ProjectNotFound(project_id.to_string()))?;

            project.scripts.push(script);
            project.updated_at = chrono::Utc::now();
        }
        self.save_projects()?;
        Ok(script_clone)
    }

    pub fn update_script(
        &self,
        script_id: &str,
        updater: impl FnOnce(&mut Script),
    ) -> Result<Script, StorageError> {
        let script = {
            let mut projects = self.projects.write();
            let mut found_script = None;

            for project in projects.iter_mut() {
                if let Some(script) = project.scripts.iter_mut().find(|s| s.id == script_id) {
                    updater(script);
                    found_script = Some(script.clone());
                    project.updated_at = chrono::Utc::now();
                    break;
                }
            }

            found_script.ok_or_else(|| StorageError::ScriptNotFound(script_id.to_string()))?
        };
        self.save_projects()?;
        Ok(script)
    }

    pub fn delete_script(&self, script_id: &str) -> Result<(), StorageError> {
        {
            let mut projects = self.projects.write();
            let mut found = false;

            for project in projects.iter_mut() {
                let initial_len = project.scripts.len();
                project.scripts.retain(|s| s.id != script_id);
                if project.scripts.len() != initial_len {
                    project.updated_at = chrono::Utc::now();
                    found = true;
                    break;
                }
            }

            if !found {
                return Err(StorageError::ScriptNotFound(script_id.to_string()));
            }
        }
        self.save_projects()?;
        Ok(())
    }

    pub fn get_script(&self, script_id: &str) -> Option<(Project, Script)> {
        let projects = self.projects.read();
        for project in projects.iter() {
            if let Some(script) = project.scripts.iter().find(|s| s.id == script_id) {
                return Some((project.clone(), script.clone()));
            }
        }
        None
    }

    // ========================================================================
    // Settings
    // ========================================================================

    fn load_settings(&self) -> Result<(), StorageError> {
        let path = self.settings_path();
        if path.exists() {
            let settings: AppSettings = read_json_locked(&path)?;
            *self.settings.write() = settings;
        }
        Ok(())
    }

    fn save_settings(&self) -> Result<(), StorageError> {
        let path = self.settings_path();
        let settings = self.settings.read();
        write_json_locked(&path, &*settings)
    }

    pub fn get_settings(&self) -> AppSettings {
        self.settings.read().clone()
    }

    pub fn update_settings(&self, settings: AppSettings) -> Result<(), StorageError> {
        *self.settings.write() = settings;
        self.save_settings()?;
        Ok(())
    }

    // ========================================================================
    // Global Scripts
    // ========================================================================

    fn load_global_scripts(&self) -> Result<(), StorageError> {
        let path = self.global_scripts_path();
        if path.exists() {
            let scripts: Vec<GlobalScript> = read_json_locked(&path)?;
            *self.global_scripts.write() = scripts;
        }
        Ok(())
    }

    fn save_global_scripts(&self) -> Result<(), StorageError> {
        let path = self.global_scripts_path();
        let scripts = self.global_scripts.read();
        write_json_locked(&path, &*scripts)
    }

    pub fn get_all_global_scripts(&self) -> Vec<GlobalScript> {
        self.global_scripts.read().clone()
    }

    pub fn get_global_script(&self, id: &str) -> Option<GlobalScript> {
        self.global_scripts
            .read()
            .iter()
            .find(|s| s.id == id)
            .cloned()
    }

    pub fn create_global_script(
        &self,
        script: GlobalScript,
    ) -> Result<GlobalScript, StorageError> {
        {
            let mut scripts = self.global_scripts.write();
            scripts.push(script.clone());
        }
        self.save_global_scripts()?;
        Ok(script)
    }

    pub fn update_global_script(
        &self,
        id: &str,
        updater: impl FnOnce(&mut GlobalScript),
    ) -> Result<GlobalScript, StorageError> {
        let script = {
            let mut scripts = self.global_scripts.write();
            let script = scripts
                .iter_mut()
                .find(|s| s.id == id)
                .ok_or_else(|| StorageError::GlobalScriptNotFound(id.to_string()))?;

            updater(script);
            script.updated_at = chrono::Utc::now();
            script.clone()
        };
        self.save_global_scripts()?;
        Ok(script)
    }

    pub fn delete_global_script(&self, id: &str) -> Result<(), StorageError> {
        {
            let mut scripts = self.global_scripts.write();
            let initial_len = scripts.len();
            scripts.retain(|s| s.id != id);
            if scripts.len() == initial_len {
                return Err(StorageError::GlobalScriptNotFound(id.to_string()));
            }
        }
        self.save_global_scripts()?;
        Ok(())
    }

    // ========================================================================
    // Tag Definitions
    // ========================================================================

    fn load_tag_definitions(&self) -> Result<(), StorageError> {
        let path = self.tag_definitions_path();
        if path.exists() {
            let defs: Vec<TagDefinition> = read_json_locked(&path)?;
            *self.tag_definitions.write() = defs;
        }
        Ok(())
    }

    fn save_tag_definitions(&self) -> Result<(), StorageError> {
        let path = self.tag_definitions_path();
        let defs = self.tag_definitions.read();
        write_json_locked(&path, &*defs)
    }

    pub fn get_all_tag_definitions(&self) -> Vec<TagDefinition> {
        self.tag_definitions.read().clone()
    }

    pub fn create_tag_definition(
        &self,
        def: TagDefinition,
    ) -> Result<TagDefinition, StorageError> {
        {
            let mut defs = self.tag_definitions.write();
            // Prevent duplicate names (case-insensitive)
            let name_lower = def.name.to_lowercase();
            if defs.iter().any(|d| d.name.to_lowercase() == name_lower) {
                return Err(StorageError::Io(std::io::Error::new(
                    std::io::ErrorKind::AlreadyExists,
                    format!("Tag definition '{}' already exists", def.name),
                )));
            }
            defs.push(def.clone());
        }
        self.save_tag_definitions()?;
        Ok(def)
    }

    pub fn update_tag_definition(
        &self,
        name: &str,
        updater: impl FnOnce(&mut TagDefinition),
    ) -> Result<TagDefinition, StorageError> {
        let def = {
            let mut defs = self.tag_definitions.write();
            let name_lower = name.to_lowercase();
            let def = defs
                .iter_mut()
                .find(|d| d.name.to_lowercase() == name_lower)
                .ok_or_else(|| StorageError::FolderNotFound(name.to_string()))?;

            updater(def);
            def.clone()
        };
        self.save_tag_definitions()?;
        Ok(def)
    }

    pub fn delete_tag_definition(&self, name: &str) -> Result<(), StorageError> {
        {
            let mut defs = self.tag_definitions.write();
            let name_lower = name.to_lowercase();
            let initial_len = defs.len();
            defs.retain(|d| d.name.to_lowercase() != name_lower);
            if defs.len() == initial_len {
                return Err(StorageError::FolderNotFound(name.to_string()));
            }
        }
        self.save_tag_definitions()?;
        Ok(())
    }

    // ========================================================================
    // Script Groups
    // ========================================================================

    fn load_script_groups(&self) -> Result<(), StorageError> {
        let path = self.script_groups_path();
        if path.exists() {
            let groups: Vec<ScriptGroup> = read_json_locked(&path)?;
            *self.script_groups.write() = groups;
        }
        Ok(())
    }

    fn save_script_groups(&self) -> Result<(), StorageError> {
        let path = self.script_groups_path();
        let groups = self.script_groups.read();
        write_json_locked(&path, &*groups)
    }

    pub fn get_all_script_groups(&self) -> Vec<ScriptGroup> {
        self.script_groups.read().clone()
    }

    pub fn get_script_group(&self, id: &str) -> Option<ScriptGroup> {
        self.script_groups
            .read()
            .iter()
            .find(|g| g.id == id)
            .cloned()
    }

    pub fn create_script_group(
        &self,
        group: ScriptGroup,
    ) -> Result<ScriptGroup, StorageError> {
        {
            let mut groups = self.script_groups.write();
            groups.push(group.clone());
        }
        self.save_script_groups()?;
        Ok(group)
    }

    pub fn update_script_group(
        &self,
        id: &str,
        updater: impl FnOnce(&mut ScriptGroup),
    ) -> Result<ScriptGroup, StorageError> {
        let group = {
            let mut groups = self.script_groups.write();
            let group = groups
                .iter_mut()
                .find(|g| g.id == id)
                .ok_or_else(|| StorageError::ScriptGroupNotFound(id.to_string()))?;

            updater(group);
            group.clone()
        };
        self.save_script_groups()?;
        Ok(group)
    }

    pub fn delete_script_group(&self, id: &str) -> Result<(), StorageError> {
        {
            let mut groups = self.script_groups.write();
            let initial_len = groups.len();
            groups.retain(|g| g.id != id);
            if groups.len() == initial_len {
                return Err(StorageError::ScriptGroupNotFound(id.to_string()));
            }
        }
        self.save_script_groups()?;
        Ok(())
    }

    // ========================================================================
    // Execution History
    // ========================================================================

    fn load_execution_history(&self) -> Result<(), StorageError> {
        let path = self.execution_history_path();
        if path.exists() {
            let history: Vec<ExecutionRecord> = read_json_locked(&path)?;
            *self.execution_history.write() = history;
        }
        Ok(())
    }

    fn save_execution_history(&self) -> Result<(), StorageError> {
        let path = self.execution_history_path();
        let history = self.execution_history.read();
        write_json_locked(&path, &*history)
    }

    pub fn add_execution_record(
        &self,
        record: ExecutionRecord,
    ) -> Result<(), StorageError> {
        {
            let mut history = self.execution_history.write();
            history.push(record);
        }
        self.save_execution_history()?;
        Ok(())
    }

    pub fn update_execution_record(
        &self,
        id: &str,
        updater: impl FnOnce(&mut ExecutionRecord),
    ) -> Result<(), StorageError> {
        {
            let mut history = self.execution_history.write();
            if let Some(record) = history.iter_mut().find(|r| r.id == id) {
                updater(record);
            }
        }
        self.save_execution_history()?;
        Ok(())
    }

    pub fn get_execution_history(
        &self,
        script_id: &str,
        limit: usize,
    ) -> Vec<ExecutionRecord> {
        let history = self.execution_history.read();
        history
            .iter()
            .filter(|r| r.script_id == script_id)
            .rev()
            .take(limit)
            .cloned()
            .collect()
    }

    pub fn clear_execution_history(&self, script_id: &str) -> Result<(), StorageError> {
        {
            let mut history = self.execution_history.write();
            history.retain(|r| r.script_id != script_id);
        }
        self.save_execution_history()?;
        Ok(())
    }

    // ========================================================================
    // Tools
    // ========================================================================

    fn load_tools(&self) -> Result<(), StorageError> {
        let path = self.tools_path();
        if path.exists() {
            let tools: Vec<Tool> = read_json_locked(&path)?;
            *self.tools.write() = tools;
        }
        Ok(())
    }

    fn save_tools(&self) -> Result<(), StorageError> {
        let path = self.tools_path();
        let tools = self.tools.read();
        write_json_locked(&path, &*tools)
    }

    pub fn get_all_tools(&self) -> Vec<Tool> {
        self.tools.read().clone()
    }

    pub fn get_tool(&self, id: &str) -> Option<Tool> {
        self.tools.read().iter().find(|t| t.id == id).cloned()
    }

    pub fn create_tool(&self, tool: Tool) -> Result<Tool, StorageError> {
        {
            let mut tools = self.tools.write();
            tools.push(tool.clone());
        }
        self.save_tools()?;
        Ok(tool)
    }

    pub fn update_tool(
        &self,
        id: &str,
        updater: impl FnOnce(&mut Tool),
    ) -> Result<Tool, StorageError> {
        let tool = {
            let mut tools = self.tools.write();
            let tool = tools
                .iter_mut()
                .find(|t| t.id == id)
                .ok_or_else(|| StorageError::ToolNotFound(id.to_string()))?;

            updater(tool);
            tool.updated_at = chrono::Utc::now();
            tool.clone()
        };
        self.save_tools()?;
        Ok(tool)
    }

    pub fn delete_tool(&self, id: &str) -> Result<(), StorageError> {
        {
            let mut tools = self.tools.write();
            let initial_len = tools.len();
            tools.retain(|t| t.id != id);
            if tools.len() == initial_len {
                return Err(StorageError::ToolNotFound(id.to_string()));
            }
        }
        self.save_tools()?;
        Ok(())
    }

    // ========================================================================
    // Reload (for MCP concurrent access)
    // ========================================================================

    /// Re-read all JSON files from disk into the in-memory caches.
    /// Used by the MCP server to ensure fresh data when Tauri or other
    /// processes may have written to the same files.
    pub fn reload_all(&self) -> Result<(), StorageError> {
        self.load_projects()?;
        self.load_settings()?;
        self.load_global_scripts()?;
        self.load_tag_definitions()?;
        self.load_script_groups()?;
        self.load_execution_history()?;
        self.load_tools()?;
        Ok(())
    }

    // ========================================================================
    // Import / Export
    // ========================================================================

    /// Export all scripts, tag definitions, groups, and tools as a ScriptExport JSON string
    pub fn export_scripts_config(&self) -> Result<String, StorageError> {
        let export = ScriptExport {
            version: "2.0".to_string(),
            scripts: self.get_all_global_scripts(),
            groups: self.get_all_script_groups(),
            tools: self.get_all_tools(),
            tag_definitions: self.get_all_tag_definitions(),
            exported_at: chrono::Utc::now(),
        };
        serde_json::to_string_pretty(&export).map_err(StorageError::Json)
    }

    /// Import scripts, tag definitions, groups, and tools from a ScriptExport JSON string.
    /// Merges with existing data (skips items with duplicate IDs/names).
    pub fn import_scripts_config(&self, json: &str) -> Result<ImportResult, StorageError> {
        let import: ScriptExport =
            serde_json::from_str(json).map_err(StorageError::Json)?;

        let mut scripts_added = 0u32;
        let mut groups_added = 0u32;
        let mut skipped = 0u32;
        let mut tools_added = 0u32;
        let mut tag_definitions_added = 0u32;

        // Import tag definitions
        let existing_defs = self.get_all_tag_definitions();
        for def in import.tag_definitions {
            if existing_defs.iter().any(|d| d.name.to_lowercase() == def.name.to_lowercase()) {
                skipped += 1;
                continue;
            }
            {
                let mut defs = self.tag_definitions.write();
                if defs.iter().any(|d| d.name.to_lowercase() == def.name.to_lowercase()) {
                    skipped += 1;
                    continue;
                }
                defs.push(def);
            }
            tag_definitions_added += 1;
        }
        if tag_definitions_added > 0 {
            self.save_tag_definitions()?;
        }

        // Import scripts
        let existing_scripts = self.get_all_global_scripts();
        for script in import.scripts {
            if existing_scripts.iter().any(|s| s.id == script.id) {
                skipped += 1;
                continue;
            }
            {
                let mut scripts = self.global_scripts.write();
                scripts.push(script);
            }
            scripts_added += 1;
        }
        if scripts_added > 0 {
            self.save_global_scripts()?;
        }

        // Import groups
        let existing_groups = self.get_all_script_groups();
        for group in import.groups {
            if existing_groups.iter().any(|g| g.id == group.id) {
                skipped += 1;
                continue;
            }
            {
                let mut groups = self.script_groups.write();
                groups.push(group);
            }
            groups_added += 1;
        }
        if groups_added > 0 {
            self.save_script_groups()?;
        }

        // Import tools
        let existing_tools = self.get_all_tools();
        for tool in import.tools {
            if existing_tools.iter().any(|t| t.id == tool.id) {
                skipped += 1;
                continue;
            }
            {
                let mut tools = self.tools.write();
                tools.push(tool);
            }
            tools_added += 1;
        }
        if tools_added > 0 {
            self.save_tools()?;
        }

        Ok(ImportResult {
            scripts_added,
            groups_added,
            skipped,
            tools_added,
            tag_definitions_added,
        })
    }
}
