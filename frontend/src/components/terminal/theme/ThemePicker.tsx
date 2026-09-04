import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, FileDown, FolderSymlink, Loader2, Moon, Palette, Search, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { open } from '@tauri-apps/plugin-dialog';
import { exists } from '@tauri-apps/plugin-fs';
import { dataDir, homeDir, join } from '@tauri-apps/api/path';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Segmented } from '@/components/ui/Segmented';
import { ThemeCard } from '@/components/terminal/theme/ThemeCard';
import { openTerminalThemesDir } from '@/components/terminal/theme/themesDir';
import { useAppStore } from '@/stores/appStore';
import { useTerminalThemeStore, type ThemeSlot } from '@/stores/terminalThemeStore';
import {
  DEFAULT_THEME_DARK,
  DEFAULT_THEME_LIGHT,
  isAppDark,
  themeAccentCss,
  themeCanvasCss,
  themeSlotForMode,
} from '@/lib/terminalTheme';
import { cn } from '@/lib/utils';
import type { TerminalConfig, TerminalThemeSummary } from '@/types';

/** Colour strip of one theme: canvas + accent dot, then the 8 ANSI colours. */
export function ThemeSwatches({ theme, className }: { theme: TerminalThemeSummary; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)} aria-hidden>
      <span
        className="grid size-6 place-items-center rounded-[6px] border border-border-strong"
        style={{ background: themeCanvasCss(theme) }}
      >
        <span className="size-2.5 rounded-full" style={{ background: themeAccentCss(theme) }} />
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
  /** Same idea for the "follow the app mode" switch. */
  onFollowsChange?: (value: boolean) => void;
  /** The host's unsaved draft, when it owns the settings; else the saved ones. */
  config?: TerminalConfig;
}

/**
 * Theme picker (Ctrl+K "Change theme", or the `cortx:open-theme-picker`
 * event): a gallery of real previews — the theme's background (gradients
 * included), its wallpaper, a mock prompt in its ANSI colours — with the
 * **dark and light slots side by side** so both can be set in one go.
 *
 * Picking applies straight away and leaves the picker open (switch tab, set
 * the other mode, Esc / Done to leave). Hovering a card previews it live,
 * but only while the tab being edited is the one the current mode reads —
 * previewing a light theme over a dark window would say nothing useful.
 */
export function ThemePicker({ onChoose, onFollowsChange, config }: ThemePickerProps) {
  const open_ = useTerminalThemeStore((s) => s.pickerOpen);
  const themes = useTerminalThemeStore((s) => s.themes);
  const loading = useTerminalThemeStore((s) => s.loading);
  const setPreview = useTerminalThemeStore((s) => s.setPreview);
  const choose = useTerminalThemeStore((s) => s.choose);
  const closePicker = useTerminalThemeStore((s) => s.closePicker);
  const importFile = useTerminalThemeStore((s) => s.importFile);
  const importFolder = useTerminalThemeStore((s) => s.importFolder);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const cfg = config ?? settings?.terminal;
  const dark = isAppDark(settings);
  const follows = cfg?.themeFollowsApp ?? true;
  const activeSlot = themeSlotForMode(cfg, dark);
  const darkKey = cfg?.themeDark?.trim() || DEFAULT_THEME_DARK;
  const lightKey = cfg?.themeLight?.trim() || DEFAULT_THEME_LIGHT;

  const [target, setTarget] = useState<ThemeSlot>(activeSlot);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Each time the picker opens, edit the slot the current mode reads (read
  // through a ref: a mode flip while the picker is open must not move the tab
  // out from under the user).
  const activeSlotRef = useRef(activeSlot);
  activeSlotRef.current = activeSlot;
  useEffect(() => {
    if (open_) {
      setTarget(activeSlotRef.current);
      setQuery('');
    }
  }, [open_]);

  const chosenKey = target === 'themeDark' ? darkKey : lightKey;
  const otherKey = target === 'themeDark' ? lightKey : darkKey;
  /** Live preview only makes sense for the slot the window is showing. */
  const previews = target === activeSlot;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return themes;
    return themes.filter((t) => `${t.name} ${t.key} ${t.source}`.toLowerCase().includes(q));
  }, [themes, query]);
  const bundled = useMemo(() => filtered.filter((t) => t.source === 'bundled'), [filtered]);
  const imported = useMemo(() => filtered.filter((t) => t.source !== 'bundled'), [filtered]);

  const onHover = useCallback(
    (key: string) => {
      if (previews) void setPreview(key);
    },
    [previews, setPreview]
  );
  const onLeave = useCallback(() => {
    if (previews) void setPreview(null);
  }, [previews, setPreview]);

  const switchTarget = (slot: ThemeSlot) => {
    void setPreview(null);
    setTarget(slot);
  };

  const onOpenChange = (next: boolean) => {
    if (!next) closePicker();
  };

  const setFollows = (value: boolean) => {
    if (onFollowsChange) {
      onFollowsChange(value);
      return;
    }
    if (!settings) return;
    void updateSettings({ ...settings, terminal: { ...settings.terminal, themeFollowsApp: value } });
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
      if (theme) setQuery(theme.name);
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

  // Themes are plain files. Rather than a delete button on a card you are
  // one hover away from previewing, the picker opens the folder: renaming,
  // editing and deleting all happen there, and the watcher reflects it here
  // without a restart.
  const doOpenFolder = async () => {
    try {
      await openTerminalThemesDir();
    } catch (err) {
      toast.error('Could not open the themes folder', { description: String(err) });
    }
  };

  /** Arrow keys walk the gallery; the column count comes from the grid itself. */
  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'];
    if (!keys.includes(e.key)) return;
    const grid = gridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll<HTMLButtonElement>('[data-theme-card]'));
    const index = cards.findIndex((c) => c === document.activeElement);
    if (index < 0) return;
    e.preventDefault();
    const columns = Math.max(
      1,
      getComputedStyle(cards[index].parentElement?.parentElement ?? grid).gridTemplateColumns.split(' ').length
    );
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? columns : -columns;
    const next = cards[Math.min(cards.length - 1, Math.max(0, index + step))];
    next?.focus();
  };

  const section = (title: string, list: TerminalThemeSummary[]) =>
    list.length > 0 && (
      <div key={title} className="grid gap-2">
        <div className="eyebrow">{title}</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((t) => (
            <ThemeCard
              key={t.key}
              theme={t}
              selected={t.key === chosenKey}
              usedElsewhere={t.key === otherKey}
              onPick={() => void choose(t.key, target, onChoose)}
              onHover={() => onHover(t.key)}
              onLeave={onLeave}
            />
          ))}
        </div>
      </div>
    );

  return (
    <Dialog open={open_} onOpenChange={onOpenChange}>
      <DialogContent className="top-[8%] max-h-[84vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="flex flex-col gap-3 border-b border-border px-5 pt-5 pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <Palette className="size-4 text-faint" />
                Terminal theme
              </DialogTitle>
              <DialogDescription className="mt-1">
                Warp&apos;s YAML format. Pick the theme for each mode — the pictures below are the real thing.
              </DialogDescription>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground" htmlFor="picker-follows">
              <Switch id="picker-follows" checked={follows} onCheckedChange={setFollows} />
              Follow the app&apos;s mode
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              value={target}
              onChange={switchTarget}
              options={[
                { value: 'themeDark', label: 'Dark mode', icon: Moon },
                { value: 'themeLight', label: 'Light mode', icon: Sun },
              ]}
            />
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <Input
                autoFocus
                placeholder="Search themes…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 pl-9"
                aria-label="Search themes"
              />
            </div>
          </div>
          <p className="text-[11px] text-faint">
            {target === 'themeDark'
              ? follows
                ? 'Used while the app is in dark mode.'
                : 'Used all the time (the app mode is not followed).'
              : follows
                ? 'Used while the app is in light mode.'
                : 'Not used right now — turn "Follow the app’s mode" back on to use it.'}
          </p>
        </div>

        <div
          ref={gridRef}
          onKeyDown={onGridKeyDown}
          className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-4"
        >
          {loading && themes.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-faint">
              <Loader2 className="size-3.5 animate-spin" />
              Loading themes…
            </div>
          ) : filtered.length === 0 ? (
            <div className="grid place-items-center rounded-lg border border-dashed border-border-strong py-10 text-xs text-faint">
              No theme matches “{query}”.
            </div>
          ) : (
            <>
              {section('Bundled', bundled)}
              {section('Imported', imported)}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--footer-border)] bg-[var(--footer-bg)] px-5 py-3">
          <Button variant="ghost" size="xs" onClick={() => void doImportFile()} disabled={busy}>
            <FileDown />
            Import file…
          </Button>
          <Button variant="ghost" size="xs" onClick={() => void doImportFolder()} disabled={busy}>
            <FolderOpen />
            Import folder…
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void doOpenFolder()}
            title="Open data/terminal/themes — edit, rename or delete a theme there"
          >
            <FolderSymlink />
            Themes folder
          </Button>
          <span className="ml-auto flex items-center gap-2 text-[10.5px] text-faint">
            <span>Drop a .yaml in the themes folder and it shows up here.</span>
            <span>
              <span className="kbd">Esc</span> close
            </span>
          </span>
          <Button variant="outline" size="xs" onClick={closePicker}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
