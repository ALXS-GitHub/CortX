//! Structured CLI errors for `--json` mode (#20).
//!
//! Handlers that want to produce a machine-readable error build a
//! [`CortxError`] with a stable code, then propagate via `anyhow::Error`
//! the same way they do for any other failure. `main()` downcasts to
//! `CortxError` at the top level — if found, formats according to the
//! `--json` flag; otherwise wraps the message in a generic `INTERNAL`
//! envelope so agents always get the same shape.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    NotFound,
    AlreadyExists,
    InvalidArgument,
    StorageError,
    AlreadyRunning,
    NotRunning,
    PermissionDenied,
    Internal,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CortxError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identifier: Option<String>,
}

impl CortxError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            resource: None,
            identifier: None,
        }
    }

    pub fn with_resource(mut self, resource: impl Into<String>) -> Self {
        self.resource = Some(resource.into());
        self
    }

    pub fn with_identifier(mut self, identifier: impl Into<String>) -> Self {
        self.identifier = Some(identifier.into());
        self
    }

    pub fn not_found(resource: &str, identifier: &str) -> Self {
        Self::new(
            ErrorCode::NotFound,
            format!("{} '{}' not found", resource_label(resource), identifier),
        )
        .with_resource(resource)
        .with_identifier(identifier)
    }

    pub fn already_exists(resource: &str, identifier: &str) -> Self {
        Self::new(
            ErrorCode::AlreadyExists,
            format!(
                "{} '{}' already exists",
                resource_label(resource),
                identifier
            ),
        )
        .with_resource(resource)
        .with_identifier(identifier)
    }

    pub fn already_running(resource: &str, identifier: &str, pid: u32) -> Self {
        Self::new(
            ErrorCode::AlreadyRunning,
            format!(
                "{} '{}' is already running (PID {})",
                resource_label(resource),
                identifier,
                pid
            ),
        )
        .with_resource(resource)
        .with_identifier(identifier)
    }

    pub fn not_running(resource: &str, identifier: &str) -> Self {
        Self::new(
            ErrorCode::NotRunning,
            format!(
                "{} '{}' is not running",
                resource_label(resource),
                identifier
            ),
        )
        .with_resource(resource)
        .with_identifier(identifier)
    }

    pub fn invalid_argument(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidArgument, message)
    }

    pub fn storage(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::StorageError, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }
}

impl std::fmt::Display for CortxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for CortxError {}

/// Translate `cortx-core` storage errors to the stable CLI codes. Storage
/// has explicit *NotFound variants we can map to NOT_FOUND with the right
/// resource label; everything else collapses to STORAGE_ERROR.
impl From<cortx_core::storage::StorageError> for CortxError {
    fn from(e: cortx_core::storage::StorageError) -> Self {
        use cortx_core::storage::StorageError as S;
        match e {
            S::ProjectNotFound(id) => Self::not_found("project", &id),
            S::ServiceNotFound(id) => Self::not_found("service", &id),
            S::ScriptNotFound(id) => Self::not_found("project_script", &id),
            S::GlobalScriptNotFound(id) => Self::not_found("global_script", &id),
            S::ToolNotFound(id) => Self::not_found("tool", &id),
            S::AliasNotFound(id) => Self::not_found("alias", &id),
            S::StatusDefinitionNotFound(id) => Self::not_found("status", &id),
            S::AppNotFound(id) => Self::not_found("app", &id),
            S::FolderNotFound(id) => Self::not_found("folder", &id),
            S::NoAppDir => Self::storage("Failed to locate application data directory"),
            S::Io(io) if io.kind() == std::io::ErrorKind::AlreadyExists => Self::new(
                ErrorCode::AlreadyExists,
                format!("{}", io),
            ),
            S::Io(io) if io.kind() == std::io::ErrorKind::PermissionDenied => Self::new(
                ErrorCode::PermissionDenied,
                format!("{}", io),
            ),
            other => Self::storage(format!("{}", other)),
        }
    }
}

/// Pretty label used in human messages. The serde-emitted `resource`
/// field stays as the original machine-readable snake_case slug.
fn resource_label(resource: &str) -> &str {
    match resource {
        "global_script" => "Script",
        "project_script" => "Project script",
        "project" => "Project",
        "service" => "Service",
        "tool" => "Tool",
        "alias" => "Alias",
        "app" => "App",
        "tag" => "Tag",
        "status" => "Status",
        "folder" => "Folder",
        other => other,
    }
}

/// Print an error and return the exit code to use. JSON envelope on
/// stderr when `--json` is in effect; otherwise the plain `Error: ...`
/// line we've always emitted. Either way, stdout is untouched.
pub fn report_error(err: &anyhow::Error, json: bool) -> i32 {
    let cortx_err = err
        .downcast_ref::<CortxError>()
        .cloned()
        .unwrap_or_else(|| CortxError::internal(format!("{}", err)));

    if json {
        let payload = serde_json::json!({ "error": cortx_err });
        // Falls back to a hard-coded JSON object if serialization itself
        // fails — an unusual case but worth handling without panic.
        let rendered = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| {
            r#"{"error":{"code":"INTERNAL","message":"Failed to serialize error"}}"#.to_string()
        });
        eprintln!("{}", rendered);
    } else {
        eprintln!("Error: {}", cortx_err.message);
    }
    1
}
