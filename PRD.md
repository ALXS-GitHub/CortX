# Product Requirements Document (PRD)
# Local App Launcher

**Version:** 1.1
**Last Updated:** December 2024
**Status:** In Development

---

## Table of Contents

1. [Overview](#1-overview)
2. [Goals & Objectives](#2-goals--objectives)
3. [Target Users](#3-target-users)
4. [Features & Requirements](#4-features--requirements)
5. [User Stories](#5-user-stories)
6. [Data Models](#6-data-models)
7. [UI/UX Design](#7-uiux-design)
8. [Technical Architecture](#8-technical-architecture)
9. [Non-Functional Requirements](#9-non-functional-requirements)
10. [Future Considerations](#10-future-considerations)
11. [Changelog](#11-changelog)

---

## 1. Overview

### 1.1 Product Summary

**Local App Launcher** is a desktop application that serves as a personal dashboard for managing and launching local development applications. It provides developers with a centralized interface to organize, configure, and start their various development projects without needing to navigate file systems or remember complex startup commands.

### 1.2 Problem Statement

Developers often work on multiple projects simultaneously, each with different:
- Directory structures
- Startup commands (frontend, backend, databases, etc.)
- Development environments

Switching between projects requires:
- Navigating to the correct directories
- Remembering or looking up startup commands
- Opening multiple terminal windows
- Managing multiple processes

This context-switching overhead reduces productivity and creates friction in the development workflow.

### 1.3 Solution

Local App Launcher provides:
- A visual dashboard of all registered development projects
- Configurable service definitions per project (frontend, backend, etc.)
- Multiple launch options (clipboard copy, external terminal, integrated terminal)
- Real-time log viewing within the application
- Automatic port detection for running services
- Quick IDE integration (VSCode)

---

## 2. Goals & Objectives

### 2.1 Primary Goals

| Goal | Description | Success Metric | Status |
|------|-------------|----------------|--------|
| **Centralized Project Management** | Single place to view and manage all dev projects | User can see all projects on one screen | Done |
| **Quick Launch** | Start any project service in under 3 clicks | Time from app open to service running < 10s | Done |
| **Flexibility** | Support various launch methods to fit user workflows | 3 launch methods available | Done |
| **Visibility** | Real-time insight into running processes | Live logs displayed in-app | Done |

### 2.2 Secondary Goals

| Goal | Status |
|------|--------|
| Minimal configuration overhead for adding new projects | Done |
| Cross-platform support (Windows, macOS, Linux) | In Progress (Windows tested) |
| Low resource footprint when idle | Done |
| Intuitive, modern UI that developers enjoy using | Done |

---

## 3. Target Users

### 3.1 Primary Persona: Full-Stack Developer

**Name:** Alex
**Role:** Full-stack developer working on multiple projects
**Technical Level:** Advanced

**Behaviors:**
- Works on 3-5 active projects simultaneously
- Each project has frontend + backend + sometimes additional services
- Uses various terminals (PowerShell, Windows Terminal, Warp, iTerm2)
- Values keyboard shortcuts and efficiency

**Pain Points:**
- Forgets startup commands for projects not touched in weeks
- Spends time navigating to project directories
- Has too many terminal windows open, hard to identify which is which
- Context switching between projects is slow

**Goals:**
- Start any project with minimal friction
- See all project statuses at a glance
- Keep terminal outputs organized

### 3.2 Secondary Persona: Hobbyist Developer

**Name:** Sam
**Role:** Part-time developer with personal projects
**Technical Level:** Intermediate

**Behaviors:**
- Works on projects sporadically
- May forget project configurations between sessions
- Prefers visual interfaces over command-line

**Pain Points:**
- Forgets how to start projects after breaks
- Doesn't want to maintain complex scripts

---

## 4. Features & Requirements

### 4.1 Feature Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     LOCAL APP LAUNCHER                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────┐                                                  │
│  │  SIDEBAR  │   MAIN CONTENT                                   │
│  │ Dashboard │   ┌─────────────────────────────────────────┐   │
│  │ Settings  │   │ Project Cards / Project Detail View     │   │
│  │           │   │ ┌─────────┐  ┌─────────┐  ┌─────────┐  │   │
│  │ ───────── │   │ │ Project │  │ Project │  │   Add   │  │   │
│  │ Services: │   │ │    A    │  │    B    │  │   New   │  │   │
│  │ ● Proj A  │   │ │ ● ● ○   │  │ ○ ○     │  │    +    │  │   │
│  │   └ API   │   │ └─────────┘  └─────────┘  └─────────┘  │   │
│  │   └ Web   │   └─────────────────────────────────────────┘   │
│  │ ○ Proj B  │                                                  │
│  └───────────┘   ┌─────────────────────────────────────────┐   │
│                  │  TERMINAL PANEL (resizable)              │   │
│                  │  [API :3000] [Web :5173] [─][×]          │   │
│                  │  > Server running on http://localhost:3000│   │
│                  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Core Features

#### F1: Project Dashboard

**Description:** Main view displaying all registered projects as cards/tiles.

**Requirements:**
| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| F1.1 | Display all projects in a grid layout | Must Have | Done |
| F1.2 | Show project name, description | Must Have | Done |
| F1.3 | Visual indicator for running services (status dots) | Must Have | Done |
| F1.4 | Quick actions: Start All, Open Folder, Open in VSCode | Must Have | Done |
| F1.5 | Search/filter projects by name | Should Have | Pending |
| F1.6 | Sort projects (alphabetical, recently used) | Should Have | Pending |
| F1.7 | Project grouping/categories | Could Have | Pending |
| F1.8 | Project image/icon support | Should Have | Pending |

---

#### F2: Project Management

**Description:** Add, edit, and delete projects from the dashboard.

**Requirements:**
| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| F2.1 | Add new project via form with folder picker | Must Have | Done |
| F2.2 | Edit existing project configuration | Must Have | Done |
| F2.3 | Delete project (with confirmation) | Must Have | Done |
| F2.4 | Set project root path (required) | Must Have | Done |
| F2.5 | Set project name (required) | Must Have | Done |
| F2.6 | Set project description (optional) | Should Have | Done |
| F2.7 | Set project image/icon (optional) | Should Have | Pending |
| F2.8 | Auto-detect project type and suggest services | Could Have | Pending |
| F2.9 | Import/export project configurations | Could Have | Pending |

---

#### F3: Service Configuration

**Description:** Define the services/scripts that make up a project (frontend, backend, database, etc.).

**Requirements:**
| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| F3.1 | Add multiple services per project | Must Have | Done |
| F3.2 | Configure service name | Must Have | Done |
| F3.3 | Configure service working directory (relative to project root) | Must Have | Done |
| F3.4 | Configure startup command | Must Have | Done |
| F3.5 | Configure service color (for terminal identification) | Should Have | Pending |
| F3.6 | Set service port (manual configuration) | Should Have | Pending |
| F3.7 | Set environment variables per service | Should Have | Done |
| F3.8 | Set pre-start commands (e.g., npm install) | Could Have | Pending |
| F3.9 | Service templates (common setups like Vite, Next.js, etc.) | Could Have | Pending |
| F3.10 | Service dependencies (start A before B) | Could Have | Pending |
| F3.11 | Reorder services via drag or UI | Should Have | Done |

---

#### F4: Launch Options

**Description:** Multiple ways to start project services based on user preference.

##### F4.1: Copy to Clipboard

**Requirements:**
| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| F4.1.1 | Copy `cd <path> && <command>` to clipboard | Must Have | Done |
| F4.1.2 | Visual feedback on copy (toast notification) | Must Have | Done |
| F4.1.3 | Option to copy just path or just command | Should Have | Pending |

##### F4.2: External Terminal

**Requirements:**
| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| F4.2.1 | Open configured terminal application | Must Have | Done |
| F4.2.2 | Navigate to service directory in terminal | Must Have | Done |
| F4.2.3 | Execute startup command automatically | Must Have | Done |
| F4.2.4 | Support multiple terminal applications | Must Have | Done |
| F4.2.5 | Keep terminal window open after process ends | Should Have | Done |

##### F4.3: Integrated Terminal

**Requirements:**
| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| F4.3.1 | Run service in embedded terminal within app | Must Have | Done |
| F4.3.2 | Display real-time stdout/stderr output | Must Have | Done |
| F4.3.3 | Support ANSI colors in output | Must Have | Done |
| F4.3.4 | Stop/restart service from UI | Must Have | Done |
| F4.3.5 | Clear terminal output | Must Have | Done |
| F4.3.6 | Multiple terminal tabs | Must Have | Done |
| F4.3.7 | Hide terminal without stopping service (minimize) | Must Have | Done |
| F4.3.8 | Show hidden terminals in dropdown | Must Have | Done |
| F4.3.9 | Running services section in sidebar | Must Have | Done |
| F4.3.10 | Auto-scroll with pause on user scroll | Must Have | Done |
| F4.3.11 | Scroll-to-bottom button when scrolled up | Must Have | Done |
| F4.3.12 | Clickable URLs in terminal output (open externally) | Must Have | Done |
| F4.3.13 | Close all terminals button | Must Have | Done |
| F4.3.14 | Resizable terminal panel (drag to resize) | Must Have | Done |
| F4.3.15 | Automatic port detection from output | Must Have | Done |
| F4.3.16 | Port badge display in terminal tabs | Must Have | Done |
| F4.3.17 | Terminal scroll persists on tab switch | Must Have | Done |
| F4.3.18 | Search within terminal output | Should Have | Pending |
| F4.3.19 | Copy output to clipboard | Should Have | Pending |
| F4.3.20 | Terminal input (send commands to running process) | Could Have | Pending |

---

#### F5: Application Settings

**Description:** Global application configuration.

**Requirements:**
| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| F5.1 | Configure external terminal executable path | Must Have | Done |
| F5.2 | Configure terminal arguments/flags | Must Have | Done |
| F5.3 | Theme selection (light/dark/system) | Should Have | Done |
| F5.4 | Terminal presets (PowerShell, Windows Terminal, etc.) | Should Have | Done |
| F5.5 | Default launch method preference | Should Have | Pending |
| F5.6 | Startup behavior (minimize to tray, start with OS) | Could Have | Pending |
| F5.7 | Keyboard shortcuts customization | Could Have | Pending |
| F5.8 | Data storage location configuration | Could Have | Pending |

---

#### F6: Quick Actions

**Description:** Fast access to common operations.

**Requirements:**
| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| F6.1 | Open project folder in file explorer | Must Have | Done |
| F6.2 | Open project in VSCode | Must Have | Done |
| F6.3 | Start all services in project | Must Have | Done |
| F6.4 | Stop all services in project | Must Have | Done |
| F6.5 | Close all terminals for a project | Must Have | Done |

---

### 4.3 Implementation Status Summary

```
Feature Category          Implemented    Pending    Total
─────────────────────────────────────────────────────────
F1: Dashboard                   4            4         8
F2: Project Management          6            3         9
F3: Service Configuration       6            5        11
F4.1: Copy to Clipboard         2            1         3
F4.2: External Terminal         5            0         5
F4.3: Integrated Terminal      17            3        20
F5: Application Settings        4            4         8
F6: Quick Actions               5            0         5
─────────────────────────────────────────────────────────
TOTAL                          49           20        69
Completion:                   71%
```

---

## 5. User Stories

### 5.1 Project Management Stories

```
US-001: Add a New Project [IMPLEMENTED]
AS A developer
I WANT TO add a new project to my dashboard
SO THAT I can manage and launch it from the app

Acceptance Criteria:
✓ Can browse to select project folder
✓ Can set project name and optional description
- Can optionally add a project image [PENDING]
✓ Project appears on dashboard after saving
```

```
US-002: Configure Project Services [IMPLEMENTED]
AS A developer
I WANT TO configure multiple services for my project
SO THAT I can start frontend, backend, etc. separately or together

Acceptance Criteria:
✓ Can add 1 or more services to a project
✓ Each service has name, path, and command
✓ Services are displayed on project detail view
✓ Can edit or remove services
✓ Can set environment variables
```

### 5.2 Launch Stories

```
US-003: Copy Launch Command [IMPLEMENTED]
AS A developer
I WANT TO copy the launch command to my clipboard
SO THAT I can paste and run it in my preferred terminal

Acceptance Criteria:
✓ One-click copy button per service
✓ Command includes cd to directory AND startup command
✓ Toast notification confirms copy
```

```
US-004: Launch in External Terminal [IMPLEMENTED]
AS A developer
I WANT TO launch a service in my preferred external terminal
SO THAT I can use my customized terminal environment

Acceptance Criteria:
✓ Click button opens configured terminal
✓ Terminal navigates to correct directory
✓ Command starts executing automatically
✓ Works with PowerShell, Windows Terminal, etc.
```

```
US-005: Launch in Integrated Terminal [IMPLEMENTED]
AS A developer
I WANT TO launch a service in the app's integrated terminal
SO THAT I can see logs without switching windows

Acceptance Criteria:
✓ Service runs within app
✓ Output streams in real-time
✓ Can stop service with a button
✓ Terminal supports colors
✓ Clickable URLs open in browser
✓ Auto-detects running port
```

### 5.3 Settings Stories

```
US-006: Configure External Terminal [IMPLEMENTED]
AS A developer
I WANT TO set which terminal application to use
SO THAT services open in my preferred terminal

Acceptance Criteria:
✓ Can set terminal executable path
✓ Can set additional terminal arguments
✓ Settings persist between sessions
✓ Can choose from presets
```

### 5.4 New Stories

```
US-007: Open Project in IDE [IMPLEMENTED]
AS A developer
I WANT TO quickly open my project in VSCode
SO THAT I can start coding without navigating manually

Acceptance Criteria:
✓ Button available on project card
✓ Button available on project detail page
✓ Opens VSCode in project root directory
```

```
US-008: Monitor Service Ports [IMPLEMENTED]
AS A developer
I WANT TO see which port my services are running on
SO THAT I can quickly access them in my browser

Acceptance Criteria:
✓ Automatically detects ports from terminal output
✓ Displays port badge in terminal tab
✓ Works with colored terminal output (ANSI codes)
```

---

## 6. Data Models

### 6.1 Entity Relationship Diagram

```
┌─────────────────┐       ┌─────────────────┐
│    Settings     │       │     Project     │
├─────────────────┤       ├─────────────────┤
│ terminalPath    │       │ id              │
│ terminalArgs    │       │ name            │
│ preset          │       │ rootPath        │
│ theme           │       │ description?    │
│ ...             │       │ imagePath?      │
└─────────────────┘       │ createdAt       │
                          │ updatedAt       │
                          │ lastOpenedAt?   │
                          └────────┬────────┘
                                   │ 1:N
                                   ▼
                          ┌─────────────────┐
                          │    Service      │
                          ├─────────────────┤
                          │ id              │
                          │ projectId (FK)  │
                          │ name            │
                          │ workingDir      │
                          │ command         │
                          │ color?          │
                          │ port?           │
                          │ envVars?        │
                          │ order           │
                          └─────────────────┘
```

### 6.2 TypeScript Interfaces

```typescript
// Settings
interface AppSettings {
  terminal: {
    executablePath: string;
    arguments: string[];
    preset: 'powershell' | 'windows-terminal' | 'cmd' | 'warp' | 'iterm2' | 'custom';
  };
  appearance: {
    theme: 'light' | 'dark' | 'system';
  };
}

// Project
interface Project {
  id: string;
  name: string;
  rootPath: string;
  description?: string;
  imagePath?: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  services: Service[];
}

// Service
interface Service {
  id: string;
  name: string;
  workingDir: string;
  command: string;
  color?: string;
  port?: number;
  envVars?: Record<string, string>;
  order: number;
}

// Runtime State (not persisted)
interface ServiceRuntime {
  status: 'stopped' | 'starting' | 'running' | 'error';
  pid?: number;
  logs: LogEntry[];
  detectedPort?: number;  // Auto-detected from output
}

interface LogEntry {
  timestamp: string;
  stream: 'stdout' | 'stderr';
  content: string;
}
```

### 6.3 Storage Strategy

**Location:** User's application data directory
- Windows: `%APPDATA%\local-app-launcher\`
- macOS: `~/Library/Application Support/local-app-launcher/`
- Linux: `~/.config/local-app-launcher/`

**Files:**
```
local-app-launcher/
├── settings.json          # Global app settings
├── projects.json          # All project configurations
└── images/                # Cached project images (future)
    ├── project-uuid-1.png
    └── project-uuid-2.png
```

---

## 7. UI/UX Design

### 7.1 Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Local App Launcher                    [─] [□] [×] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  SIDEBAR (240px)      │  MAIN CONTENT                               │
│  ┌─────────────────┐  │  ┌───────────────────────────────────────┐ │
│  │ Dashboard       │◀─┼─▶│                                       │ │
│  │ Settings        │  │  │       (Dashboard / Project View)      │ │
│  │                 │  │  │                                       │ │
│  │ ─────────────── │  │  │                                       │ │
│  │ Services        │  │  │                                       │ │
│  │ ┌─Project A───┐ │  │  │                                       │ │
│  │ │ ● API       │ │  │  └───────────────────────────────────────┘ │
│  │ │ ● Web       │ │  │                                           │
│  │ └─────────────┘ │  │  ┌───────────────────────────────────────┐ │
│  │ ┌─Project B───┐ │  │  │  TERMINAL PANEL (resizable 100-600px) │ │
│  │ │ ○ Server    │ │  │  │  [API :3000] [Web :5173]    [▼][─][×] │ │
│  │ └─────────────┘ │  │  │  > Server running on localhost:3000   │ │
│  └─────────────────┘  │  └───────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 Key Views (Current Implementation)

#### Dashboard View
- Grid of project cards
- Each card shows: name, description, path, service status badges
- Quick actions: Start All, dropdown menu (Edit, Delete, Open VSCode, Open Folder)

#### Project Detail View
- Back button, project info (name, description, path)
- Action buttons: Open in VSCode, Open Folder, Edit, Delete
- Services list with Start/Stop controls per service
- Start All / Stop All buttons

#### Terminal Panel
- Tabbed interface with service names and port badges
- Resizable via drag handle (100-600px height)
- Minimize/maximize controls
- Hidden terminals dropdown
- Auto-scroll with manual override
- Clickable URLs

#### Settings View
- Terminal configuration (path, arguments, presets)
- Theme selection (light/dark/system)

### 7.3 Component Library

Using **shadcn/ui** components:

| Component | Usage | Status |
|-----------|-------|--------|
| `Card` | Project cards on dashboard | In Use |
| `Button` | Actions (Start, Stop, Add, etc.) | In Use |
| `Input` | Form fields | In Use |
| `Label` | Form labels | In Use |
| `Dialog` | Modals (Add/Edit Project, Service) | In Use |
| `AlertDialog` | Confirmation dialogs | In Use |
| `Tabs` | Terminal tabs | In Use |
| `Select` | Dropdowns | In Use |
| `Badge` | Status indicators | In Use |
| `Toast` (Sonner) | Notifications | In Use |
| `Tooltip` | Hover hints | In Use |
| `ScrollArea` | Scrollable content | In Use |
| `Separator` | Visual dividers | In Use |
| `Sidebar` | Navigation sidebar | In Use |
| `DropdownMenu` | Context menus | In Use |

---

## 8. Technical Architecture

### 8.1 Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| **Framework** | Tauri | v2 |
| **Frontend** | React | 19 |
| **Language** | TypeScript | 5.x |
| **Build Tool** | Vite + Rolldown | Latest |
| **Backend** | Rust | 1.70+ |
| **UI Library** | shadcn/ui + Radix | Latest |
| **Styling** | Tailwind CSS | v4 |
| **State** | Zustand | Latest |
| **Terminal Colors** | ansi-to-html | Latest |

### 8.2 Rust Backend Commands (Implemented)

```rust
// Project Commands
get_all_projects() -> Vec<Project>
get_project(id) -> Project
create_project(input) -> Project
update_project(id, input) -> Project
delete_project(id)
update_project_last_opened(id)

// Service Commands
add_service(project_id, input) -> Service
update_service(service_id, input) -> Service
delete_service(service_id)
reorder_services(project_id, service_ids)

// Launch Commands
get_launch_command(service_id) -> String
launch_external_terminal(service_id)
start_integrated_service(service_id) -> u32 (PID)
stop_integrated_service(service_id)
is_service_running(service_id) -> bool
get_running_services() -> Vec<String>

// Settings Commands
get_settings() -> AppSettings
update_settings(settings)

// Utility Commands
open_in_explorer(path)
open_in_vscode(path)
validate_path(path) -> bool
```

### 8.3 Event System (Backend → Frontend)

```rust
// Events emitted from Rust to React
"service-log" -> ServiceLogPayload {
    service_id: String,
    stream: "stdout" | "stderr",
    content: String,
}

"service-status" -> ServiceStatusPayload {
    service_id: String,
    status: "stopped" | "starting" | "running",
    pid: Option<u32>,
}

"service-exit" -> ServiceExitPayload {
    service_id: String,
    exit_code: Option<i32>,
}
```

### 8.4 Frontend State (Zustand Store)

```typescript
interface AppStore {
  // Projects
  projects: Project[];
  selectedProjectId: string | null;

  // Service Runtime
  serviceRuntimes: Map<string, ServiceRuntime>;

  // Terminal UI
  terminalPanelOpen: boolean;
  terminalHeight: number;  // 100-600px
  activeTerminalId: string | null;
  hiddenTerminalIds: Set<string>;
  closedTerminalIds: Set<string>;

  // Settings
  settings: AppSettings;

  // Actions
  loadProjects(): Promise<void>;
  startService(serviceId: string): Promise<void>;
  stopService(serviceId: string): Promise<void>;
  appendServiceLog(serviceId: string, log: LogEntry): void;
  // ... etc
}
```

### 8.5 File Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── ui/                    # shadcn components
│   │   ├── layout/
│   │   │   ├── AppSidebar.tsx
│   │   │   └── TerminalPanel.tsx
│   │   └── projects/
│   │       ├── ProjectCard.tsx
│   │       ├── ProjectForm.tsx
│   │       ├── ServiceItem.tsx
│   │       └── ServiceForm.tsx
│   ├── lib/
│   │   ├── utils.ts
│   │   └── tauri.ts
│   ├── stores/
│   │   └── appStore.ts
│   ├── types/
│   │   └── index.ts
│   ├── views/
│   │   ├── DashboardView.tsx
│   │   ├── ProjectView.tsx
│   │   └── SettingsView.tsx
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/
│   └── src/
│       ├── lib.rs
│       ├── commands.rs
│       ├── models.rs
│       ├── process_manager.rs
│       └── storage.rs
└── package.json
```

---

## 9. Non-Functional Requirements

### 9.1 Performance

| Metric | Target | Status |
|--------|--------|--------|
| App startup time | < 2 seconds | Met |
| Project list render | < 100ms for 50 projects | Met |
| Terminal log latency | < 50ms from process output to display | Met |
| Memory usage (idle) | < 100MB | Met |
| Memory usage (10 terminals) | < 300MB | TBD |

### 9.2 Reliability

- [x] Process crashes should not crash the main app
- [x] Data should persist across app restarts
- [x] Graceful handling of invalid project paths
- [x] Recovery from corrupted configuration files (serde defaults)

### 9.3 Security

- [x] No remote code execution
- [x] Project paths validated
- [ ] CSP configured appropriately for production

### 9.4 Platform Support

| Platform | Version | Status |
|----------|---------|--------|
| Windows | 10, 11 | Tested |
| macOS | 12+ (Monterey) | Not Tested |
| Linux | Ubuntu 22.04+ | Not Tested |

---

## 10. Future Considerations

### 10.1 Potential Enhancements (Post-MVP)

| Feature | Description | Priority |
|---------|-------------|----------|
| **Project Templates** | Pre-configured setups for common stacks | Medium |
| **Import/Export** | Share project configurations | Medium |
| **Keyboard Shortcuts** | Power user efficiency | Medium |
| **Service Dependencies** | Start order management | Low |
| **Health Checks** | HTTP/TCP health checking | Low |
| **Git Integration** | Show branch, status | Low |
| **Docker Support** | Launch Docker containers | Low |
| **Multiple Themes** | Custom color schemes | Low |

### 10.2 Known Limitations

- Terminal emulation is basic (no full PTY support, no input)
- Single user (no multi-user support)
- Local projects only (no SSH/remote)

---

## 11. Changelog

### Version 1.1 (December 2024) - Current

#### Added
- **Open in VSCode** - Quick action button on project cards and detail view
- **Automatic Port Detection** - Detects running ports from terminal output and displays badges
- **Resizable Terminal Panel** - Drag to resize between 100-600px
- **Dynamic Content Padding** - Main content and sidebar scroll properly with terminal
- **Sidebar Service Management** - Services grouped by project with Start/Stop/Close controls
- **Project-level Controls** - Start All, Stop All, Close All per project in sidebar
- **External Link Handling** - All terminal URLs open in external browser

#### Fixed
- **URL Display** - ANSI codes no longer corrupt clickable URLs
- **Duplicate Terminal Output** - Fixed event listener race condition
- **Terminal Scroll on Tab Switch** - Always scrolls to bottom when switching tabs
- **Terminal Tab Scrollbar** - Removed unwanted vertical scrollbar
- **Port Detection for Colored Output** - ANSI stripping before pattern matching

#### Improved
- Terminal output with comprehensive port detection patterns
- Service visibility states (running, stopped, closed)

### Version 1.0 (December 2024) - Initial Release

- Project dashboard with CRUD operations
- Service management per project
- Integrated terminal with tabs
- External terminal launch
- Copy to clipboard
- Settings with terminal presets
- Light/dark theme support

---

*End of Document*
