/**
 * The terminal settings as pages and cards (ticket #64).
 *
 * `terminalDefaults.ts` says which group every setting belongs to and which
 * page every group sits on; this file gives them their titles, descriptions
 * and search words, and turns them into the `SettingsPageDef`s both settings
 * surfaces navigate: the main window's Settings screen (where they sit under
 * "Terminal", plus Notifications and Agents) and the Terminal window's panel
 * (the same pages, nothing else).
 *
 * The search words of a card are its title, the labels of every setting in it
 * (from the defaults table, so a renamed setting is found under its new name
 * with nothing to update here) and the extra words below.
 */
import { SquareTerminal } from 'lucide-react';
import type { SettingsNavParent, SettingsPageDef, SettingsSectionDef } from '@/components/settings/settingsNav';
import { CARD_GROUPS, GROUP_KEYS, TERMINAL_SETTINGS, type CardId, type GroupId } from './terminalDefaults';

export interface TerminalGroupMeta {
  title: string;
  description?: string;
  /** Extra search words, on top of the title and the settings' labels. */
  keywords?: string;
}

export const TERMINAL_GROUPS: Record<GroupId, TerminalGroupMeta> = {
  shell: {
    title: 'Shell',
    description: 'What a new terminal runs, and how much it tells CortX.',
    keywords: 'pwsh powershell zsh bash nu command line osc 7 osc 133 cortx init',
  },
  sessions: {
    title: 'Sessions',
    description: 'What comes back when the Terminal window opens again, and what closing asks first.',
    keywords: 'restore reopen scrollback close busy running confirm',
  },
  targets: {
    title: 'Where things open',
    keywords: 'dock window services scripts dev sessions launch configurations target',
  },
  text: {
    title: 'Font',
    description: 'Applies to every terminal: the dock, the Terminal window and the grid.',
    keywords: 'font family size line height weight bold letter spacing ligatures renderer gpu webgl canvas dom nerd font',
  },
  accessibility: {
    title: 'Accessibility',
    keywords: 'contrast wcag screen reader voiceover nvda narrator readable',
  },
  theme: {
    title: 'Theme',
    description: "Themes use Warp's YAML format: import your Warp themes as they are.",
    keywords: 'theme picker warp yaml dark light mode follow app dock colours',
  },
  cursor: {
    title: 'Cursor and selection',
    keywords: 'cursor block bar underline blink unfocused pane padding selection colour color',
  },
  window: {
    title: 'Terminal window',
    description: 'The look of the Terminal window itself. The dock is part of the main window and has none of these.',
    keywords: 'opacity transparency acrylic mica vibrancy blur backdrop title bar rail chrome',
  },
  wallpaper: {
    title: 'Wallpaper',
    description: "Overrides of the theme's own wallpaper values. Only themes with a background image use them.",
    keywords: 'background image picture opacity blur dim fit cover contain tile',
  },
  blocks: {
    title: 'Command blocks',
    description: 'Each command and its output as one block, from the shell integration markers.',
    keywords: 'blocks overlay block layout warp spacing dividers gutter actions hover fold sticky pin jump failed tint cards',
  },
  completion: {
    title: 'Suggestions and completion',
    keywords: 'ghost text inline suggestions history completion menu ctrl space tab flags subcommands git branches npm scripts',
  },
  inputLine: {
    title: 'Input line',
    keywords: 'prompt input line bottom pinned editor universal input editor beta dead keys accents paste',
  },
  keys: {
    title: 'Keyboard',
    keywords: 'keys shift enter new line option alt meta macos azerty ctrl tab recently used mru',
  },
  mouse: {
    title: 'Mouse and links',
    keywords: 'copy on select selection clipboard smooth scrolling wheel file paths links clickable tooltip hover',
  },
  programs: {
    title: 'What programs may do',
    description: 'Escape sequences a program running in the terminal can send.',
    keywords: 'osc 52 osc52 clipboard tmux neovim ssh kitty graphics images sixel iterm2 security',
  },
  tabs: {
    title: 'Tabs',
    keywords: 'tabs rail tab strip sidebar top project follow cd working directory',
  },
  tabContents: {
    title: 'What a tab shows',
    description: 'The title is always there; everything around it is up to you.',
    keywords: 'tab directory cwd running command status agent activity colour bar number index',
  },
  scrollback: {
    title: 'Scrollback',
    keywords: 'scrollback lines buffer memory blocks navigation',
  },
  history: {
    title: 'Command history',
    description: 'The file behind the history view, Ctrl+R and the ghost text ranking.',
    keywords: 'history size cap megabytes mask secrets redact token password api key jsonl',
  },
  keybindings: {
    title: 'Keyboard shortcuts',
    keywords: 'shortcuts keybindings keyboard combo hotkey rebind',
  },
  external: {
    title: 'External terminal',
    keywords: 'external windows terminal powershell cmd warp iterm2 terminal app custom path arguments preset',
  },
  notifications: {
    title: 'Commands',
    description: 'When a finished command is worth interrupting you.',
    keywords: 'notify notification command failed long exit code muted commands claude codex vim ssh',
  },
  agentNotify: {
    title: 'Agents',
    keywords: 'agent claude codex needs you question permission done turn ended notify notification',
  },
  delivery: {
    title: 'Delivery',
    description: 'How a notification shows, for commands and agents alike.',
    keywords: 'toast system desktop both hidden out of sight foreground corner position top bottom',
  },
  bell: {
    title: 'Bell',
    keywords: 'bell bel 0x07 visual flash audible beep sound',
  },
  agentNew: {
    title: 'New agent',
    description: 'What New agent (Ctrl+Shift+A) and the palette start.',
    keywords: 'new agent launch command claude cc codex tui gui permission mode alias shim',
  },
  agentView: {
    title: 'Agent view',
    description: 'The GUI mode: a conversation view of Claude Code instead of its terminal interface.',
    keywords: 'gui conversation background font text size width line spacing',
  },
  agentPrompt: {
    title: 'Agent prompt',
    keywords: 'prompt bar ctrl g editor status bar bubble colour opacity',
  },
  grid: {
    title: 'Grid',
    description: 'Agent mode shows every terminal as a tile.',
    keywords: 'grid tiles agent mode rail hide interactive size text scale header',
  },
  agentColors: {
    title: 'Dot colours',
    description: "A family of their own: no shell, service or script dot uses them. Empty = CortX's colour.",
    keywords: 'colours colors dot working needs you done idle',
  },
};

/** The search side of a group. */
function groupSection(group: GroupId): SettingsSectionDef {
  const meta = TERMINAL_GROUPS[group];
  const labels = GROUP_KEYS[group].map((k) => TERMINAL_SETTINGS[k].label).join(' ');
  return { id: group, title: meta.title, keywords: `${meta.description ?? ''} ${labels} ${meta.keywords ?? ''}` };
}

/** A page made of terminal groups only. */
function groupsPage(card: CardId, id: string, title: string, description: string, parent?: SettingsNavParent): SettingsPageDef {
  return { id, title, description, parent, sections: CARD_GROUPS[card].map(groupSection) };
}

export const TERMINAL_PARENT: SettingsNavParent = { id: 'terminal', title: 'Terminal', icon: SquareTerminal, beta: true };

/** Page ids of the terminal pages, by the card id their "N changed" counts. */
export const TERMINAL_PAGE_CARD: Record<string, CardId> = {
  'terminal-shell': 'shell',
  'terminal-text': 'text',
  'terminal-theme': 'theme',
  'terminal-blocks': 'blocks',
  'terminal-input': 'input',
  'terminal-keyboard': 'keyboard',
  'terminal-tabs': 'tabs',
  'terminal-history': 'history',
  'terminal-shortcuts': 'shortcuts',
  'terminal-external': 'external',
  notifications: 'notifications',
  agents: 'agents',
};

/** The pages under "Terminal", in list order. */
export function terminalSubPages(opts: { externalTerminal?: boolean; launchConfigs?: boolean } = {}): SettingsPageDef[] {
  const P = TERMINAL_PARENT;
  const pages: SettingsPageDef[] = [
    groupsPage('shell', 'terminal-shell', 'Shell & sessions', 'The shell a new terminal runs, what comes back on start, and where things open.', P),
    groupsPage('text', 'terminal-text', 'Text', 'How the text of every terminal is drawn.', P),
    groupsPage('theme', 'terminal-theme', 'Theme & window', 'Colours, cursor, and the look of the Terminal window.', P),
    groupsPage('blocks', 'terminal-blocks', 'Blocks', 'Commands and their output as blocks you can copy, fold and jump between.', P),
    groupsPage('input', 'terminal-input', 'Input & completion', 'Ghost text, the completion menu and the line you type in.', P),
    groupsPage('keyboard', 'terminal-keyboard', 'Keyboard & mouse', 'What keys, the mouse and the programs inside a terminal may do.', P),
    groupsPage('tabs', 'terminal-tabs', 'Tabs', 'Where the tabs live and what each one shows.', P),
    groupsPage('history', 'terminal-history', 'History', 'How far back a terminal scrolls, and the command history file.', P),
    groupsPage('shortcuts', 'terminal-shortcuts', 'Shortcuts', 'Keyboard shortcuts of the Terminal window.', P),
  ];
  if (opts.externalTerminal !== false) {
    pages.push(
      groupsPage('external', 'terminal-external', 'External terminal', 'The program a service opens in when it is launched outside CortX.', P)
    );
  }
  if (opts.launchConfigs !== false) {
    pages.push({
      id: 'terminal-launch',
      title: 'Launch configurations',
      description: 'Presets that open a set of terminals in a project.',
      parent: P,
      sections: [{ id: 'launch', title: 'Launch configurations', keywords: 'dev session yaml tabs splits layout preset run' }],
    });
  }
  return pages;
}

/** The Notifications page (every notification, commands and agents). */
export function notificationsPage(icon?: SettingsPageDef['icon']): SettingsPageDef {
  return {
    ...groupsPage('notifications', 'notifications', 'Notifications', 'What finished commands and agents tell you, and how.'),
    icon,
  };
}

/** The terminal half of the Agents page: everything but the sources. */
export function agentTerminalSections(): SettingsSectionDef[] {
  return CARD_GROUPS.agents.map(groupSection);
}
