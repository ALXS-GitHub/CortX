use crate::models::{AppSettings, Project};
use directories::ProjectDirs;
use parking_lot::RwLock;
use std::fs;
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
}

pub struct Storage {
    app_dir: PathBuf,
    projects: RwLock<Vec<Project>>,
    settings: RwLock<AppSettings>,
}

impl Storage {
    pub fn new() -> Result<Self, StorageError> {
        let project_dirs = ProjectDirs::from("com", "cortx", "Cortx")
            .ok_or(StorageError::NoAppDir)?;

        let app_dir = project_dirs.data_dir().to_path_buf();

        // Create directories if they don't exist
        fs::create_dir_all(&app_dir)?;
        fs::create_dir_all(app_dir.join("images"))?;

        let storage = Self {
            app_dir,
            projects: RwLock::new(Vec::new()),
            settings: RwLock::new(AppSettings::default()),
        };

        // Load existing data
        storage.load_projects()?;
        storage.load_settings()?;

        Ok(storage)
    }

    fn projects_path(&self) -> PathBuf {
        self.app_dir.join("projects.json")
    }

    fn settings_path(&self) -> PathBuf {
        self.app_dir.join("settings.json")
    }

    pub fn images_dir(&self) -> PathBuf {
        self.app_dir.join("images")
    }

    // Projects

    fn load_projects(&self) -> Result<(), StorageError> {
        let path = self.projects_path();
        if path.exists() {
            let content = fs::read_to_string(&path)?;
            let projects: Vec<Project> = serde_json::from_str(&content)?;
            *self.projects.write() = projects;
        }
        Ok(())
    }

    fn save_projects(&self) -> Result<(), StorageError> {
        let path = self.projects_path();
        let projects = self.projects.read();
        let content = serde_json::to_string_pretty(&*projects)?;
        fs::write(path, content)?;
        Ok(())
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

    pub fn update_project(&self, id: &str, updater: impl FnOnce(&mut Project)) -> Result<Project, StorageError> {
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

    // Services

    pub fn add_service(&self, project_id: &str, service: crate::models::Service) -> Result<crate::models::Service, StorageError> {
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

    pub fn update_service(&self, service_id: &str, updater: impl FnOnce(&mut crate::models::Service)) -> Result<crate::models::Service, StorageError> {
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

    pub fn get_service(&self, service_id: &str) -> Option<(Project, crate::models::Service)> {
        let projects = self.projects.read();
        for project in projects.iter() {
            if let Some(service) = project.services.iter().find(|s| s.id == service_id) {
                return Some((project.clone(), service.clone()));
            }
        }
        None
    }

    // Settings

    fn load_settings(&self) -> Result<(), StorageError> {
        let path = self.settings_path();
        if path.exists() {
            let content = fs::read_to_string(&path)?;
            let settings: AppSettings = serde_json::from_str(&content)?;
            *self.settings.write() = settings;
        }
        Ok(())
    }

    fn save_settings(&self) -> Result<(), StorageError> {
        let path = self.settings_path();
        let settings = self.settings.read();
        let content = serde_json::to_string_pretty(&*settings)?;
        fs::write(path, content)?;
        Ok(())
    }

    pub fn get_settings(&self) -> AppSettings {
        self.settings.read().clone()
    }

    pub fn update_settings(&self, settings: AppSettings) -> Result<(), StorageError> {
        *self.settings.write() = settings;
        self.save_settings()?;
        Ok(())
    }
}
