export interface Service {
  id: string;
  name: string;
  workingDir: string;
  command: string;
  modes?: Record<string, string>;  // Optional: { modeName: command }
  defaultMode?: string;  // If set, use this mode's command as default when starting
  extraArgs?: string;  // Static args always appended to command
  argPresets?: Record<string, string>;  // { presetName: argsString }
  defaultArgPreset?: string;  // Default preset to use
  color?: string;
  port?: number;
  envVars?: Record<string, string>;
  order: number;
}

export interface Script {
  id: string;
  name: string;
  description?: string;
  command: string;
  scriptPath?: string;
  workingDir: string;
  color?: string;
  linkedServiceIds: string[];
  order: number;
}

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  description?: string;
  imagePath?: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  services: Service[];
  scripts: Script[];
  envFiles: EnvFile[];
  envFilesDiscovered: boolean;
  tags: string[];
  status?: string;
  toolboxUrl?: string;
  /** Pinned by the user: favorites are listed first and can be filtered on. */
  favorite: boolean;
}

// Environment file types

export interface EnvVariable {
  key: string;
  value: string;
  lineNumber: number;
}

export type EnvFileVariant =
  | 'base'
  | 'local'
  | 'development'
  | 'production'
  | 'test'
  | 'staging'
  | 'example'
  | 'other';

export interface EnvFile {
  id: string;
  path: string;
  relativePath: string;
  filename: string;
  variant: EnvFileVariant;
  variables: EnvVariable[];
  isManuallyAdded: boolean;
  linkedServiceId?: string;
  discoveredAt: string;
  lastReadAt: string;
}

export interface EnvComparison {
  baseFileId: string;
  exampleFileId: string;
  missingInBase: string[];
  extraInBase: string[];
  commonKeys: string[];
}

export type TerminalPreset =
  | 'windowsterminal'
  | 'powershell'
  | 'cmd'
  | 'warp'
  | 'macterminal'
  | 'iterm2'
  | 'custom'
  /** CortX's own Terminal window: "external" launches run in a PTY there. */
  | 'cortxterminal';

export interface TerminalConfig {
  preset: TerminalPreset;
  customPath: string;
  customArgs: string[];
  /** Shell launched by "new terminal" tabs in the integrated terminal, as a
   *  command line (e.g. `pwsh -NoLogo`, `/bin/zsh -l`). Empty = auto-detect. */
  integratedShell?: string;
  /** `cortx init` emits OSC 7 / OSC 133 (cwd, command boundaries, exit codes)
   *  inside CortX terminals. Default true. */
  shellIntegration?: boolean;
  /** Toast + OS notification when a long command finishes in a terminal you
   *  are not looking at. Default true. */
  notifyOnLongCommand?: boolean;
  /** Threshold for "long", in seconds. Default 10. */
  longCommandSeconds?: number;
  /** Which finished commands are worth a notification. Undefined = derived from
   *  `notifyOnLongCommand` (false → `never`, otherwise `failed`). */
  notifyWhen?: TerminalNotifyWhen;
  /** How a notification is delivered. Undefined = `both`. */
  notifyStyle?: TerminalNotifyStyle;
  /** Only notify for a terminal that is not on screen. Default true. */
  notifyOnlyWhenHidden?: boolean;
  /** Commands that never notify (program name, or a whole prefix like `npm run dev`).
   *  Undefined = the built-in list; `[]` = nothing is muted. */
  notifyMutedCommands?: string[];
  /** Terminal window: sessions rail on the left (default) or a tab strip on top — never both. */
  tabsPlacement?: 'sidebar' | 'top';
  /** What Ctrl+Tab walks: the tab list, or the order you last used the tabs in
   *  (issue 45b). Default `sequential`. */
  ctrlTabBehavior?: TerminalCtrlTabBehavior;
  /** Ask before closing a terminal — or quitting CortX — while a command is
   *  running in it (nothing running = closes straight away). Default true. */
  confirmCloseRunning?: boolean;
  /** Font of every terminal. Empty = bundled monospace stack. */
  fontFamily?: string;
  /** Font size in px. Default 12. */
  fontSize?: number;
  /** Line height multiplier 1.0–2.0. Default 1.2. */
  lineHeight?: number;
  /** Extra space between glyphs in px. Undefined = automatic. */
  letterSpacing?: number;
  /** Weight of normal / bold text (100–900). Undefined = 400 / 700. */
  fontWeight?: number;
  fontWeightBold?: number;
  /** `webgl` (GPU), `canvas` (fine text + exact block glyphs) or `dom` (no acceleration). */
  renderer?: 'dom' | 'webgl' | 'canvas';
  /** Selection colour (any CSS colour). Undefined = the theme's. */
  selectionColor?: string;
  /** Lines of output kept behind the viewport, per terminal (1 000–200 000).
   *  Default 10 000. Also caps how far back the command blocks stay
   *  navigable: trimming the scrollback destroys the markers the blocks are
   *  built on. Applies to the terminals already open.
   *
   *  The backend keeps its own copy of the same output — that is what is
   *  replayed when the Terminal window is reopened or the webview reloads —
   *  and it is budgeted from this number (128 bytes a line, never under 4 MB,
   *  never over 32 MB). It counts raw bytes, so a session full of Sixel
   *  images reaches the budget well before the line count does. */
  scrollbackLines?: number;
  /** Size cap of the shared command-history file, in megabytes (1-200).
   *  Default 10. Past it the file is rewritten keeping only its most recent
   *  half, so what stays searchable is between half and all of it. At roughly
   *  250 bytes a command, 10 MB is about 40 000 of them. */
  historyMaxMb?: number;
  /** Reopen the Terminal window's tabs on start (shells in their last cwd, nothing re-run). Default true. */
  restoreSessions?: boolean;
  /** Seed restored shells with the tail of their previous scrollback. Default true. */
  restoreScrollback?: boolean;
  /** Lines *replayed* into a restored shell on start (not the same thing as
   *  `scrollbackLines`, which is how much a live terminal keeps). Default 200. */
  restoreScrollbackLines?: number;
  /** Where a started service / script shows up. Default dock. */
  openProcessesIn?: TerminalTargetSurface;
  /** Where a launch configuration opens its tabs. Default window. */
  openDevSessionsIn?: TerminalTargetSurface;
  /** Terminal window shortcuts: action id → combo (e.g. `{ "split.right": "Ctrl+Shift+D" }`). Missing = default. */
  keybindings?: Record<string, string>;
  /** Terminal theme names (files under data/terminal/themes/) for dark / light app mode. */
  themeDark?: string;
  themeLight?: string;
  /** Pick the dark/light theme from the app mode (default true) or always use themeDark. */
  themeFollowsApp?: boolean;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
  /** The cursor of a pane that does *not* have the focus (issue 52). Default
   *  `outline` — the shape above, hollow — which is xterm's own. `none` is
   *  the one to pick with splits open: the pane your keys go to becomes the
   *  only one with a cursor in it. */
  cursorInactiveStyle?: TerminalCursorInactiveStyle;
  /** Inner padding in px. Default 8. */
  padding?: number;
  /** Terminal window opacity 50–100. Default 100. */
  windowOpacity?: number;
  windowEffect?: 'none' | 'acrylic' | 'mica' | 'vibrancy';
  /** Ghost-text completions from the command history (→ accepts). Default true. */
  inlineSuggestions?: boolean;
  /** Wallpaper overrides; undefined = the theme file's own values. */
  wallpaperOpacity?: number;
  wallpaperBlur?: number;
  wallpaperFit?: 'cover' | 'contain' | 'tile' | 'center';
  /** Darkening overlay on the wallpaper, 0–90 %. Default 0. */
  wallpaperDim?: number;
  /** Title bar + rail background alpha 0–100 %. Default 72. */
  chromeOpacity?: number;
  /** Title bar + rail backdrop blur in px. Default 20. */
  chromeBlur?: number;
  /** How much of the terminal theme the main window's dock takes (ticket #38).
   *  Default `app`. Supersedes `dockUsesTerminalTheme`, which is kept only so
   *  an older settings file (and an older build) still reads right — see
   *  `lib/terminalTheme.ts › dockThemeMode`. */
  dockTheme?: TerminalDockTheme;
  /** @deprecated Use `dockTheme`. `true` is read as `chrome`, `false` as `app`.
   *  Still written alongside `dockTheme` so downgrading keeps the dock right. */
  dockUsesTerminalTheme?: boolean;
  /** A mouse selection is copied to the clipboard as soon as it ends (Warp / X11 style).
   *  While on, Ctrl+C keeps interrupting the program instead of copying. Default true. */
  copyOnSelect?: boolean;
  /** What Shift+Enter sends: `escape-enter` = ESC + CR (a new line for Claude Code,
   *  zsh and fish), `enter` = the same CR as Enter. Default `escape-enter`. */
  shiftEnter?: ShiftEnterKey;
  /** Wheel scrolling animation in ms; 0 scrolls instantly, line by line. Default 100. */
  smoothScrollDuration?: number;
  /** What a tab shows in the sessions rail and the tab strip. */
  tabDisplay?: TerminalTabDisplay;
  /** Render kitty graphics (`ESC _ G …`) by translating them to the iTerm2
   *  sequence the image addon draws. Default true. */
  kittyGraphics?: boolean;
  /** Underline file paths in the output and open them on click. Default true. */
  filePathLinks?: boolean;
  /** Key that opens the completion menu above the prompt. `tab` takes Tab
   *  away from the shell's own completion, so the default is `ctrlSpace`. */
  completionMenu?: CompletionMenuKey;
  /** Learn a command's flags and subcommands by running `<cmd> --help` once
   *  (PATH-resolved names only, cached on disk). Default true. */
  completionSpecs?: boolean;
  /** Git refs, package.json scripts and file paths in the terminal's own
   *  directory. Default true. */
  completionContext?: boolean;
  /** Read the previous command's output for what to run next — the
   *  `git push --set-upstream …` git just printed, the session id a coding
   *  agent left behind, the subcommand it says you meant. Default true. */
  suggestionsFromOutput?: boolean;
  /** How sure the engine must be before it draws a ghost at all. `strict`
   *  only when it is all but certain, `loose` whenever anything matches.
   *  Default `balanced`. */
  suggestionConfidence?: SuggestionConfidence;
  /** Where the input line sits in a pane: `flow` = after the output, as today;
   *  `bottom` = pinned to the bottom of the pane, output stacking above it
   *  (Warp's `pinned_to_bottom`). Purely visual — the PTY size never changes.
   *  Default `flow`. */
  inputPosition?: TerminalInputPosition;
  /** Beta: type the command into a CortX editor at the prompt instead of the
   *  shell's own line editor. Only ever active between the shell's `OSC 133;B`
   *  and the submission, so anything without shell integration (ssh, a REPL, a
   *  TUI) behaves exactly as it does today. Default false. */
  inputEditor?: boolean;
  /** A key the editor cannot honour (Tab, Ctrl+R, ↑/↓…) writes the line to the
   *  PTY without a CR and gives the key to the shell, which completes or
   *  searches it as it does today. Off: the key is swallowed. Default true. */
  inputEditorHandoff?: boolean;
  /** Command blocks (#7): the OSC 133 markers become one block per command —
   *  Ctrl+↑ / Ctrl+↓ jump prompt to prompt, a block can be copied, folded or
   *  run again. Purely an overlay: the grid, the PTY and the flow are
   *  untouched, and nothing appears without shell integration. Default true. */
  blocks?: boolean;
  /** The clickable status bars in the pane's left padding (green / red per
   *  exit code). Off keeps navigation, copy and folding. Default true. */
  blockGutter?: boolean;
  /** The 1 px rule the full width of the pane on each block's top edge — what
   *  makes the blocks visible (Warp's `show_block_dividers`). Default true. */
  blockDividers?: boolean;
  /** The toolbar that appears at a block's top-right corner on hover: copy the
   *  command, the output or both, run it again, fold it, and `⋯` for the rest.
   *  Off leaves the gutter's right-click menu. Default true. */
  blockActions?: boolean;
  /** A 10 % wash of the palette's own red over a block whose command failed,
   *  plus the full-height flag pole in the gutter beside it — what makes an
   *  `exit 1` findable in a pane full of output. Off leaves the gutter bar.
   *  Default true. */
  blockFailedWash?: boolean;
  /** A background plate under each block, so a command and its output read as
   *  a card rather than as scrollback. **Terminal window only**: it is drawn
   *  beneath the xterm canvas and only shows through where that canvas is
   *  transparent, which a docked pane's is not. Default true. */
  blockCards?: boolean;
  /** Once the command that produced what you are reading has scrolled off,
   *  pin it to the top of the pane; click it to go back. Hidden while the
   *  command is still running. Default true. */
  blockStickyHeader?: boolean;
  /** A button at the bottom-right of a block whose output runs off the bottom
   *  of the pane: one click goes to its end. Default true. */
  blockJumpToBottom?: boolean;
  /** Mask what looks like a secret — a token, a password, an API key — in the
   *  command line before it reaches the history file. That file feeds the
   *  history view, Ctrl+R and the ranking behind ghost text, so masking on the
   *  way in covers all three. Only the file, never the screen. Default true. */
  redactSecrets?: boolean;
  /** Air between two blocks — Warp's `appearance.spacing`. `comfortable` by
   *  default, because that is what Warp's own `normal` amounts to. The shell
   *  integration prints that many real blank lines before a prompt that
   *  follows a command: an overlay cannot space out two rows of an xterm
   *  grid, so the room has to exist in the buffer. `compact` adds nothing.
   *  Applies to newly opened terminals. */
  blockSpacing?: TerminalBlockSpacing;
  /** Show a link's target in a tooltip while the pointer is on it, before the
   *  click. Default true. */
  linkTooltip?: boolean;
  /** What ⌥ (Option) sends on macOS. Ignored on Windows and Linux, where Alt
   *  has always been Meta. Default `wordKeys`. See `lib/terminalKeys.ts`. */
  macOptionAsMeta?: MacOptionAsMeta;
  /** What a program running in the terminal may do with the system clipboard
   *  through the OSC 52 escape sequence. Default `deny` (issue 36). */
  osc52?: TerminalOsc52Access;
  /** What a `BEL` (`0x07`) does. Default `visual` (issue 11). */
  bell?: TerminalBellStyle;
  /** Join `!=`, `=>`, `->` into the ligatures the font draws for them. Off by
   *  default: the joiner runs over every rendered row. Default false. */
  ligatures?: boolean;
  /** Minimum contrast ratio between a cell's text and its background, 1–21
   *  (issue 52). `1` (the default) leaves every colour exactly as the theme
   *  and the program wrote it; `4.5` is WCAG AA and `7` AAA — xterm then
   *  lightens or darkens a foreground, per cell, only where the pair falls
   *  short. What rescues a third-party theme whose `brightBlack` is
   *  unreadable on its own background; what distorts a theme whose dim greys
   *  are the point. Applies to the terminals already open. */
  minimumContrastRatio?: number;
  /** Expose the terminal's rows as live DOM for VoiceOver / NVDA (issue 52).
   *  Default false — xterm's own default, because the mirror is rebuilt on
   *  every render. Without it a screen reader hears nothing at all from a
   *  terminal. Applies to the terminals already open. */
  screenReaderMode?: boolean;
}

/** The cursor of a pane that does not have the focus (issue 52). xterm's own
 *  default is `outline`; CortX keeps it, and offers the rest because a window
 *  full of splits wants a louder answer to "where do my keys go". */
export type TerminalCursorInactiveStyle = 'outline' | 'block' | 'bar' | 'underline' | 'none';

/**
 * What a `BEL` byte does (issue 11). Warp has a whole `audible_bell` module;
 * this is the same three levels every terminal offers.
 *
 * The signal is deliberately confined to the pane — a flash, or a short tone
 * — and never reaches the toast or the desktop notification: those two
 * channels belong to the command-finished policy
 * (`settings/notificationPolicy.ts`), and one event must not arrive twice.
 */
export type TerminalBellStyle = 'off' | 'visual' | 'audible';

/**
 * What OSC 52 is allowed to do (issue 36) — Warp's
 * `terminal.osc52_clipboard_access`, with the same three levels and the same
 * `deny` default.
 *
 * OSC 52 is an escape sequence like any other: anything that writes to the
 * PTY can emit one — a program behind `ssh`, a process in a container, a
 * `cat` on a file nobody read. Writing replaces what you copied; reading
 * hands the program whatever you last copied anywhere.
 */
export type TerminalOsc52Access = 'deny' | 'writeOnly' | 'readWrite';

/** How much room a block gets above it (ticket #7). Default `comfortable`,
 *  which leaves two blank lines — Warp's own spacing is ~2.1 grid cells, and
 *  two whole rows is the nearest a grid can express. `normal` is one row, a
 *  quarter of that. */
export type TerminalBlockSpacing = 'normal' | 'compact' | 'comfortable';

/**
 * What Ctrl+Tab does (issue 45b) — Warp's `keys.ctrl_tab_behavior_setting`.
 *
 * `sequential` is the default and is what CortX has always done: the next tab
 * in the list, then the one after it. `recentlyUsed` makes it Alt+Tab: the
 * first press goes to the tab you were on before this one, and holding Ctrl
 * while pressing again walks further back through the tabs you have used.
 *
 * The default deliberately does not move: switching a key someone presses a
 * hundred times a day is not a change to make on their behalf.
 */
export type TerminalCtrlTabBehavior = 'sequential' | 'recentlyUsed';

/**
 * What ⌥ (Option) sends on macOS (issue 35, zorg #28).
 *
 * - `never` — macOS composes everything; no chord is reserved. `Alt+B` /
 *   `Alt+F` never reach the shell.
 * - `wordKeys` (default) — macOS composes everything *except* ⌥B, ⌥F, ⌥D, ⌥V
 *   and ⌥⌫, which CortX sends as `ESC` + key.
 * - `always` — xterm's `macOptionIsMeta`: every ⌥ chord becomes `ESC` + key,
 *   and the ⌥ layer of the keyboard (`[ ] { } | @` on FR/CH/AZERTY) is gone.
 */
export type MacOptionAsMeta = 'never' | 'wordKeys' | 'always';

/** Where the input line sits in a terminal pane (ticket #15, U0). */
export type TerminalInputPosition = 'flow' | 'bottom';

/**
 * How much of the terminal theme the main window's dock takes (ticket #38).
 *
 * - `app` (default) — nothing: the dock keeps the app skin, panes included.
 * - `canvas` — the panes only; the dock's header and tab rows stay the app's.
 * - `chrome` — the whole dock, the way the Terminal window does it.
 *
 * `canvas` is what the old `dockUsesTerminalTheme: true` actually did, and
 * what ticket #38 was about: a slab of terminal colour dropped into a light
 * interface whose chrome stayed white. The boolean is now read as `chrome`
 * instead, which is the coherent answer.
 */
export type TerminalDockTheme = 'app' | 'canvas' | 'chrome';

/** When a tab shows its Ctrl+N number. Default `ctrl`. */
export type TabIndexDisplay = 'never' | 'ctrl' | 'always';

/**
 * What a terminal tab shows. The title is never optional — a tab needs a
 * name; everything around it is. See `DEFAULT_TAB_DISPLAY` in
 * `components/terminal/model.ts` for the defaults.
 */
export interface TerminalTabDisplay {
  /** Second line: the directory the shell is in. Default true. */
  cwd?: boolean;
  /** Second line while a command runs: the command (takes over the directory). Default true. */
  command?: boolean;
  /** Status glyph (spinner, finished pill, runtime dot). Default true. */
  status?: boolean;
  /** Detected agent: its icon, the title it gave itself, its own state. Default true. */
  agent?: boolean;
  /** When the Ctrl+N number shows up. Default `ctrl` (only while Ctrl is held). */
  index?: TabIndexDisplay;
  /** Also draw the tab colour as a bar down the left edge, on top of the tint.
   *  Off by default: the tint alone carries the colour, which is what Warp
   *  does. The bar says the same thing without repainting the surface, which
   *  a busy wallpaper theme may prefer. */
  colorBar?: boolean;
}

/** What the terminal sends when Shift+Enter is pressed (see `lib/terminalKeys`). */
export type ShiftEnterKey = 'escape-enter' | 'enter';

export type TerminalTargetSurface = 'dock' | 'window';

/** Which finished commands deserve a notification (see `notificationPolicy.ts`). */
export type TerminalNotifyWhen = 'never' | 'failed' | 'failed-or-long' | 'all';
/** How a terminal notification reaches you. */
export type TerminalNotifyStyle = 'toast' | 'system' | 'both';

// ---------------------------------------------------------------------------
// Launch configurations (data/terminal/launch/*.yaml)
// ---------------------------------------------------------------------------

export type LaunchSplitDirection = 'horizontal' | 'vertical';

export type LaunchNode =
  | { split: LaunchSplitDirection; children: LaunchNode[]; sizes?: number[] }
  | { cwd?: string; command?: string; shell?: string; title?: string };

export interface LaunchTab {
  title?: string;
  layout: LaunchNode;
}

export interface LaunchConfig {
  id: string;
  name: string;
  projectId?: string;
  /** `terminal` (default) or `dock`. */
  window: 'terminal' | 'dock';
  tabs: LaunchTab[];
}

export function isLaunchSplit(node: LaunchNode): node is { split: LaunchSplitDirection; children: LaunchNode[]; sizes?: number[] } {
  return typeof node === 'object' && node !== null && 'split' in node;
}

export type ShellPhase = 'unknown' | 'idle' | 'running';

/** What the shell behind a terminal reported through shell integration
 *  (`terminal-state` event / `get_terminal_states`). */
export interface TerminalShellState {
  terminalId: string;
  phase: ShellPhase;
  cwd?: string | null;
  /** Command currently running (phase === 'running'). */
  command?: string | null;
  /** Epoch ms. */
  startedAt?: number | null;
  lastCommand?: string | null;
  lastExitCode?: number | null;
  lastDurationMs?: number | null;
  lastFinishedAt?: number | null;
  /** Increments on every finished command. */
  completedCommands: number;
}

/**
 * An agent (Claude Code, Codex) detected inside a terminal — the agent process
 * is a descendant of the PTY's, found by walking the process tree
 * (`terminal-agents` event / `get_terminal_agents`).
 */
export interface TerminalAgentInfo {
  terminalId: string;
  provider: AgentProvider;
  /** `running` / `waiting` for Claude Code; `unknown` for Codex, which
   *  publishes no live status at all. */
  state: AgentState;
  /** Pid of the agent itself, not of the shell. */
  pid: number;
  sessionId?: string;
  /** Title the agent gave itself (`/rename`, `--name`, auto title). */
  name?: string;
  cwd?: string;
  kind?: string;
}

/** One line of `runtime/command-history.jsonl`. */
export interface CommandRecord {
  ts: number;
  terminalId: string;
  projectId?: string;
  cwd?: string;
  command?: string;
  exitCode?: number;
  durationMs: number;
}

/**
 * One command from the shared history, ranked for a terminal's context
 * (`suggest_history`). Every part of `score` is independent of what has been
 * typed, so the frontend fetches the list once per prompt and filters it
 * locally. See `cortx_core::terminal::rank_commands`.
 */
export interface CommandSuggestion {
  command: string;
  score: number;
  /** How many times it was run, all directories together. */
  count: number;
  lastTs: number;
  /** Never once exited 0. Only offered when nothing else matches. */
  failed: boolean;
  sameCwd: boolean;
  sameProject: boolean;
}

/** A completable token of a command specification: a subcommand or a flag. */
export interface SpecItem {
  name: string;
  description?: string;
  /** The flag expects a value, so accepting it shouldn't add a space. */
  takesValue: boolean;
}

/**
 * What CortX learned about a command by reading its own `--help` page once
 * (`runtime/command-specs/<name>.json`).
 */
export interface CommandSpec {
  command: string;
  subcommands: SpecItem[];
  flags: SpecItem[];
  fetchedAt: number;
  exePath?: string;
  exeMtime?: number;
  /** `--help`, `-h`, or `none` when the program printed nothing useful. */
  source: string;
}

/** One filesystem entry offered as a completion. */
export interface PathCompletion {
  name: string;
  /** The whole word once accepted, directory part included. */
  value: string;
  isDir: boolean;
}

/** Which key opens the terminal completion menu. */
export type CompletionMenuKey = 'off' | 'ctrlSpace' | 'tab';

/** How sure an inline suggestion must be before it is drawn at all. */
export type SuggestionConfidence = 'strict' | 'balanced' | 'loose';

export interface AppearanceConfig {
  theme: 'light' | 'dark' | 'system';
}

export interface DefaultsConfig {
  launchMethod: 'clipboard' | 'external' | 'integrated';
}

export interface AppSettings {
  terminal: TerminalConfig;
  appearance: AppearanceConfig;
  defaults: DefaultsConfig;
  scriptsConfig: ScriptsConfig;
  toolboxBaseUrl: string;
  backupRepoPath?: string;
  /** tauri-plugin-global-shortcut combo (e.g. "CmdOrCtrl+Shift+Space").
   *  Undefined / empty means "disabled". */
  globalHotkey?: string;
  /** Directory where alias shims (real launcher files) are written. Empty/undefined
   *  means use the platform default (`%LOCALAPPDATA%\CortX\bin`, `~/.local/share/CortX/bin`). */
  shimDir?: string;
  /** Agents (beta) section: provider roots, toggles and list defaults. */
  agents: AgentsSettings;
}

export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface ServiceState {
  serviceId: string;
  status: ServiceStatus;
  pid?: number;
  activeMode?: string;  // Track which mode is running
  activeArgPreset?: string;  // Track which arg preset is active
}

export type LogStream = 'stdout' | 'stderr';

export interface LogEntry {
  timestamp: string;
  stream: LogStream;
  content: string;
}

// Integrated terminal (PTY) — see cortx_core::process_manager / terminal
export interface ShellInfo {
  id: string;
  pid: number;
  cwd: string;
  projectId?: string | null;
  program: string;
  startedAt: string;
}

export interface ShellExitPayload {
  shellId: string;
  exitCode?: number | null;
}

export interface TerminalCapabilities {
  /** Windows only: the bundled Windows Terminal ConPTY (image passthrough) is in use. */
  conptySideloaded: boolean;
  platform: string;
}

// Event payloads from Tauri
export interface ServiceLogPayload {
  serviceId: string;
  stream: LogStream;
  content: string;
}

export interface ServiceStatusPayload {
  serviceId: string;
  status: ServiceStatus;
  pid?: number;
  activeMode?: string;
  activeArgPreset?: string;
}

export interface ServiceExitPayload {
  serviceId: string;
  exitCode?: number;
}

export interface ServicePortsPayload {
  serviceId: string;
  ports: number[];
}

// Script types
export type ScriptStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface ScriptLogPayload {
  scriptId: string;
  stream: LogStream;
  content: string;
}

export interface ScriptStatusPayload {
  scriptId: string;
  status: ScriptStatus;
  pid?: number;
}

export interface ScriptExitPayload {
  scriptId: string;
  exitCode?: number;
  success: boolean;
}

// Input types for commands
export interface CreateProjectInput {
  name: string;
  rootPath: string;
  description?: string;
  imagePath?: string;
  tags?: string[];
  status?: string;
  toolboxUrl?: string;
}

export interface UpdateProjectInput {
  name?: string;
  rootPath?: string;
  description?: string;
  imagePath?: string;
  tags?: string[];
  /** Empty string clears the status; omit the field to leave it untouched. */
  status?: string;
  toolboxUrl?: string;
  favorite?: boolean;
}

export interface CreateServiceInput {
  name: string;
  workingDir: string;
  command: string;
  modes?: Record<string, string>;
  defaultMode?: string;
  extraArgs?: string;
  argPresets?: Record<string, string>;
  defaultArgPreset?: string;
  color?: string;
  port?: number;
  envVars?: Record<string, string>;
}

export interface UpdateServiceInput {
  name?: string;
  workingDir?: string;
  command?: string;
  modes?: Record<string, string>;
  defaultMode?: string;
  extraArgs?: string;
  argPresets?: Record<string, string>;
  defaultArgPreset?: string;
  color?: string;
  port?: number;
  envVars?: Record<string, string>;
}

export interface CreateScriptInput {
  name: string;
  description?: string;
  command: string;
  scriptPath?: string;
  workingDir: string;
  color?: string;
  linkedServiceIds?: string[];
}

export interface UpdateScriptInput {
  name?: string;
  description?: string;
  command?: string;
  scriptPath?: string;
  workingDir?: string;
  color?: string;
  linkedServiceIds?: string[];
}

// Environment file input types

export interface DiscoverEnvFilesInput {
  force: boolean;
}

export interface AddEnvFileInput {
  path: string;
}

export interface LinkEnvToServiceInput {
  serviceId: string | null;
}

// ============================================================================
// Global Scripts types
// ============================================================================

export type ScriptParamType = 'string' | 'bool' | 'number' | 'enum' | 'path';

export interface ScriptParameter {
  name: string;
  paramType: ScriptParamType;
  shortFlag?: string;
  longFlag?: string;
  description?: string;
  defaultValue?: string;
  required: boolean;
  enumValues: string[];
  nargs?: string;
}

export interface ParameterPreset {
  id: string;
  name: string;
  description?: string;
  values: Record<string, string>;
  enabled: Record<string, boolean>;
}

export interface GlobalScript {
  id: string;
  name: string;
  description?: string;
  command: string;
  scriptPath?: string;
  workingDir?: string;
  color?: string;
  tags: string[];
  parameters: ScriptParameter[];
  parameterPresets: ParameterPreset[];
  defaultPresetId?: string;
  envVars?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  order: number;
  autoDiscovered: boolean;
  status?: string;
  /** Pinned by the user: favorites are listed first and can be filtered on. */
  favorite: boolean;
}

export interface TagDefinition {
  name: string;
  color?: string;
  order?: number;
}

export interface ExecutionRecord {
  id: string;
  scriptId: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  success: boolean;
  exitCode?: number;
  parametersUsed: Record<string, string>;
  presetName?: string;
}

export interface ScriptsConfig {
  mainFolder?: string;
  scanExtensions: string[];
  ignoredPatterns: string[];
  autoScanOnStartup: boolean;
  commandTemplates: Record<string, string>;
}

export interface DiscoveredScript {
  path: string;
  name: string;
  description?: string;
  extension: string;
}

// Discovered tool (from package manager scanning)
export interface DiscoveredTool {
  name: string;
  version?: string;
  source: string;
  description?: string;
  installLocation?: string;
  homepage?: string;
}

// Tool types
export interface ToolConfigPath {
  label: string;
  path: string;
  isDirectory: boolean;
}

export interface Tool {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  status: string;
  replacedBy?: string;
  installMethod?: string;
  installLocation?: string;
  version?: string;
  homepage?: string;
  configPaths: ToolConfigPath[];
  toolboxUrl?: string;
  notes?: string;
  color?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  /** Pinned by the user: favorites are listed first and can be filtered on. */
  favorite: boolean;
}

export interface CreateToolInput {
  name: string;
  description?: string;
  tags?: string[];
  status?: string;
  replacedBy?: string;
  installMethod?: string;
  installLocation?: string;
  version?: string;
  homepage?: string;
  configPaths?: ToolConfigPath[];
  toolboxUrl?: string;
  notes?: string;
  color?: string;
}

export interface UpdateToolInput {
  name?: string;
  description?: string;
  tags?: string[];
  /** Empty string clears the status; omit the field to leave it untouched. */
  status?: string;
  favorite?: boolean;
  replacedBy?: string;
  installMethod?: string;
  installLocation?: string;
  version?: string;
  homepage?: string;
  configPaths?: ToolConfigPath[];
  toolboxUrl?: string;
  notes?: string;
  color?: string;
}

// Input types for global script commands

export interface CreateGlobalScriptInput {
  name: string;
  description?: string;
  command: string;
  scriptPath?: string;
  workingDir?: string;
  color?: string;
  tags?: string[];
  parameters?: ScriptParameter[];
  parameterPresets?: ParameterPreset[];
  envVars?: Record<string, string>;
  status?: string;
}

export interface UpdateGlobalScriptInput {
  name?: string;
  description?: string;
  command?: string;
  scriptPath?: string;
  workingDir?: string;
  color?: string;
  tags?: string[];
  parameters?: ScriptParameter[];
  parameterPresets?: ParameterPreset[];
  defaultPresetId?: string;
  envVars?: Record<string, string>;
  /** Empty string clears the status; omit the field to leave it untouched. */
  status?: string;
  favorite?: boolean;
}

export interface CreateTagDefinitionInput {
  name: string;
  color?: string;
  order?: number;
}

export interface UpdateTagDefinitionInput {
  name?: string;
  color?: string;
  order?: number;
}

// Import/Export result
export interface ImportResult {
  scriptsAdded: number;
  skipped: number;
  toolsAdded: number;
  tagDefinitionsAdded: number;
  aliasesAdded: number;
  appsAdded: number;
  statusDefinitionsAdded: number;
  projectsAdded: number;
  settingsImported: boolean;
}

export interface ImportOptions {
  projects: boolean;
  scripts: boolean;
  tools: boolean;
  apps: boolean;
  shellConfig: boolean;
  tagsAndStatuses: boolean;
  settings: boolean;
}

export interface ExportSummary {
  version: string;
  exportedAt: string;
  projectsCount: number;
  scriptsCount: number;
  toolsCount: number;
  appsCount: number;
  aliasesCount: number;
  tagDefinitionsCount: number;
  statusDefinitionsCount: number;
  hasSettings: boolean;
}

// View types
export type View = 'dashboard' | 'project' | 'settings' | 'scripts' | 'script-detail' | 'tools' | 'tool-detail' | 'aliases' | 'alias-detail' | 'apps' | 'app-detail' | 'utilities' | 'agents';

// Status Definition types
export interface StatusDefinition {
  name: string;
  color?: string;
  order?: number;
}

export interface CreateStatusDefinitionInput {
  name: string;
  color?: string;
  order?: number;
}

export interface UpdateStatusDefinitionInput {
  name?: string;
  color?: string;
  order?: number;
}

// App types (GUI Applications)
export interface App {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  status?: string;
  version?: string;
  homepage?: string;
  executablePath?: string;
  launchArgs?: string;
  configPaths: ToolConfigPath[];
  toolboxUrl?: string;
  notes?: string;
  color?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  /** Pinned by the user: favorites are listed first and can be filtered on. */
  favorite: boolean;
}

export interface CreateAppInput {
  name: string;
  description?: string;
  tags?: string[];
  status?: string;
  version?: string;
  homepage?: string;
  executablePath?: string;
  launchArgs?: string;
  configPaths?: ToolConfigPath[];
  toolboxUrl?: string;
  notes?: string;
  color?: string;
}

export interface UpdateAppInput {
  name?: string;
  description?: string;
  tags?: string[];
  /** Empty string clears the status; omit the field to leave it untouched. */
  status?: string;
  favorite?: boolean;
  version?: string;
  homepage?: string;
  executablePath?: string;
  launchArgs?: string;
  configPaths?: ToolConfigPath[];
  toolboxUrl?: string;
  notes?: string;
  color?: string;
}

export type ListViewMode = 'card' | 'list' | 'compact';

// Shell Alias types
export type AliasType = 'function' | 'script' | 'init';

export interface ShellAlias {
  id: string;
  name: string;
  command: string;
  description?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  order: number;
  status?: string;
  aliasType: AliasType;
  setup?: Record<string, string>;
  script?: Record<string, string>;
  toolId?: string;
  executionOrder?: number;
  /** When true, a real launcher file ("shim") is written so this alias is
   *  callable from any process (agents, scheduled tasks), not just shells that
   *  source `cortx init`. Only effective for `function` aliases. */
  shim?: boolean;
  /** Pinned by the user: favorites are listed first and can be filtered on. */
  favorite: boolean;
}

export interface CreateShellAliasInput {
  name: string;
  command: string;
  description?: string;
  tags?: string[];
  status?: string;
  aliasType?: AliasType;
  setup?: Record<string, string>;
  script?: Record<string, string>;
  toolId?: string;
  executionOrder?: number;
  shim?: boolean;
}

export interface UpdateShellAliasInput {
  name?: string;
  command?: string;
  description?: string;
  tags?: string[];
  /** Empty string clears the status; omit the field to leave it untouched. */
  status?: string;
  aliasType?: AliasType;
  setup?: Record<string, string>;
  script?: Record<string, string>;
  toolId?: string;
  executionOrder?: number;
  shim?: boolean;
  favorite?: boolean;
}

// Alias shim (real launcher files) status & operations
export interface ShimStatus {
  dir: string;
  onPath: boolean;
  count: number;
  names: string[];
}

export interface ShimSyncReport {
  written: string[];
  removed: string[];
}

export type ShimInstallOutcome =
  | { status: 'added' }
  | { status: 'alreadyPresent' }
  | { status: 'manual'; instruction: string };

// ============================================================================
// Agents (beta) — DEV-11. Types mirror the Rust structs (camelCase / kebab-case enums).
// ============================================================================

export type AgentProvider = 'claude-code' | 'codex';
export type AgentState = 'running' | 'waiting' | 'stopped' | 'unknown';
export type AgentTitleSource = 'custom' | 'auto' | 'first-prompt';

export interface AgentAnnotations {
  customName?: string;
  tags: string[];              // reuse existing tag definitions
  status?: string;             // reuse existing status definitions (free label)
  pinned: boolean;
  hidden: boolean;
  notes?: string;
  projectIdOverride?: string;  // forces project attachment
  updatedAt: string;
}

export interface AgentSession {
  id: string;                  // Claude sessionId (uuid) | Codex thread id
  provider: AgentProvider;
  title: string;               // custom-title/customName > ai-title/codex title > first prompt (truncated 80 chars)
  titleSource: AgentTitleSource;
  cwd: string;                 // normalized absolute path, no `\\?\` prefix
  projectId?: string;          // resolved by longest-prefix match against Project.rootPath, or annotations.projectIdOverride
  gitBranch?: string;
  state: AgentState;
  pid?: number;
  kind?: string;               // 'interactive' | 'background' | 'exec' | ...
  startedAt: string;
  lastActivityAt: string;
  lastUserPrompt?: string;     // single line, max 200 chars
  lastAssistantText?: string;  // single line, max 200 chars
  currentTool?: string;        // last tool_use without tool_result (Claude), e.g. "Bash" or "Edit"
  messageCount: number;
  subagentCount: number;
  model?: string;
  version?: string;            // CLI version
  transcriptPath: string;
  ticketRefs: string[];        // regex [A-Z]{2,}-\d+ and #\d+ found in title / first prompt, deduped
  annotations: AgentAnnotations;
}

export type AgentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolId: string; name: string; input: unknown }
  | { type: 'tool-result'; toolId: string; name?: string; output: string; isError: boolean }
  | { type: 'attachment'; description: string };

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: string;
  parts: AgentPart[];
  isSidechain: boolean;
}

export interface AgentTranscriptPage {
  sessionId: string;
  messages: AgentMessage[];    // chronological order
  totalMessages: number;
  offset: number;              // index of messages[0] in the full transcript
  hasMore: boolean;            // true if offset > 0 (older messages exist)
}

export interface AgentProviderHealth {
  provider: AgentProvider;
  enabled: boolean;
  detected: boolean;           // root dir exists
  rootPath: string;
  version?: string;
  sessionCount: number;
  liveCount: number;
  unreadableCount: number;
  liveSupported: boolean;      // true for claude-code, false for codex
}

export interface AgentsHealth {
  providers: AgentProviderHealth[];
  indexing: boolean;
  lastScanAt?: string;
}

// AppSettings gets a new field `agents` (Rust: #[serde(default)] pub agents: AgentsSettings)
export interface AgentsSettings {
  claudeConfigDir?: string;        // default: ~/.claude  (empty/undefined => default)
  codexHome?: string;              // default: ~/.codex
  claudeEnabled: boolean;          // default true
  codexEnabled: boolean;           // default true
  codexLiveThresholdMinutes: number; // default 5 — Codex thread updated within N min => 'running' (best effort), else 'stopped'
  recentDays: number;              // default 7 — UI default filter for finished sessions
}

export interface ListAgentSessionsOptions {
  sinceDays?: number | null;   // null/undefined => all. Running/waiting sessions are ALWAYS included regardless of age
  includeHidden?: boolean;     // default false
}

export interface AgentTranscriptQuery {
  end?: number | null;         // exclusive end index; null => totalMessages
  limit: number;               // e.g. 50
}

// ---------------------------------------------------------------------------
// Terminal themes (data/terminal/themes/*.yaml, Warp's format) — DEV-13 P3.
// Field names mirror the YAML (snake_case) so a file round-trips unchanged.
// ---------------------------------------------------------------------------

export type TerminalThemeDetails = 'darker' | 'lighter';
export type TerminalThemeImageFit = 'cover' | 'contain' | 'tile' | 'center';
export type TerminalThemeSource = 'bundled' | 'user';

export interface TerminalAnsiColors {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
}

export interface TerminalThemeImage {
  /** Absolute path once read through `getTerminalTheme` (bare file name on disk). */
  path: string;
  /** Percent, Warp semantics. Missing = 100. */
  opacity?: number | null;
}

/**
 * Warp gradient stops: `top` / `bottom` for a `background`, `left` / `right`
 * for an `accent` (a few themes set both pairs on the background). The
 * matching flat colour (`background` / `accent`) is always filled in with the
 * blend of the stops, for anything that takes a single colour.
 */
export interface TerminalThemeGradient {
  top?: string | null;
  bottom?: string | null;
  left?: string | null;
  right?: string | null;
}

/** CortX-only knobs under the `cortx:` key (ignored by Warp). */
export interface TerminalThemeCortxExt {
  cursor?: string | null;
  selection?: string | null;
  /** Wallpaper blur in px. */
  blur?: number | null;
  imageFit?: TerminalThemeImageFit | null;
}

export interface TerminalTheme {
  /** File stem — what the settings (`themeDark` / `themeLight`) refer to. */
  key: string;
  name: string;
  /** Always a single colour (the blend of the stops when there is a gradient). */
  background: string;
  background_gradient?: TerminalThemeGradient | null;
  accent: string;
  accent_gradient?: TerminalThemeGradient | null;
  foreground: string;
  details: TerminalThemeDetails;
  background_image?: TerminalThemeImage | null;
  terminal_colors: { normal: TerminalAnsiColors; bright: TerminalAnsiColors };
  cortx?: TerminalThemeCortxExt | null;
}

/** One card of the theme picker. */
export interface TerminalThemeSummary {
  key: string;
  name: string;
  background: string;
  backgroundGradient?: TerminalThemeGradient | null;
  accent: string;
  accentGradient?: TerminalThemeGradient | null;
  foreground: string;
  details: TerminalThemeDetails;
  hasImage: boolean;
  /** Wallpaper opacity in percent, as the theme file asks for it. */
  imageOpacity?: number | null;
  source: TerminalThemeSource;
  /** The 8 normal ANSI colours. */
  swatches: string[];
}

export interface TerminalThemeImportReport {
  imported: number;
  skipped: number;
  keys: string[];
}
