/**
 * Constants and plain functions shared by the terminal settings cards. Kept
 * out of the `.tsx` files so each of those only exports components (fast
 * refresh).
 */
import type { TerminalBellStyle, TerminalConfig, TerminalPreset } from '@/types';

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
 *
 * `SF Mono` was in the macOS list and is gone (issue 49). The file is there —
 * `/System/Library/Fonts/SFNSMono.ttf` — but Apple does not publish the SF
 * families to web engines under their name, so a WKWebView never resolves
 * `SF Mono` and never will. The way to that typeface from a browser engine is
 * the `ui-monospace` generic, which CortX's default stack already contains:
 * leaving the field empty is what gets you SF Mono on a Mac. Suggesting the
 * name only produced "this font is not installed" on the one machine where
 * the font is certainly present.
 *
 * The two Nerd Font entries stay, with a caveat the settings card now spells
 * out: a WKWebView cannot see `~/Library/Fonts`, which is where Font Book
 * installs by default ("Install for: Me only"). The same font in
 * `/Library/Fonts` resolves immediately.
 */
export const TERMINAL_FONT_SUGGESTIONS: Record<Platform, readonly string[]> = {
  windows: ['Cascadia Mono', 'Cascadia Code', 'Consolas', 'Hack NFM', 'Hack NF', 'JetBrains Mono'],
  macos: ['Menlo', 'Monaco', 'Hack Nerd Font Mono', 'JetBrains Mono'],
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

// ---------------------------------------------------------------------------
// Bell (issue 11)
// ---------------------------------------------------------------------------

/**
 * What a `BEL` (`0x07`) does. Kept here rather than in `notificationPolicy`
 * because it is deliberately *not* part of that policy: `BEL` is a byte a
 * program sends to ask for attention, `OSC 133;D` is the shell reporting that
 * a command ended. Two events, so two channels — the bell never becomes a
 * toast or a desktop notification, only a flash of the pane it came from and,
 * at `audible`, a short tone. `lib/terminalSessions` closes the last gap by
 * dropping a bell that lands in the wake of a command the notification policy
 * is already going to announce, so a build that fails *and* rings is signalled
 * once.
 *
 * `visual` is the default: better than the nothing CortX did before, and it
 * surprises nobody.
 */
export const DEFAULT_BELL: TerminalBellStyle = 'visual';

export const BELL_OPTIONS: { value: TerminalBellStyle; label: string; hint: string }[] = [
  { value: 'off', label: 'Ignore it', hint: 'A bell does nothing, as it did before this setting existed.' },
  {
    value: 'visual',
    label: 'Flash the pane',
    hint: 'The default: the terminal that rang lights up for a quarter of a second — which says which one it was, something a sound cannot.',
  },
  {
    value: 'audible',
    label: 'Flash and beep',
    hint: 'The flash, plus a short tone. Audible from another window; heard for every bell, wherever it came from.',
  },
];

export function resolveBellStyle(cfg?: Partial<TerminalConfig> | null): TerminalBellStyle {
  return cfg?.bell ?? DEFAULT_BELL;
}

/** Search keywords of each terminal settings card, shared by both surfaces. */
export const TERMINAL_SECTION_KEYWORDS = {
  external:
    'terminal application external windows terminal powershell cmd warp custom path arguments cortx terminal preset',
  integrated:
    'integrated terminal shell integration inline suggestions ghost font size line height weight letter spacing selection renderer tabs placement rail restore sessions scrollback close busy open in dock window processes dev sessions file path links clickable paths kitty graphics images tab display number cwd agent completion menu flags subcommands git branches npm scripts input line position bottom pinned universal input editor blocks dividers gutter fold prompt navigation suggestions from output confidence ghost text smooth scrolling block spacing comfortable failed tint wash link tooltip hover target option meta alt key macos word keys dead keys azerty swiss font family missing not installed nerd font mono osc52 osc 52 clipboard access escape sequence tmux neovim yank write only read write deny security ssh scrollback lines kept buffer memory history block navigation trim markers ligatures font ligature calt fira code cascadia jetbrains arrow glyph ctrl tab behavior next tab recently used mru most recently used alt+tab alt tab switch tabs order stack hold ctrl cycle tabs previous tab accessibility screen reader voiceover nvda narrator minimum contrast ratio wcag aa aaa readable text legibility font installed all users library fonts font book',
  notifications:
    'terminal notifications notify toast system desktop long command failed exit code muted commands claude codex vim ssh hidden background password prompt bell BEL 0x07 visual flash audible beep sound ring attention',
  appearance:
    'terminal appearance theme picker wallpaper opacity blur dim cursor padding window opacity effect acrylic mica vibrancy chrome dock theme dock colours dock skin panes only whole dock inactive cursor unfocused pane split focus which pane',
  shortcuts: 'terminal shortcuts keybindings keyboard combo copy on select shift enter smooth scroll keys selection',
  launch: 'terminal launch configurations dev session yaml tabs layout',
} as const;

/** DOM event the Terminal window listens to in order to show its settings panel. */
export const OPEN_TERMINAL_SETTINGS_EVENT = 'cortx:open-terminal-settings';

export function openTerminalSettingsPanel(): void {
  window.dispatchEvent(new CustomEvent(OPEN_TERMINAL_SETTINGS_EVENT));
}
