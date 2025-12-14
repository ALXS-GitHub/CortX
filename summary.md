● Summary

  1. App Overview

  Local App Launcher is a desktop dashboard for managing local development projects. It allows you to:

  - Register projects with their path, description, and optional image
  - Configure services per project (frontend, backend, database, etc.) with:
    - Working directory
    - Start command (e.g., npm run dev)
    - Optional port and color
  - Launch services in 3 ways:
    - Copy command to clipboard
    - Open in external terminal (configurable)
    - Run in integrated terminal with live logs
  - Monitor running services with real-time stdout/stderr streaming

  ---
  2. Configuration Details

  Tauri Backend (Rust)

  | File                      | Key Points                                                 |
  |---------------------------|------------------------------------------------------------|
  | Cargo.toml                | Plugins: shell, dialog, clipboard-manager, process, log    |
  | tauri.conf.json           | Window: 1200x800, min 900x600. Dev server: localhost:12321 |
  | capabilities/default.json | Permissions for shell spawning, file dialogs, clipboard    |

  Rust modules created:
  - models.rs - Data structures (Project, Service, Settings)
  - storage.rs - JSON persistence in %APPDATA%/local-app-launcher/
  - process_manager.rs - Spawns processes, streams stdout/stderr via Tauri events
  - commands.rs - 20+ Tauri commands exposed to frontend

  Frontend (React)

  | Config     | Value                                                   |
  |------------|---------------------------------------------------------|
  | Dev port   | 12321 (hardcoded in vite.config.ts AND tauri.conf.json) |
  | Bundler    | rolldown-vite (not standard Vite)                       |
  | UI         | shadcn/ui with Radix Vega style                         |
  | State      | Zustand store (src/stores/appStore.ts)                  |
  | Styling    | Tailwind v4 with oklch colors                           |
  | Path alias | @/ → ./src/                                             |

  Important: React Compiler is enabled - no need for manual useMemo/useCallback.

  ---
  3. What Went Wrong & The Fix

  Error:
  Permission clipboard-manager:allow-write not found

  Cause: The Tauri capability file used incorrect permission names. The clipboard-manager plugin changed its permission naming convention.

  Fix: Updated capabilities/default.json:
  - "clipboard-manager:allow-write",
  - "clipboard-manager:allow-read",
  + "clipboard-manager:allow-write-text",
  + "clipboard-manager:allow-read-text",

  Also added shell:allow-kill for stopping processes.