import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, FolderOpen, FileDown, Image as ImageIcon, Loader2, Moon, Sun, Trash2 } from 'lucide-react';
import { ask, open } from '@tauri-apps/plugin-dialog';
import { exists } from '@tauri-apps/plugin-fs';
import { dataDir, homeDir, join } from '@tauri-apps/api/path';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { useTerminalThemeStore, type ThemeSlot } from '@/stores/terminalThemeStore';
import { isAppDark, resolveActiveThemeName, themeSlotForMode } from '@/lib/terminalTheme';
import { cn } from '@/lib/utils';
import type { TerminalThemeSummary } from '@/types';

/** Colour strip of one theme: canvas + accent dot, then the 8 ANSI colours. */
export function ThemeSwatches({ theme, className }: { theme: TerminalThemeSummary; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)} aria-hidden>
      <span
        className="grid size-6 place-items-center rounded-[6px] border border-border-strong"
        style={{ background: theme.background }}
      >
        <span className="size-2.5 rounded-full" style={{ background: theme.accent }} />
      </span>
      <span className="flex gap-px overflow-hidden rounded-[4px]">
        {theme.swatches.map((c, i) => (
          <span key={i} className="block h-3 w-2" style={{ background: c }} />
        ))}
      </span>
    </span>
  );
}

/** Where Warp keeps its themes on this machine, when the folder exists. */
async function guessWarpThemesDir(): Promise<string | undefined> {
  try {
    const ua = navigator.userAgent;
    let dir: string;
    if (/Windows/i.test(ua)) {
      dir = await join(await dataDir(), 'warp', 'Warp', 'data', 'themes');
    } else if (/Mac/i.test(ua)) {
      dir = await join(await homeDir(), '.warp', 'themes');
    } else {
      dir = await join(await homeDir(), '.local', 'share', 'warp-terminal', 'themes');
    }
    return (await exists(dir)) ? dir : undefined;
  } catch {
    return undefined;
  }
}

interface ThemePickerProps {
  /**
   * Called instead of saving the settings when the host owns them (the
   * Settings page). `slot` is the settings field the choice belongs to.
   */
  onChoose?: (key: string, slot: ThemeSlot) => void;
}

/**
 * Theme picker (Ctrl+K "Change theme", or the `cortx:open-theme-picker`
 * event): searchable list with swatches, live preview while navigating,
 * Enter applies, Esc reverts. Reads/writes `useTerminalThemeStore`.
 */
export function ThemePicker({ onChoose }: ThemePickerProps) {
  const open_ = useTerminalThemeStore((s) => s.pickerOpen);
  const themes = useTerminalThemeStore((s) => s.themes);
  const loading = useTerminalThemeStore((s) => s.loading);
  const setPreview = useTerminalThemeStore((s) => s.setPreview);
  const choose = useTerminalThemeStore((s) => s.choose);
  const closePicker = useTerminalThemeStore((s) => s.closePicker);
  const importFile = useTerminalThemeStore((s) => s.importFile);
  const importFolder = useTerminalThemeStore((s) => s.importFolder);
  const remove = useTerminalThemeStore((s) => s.remove);
  const settings = useAppStore((s) => s.settings);

  const dark = isAppDark(settings);
  const slot = themeSlotForMode(settings?.terminal, dark);
  const activeKey = resolveActiveThemeName(settings?.terminal, dark);

  const [value, setValue] = useState(activeKey);
  const [busy, setBusy] = useState(false);

  // Start on the active theme each time the picker opens.
  useEffect(() => {
    if (open_) setValue(activeKey);
  }, [open_, activeKey]);

  const highlighted = useMemo(() => themes.find((t) => t.key === value) ?? null, [themes, value]);
  const bundled = useMemo(() => themes.filter((t) => t.source === 'bundled'), [themes]);
  const imported = useMemo(() => themes.filter((t) => t.source !== 'bundled'), [themes]);

  const onHighlight = useCallback(
    (key: string) => {
      setValue(key);
      if (open_) void setPreview(key);
    },
    [open_, setPreview]
  );

  const onOpenChange = (next: boolean) => {
    if (!next) closePicker();
  };

  const doImportFile = async () => {
    setBusy(true);
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        title: 'Import a Warp theme',
        defaultPath: await guessWarpThemesDir(),
        filters: [{ name: 'Warp theme', extensions: ['yaml', 'yml'] }],
      });
      if (typeof picked !== 'string') return;
      const theme = await importFile(picked);
      if (theme) onHighlight(theme.key);
    } finally {
      setBusy(false);
    }
  };

  const doImportFolder = async () => {
    setBusy(true);
    try {
      const picked = await open({
        multiple: false,
        directory: true,
        title: 'Import every Warp theme in a folder',
        defaultPath: await guessWarpThemesDir(),
      });
      if (typeof picked !== 'string') return;
      await importFolder(picked);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!highlighted || highlighted.source === 'bundled') return;
    const ok = await ask(`Delete the theme "${highlighted.name}"? Its file and wallpaper are removed.`, {
      title: 'Delete theme',
      kind: 'warning',
      okLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    if (!ok) return;
    setBusy(true);
    try {
      if (await remove(highlighted.key)) onHighlight(activeKey);
    } finally {
      setBusy(false);
    }
  };

  const renderItem = (t: TerminalThemeSummary) => (
    <CommandItem key={t.key} value={t.key} keywords={[t.name, t.source]} onSelect={() => void choose(t.key, onChoose)}>
      <ThemeSwatches theme={t} />
      <span className="min-w-0 flex-1 truncate">{t.name}</span>
      {t.hasImage && <ImageIcon className="size-3.5" aria-label="Has a wallpaper" />}
      {t.details === 'lighter' ? (
        <Sun className="size-3.5" aria-label="Light theme" />
      ) : (
        <Moon className="size-3.5" aria-label="Dark theme" />
      )}
      {t.key === activeKey && <Check className="size-3.5 !text-primary" aria-label="Current theme" />}
    </CommandItem>
  );

  return (
    <Dialog open={open_} onOpenChange={onOpenChange}>
      <DialogContent className="top-[14%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Terminal theme</DialogTitle>
        <DialogDescription className="sr-only">
          Pick a theme for the terminal. Arrow keys preview, Enter applies, Escape reverts.
        </DialogDescription>
        <Command
          value={value}
          onValueChange={onHighlight}
          className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:size-4 [&_[cmdk-input]]:h-12"
        >
          <CommandInput placeholder="Search themes…" />
          <CommandList className="max-h-[min(52vh,420px)]">
            {loading && themes.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-faint">
                <Loader2 className="size-3.5 animate-spin" />
                Loading themes…
              </div>
            ) : (
              <CommandEmpty>No theme matches.</CommandEmpty>
            )}
            {bundled.length > 0 && <CommandGroup heading="Bundled">{bundled.map(renderItem)}</CommandGroup>}
            {imported.length > 0 && <CommandGroup heading="Imported">{imported.map(renderItem)}</CommandGroup>}
          </CommandList>
        </Command>
        <div className="flex items-center gap-1.5 border-t border-border px-2 py-2">
          <Button variant="ghost" size="xs" onClick={() => void doImportFile()} disabled={busy}>
            <FileDown />
            Import file…
          </Button>
          <Button variant="ghost" size="xs" onClick={() => void doImportFolder()} disabled={busy}>
            <FolderOpen />
            Import folder…
          </Button>
          {highlighted && highlighted.source !== 'bundled' && (
            <Button variant="ghost" size="xs" className="text-destructive" onClick={() => void doDelete()} disabled={busy}>
              <Trash2 />
              Delete
            </Button>
          )}
          <span className="ml-auto flex items-center gap-2 text-[10.5px] text-faint">
            <span>
              <span className="kbd">↑↓</span> preview
            </span>
            <span>
              <span className="kbd">Enter</span> use as {slot === 'themeDark' ? 'dark' : 'light'} theme
            </span>
            <span>
              <span className="kbd">Esc</span> revert
            </span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
