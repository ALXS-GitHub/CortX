# CortX CLI — Full Documentation

> **If you're an AI agent: read this first.** This document explains everything CortX is and every CLI command available. After reading, you can directly execute `cortx <command>` to interact with the user's local data.

## What is CortX

CortX is a personal local app launcher and script manager. It has four interfaces backed by the same data:

- **GUI** — Tauri desktop app (React + Rust)
- **TUI** — Terminal interface (ratatui), launched via `cortx` with no arguments
- **CLI** — Subcommands on the same `cortx` binary
- **MCP server** — `cortx-mcp` binary exposed as a Model Context Protocol server for LLM agents

All four read/write the same JSON files in the user's app data dir. Changes made via any interface propagate to the others through a file watcher.

## Data model

CortX manages ten types of entities:

| Domain | What it is |
|---|---|
| **Project** | A folder on disk with a `root_path`. Groups services + scripts scoped to that project. |
| **Service** | Long-running process (server, watcher) attached to a project. Has a command, working dir, modes, env vars, port. |
| **Script** (project-scoped) | One-shot command attached to a project (build, test, deploy). Can be linked to a service. |
| **GlobalScript** | Standalone script, not attached to any project. Has parameters, presets, env vars. The "scripts" domain in the CLI refers to these. |
| **Tool** | Registry entry for an installed CLI utility (git, ripgrep, etc.). Metadata: version, install method, config paths. |
| **App** | GUI application registry (VS Code, Discord, etc.). Has executable path and launch args. |
| **ShellAlias** | Shell shortcut synced into `cortx init <shell>`. Types: `function`, `script`, `init`. |
| **TagDefinition** | Named tag with optional color and sort order. Used across all entities. |
| **StatusDefinition** | Named status (Active, WIP, Deprecated…) with color + order. |
| **Settings** | App-wide config: terminal preset, theme, launch method, toolbox base URL, backup repo path, script scan config. |

### Key concepts

- **Name vs ID**: Most entities can be addressed by name OR UUID in `get`/`update`/`delete` commands. Name lookup is case-insensitive. Use ID when names may conflict.
- **Tags**: Free-form strings. The first tag on an item is the "primary tag" (used for grouping/sorting). `TagDefinition` enriches a tag name with a color and display order.
- **Statuses**: Same pattern as tags. `StatusDefinition` enriches status strings.
- **`execution_order` on aliases**: Controls ordering inside `cortx init <shell>` output. Aliases with `execution_order` set run first (sorted ascending); others run after by insertion order. Used to force, e.g., `oh-my-posh init` before `zoxide init` so zoxide can hook the prompt AFTER oh-my-posh sets it.

### Choosing the right entity type

| Kind of command | Put it in | Why |
|---|---|---|
| One-shot script that produces logs (build, test, deploy, batch) | `Script` / `GlobalScript` | Process manager captures stdout/stderr line-by-line for display in GUI/TUI |
| Long-running process tied to a project (dev server, watcher) | `Service` | Process manager + project attachment + modes/port |
| Interactive / TUI app (lazygit, btop, yazi, speedtype…) | **`ShellAlias`** | Runs in the user's real terminal via `cortx init <shell>` — full TTY, stdin/raw mode, ANSI sequences all work |

**Never register a TUI app as a Script.** CortX's process manager pipes stdout/stderr and sets `CREATE_NO_WINDOW` on Windows, which breaks any app that needs a real terminal (no PTY attached, line-buffered output, no stdin). Use an alias instead — the shell executes the binary directly so the TTY is preserved.

## CLI conventions

- **Global flag `--json`**: Available on every command. Outputs structured JSON to stdout instead of human-readable tables. Use for scripting or LLM piping.
- **`--yes` on delete commands**: Skips the interactive confirmation prompt. Always pass `--yes` when calling from an agent/script.
- **Backward compat shortcuts**:
  - `cortx scripts` = `cortx script list`
  - `cortx tools` = `cortx tool list`
  - `cortx <name> [args]` = `cortx run <name> [args]` (external subcommand fallback)
- **TUI mode**: `cortx` with no subcommand launches the interactive TUI. To disable this when scripting, always pass a subcommand.

## Command reference

### Top-level

| Command | What it does |
|---|---|
| `cortx` | Launch interactive TUI |
| `cortx run <name> [args] [--preset P]` | Run a global script. `--preset` applies a saved parameter preset. |
| `cortx <name> [args]` | Shortcut for `cortx run <name>` |
| `cortx init <shell>` | Generate shell init script (aliases + setup). Shells: `powershell`, `pwsh`, `ps`, `bash`, `zsh`, `fish`. |
| `cortx export [--file PATH]` | Export all data as JSON. Default: cortx-export.json in cwd. |
| `cortx import <file> [--all]` | Import from export file. `--all` imports every category without prompting. |
| `cortx backup` | Git-backup all data files to the configured `backupRepoPath` (add + commit + push). |
| `cortx docs` | Print this documentation to stdout. |

### `cortx script` — global scripts

| Command | Args / Flags |
|---|---|
| `script list` | `[--tag X]` filter by tag |
| `script get <name_or_id>` | Show full details (command, description, tags, parameters, presets) |
| `script create <name> <command>` | `[--dir X] [--tag X...] [--description X] [--status X]` |
| `script update <name_or_id>` | `[--name X] [--command X] [--dir X] [--tag X...] [--description X] [--status X]` |
| `script delete <name_or_id>` | `[--yes]` |

Scripts can have CLI parameters (e.g. `--input`, `-n 5`) that get auto-detected by the GUI/MCP via `--help` parsing. The CLI does not expose parameter creation — use the MCP or GUI for that.

### `cortx project` — projects

| Command | Args / Flags |
|---|---|
| `project list` | `[--tag X]` |
| `project get <name_or_id>` | Shows services + scripts count |
| `project create <name> <path>` | `[--description X] [--tag X...] [--status X] [--toolbox-url X]` |
| `project update <name_or_id>` | `[--name X] [--path X] [--description X] [--tag X...] [--status X] [--toolbox-url X]` |
| `project delete <name_or_id>` | `[--yes]`. Deletes project AND all its services/scripts. |

### `cortx service` — services within a project

| Command | Args / Flags |
|---|---|
| `service list <project>` | Project name or ID |
| `service add <project> <name> <dir> <command>` | `[--mode name=cmd...] [--default-mode X] [--port N] [--color X]` |
| `service update <id>` | `[--name X] [--command X] [--dir X]` — takes service ID only |
| `service delete <id>` | `[--yes]` |

The `--mode` flag is repeatable: `--mode dev="npm run dev" --mode prod="npm start"`. Paired with `--default-mode dev`.

### `cortx tool` — installed CLI tools registry

| Command | Args / Flags |
|---|---|
| `tool list` | `[--tag X] [--scan]` — `--scan` auto-discovers from Scoop/Chocolatey |
| `tool get <name_or_id>` | |
| `tool create <name>` | `[--description X] [--tag X...] [--status X] [--install-method X] [--install-location X] [--version X] [--homepage X] [--color X] [--config-path label=path[:dir]...]` |
| `tool update <name_or_id>` | Same flags as create + `[--name X]`. `--config-path` replaces all paths. |
| `tool delete <name_or_id>` | `[--yes]` |

`--config-path` format: `"label=path"` for files, `"label=path:dir"` for directories. Example: `--config-path "config=C:/Users/me/.config/fastfetch:dir"`.

### `cortx app` — GUI apps registry

| Command | Args / Flags |
|---|---|
| `app list` | |
| `app get <name_or_id>` | |
| `app create <name>` | `[--description X] [--executable X] [--tag X...] [--status X] [--homepage X] [--launch-args X] [--color X] [--config-path ...]` |
| `app update <name_or_id>` | Same flags as create + `[--name X]`. |
| `app delete <name_or_id>` | `[--yes]` |
| `app launch <name>` | Launch the app's executable (case-insensitive partial match on name) |

### `cortx alias` — shell aliases

| Command | Args / Flags |
|---|---|
| `alias list` | |
| `alias get <name>` | |
| `alias add <name> <command>` | `[-d DESC] [-t TYPE] [--setup shell=code...] [--script shell=code...] [--tool-id UUID]` |
| `alias update <name_or_id>` | `[--name X] [--command X] [--description X] [-t TYPE] [--execution-order N] [--tag X...]` |
| `alias remove <name>` | No confirmation — removes directly |

Alias types:
- **`function`** (default): Wraps `command` as a shell function. Command is the body, `@args`/`$@` is appended.
- **`script`**: Raw per-shell code from the `--script shell=code` map. Injected as-is.
- **`init`**: Eval output of the command in `--script shell=code`. Example: `zoxide init powershell` — its output is eval'd.

`--setup shell=code` runs BEFORE the alias definition (e.g., `Remove-Alias ls -Force` to clear a builtin before redefining).

Use `--execution-order N` to force ordering in `cortx init` output. Lower numbers come first; aliases without it run at the end by insertion order.

### `cortx tag` — tag definitions

| Command | Args / Flags |
|---|---|
| `tag list` | |
| `tag create <name>` | `[--color #hex] [--order N]` |
| `tag update <name>` | `[--name NEW_NAME] [--color X] [--order N]` |
| `tag delete <name>` | `[--yes]` — items keep the tag string but lose color/order |

### `cortx status` — status definitions

Same shape as tag. `create/update/delete` with `--color` and `--order`.

### `cortx settings` — app settings

| Command | Args / Flags |
|---|---|
| `settings get` | Print all settings |
| `settings set <key> <value>` | Set a setting value by key path |

Settable keys:
- `terminal.preset` — `windowsterminal`, `powershell`, `cmd`, `warp`, `macterminal`, `iterm2`, `custom`
- `appearance.theme` — `light`, `dark`, `system`
- `defaults.launchMethod` — `clipboard`, `external`, `integrated`
- `toolboxBaseUrl` — URL prefix for tool `toolbox_url` fields starting with `/`
- `backupRepoPath` — local path to a git repo for `cortx backup`

## Common workflows

### Add a CLI tool you just installed
```bash
cortx tool create "ripgrep" \
  --description "Fast recursive grep" \
  --tag "cli tool" --tag "utils" \
  --status "Active" \
  --install-method "scoop" \
  --install-location "C:/Users/me/scoop/apps/ripgrep/current" \
  --version "14.0.3" \
  --homepage "https://github.com/BurntSushi/ripgrep"
```

### Create a new alias that syncs to your shell
```bash
cortx alias add "gp" "git push" --description "Quick git push"
# Then reload your shell — cortx init is already sourced in your profile
```

### Run a script with a preset
```bash
cortx run deploy-staging --preset fast
```

### Script a bulk operation using JSON output
```bash
# List all projects tagged "web" as JSON, pipe to jq
cortx project list --tag web --json | jq '.[].name'
```

### Back up everything to git
```bash
cortx settings set backupRepoPath "C:/Users/me/dotfiles/cortx-data"
cortx backup
```

### Migrate data between machines
```bash
# On machine A
cortx export --file /tmp/cortx.json

# On machine B
cortx import /tmp/cortx.json --all
```

## When to use CLI vs MCP

**CLI is preferred for:**
- Scripting, automation, pipelines (pipe `--json` into jq/other tools)
- Quick one-shot queries from an agent (cheaper than loading all 54 MCP tool schemas)
- Bash/PowerShell workflows where shell composition is natural

**MCP is preferred for:**
- Interactive agent sessions where you want type-safe structured calls
- Complex parameter parsing (nested objects, env var maps)
- Features not yet exposed in the CLI (script parameter detection, preset management)

The CLI and MCP share the same backend — changes via one are immediately visible via the other.

## Tips for AI agents

1. **Always pass `--yes` to delete commands** — otherwise they block on confirmation.
2. **Use `--json` for parsing** — the table output is for humans; JSON is stable and structured.
3. **Name-or-ID lookup is case-insensitive on names** — but UUIDs are safer when names could collide.
4. **Check existing data before creating** — `cortx <domain> list` first to avoid duplicates.
5. **The TUI starts if you run `cortx` with no args** — always pass a subcommand when scripting.
6. **`cortx init <shell>` is meant to be eval'd in a shell profile** — don't run it as a standalone command; its output is shell code.
7. **For destructive bulk ops, prefer `cortx export` first** — you can always re-import if something goes wrong.
