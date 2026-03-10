use std::collections::VecDeque;

/// Maximum number of log lines buffered per process
const MAX_LOG_LINES: usize = 500;

#[derive(Debug, Clone, PartialEq)]
pub enum ProcessStatus {
    Running,
    Completed,
    Failed,
    Stopped,
}

impl std::fmt::Display for ProcessStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProcessStatus::Running => write!(f, "running"),
            ProcessStatus::Completed => write!(f, "completed"),
            ProcessStatus::Failed => write!(f, "failed"),
            ProcessStatus::Stopped => write!(f, "stopped"),
        }
    }
}

#[derive(Debug)]
pub struct ProcessRunState {
    pub status: ProcessStatus,
    pub pid: Option<u32>,
    pub logs: VecDeque<String>,
    pub exit_code: Option<i32>,
    pub success: Option<bool>,
}

impl ProcessRunState {
    pub fn new() -> Self {
        Self {
            status: ProcessStatus::Running,
            pid: None,
            logs: VecDeque::with_capacity(MAX_LOG_LINES),
            exit_code: None,
            success: None,
        }
    }

    pub fn push_log(&mut self, line: String) {
        if self.logs.len() >= MAX_LOG_LINES {
            self.logs.pop_front();
        }
        self.logs.push_back(line);
    }
}
