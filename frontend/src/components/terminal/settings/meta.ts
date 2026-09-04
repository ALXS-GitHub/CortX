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
    'integrated terminal shell integration inline suggestions ghost font size line height weight letter spacing selection renderer tabs placement rail restore sessions scrollback close busy open in dock window processes dev sessions dock theme file path links clickable paths kitty graphics images tab display number cwd agent',
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
