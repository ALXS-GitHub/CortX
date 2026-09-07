/**
 * Constants and plain functions shared by the terminal settings cards. Kept
 * out of the `.tsx` files so each of those only exports components (fast
 * refresh).
 */
import type { TerminalPreset } from '@/types';

export type Platform = 'windows' | 'macos' | 'linux';

export function getPlatform(): Platform {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac')) return 'macos';
  return 'linux';
}

/**
 * Monospace families worth suggesting for `terminal.fontFamily`, per platform
 * (issue 34).
 *
 * The list used to be the same everywhere and it was a Windows list: `Hack
 * NF`, `Hack NFM`, `Cascadia Code`, `Cascadia Mono`, `Consolas`. Not one of
 * those exists on a stock macOS or Linux machine, and CortX ships a `.dmg`,
 * a `.deb`, an `.rpm` and an `.AppImage` at every release — so on two of the
 * three platforms the suggestions were all invalid.
 *
 * `Hack NF` / `Hack NFM` are Nerd Fonts' *Windows Compatible* builds, whose
 * family names were shortened for the old 31-character limit; everywhere else
 * the same font installs as `Hack Nerd Font Mono`. The **Mono** variant is
 * the one to suggest: in the plain `Nerd Font` build the added glyphs are
 * double width and push a terminal's columns out of line.
 */
export const TERMINAL_FONT_SUGGESTIONS: Record<Platform, readonly string[]> = {
  windows: ['Cascadia Mono', 'Cascadia Code', 'Consolas', 'Hack NFM', 'Hack NF', 'JetBrains Mono'],
  macos: ['SF Mono', 'Menlo', 'Monaco', 'Hack Nerd Font Mono', 'JetBrains Mono'],
  linux: ['DejaVu Sans Mono', 'Liberation Mono', 'Hack Nerd Font Mono', 'JetBrains Mono'],
};

export const TERMINAL_PRESETS: {
  value: TerminalPreset;
  label: string;
  description: string;
  platforms: Platform[];
}[] = [
  {
    value: 'cortxterminal',
    label: 'CortX Terminal',
    description: "Services launched externally open in CortX's own Terminal window",
    platforms: ['windows', 'macos', 'linux'],
  },
  {
    value: 'windowsterminal',
    label: 'Windows Terminal',
    description: 'Modern Windows terminal with tabs and profiles',
    platforms: ['windows'],
  },
  {
    value: 'powershell',
    label: 'PowerShell',
    description: 'Windows PowerShell terminal',
    platforms: ['windows'],
  },
  {
    value: 'cmd',
    label: 'Command Prompt',
    description: 'Classic Windows command prompt (cmd.exe)',
    platforms: ['windows'],
  },
  {
    value: 'warp',
    label: 'Warp',
    description: 'Modern terminal with AI features (opens in working directory)',
    platforms: ['windows', 'macos'],
  },
  {
    value: 'macterminal',
    label: 'Terminal.app',
    description: 'Default macOS terminal',
    platforms: ['macos'],
  },
  {
    value: 'iterm2',
    label: 'iTerm2',
    description: 'Popular macOS terminal replacement',
    platforms: ['macos'],
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'Specify your own terminal executable and arguments',
    platforms: ['windows', 'macos', 'linux'],
  },
];

/** Search keywords of each terminal settings card, shared by both surfaces. */
export const TERMINAL_SECTION_KEYWORDS = {
  external:
    'terminal application external windows terminal powershell cmd warp custom path arguments cortx terminal preset',
  integrated:
    'integrated terminal shell integration inline suggestions ghost font size line height weight letter spacing selection renderer tabs placement rail restore sessions scrollback close busy open in dock window processes dev sessions dock theme file path links clickable paths kitty graphics images tab display number cwd agent completion menu flags subcommands git branches npm scripts input line position bottom pinned universal input editor blocks dividers gutter fold prompt navigation suggestions from output confidence ghost text smooth scrolling block spacing comfortable failed tint wash link tooltip hover target option meta alt key macos word keys dead keys azerty swiss font family missing not installed nerd font mono osc52 osc 52 clipboard access escape sequence tmux neovim yank write only read write deny security ssh',
  notifications:
    'terminal notifications notify toast system desktop long command failed exit code muted commands claude codex vim ssh hidden background password prompt',
  appearance:
    'terminal appearance theme picker wallpaper opacity blur dim cursor padding window opacity effect acrylic mica vibrancy chrome',
  shortcuts: 'terminal shortcuts keybindings keyboard combo copy on select shift enter smooth scroll keys selection',
  launch: 'terminal launch configurations dev session yaml tabs layout',
} as const;

/** DOM event the Terminal window listens to in order to show its settings panel. */
export const OPEN_TERMINAL_SETTINGS_EVENT = 'cortx:open-terminal-settings';

export function openTerminalSettingsPanel(): void {
  window.dispatchEvent(new CustomEvent(OPEN_TERMINAL_SETTINGS_EVENT));
}
