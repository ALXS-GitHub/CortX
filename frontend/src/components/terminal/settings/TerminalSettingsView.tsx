/**
 * The Terminal window's own settings, full space (ticket #27).
 *
 * They used to open in a `Dialog` — 860 px wide over a 1600 px window, with
 * the cards squeezed into a column barely wider than the Settings page's own.
 * The terminal is where terminal preferences belong (Warp does the same), so
 * they now take the whole content area of the window: the rail, the tab strip
 * and the title bar stay, the tree of terminals is what gets replaced.
 *
 * **Not a tab.** A tab that holds no terminal would open the whole tab model
 * (split tree, `sessions.json`, drag, detach, Ctrl+N numbering). This is a
 * panel the window swaps in, and the tab list is untouched — see
 * `TerminalWindow.tsx`, which owns the open/closed state, hides the tree
 * rather than unmounting it, and re-fits the panes on the way back.
 *
 * **One source of settings.** The cards are `TerminalSettingsSections`, the
 * very list the main window's Settings page mounts; every one of them reads
 * and writes `settings.terminal` through the app store. Nothing is duplicated
 * here — this file is chrome only.
 *
 * **Colours.** This is an opaque chrome surface laid over the terminal, not a
 * layer among its cells, so it uses the app's tokens like the command-history
 * view does (`components/terminal/history/`). The one thing it cannot take
 * from the app is its background: in a themed window `--background` is
 * `transparent` on purpose, so the wallpaper shows through everything — hence
 * `--terminal-window-solid`, the theme's own opaque colour, with the app's
 * canvas as the fallback for an unthemed window. `--card` sits a hair above
 * it, which is exactly the contrast the cards need. Nothing here derives a
 * colour from `--accent` / `--primary`.
 */
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Search, SlidersHorizontal, X } from 'lucide-react';
import { emit } from '@tauri-apps/api/event';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { showMainWindow } from '@/lib/tauri';
import { TerminalSettingsSections } from './TerminalSettingsPanel';

/** Send the main window to its Settings page, on the Terminal tab. */
async function openSettingsPage(): Promise<void> {
  await showMainWindow();
  await emit('cortx-open-settings', { section: 'terminal' }).catch(() => {});
}

export interface TerminalSettingsViewProps {
  /** Close the panel and give the terminals the space back. */
  onClose: () => void;
}

export function TerminalSettingsView({ onClose }: TerminalSettingsViewProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // The Escape listener is installed once and must not be rebuilt whenever the
  // parent hands down a new closure, so it reads the callback through a ref.
  // Written in an effect, not during render: a render can be thrown away.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Take the keyboard off the terminal. The hidden pane's textarea loses
  // focus by itself when its box goes away, but "focus lands on the body" is
  // not the same as "the search field is ready", and the field is what the
  // user is here for.
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

  const q = query.trim().toLowerCase();

  return (
    <section
      aria-label="Terminal settings"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      // See the module header: the app canvas is transparent in a themed
      // window, and this panel must not show the wallpaper.
      style={{ background: 'var(--terminal-window-solid, var(--background))' }}
    >
      <header className="flex shrink-0 flex-col gap-3 border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <SlidersHorizontal className="mt-0.5 size-4 shrink-0 text-faint" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-sm font-semibold tracking-tight">Terminal settings</h2>
            <p className="text-xs text-muted-foreground">
              The same settings as CortX › Settings › Terminal, saved to the same file. Changes show up in the other
              window straight away.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void openSettingsPage()}>
            <ExternalLink />
            Open in CortX
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close settings (Esc)" aria-label="Close settings">
            <X />
          </Button>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter these settings…"
            className="pl-9"
            aria-label="Filter terminal settings"
          />
        </div>
      </header>
      <div className="settings-sections min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {/* Full height, and wider than the dialog ever was — but a settings
            row whose label and control sit 1600 px apart is unreadable, so
            the column stops at a comfortable width and centres. */}
        <div className="mx-auto w-full max-w-5xl space-y-5">
          <TerminalSettingsSections
            query={q}
            empty={<p className="py-10 text-center text-sm text-muted-foreground">No setting matches “{query}”.</p>}
          />
        </div>
      </div>
    </section>
  );
}
