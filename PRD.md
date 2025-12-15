# Product Requirements Document (PRD)
# Local App Launcher

**Version:** 1.0
**Last Updated:** December 2024
**Status:** Draft

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

---

## 2. Goals & Objectives

### 2.1 Primary Goals

| Goal | Description | Success Metric |
|------|-------------|----------------|
| **Centralized Project Management** | Single place to view and manage all dev projects | User can see all projects on one screen |
| **Quick Launch** | Start any project service in under 3 clicks | Time from app open to service running < 10s |
| **Flexibility** | Support various launch methods to fit user workflows | 3 launch methods available |
| **Visibility** | Real-time insight into running processes | Live logs displayed in-app |

### 2.2 Secondary Goals

- Minimal configuration overhead for adding new projects
- Cross-platform support (Windows, macOS, Linux)
- Low resource footprint when idle
- Intuitive, modern UI that developers enjoy using

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
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    DASHBOARD VIEW                        │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │   │
│  │  │ Project │  │ Project │  │ Project │  │   Add   │    │   │
│  │  │    A    │  │    B    │  │    C    │  │   New   │    │   │
│  │  │ ● ● ○   │  │ ○ ○     │  │ ●       │  │    +    │    │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  INTEGRATED TERMINALS                    │   │
│  │  ┌─────────────────────┐  ┌─────────────────────┐       │   │
│  │  │ Project A - Frontend│  │ Project A - Backend │       │   │
│  │  │ > npm run dev       │  │ > cargo run         │       │   │
│  │  │ Server running...   │  │ Listening on 8080   │       │   │
│  │  └─────────────────────┘  └─────────────────────┘       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Core Features

#### F1: Project Dashboard

**Description:** Main view displaying all registered projects as cards/tiles.

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| F1.1 | Display all projects in a grid/list layout | Must Have |
| F1.2 | Show project name, description, and image (if set) | Must Have |
| F1.3 | Visual indicator for running services (status dots) | Must Have |
| F1.4 | Quick actions: Start All, Stop All, Open Folder | Must Have |
| F1.5 | Search/filter projects by name | Should Have |
| F1.6 | Sort projects (alphabetical, recently used, custom order) | Should Have |
| F1.7 | Project grouping/categories | Could Have |

---

#### F2: Project Management

**Description:** Add, edit, and delete projects from the dashboard.

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| F2.1 | Add new project via form or folder picker | Must Have |
| F2.2 | Edit existing project configuration | Must Have |
| F2.3 | Delete project (with confirmation) | Must Have |
| F2.4 | Set project root path (required) | Must Have |
| F2.5 | Set project name (required) | Must Have |
| F2.6 | Set project description (optional) | Should Have |
| F2.7 | Set project image/icon (optional) | Should Have |
| F2.8 | Auto-detect project type and suggest services | Could Have |
| F2.9 | Import/export project configurations | Could Have |

---

#### F3: Service Configuration

**Description:** Define the services/scripts that make up a project (frontend, backend, database, etc.).

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| F3.1 | Add multiple services per project | Must Have |
| F3.2 | Configure service name | Must Have |
| F3.3 | Configure service working directory (relative to project root) | Must Have |
| F3.4 | Configure startup command | Must Have |
| F3.5 | Configure service color (for terminal identification) | Should Have |
| F3.6 | Set service port (for status checking) | Should Have |
| F3.7 | Set environment variables per service | Should Have |
| F3.8 | Set pre-start commands (e.g., npm install) | Could Have |
| F3.9 | Service templates (common setups like Vite, Next.js, etc.) | Could Have |
| F3.10 | Service dependencies (start A before B) | Could Have |

---

#### F4: Launch Options

**Description:** Multiple ways to start project services based on user preference.

##### F4.1: Copy to Clipboard

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| F4.1.1 | Copy `cd <path> && <command>` to clipboard | Must Have |
| F4.1.2 | Visual feedback on copy (toast notification) | Must Have |
| F4.1.3 | Option to copy just path or just command | Should Have |

##### F4.2: External Terminal

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| F4.2.1 | Open configured terminal application | Must Have |
| F4.2.2 | Navigate to service directory in terminal | Must Have |
| F4.2.3 | Execute startup command automatically | Must Have |
| F4.2.4 | Support multiple terminal applications | Must Have |
| F4.2.5 | Keep terminal window open after process ends | Should Have |

##### F4.3: Integrated Terminal

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| F4.3.1 | Run service in embedded terminal within app | Must Have |
| F4.3.2 | Display real-time stdout/stderr output | Must Have |
| F4.3.3 | Support ANSI colors in output | Must Have |
| F4.3.4 | Stop/restart service from UI | Must Have |
| F4.3.5 | Clear terminal output | Must Have |
| F4.3.6 | Multiple terminal tabs/panels | Must Have |
| F4.3.7 | Hide terminal without stopping service (X button) | Must Have |
| F4.3.8 | Show hidden terminals dropdown | Must Have |
| F4.3.9 | Running services section in sidebar | Must Have |
| F4.3.10 | Auto-scroll with pause on user scroll | Must Have |
| F4.3.11 | Scroll-to-bottom button when scrolled up | Must Have |
| F4.3.12 | Clickable URLs in terminal output | Must Have |
| F4.3.13 | Close all terminals button (hides all, keeps running) | Must Have |
| F4.3.14 | Search within terminal output | Should Have |
| F4.3.15 | Copy output to clipboard | Should Have |
| F4.3.16 | Terminal input (send commands to running process) | Could Have |

---

#### F5: Application Settings

**Description:** Global application configuration.

**Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| F5.1 | Configure external terminal executable path | Must Have |
| F5.2 | Configure terminal arguments/flags | Must Have |
| F5.3 | Theme selection (light/dark/system) | Should Have |
| F5.4 | Default launch method preference | Should Have |
| F5.5 | Startup behavior (minimize to tray, start with OS) | Could Have |
| F5.6 | Keyboard shortcuts customization | Could Have |
| F5.7 | Data storage location configuration | Could Have |

---

### 4.3 Feature Priority Matrix

```
                    IMPACT
              Low         High
         ┌─────────┬─────────┐
    Low  │ Groups  │ Search  │
         │ Import  │ Sort    │
EFFORT   ├─────────┼─────────┤
         │ Auto-   │ Dashboard│
   High  │ detect  │ Services │
         │ Deps    │ Terminals│
         └─────────┴─────────┘
```

**Implementation Order (Recommended):**
1. Dashboard (F1.1-F1.4)
2. Project Management (F2.1-F2.5)
3. Service Configuration (F3.1-F3.4)
4. Integrated Terminal (F4.3.1-F4.3.6)
5. Copy to Clipboard (F4.1)
6. External Terminal (F4.2)
7. Settings (F5.1-F5.4)
8. Enhanced features (remaining)

---

## 5. User Stories

### 5.1 Project Management Stories

```
US-001: Add a New Project
AS A developer
I WANT TO add a new project to my dashboard
SO THAT I can manage and launch it from the app

Acceptance Criteria:
- Can browse to select project folder
- Can set project name and optional description
- Can optionally add a project image
- Project appears on dashboard after saving
```

```
US-002: Configure Project Services
AS A developer
I WANT TO configure multiple services for my project
SO THAT I can start frontend, backend, etc. separately or together

Acceptance Criteria:
- Can add 1 or more services to a project
- Each service has name, path, and command
- Services are displayed on project detail view
- Can edit or remove services
```

### 5.2 Launch Stories

```
US-003: Copy Launch Command
AS A developer
I WANT TO copy the launch command to my clipboard
SO THAT I can paste and run it in my preferred terminal

Acceptance Criteria:
- One-click copy button per service
- Command includes cd to directory AND startup command
- Toast notification confirms copy
```

```
US-004: Launch in External Terminal
AS A developer
I WANT TO launch a service in my preferred external terminal
SO THAT I can use my customized terminal environment

Acceptance Criteria:
- Click button opens configured terminal
- Terminal navigates to correct directory
- Command starts executing automatically
- Works with PowerShell, Windows Terminal, Warp, etc.
```

```
US-005: Launch in Integrated Terminal
AS A developer
I WANT TO launch a service in the app's integrated terminal
SO THAT I can see logs without switching windows

Acceptance Criteria:
- Service runs within app
- Output streams in real-time
- Can stop service with a button
- Terminal supports colors
```

### 5.3 Settings Stories

```
US-006: Configure External Terminal
AS A developer
I WANT TO set which terminal application to use
SO THAT services open in my preferred terminal

Acceptance Criteria:
- Can set terminal executable path
- Can set additional terminal arguments
- Settings persist between sessions
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
│ theme           │       │ rootPath        │
│ defaultLaunch   │       │ description?    │
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
    executablePath: string;      // e.g., "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
    arguments: string[];         // e.g., ["-NoExit", "-Command"]
  };
  appearance: {
    theme: 'light' | 'dark' | 'system';
  };
  defaults: {
    launchMethod: 'clipboard' | 'external' | 'integrated';
  };
}

// Project
interface Project {
  id: string;                    // UUID
  name: string;                  // Display name
  rootPath: string;              // Absolute path to project root
  description?: string;          // Optional description
  imagePath?: string;            // Optional path to project image
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  lastOpenedAt?: string;         // ISO timestamp
  services: Service[];           // Array of services
}

// Service
interface Service {
  id: string;                    // UUID
  name: string;                  // e.g., "Frontend", "Backend", "Database"
  workingDir: string;            // Relative path from project root
  command: string;               // e.g., "npm run dev"
  color?: string;                // Hex color for terminal identification
  port?: number;                 // Port to check for status
  envVars?: Record<string, string>; // Environment variables
  order: number;                 // Display order
}

// Runtime State (not persisted)
interface ServiceStatus {
  serviceId: string;
  status: 'stopped' | 'starting' | 'running' | 'error';
  pid?: number;                  // Process ID if running
  logs: LogEntry[];              // Log buffer
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
└── images/                # Cached project images
    ├── project-uuid-1.png
    └── project-uuid-2.png
```

---

## 7. UI/UX Design

### 7.1 Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ ┌─────┐  Local App Launcher                    [─] [□] [×]         │
│ │ ≡ │  ──────────────────────────────────────────────────────────│
├─────┴───────────────────────────────────────────────────────────────┤
│                                                                     │
│  SIDEBAR          │  MAIN CONTENT                                   │
│  ┌─────────────┐  │  ┌───────────────────────────────────────────┐ │
│  │ Dashboard   │◀─┼─▶│                                           │ │
│  │ Projects    │  │  │         (Dynamic content area)            │ │
│  │ Settings    │  │  │                                           │ │
│  │             │  │  │                                           │ │
│  │             │  │  │                                           │ │
│  └─────────────┘  │  └───────────────────────────────────────────┘ │
│                   │                                                 │
│                   │  ┌───────────────────────────────────────────┐ │
│                   │  │  TERMINAL PANEL (collapsible)             │ │
│                   │  │  [Tab1] [Tab2] [Tab3]                     │ │
│                   │  │  $ npm run dev                            │ │
│                   │  │  > Server running on port 3000            │ │
│                   │  └───────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 Key Views

#### Dashboard View
```
┌─────────────────────────────────────────────────────────────────┐
│  My Projects                              [+ Add Project]       │
│  ─────────────────────────────────────────────────────────────  │
│  🔍 Search projects...                     Sort: Recent ▼       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   ┌─────┐    │  │   ┌─────┐    │  │   ┌─────┐    │          │
│  │   │ IMG │    │  │   │ IMG │    │  │   │ IMG │    │          │
│  │   └─────┘    │  │   └─────┘    │  │   └─────┘    │          │
│  │              │  │              │  │              │          │
│  │  E-Commerce  │  │  Portfolio   │  │  API Server  │          │
│  │  Full-stack  │  │  React site  │  │  Rust API    │          │
│  │              │  │              │  │              │          │
│  │  ● Frontend  │  │  ● App      │  │  ● Server    │          │
│  │  ● Backend   │  │              │  │              │          │
│  │  ○ Database  │  │              │  │              │          │
│  │              │  │              │  │              │          │
│  │ [▶ Start All]│  │ [▶ Start]   │  │ [▶ Start]   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Legend: ● Running  ○ Stopped  ◐ Starting
```

#### Project Detail View
```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back    E-Commerce App                    [Edit] [Delete]    │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  📁 C:\Projects\ecommerce-app                                   │
│  📝 Full-stack e-commerce application with React and Node.js    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  SERVICES                                        [+ Add]   ││
│  │  ─────────────────────────────────────────────────────────  ││
│  │                                                             ││
│  │  ┌─────────────────────────────────────────────────────┐   ││
│  │  │ 🟢 Frontend                                         │   ││
│  │  │    Path: ./frontend                                 │   ││
│  │  │    Command: npm run dev                             │   ││
│  │  │    Port: 3000                                       │   ││
│  │  │                                                     │   ││
│  │  │    [📋 Copy] [🖥️ External] [▶ Start] [⏹ Stop]      │   ││
│  │  └─────────────────────────────────────────────────────┘   ││
│  │                                                             ││
│  │  ┌─────────────────────────────────────────────────────┐   ││
│  │  │ 🟢 Backend                                          │   ││
│  │  │    Path: ./backend                                  │   ││
│  │  │    Command: npm run start:dev                       │   ││
│  │  │    Port: 8080                                       │   ││
│  │  │                                                     │   ││
│  │  │    [📋 Copy] [🖥️ External] [▶ Start] [⏹ Stop]      │   ││
│  │  └─────────────────────────────────────────────────────┘   ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Add/Edit Project Modal
```
┌─────────────────────────────────────────────────────────────────┐
│  Add New Project                                           [×]  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Project Name *                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ My Awesome Project                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Project Path *                                                 │
│  ┌────────────────────────────────────────────────┐ [Browse]   │
│  │ C:\Projects\my-awesome-project                  │            │
│  └────────────────────────────────────────────────┘            │
│                                                                 │
│  Description                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ A short description of the project...                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Project Image                                                  │
│  ┌─────────────────────┐                                       │
│  │   [Drop image or    │                                       │
│  │    click to browse] │                                       │
│  └─────────────────────┘                                       │
│                                                                 │
│                                    [Cancel]  [Save Project]     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Settings View
```
┌─────────────────────────────────────────────────────────────────┐
│  Settings                                                       │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  TERMINAL CONFIGURATION                                         │
│  ─────────────────────                                          │
│                                                                 │
│  Terminal Executable                                            │
│  ┌────────────────────────────────────────────────┐ [Browse]   │
│  │ C:\Program Files\PowerShell\7\pwsh.exe         │            │
│  └────────────────────────────────────────────────┘            │
│                                                                 │
│  Terminal Arguments                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ -NoExit -Command                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ℹ️ Arguments passed to terminal before the command             │
│                                                                 │
│  APPEARANCE                                                     │
│  ──────────                                                     │
│                                                                 │
│  Theme                                                          │
│  ( ) Light  (●) Dark  ( ) System                               │
│                                                                 │
│  DEFAULTS                                                       │
│  ────────                                                       │
│                                                                 │
│  Default Launch Method                                          │
│  [▼ Integrated Terminal                              ]          │
│                                                                 │
│                                              [Save Settings]    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Component Library

Using **shadcn/ui** components with **Radix Vega** style:

| Component | Usage |
|-----------|-------|
| `Card` | Project cards on dashboard |
| `Button` | Actions (Start, Stop, Add, etc.) |
| `Input` | Form fields |
| `Label` | Form labels |
| `Dialog` | Modals (Add/Edit Project, Confirm Delete) |
| `Tabs` | Terminal tabs, settings sections |
| `Select` | Dropdowns (sort, launch method) |
| `Badge` | Status indicators |
| `Toast` | Notifications (copy success, errors) |
| `Tooltip` | Hover hints |
| `ScrollArea` | Scrollable content areas |
| `Separator` | Visual dividers |
| `Sidebar` | Navigation sidebar |
| `Collapsible` | Terminal panel |

### 7.4 Design Tokens

```css
/* Colors - using oklch */
--color-running: oklch(0.7 0.15 145);    /* Green */
--color-stopped: oklch(0.6 0.02 250);    /* Gray */
--color-starting: oklch(0.75 0.15 85);   /* Yellow */
--color-error: oklch(0.6 0.2 25);        /* Red */

/* Terminal colors (service identification) */
--terminal-blue: oklch(0.7 0.15 250);
--terminal-green: oklch(0.7 0.15 145);
--terminal-orange: oklch(0.75 0.15 50);
--terminal-purple: oklch(0.65 0.15 300);
--terminal-cyan: oklch(0.75 0.12 200);
```

---

## 8. Technical Architecture

### 8.1 Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Framework** | Tauri v2 | Desktop app shell, native APIs |
| **Frontend** | React 19 | UI components and state |
| **Language** | TypeScript | Type-safe frontend code |
| **Build Tool** | Vite (rolldown) | Fast bundling and HMR |
| **Backend** | Rust | Native performance, process management |
| **UI Library** | shadcn/ui + Radix | Accessible components |
| **Styling** | Tailwind CSS v4 | Utility-first CSS |
| **State** | React Context / Zustand | Global state management |

### 8.2 System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         TAURI APPLICATION                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      FRONTEND (React)                      │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │   Views     │  │   State     │  │   Components    │   │  │
│  │  │ - Dashboard │  │ - Projects  │  │ - ProjectCard   │   │  │
│  │  │ - Project   │  │ - Settings  │  │ - ServiceItem   │   │  │
│  │  │ - Settings  │  │ - Services  │  │ - Terminal      │   │  │
│  │  │ - Terminal  │  │ - Logs      │  │ - Forms         │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │  │
│  │                           │                                │  │
│  │                           ▼                                │  │
│  │                    Tauri IPC (invoke)                      │  │
│  └───────────────────────────┬───────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                      BACKEND (Rust)                        │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │  Commands   │  │  Services   │  │   Managers      │   │  │
│  │  │ - Projects  │  │ - Storage   │  │ - Process Mgr   │   │  │
│  │  │ - Settings  │  │ - Config    │  │ - Terminal Mgr  │   │  │
│  │  │ - Launch    │  │             │  │                 │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   File System       │
                    │ - settings.json     │
                    │ - projects.json     │
                    │ - images/           │
                    └─────────────────────┘
```

### 8.3 Rust Backend Commands

```rust
// Project Commands
#[tauri::command]
fn get_all_projects() -> Result<Vec<Project>, String>;

#[tauri::command]
fn get_project(id: String) -> Result<Project, String>;

#[tauri::command]
fn create_project(project: CreateProjectInput) -> Result<Project, String>;

#[tauri::command]
fn update_project(id: String, project: UpdateProjectInput) -> Result<Project, String>;

#[tauri::command]
fn delete_project(id: String) -> Result<(), String>;

// Service Commands
#[tauri::command]
fn add_service(project_id: String, service: CreateServiceInput) -> Result<Service, String>;

#[tauri::command]
fn update_service(service_id: String, service: UpdateServiceInput) -> Result<Service, String>;

#[tauri::command]
fn delete_service(service_id: String) -> Result<(), String>;

// Launch Commands
#[tauri::command]
fn copy_launch_command(service_id: String) -> Result<String, String>;

#[tauri::command]
fn launch_external_terminal(service_id: String) -> Result<(), String>;

#[tauri::command]
fn start_integrated_service(service_id: String) -> Result<u32, String>; // Returns PID

#[tauri::command]
fn stop_integrated_service(service_id: String) -> Result<(), String>;

// Settings Commands
#[tauri::command]
fn get_settings() -> Result<AppSettings, String>;

#[tauri::command]
fn update_settings(settings: AppSettings) -> Result<(), String>;

// File Dialog Commands
#[tauri::command]
fn pick_directory() -> Result<Option<String>, String>;

#[tauri::command]
fn pick_image() -> Result<Option<String>, String>;
```

### 8.4 Event System (Backend → Frontend)

```rust
// Events emitted from Rust to React
enum AppEvent {
    // Service log output
    ServiceLog {
        service_id: String,
        stream: LogStream,  // stdout | stderr
        content: String,
    },

    // Service status changes
    ServiceStatusChanged {
        service_id: String,
        status: ServiceStatus,  // stopped | starting | running | error
    },

    // Process exit
    ServiceExited {
        service_id: String,
        exit_code: Option<i32>,
    },
}
```

### 8.5 Frontend State Architecture

```typescript
// Using Zustand for state management
interface AppStore {
  // Projects
  projects: Project[];
  selectedProjectId: string | null;
  loadProjects: () => Promise<void>;
  addProject: (input: CreateProjectInput) => Promise<void>;
  updateProject: (id: string, input: UpdateProjectInput) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  // Services
  addService: (projectId: string, input: CreateServiceInput) => Promise<void>;
  updateService: (serviceId: string, input: UpdateServiceInput) => Promise<void>;
  deleteService: (serviceId: string) => Promise<void>;

  // Service Status (runtime state)
  serviceStatuses: Map<string, ServiceStatus>;
  serviceLogs: Map<string, LogEntry[]>;
  startService: (serviceId: string) => Promise<void>;
  stopService: (serviceId: string) => Promise<void>;

  // Settings
  settings: AppSettings;
  loadSettings: () => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;

  // UI State
  terminalPanelOpen: boolean;
  activeTerminalTab: string | null;
  toggleTerminalPanel: () => void;
  setActiveTerminalTab: (serviceId: string) => void;
}
```

### 8.6 File Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── ui/                    # shadcn components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   └── ...
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── TerminalPanel.tsx
│   │   ├── projects/
│   │   │   ├── ProjectCard.tsx
│   │   │   ├── ProjectGrid.tsx
│   │   │   ├── ProjectDetail.tsx
│   │   │   ├── ProjectForm.tsx
│   │   │   └── ServiceItem.tsx
│   │   ├── terminal/
│   │   │   ├── TerminalTabs.tsx
│   │   │   ├── TerminalOutput.tsx
│   │   │   └── TerminalControls.tsx
│   │   └── settings/
│   │       ├── TerminalSettings.tsx
│   │       ├── AppearanceSettings.tsx
│   │       └── DefaultsSettings.tsx
│   ├── hooks/
│   │   ├── useProjects.ts
│   │   ├── useServices.ts
│   │   ├── useTerminal.ts
│   │   └── useSettings.ts
│   ├── lib/
│   │   ├── utils.ts               # cn() helper
│   │   ├── tauri.ts               # Tauri invoke wrappers
│   │   └── constants.ts
│   ├── stores/
│   │   └── appStore.ts            # Zustand store
│   ├── types/
│   │   ├── project.ts
│   │   ├── service.ts
│   │   └── settings.ts
│   ├── views/
│   │   ├── Dashboard.tsx
│   │   ├── ProjectView.tsx
│   │   └── SettingsView.tsx
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── projects.rs
│   │   │   ├── services.rs
│   │   │   ├── launch.rs
│   │   │   └── settings.rs
│   │   ├── models/
│   │   │   ├── mod.rs
│   │   │   ├── project.rs
│   │   │   ├── service.rs
│   │   │   └── settings.rs
│   │   ├── services/
│   │   │   ├── mod.rs
│   │   │   ├── storage.rs
│   │   │   └── process_manager.rs
│   │   └── utils/
│   │       └── mod.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

---

## 9. Non-Functional Requirements

### 9.1 Performance

| Metric | Target |
|--------|--------|
| App startup time | < 2 seconds |
| Project list render | < 100ms for 50 projects |
| Terminal log latency | < 50ms from process output to display |
| Memory usage (idle) | < 100MB |
| Memory usage (10 terminals) | < 300MB |

### 9.2 Reliability

- Process crashes should not crash the main app
- Data should persist across app restarts
- Graceful handling of invalid project paths
- Recovery from corrupted configuration files

### 9.3 Security

- No remote code execution
- Project paths validated to prevent directory traversal
- Sensitive data (if any) stored securely using OS keychain
- CSP configured appropriately for production

### 9.4 Usability

- Keyboard navigation support
- Screen reader compatibility (ARIA labels)
- Responsive to window resizing
- Clear error messages and recovery options

### 9.5 Platform Support

| Platform | Version | Priority |
|----------|---------|----------|
| Windows | 10, 11 | Must Have |
| macOS | 12+ (Monterey) | Should Have |
| Linux | Ubuntu 22.04+ | Could Have |

---

## 10. Future Considerations

### 10.1 Potential Enhancements (Post-MVP)

| Feature | Description | Complexity |
|---------|-------------|------------|
| **Project Templates** | Pre-configured setups for common stacks (Next.js, Laravel, etc.) | Medium |
| **Git Integration** | Show branch, status, quick commit/pull | Medium |
| **Docker Support** | Launch Docker containers as services | High |
| **Remote Projects** | SSH into remote servers to manage projects | High |
| **Collaboration** | Share project configurations with team | High |
| **Plugins** | Extensibility system for custom functionality | Very High |
| **Process Monitoring** | CPU/Memory usage per service | Medium |
| **Service Health Checks** | HTTP/TCP health checking for ports | Medium |
| **Quick Notes** | Per-project notes/documentation | Low |
| **Scheduled Tasks** | Run commands on schedule (cron-like) | Medium |

### 10.2 Known Limitations

- Terminal emulation is basic (no full PTY support)
- No Windows credential management integration
- Limited to local filesystem (no network drives tested)
- Single user (no multi-user support)

### 10.3 Technical Debt to Address

- Evaluate Tauri v3 when stable
- Consider migrating to React Server Components if beneficial
- Explore better terminal emulation libraries (xterm.js)

---

## Appendix A: Terminal Configuration Examples

### Windows PowerShell 7
```json
{
  "executablePath": "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  "arguments": ["-NoExit", "-Command"]
}
```

### Windows Terminal
```json
{
  "executablePath": "wt.exe",
  "arguments": ["-d", "{directory}", "cmd", "/k"]
}
```

### Warp (macOS)
```json
{
  "executablePath": "/Applications/Warp.app/Contents/MacOS/stable/warp",
  "arguments": ["--working-directory", "{directory}"]
}
```

### iTerm2 (macOS)
```json
{
  "executablePath": "/Applications/iTerm.app/Contents/MacOS/iTerm2",
  "arguments": []
}
```

### GNOME Terminal (Linux)
```json
{
  "executablePath": "gnome-terminal",
  "arguments": ["--working-directory={directory}", "--"]
}
```

---

## Appendix B: Keyboard Shortcuts (Proposed)

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | Add new project |
| `Ctrl+,` | Open settings |
| `Ctrl+F` | Focus search |
| `Ctrl+1-9` | Switch to terminal tab 1-9 |
| `Ctrl+T` | Toggle terminal panel |
| `Ctrl+W` | Close current terminal tab |
| `Ctrl+Enter` | Start selected service |
| `Ctrl+Shift+Enter` | Start all services |
| `Escape` | Close modal / deselect |

---

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| **Project** | A development application/codebase registered in the launcher |
| **Service** | A runnable component of a project (frontend, backend, etc.) |
| **Integrated Terminal** | Terminal embedded within the app UI |
| **External Terminal** | User's preferred standalone terminal application |
| **Launch** | Starting a service's command |

---

*End of Document*
