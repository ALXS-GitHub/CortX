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
}

pub struct Storage {
    app_dir: PathBuf,
    projects: RwLock<Vec<Project>>,
    settings: RwLock<AppSettings>,
    global_scripts: RwLock<Vec<GlobalScript>>,
    folders: RwLock<Vec<VirtualFolder>>,
    script_groups: RwLock<Vec<ScriptGroup>>,
    execution_history: RwLock<Vec<ExecutionRecord>>,
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
            folders: RwLock::new(Vec::new()),
            script_groups: RwLock::new(Vec::new()),
            execution_history: RwLock::new(Vec::new()),
        };

        // Load existing data
        storage.load_projects()?;
        storage.load_settings()?;
        storage.load_global_scripts()?;
        storage.load_folders()?;
        storage.load_script_groups()?;
        storage.load_execution_history()?;

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

    fn folders_path(&self) -> PathBuf {
        self.app_dir.join("folders.json")
    }

    fn script_groups_path(&self) -> PathBuf {
        self.app_dir.join("script_groups.json")
    }

    fn execution_history_path(&self) -> PathBuf {
        self.app_dir.join("execution_history.json")
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
    // Virtual Folders
    // ========================================================================

    fn load_folders(&self) -> Result<(), StorageError> {
        let path = self.folders_path();
        if path.exists() {
            let folders: Vec<VirtualFolder> = read_json_locked(&path)?;
            *self.folders.write() = folders;
        }
        Ok(())
    }

    fn save_folders(&self) -> Result<(), StorageError> {
        let path = self.folders_path();
        let folders = self.folders.read();
        write_json_locked(&path, &*folders)
    }

    pub fn get_all_folders(&self) -> Vec<VirtualFolder> {
        self.folders.read().clone()
    }

    pub fn create_folder(&self, folder: VirtualFolder) -> Result<VirtualFolder, StorageError> {
        {
            let mut folders = self.folders.write();
            folders.push(folder.clone());
        }
        self.save_folders()?;
        Ok(folder)
    }

    pub fn update_folder(
        &self,
        id: &str,
        updater: impl FnOnce(&mut VirtualFolder),
    ) -> Result<VirtualFolder, StorageError> {
        let folder = {
            let mut folders = self.folders.write();
            let folder = folders
                .iter_mut()
                .find(|f| f.id == id)
                .ok_or_else(|| StorageError::FolderNotFound(id.to_string()))?;

            updater(folder);
            folder.clone()
        };
        self.save_folders()?;
        Ok(folder)
    }

    pub fn delete_folder(&self, id: &str) -> Result<(), StorageError> {
        {
            let mut folders = self.folders.write();
            let initial_len = folders.len();
            folders.retain(|f| f.id != id);
            if folders.len() == initial_len {
                return Err(StorageError::FolderNotFound(id.to_string()));
            }
        }
        self.save_folders()?;
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
    // Import / Export
    // ========================================================================

    /// Export all scripts, folders, and groups as a ScriptExport JSON string
    pub fn export_scripts_config(&self) -> Result<String, StorageError> {
        let export = ScriptExport {
            version: "1.0".to_string(),
            scripts: self.get_all_global_scripts(),
            folders: self.get_all_folders(),
            groups: self.get_all_script_groups(),
            exported_at: chrono::Utc::now(),
        };
        serde_json::to_string_pretty(&export).map_err(StorageError::Json)
    }

    /// Import scripts, folders, and groups from a ScriptExport JSON string.
    /// Merges with existing data (skips items with duplicate IDs).
    pub fn import_scripts_config(&self, json: &str) -> Result<ImportResult, StorageError> {
        let import: ScriptExport =
            serde_json::from_str(json).map_err(StorageError::Json)?;

        let mut scripts_added = 0u32;
        let mut folders_added = 0u32;
        let mut groups_added = 0u32;
        let mut skipped = 0u32;

        // Import folders first (scripts may reference them)
        let existing_folders = self.get_all_folders();
        for folder in import.folders {
            if existing_folders.iter().any(|f| f.id == folder.id) {
                skipped += 1;
                continue;
            }
            {
                let mut folders = self.folders.write();
                folders.push(folder);
            }
            folders_added += 1;
        }
        if folders_added > 0 {
            self.save_folders()?;
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

        Ok(ImportResult {
            scripts_added,
            folders_added,
            groups_added,
            skipped,
        })
    }
}
