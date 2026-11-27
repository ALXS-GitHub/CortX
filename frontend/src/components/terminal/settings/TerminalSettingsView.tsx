/**
 * The Terminal window's own settings, full space (ticket #27).
 *
 * They used to open in a `Dialog`; the terminal is where terminal preferences
 * belong (Warp does the same), so they take the whole content area of the
 * window: the rail, the tab strip and the title bar stay, the tree of
 * terminals is what gets replaced.
 *
 * **Not a tab.** A tab that holds no terminal would open the whole tab model
 * (split tree, `sessions.json`, drag, detach, Ctrl+N numbering). This is a
 * panel the window swaps in, and the tab list is untouched — see
 * `TerminalWindow.tsx`, which owns the open/closed state, hides the tree
 * rather than unmounting it, and re-fits the panes on the way back.
 *
 * **One source of settings, one layout.** Since ticket #64 this is the same
 * list / detail layout as the main window's Settings screen
 * (`SettingsLayout`), restricted to the pages about the terminal: the
 * Terminal pages, Notifications and the terminal half of Agents. Every card
 * reads and writes `settings.terminal` through the app store. Nothing is
 * duplicated here — this file is chrome only.
 *
 * **Colours.** This is an opaque chrome surface laid over the terminal, not a
 * layer among its cells, so it uses the app's tokens like the command-history
 * view does (`components/terminal/history/`). The one thing it cannot take
 * from the app is its background: in a themed window `--background` is
 * `transparent` on purpose, so the wallpaper shows through everything — hence
 * `--terminal-window-solid`, the theme's own opaque colour, with the app's
 * canvas as the fallback for an unthemed window. Nothing here derives a colour
 * from `--accent` / `--primary`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Bot, ExternalLink, SlidersHorizontal, X } from 'lucide-react';
import { emit } from '@tauri-apps/api/event';
import { Button } from '@/components/ui/button';
import { SettingsLayout } from '@/components/settings/SettingsLayout';
import { readStoredPage, resolvePage, storePage, type SettingsPageDef } from '@/components/settings/settingsNav';
import { showMainWindow } from '@/lib/tauri';
import { TerminalPageAction, TerminalSettingsPage } from './TerminalSettingsPanel';
import { agentTerminalSections, notificationsPage, terminalSubPages } from './terminalPages';

const PAGE_KEY = 'cortx-terminal-settings-page';

/** Send the main window to its Settings screen. */
async function openSettingsPage(): Promise<void> {
  await showMainWindow();
  await emit('cortx-open-settings', { section: 'terminal' }).catch(() => {});
}

export interface TerminalSettingsViewProps {
  /** Close the panel and give the terminals the space back. */
  onClose: () => void;
}

export function TerminalSettingsView({ onClose }: TerminalSettingsViewProps) {
  const pages = useMemo<SettingsPageDef[]>(
    () => [
      ...terminalSubPages(),
      notificationsPage(Bell),
      {
        id: 'agents',
        title: 'Agents',
        description: 'How agents start and show in the terminal: the agent view, the prompt, the grid.',
        icon: Bot,
        beta: true,
        sections: agentTerminalSections(),
      },
    ],
    []
  );
  const [selected, setSelected] = useState(() => resolvePage(pages, readStoredPage(PAGE_KEY))?.id ?? '');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // The Escape listener is installed once and must not be rebuilt whenever the
  // parent hands down a new closure, so it reads the callback through a ref.
  // Written in an effect, not during render: a render can be thrown away.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Take the keyboard off the terminal: the search field is ready at once.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Escape closes, wherever the focus is inside the panel. Bubble phase on
  // purpose: a Radix layer (a Select, a popover) handles Escape in the
  // capture phase and marks the event handled, so its own dismissal never
  // closes the panel underneath it. `ShortcutsSection` grabs the whole
  // keyboard while it records a combo, in the capture phase too.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const titleOf = (id: string) => pages.find((p) => p.id === id)?.title ?? '';

  return (
    <section
      aria-label="Terminal settings"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      // See the module header: the app canvas is transparent in a themed
      // window, and this panel must not show the wallpaper.
      style={{ background: 'var(--terminal-window-solid, var(--background))' }}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <SlidersHorizontal className="size-4 shrink-0 text-faint" />
        <div className="min-w-0 flex-1">
          <h2 className="zn-section-title">Terminal settings</h2>
          <p className="truncate text-xs text-muted-foreground">
            The same settings as CortX › Settings, saved to the same file. Changes show in the other window at once.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void openSettingsPage()}>
          <ExternalLink />
          Open in CortX
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close settings (Esc)" aria-label="Close settings">
          <X />
        </Button>
      </header>
      <SettingsLayout
        className="flex-1"
        pages={pages}
        selected={selected}
        onSelect={(id) => {
          setSelected(id);
          storePage(PAGE_KEY, id);
        }}
        query={query}
        onQueryChange={setQuery}
        searchRef={searchRef}
        renderPage={(id) => <TerminalSettingsPage page={id} />}
        renderPageAction={(id) => <TerminalPageAction page={id} title={titleOf(id)} />}
      />
    </section>
  );
}
