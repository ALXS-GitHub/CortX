/**
 * Every terminal settings card, in one column (DEV-13 #8).
 *
 * The Settings page of the main window and the Terminal window's own dialog
 * both render this list, and every card inside reads and writes
 * `settings.terminal` through the app store — which persists `settings.json`.
 * A change made in one window reaches the other through the existing
 * `data-changed` file-watcher event, which reloads the settings there. There
 * is no second copy of the data anywhere.
 */
import type { ReactNode } from 'react';
import { LaunchConfigsSection } from '@/components/terminal/launch/LaunchConfigsSection';
import { TERMINAL_SECTION_KEYWORDS } from './meta';
import { ExternalTerminalSection } from './ExternalTerminalSection';
import { IntegratedTerminalSection } from './IntegratedTerminalSection';
import { ShortcutsSection } from './ShortcutsSection';
import { TerminalAppearanceSection } from './TerminalAppearanceSection';
import { TerminalNotificationsSection } from './TerminalNotificationsSection';
import { useTerminalSettings } from './useTerminalSettings';

function matches(keywords: string, query: string): boolean {
  return !query || keywords.includes(query);
}

export interface TerminalSettingsSectionsProps {
  /** Lower-cased search text; empty shows everything. */
  query?: string;
  /** Show the "launch configurations" card. */
  launchConfigs?: boolean;
  /** Show the external-terminal card (which program a service opens in). */
  externalTerminal?: boolean;
  /** Rendered when the query matches nothing. */
  empty?: ReactNode;
}

/**
 * The cards themselves, without any page chrome, so a host can lay them out
 * (the settings page adds its own spacing and tab filtering).
 */
export function TerminalSettingsSections({
  query = '',
  launchConfigs = true,
  externalTerminal = true,
  empty,
}: TerminalSettingsSectionsProps) {
  const { terminal, patch } = useTerminalSettings();
  const q = query.trim().toLowerCase();
  const k = TERMINAL_SECTION_KEYWORDS;

  const shown = [
    externalTerminal && matches(k.external, q),
    matches(k.integrated, q),
    matches(k.notifications, q),
    matches(k.appearance, q),
    matches(k.shortcuts, q),
    launchConfigs && matches(k.launch, q),
  ];
  if (!shown.some(Boolean)) return <>{empty}</>;

  return (
    <>
      {shown[0] && <ExternalTerminalSection />}
      {shown[1] && <IntegratedTerminalSection />}
      {shown[2] && <TerminalNotificationsSection />}
      {shown[3] && terminal && <TerminalAppearanceSection value={terminal} onChange={patch} />}
      {shown[4] && <ShortcutsSection value={terminal?.keybindings} onChange={(next) => patch({ keybindings: next })} />}
      {shown[5] && <LaunchConfigsSection />}
    </>
  );
}
