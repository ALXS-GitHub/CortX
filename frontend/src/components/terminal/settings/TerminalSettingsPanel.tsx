/**
 * The terminal settings pages (DEV-13 #8, ticket #64), by page id.
 *
 * The Settings screen of the main window and the Terminal window's panel
 * both render these, and every card inside reads and writes
 * `settings.terminal` through the app store — which persists `settings.json`.
 * A change made in one window reaches the other through the existing
 * `data-changed` file-watcher event, which reloads the settings there. There
 * is no second copy of the data anywhere.
 *
 * The page list itself (titles, cards, search words) is `terminalPages.ts`.
 */
import { LaunchConfigsSection } from '@/components/terminal/launch/LaunchConfigsSection';
import { AgentSettingsSection } from './AgentSettingsSection';
import { ExternalTerminalSection } from './ExternalTerminalSection';
import { ShortcutsSection } from './ShortcutsSection';
import { TerminalThemePage } from './TerminalAppearanceSection';
import { TerminalNotificationsSection } from './TerminalNotificationsSection';
import {
  TerminalBlocksPage,
  TerminalHistoryPage,
  TerminalInputPage,
  TerminalKeyboardPage,
  TerminalShellPage,
  TerminalTabsPage,
  TerminalTextPage,
} from './TerminalBehaviourPages';
import { ResetCard } from './controls';
import { TERMINAL_PAGE_CARD } from './terminalPages';
import { useTerminalSettings } from './useTerminalSettings';

function KeybindingsPage() {
  const { terminal, patch } = useTerminalSettings();
  return <ShortcutsSection value={terminal?.keybindings} onChange={(next) => patch({ keybindings: next })} />;
}

/** The cards of one terminal page (`terminalPages.ts` ids). Nothing for an unknown id. */
export function TerminalSettingsPage({ page }: { page: string }) {
  switch (page) {
    case 'terminal-shell':
      return <TerminalShellPage />;
    case 'terminal-text':
      return <TerminalTextPage />;
    case 'terminal-theme':
      return <TerminalThemePage />;
    case 'terminal-blocks':
      return <TerminalBlocksPage />;
    case 'terminal-input':
      return <TerminalInputPage />;
    case 'terminal-keyboard':
      return <TerminalKeyboardPage />;
    case 'terminal-tabs':
      return <TerminalTabsPage />;
    case 'terminal-history':
      return <TerminalHistoryPage />;
    case 'terminal-shortcuts':
      return <KeybindingsPage />;
    case 'terminal-external':
      return <ExternalTerminalSection />;
    case 'terminal-launch':
      return <LaunchConfigsSection />;
    case 'notifications':
      return <TerminalNotificationsSection />;
    case 'agents':
      return <AgentSettingsSection />;
    default:
      return null;
  }
}

/** "N changed" and its reset, for the heading of a terminal page. */
export function TerminalPageAction({ page, title }: { page: string; title: string }) {
  const card = TERMINAL_PAGE_CARD[page];
  return card ? <ResetCard card={card} title={title} /> : null;
}
