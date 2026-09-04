/**
 * The Terminal window's own settings (DEV-13 #8), so terminal preferences are
 * where the terminal is — like Warp — without a second copy of the data: the
 * cards inside are the ones the Settings page mounts, all bound to
 * `settings.terminal` through the app store.
 *
 * Opened from the Ctrl+K palette ("Terminal settings…") and from Ctrl+,.
 */
import { useEffect, useState } from 'react';
import { ExternalLink, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { showMainWindow } from '@/lib/tauri';
import { emit } from '@tauri-apps/api/event';
import { OPEN_TERMINAL_SETTINGS_EVENT } from './meta';
import { TerminalSettingsSections } from './TerminalSettingsPanel';
import { flushTerminalSettings } from './useTerminalSettings';

/** Send the main window to its Settings page, on the Terminal tab. */
async function openSettingsPage(): Promise<void> {
  await showMainWindow();
  await emit('cortx-open-settings', { section: 'terminal' }).catch(() => {});
}

export function TerminalSettingsDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_TERMINAL_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TERMINAL_SETTINGS_EVENT, onOpen);
  }, []);

  const handleOpenChange = (next: boolean) => {
    // The controls save on a short debounce; closing must not drop the last one.
    if (!next) flushTerminalSettings();
    setOpen(next);
  };

  const q = query.trim().toLowerCase();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[min(96vw,860px)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-faint" />
            Terminal settings
          </DialogTitle>
          <DialogDescription>
            The same settings as CortX › Settings › Terminal, saved to the same file. Changes show up in the other window
            straight away.
          </DialogDescription>
          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter these settings…"
                className="pl-9"
                aria-label="Filter terminal settings"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => void openSettingsPage()}>
              <ExternalLink />
              Open in CortX
            </Button>
          </div>
        </DialogHeader>
        <div className="settings-sections min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <TerminalSettingsSections
            query={q}
            empty={<p className="py-10 text-center text-sm text-muted-foreground">No setting matches “{query}”.</p>}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
