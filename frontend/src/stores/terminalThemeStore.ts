/**
 * Terminal theme store (DEV-13 P3).
 *
 * Holds the theme list, the theme resolved from the settings for the
 * current light/dark mode, and a transient *preview* (picker navigation).
 * Whenever active/preview/settings/mode change it pushes the result to
 * xterm (`applyThemeToAll`) and — in the Terminal window — to the window
 * chrome (`applyWindowTheme`) and the native backdrop effect.
 *
 * The themes folder is watched by the backend: a `.yaml` dropped in, edited
 * or imported (from either window) is broadcast as `terminal-themes-changed`
 * and picked up here — no restart, and both windows follow.
 *
 * Wire-up: call `initTerminalThemeStore({ windowChrome: true })` once from
 * the Terminal window (in an effect; it returns a disposer). Without init
 * the store still lists themes and previews palettes (Settings page), but
 * never touches the window chrome.
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import * as api from '@/lib/tauri';
import { useAppStore } from '@/stores/appStore';
import { useThemeStore } from '@/lib/theme';
import { applyThemeToAll } from '@/lib/terminalSessions';
import {
  DEFAULT_THEME_DARK,
  DEFAULT_THEME_LIGHT,
  OPEN_THEME_PICKER_EVENT,
  applyWindowTheme,
  clampOpacity,
  isAppDark,
  resolveActiveThemeName,
  setXtermThemeOverride,
  themeSlotForMode,
} from '@/lib/terminalTheme';
import type { TerminalConfig, TerminalTheme, TerminalThemeImportReport, TerminalThemeSummary } from '@/types';

export type ThemeSlot = 'themeDark' | 'themeLight';

interface TerminalThemeState {
  themes: TerminalThemeSummary[];
  loaded: boolean;
  loading: boolean;
  /** Theme resolved from the settings for the current mode (Terminal window only). */
  activeTheme: TerminalTheme | null;
  /** Transient theme shown while navigating the picker. */
  previewTheme: TerminalTheme | null;
  pickerOpen: boolean;
  /**
   * Bumped whenever the theme files change on disk. Anything holding a
   * cached asset (the wallpaper data URL) reloads when it moves.
   */
  assetVersion: number;

  /** (Re)load the theme list. */
  load: () => Promise<void>;
  /** Preview a theme live (`null` reverts to the active one). */
  setPreview: (key: string | null) => Promise<void>;
  /**
   * Make `key` the theme of `slot` (default: the slot the current mode
   * reads). Saves the settings, unless `onChoose` is given (the Settings
   * page then owns the save).
   */
  choose: (key: string, slot?: ThemeSlot, onChoose?: (key: string, slot: ThemeSlot) => void) => Promise<void>;
  openPicker: () => void;
  /** Close the picker and drop the preview. */
  closePicker: () => void;
  /**
   * A theme file changed on disk (watcher broadcast, any window): drop the
   * caches, relist, and re-resolve what is on screen.
   */
  refreshFromDisk: (keys?: string[]) => Promise<void>;
  importFile: (path: string) => Promise<TerminalTheme | null>;
  importFolder: (path: string) => Promise<TerminalThemeImportReport | null>;
  remove: (key: string) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** True once `initTerminalThemeStore({ windowChrome: true })` ran: theme the whole window. */
let chrome = false;
let initialised = false;
let previewSeq = 0;
let lastEffectKey = '';

const themeCache = new Map<string, Promise<TerminalTheme | null>>();
const imageCache = new Map<string, Promise<string | null>>();

function fetchTheme(key: string): Promise<TerminalTheme | null> {
  let p = themeCache.get(key);
  if (!p) {
    p = api.getTerminalTheme(key).catch((err) => {
      console.warn(`Terminal theme "${key}" could not be read:`, err);
      return null;
    });
    themeCache.set(key, p);
    // A miss (backend not ready during a dev restart, file being written…)
    // must not poison the cache: the next request asks again.
    p.then((theme) => {
      if (!theme) themeCache.delete(key);
    });
  }
  return p;
}

/** The theme's wallpaper as a data URL (cached per key; `null` = none). */
export function loadThemeImage(key: string): Promise<string | null> {
  let p = imageCache.get(key);
  if (!p) {
    p = api.readTerminalThemeImage(key).catch((err) => {
      console.warn(`Wallpaper of terminal theme "${key}" could not be read:`, err);
      return null;
    });
    imageCache.set(key, p);
    p.then((url) => {
      if (!url) imageCache.delete(key);
    });
  }
  return p;
}

function invalidate(key?: string) {
  if (key) {
    themeCache.delete(key);
    imageCache.delete(key);
  } else {
    themeCache.clear();
    imageCache.clear();
  }
}

function currentSettings() {
  return useAppStore.getState().settings;
}

/** Push the current (preview ?? active) theme to xterm and, when themed, the window. */
function syncWindowEffect(theme: TerminalTheme | null, cfg: TerminalConfig | undefined) {
  const effect = cfg?.windowEffect ?? 'none';
  const opacity = clampOpacity(cfg?.windowOpacity);
  const tint = theme?.background ?? null;
  const dark = theme ? theme.details !== 'lighter' : isAppDark(currentSettings());
  const key = [effect, opacity, tint, dark].join('|');
  if (key === lastEffectKey) return;
  lastEffectKey = key;
  api.setTerminalWindowEffect(effect, opacity, tint, dark).catch((err) => {
    console.warn('Terminal window effect not applied:', err);
  });
}

// Store-internal actions reachable from `initTerminalThemeStore` (declared
// before the store: the creator runs synchronously).
const internals: { apply: () => void; resolveActive: (force?: boolean) => Promise<void> } = {
  apply: () => {},
  resolveActive: async () => {},
};

export const useTerminalThemeStore = create<TerminalThemeState>()((set, get) => {
  const apply = () => {
    const { activeTheme, previewTheme } = get();
    const theme = previewTheme ?? activeTheme;
    const settings = currentSettings();
    // The Terminal window always paints with the theme; the main window's
    // dock only when asked (otherwise it keeps the app skin's palette).
    setXtermThemeOverride(chrome || settings?.terminal.dockUsesTerminalTheme ? theme : null);
    if (chrome) {
      applyWindowTheme(theme, {
        opacity: settings?.terminal.windowOpacity,
        dark: isAppDark(settings),
        look: {
          chromeOpacity: settings?.terminal.chromeOpacity,
          chromeBlur: settings?.terminal.chromeBlur,
          selectionColor: settings?.terminal.selectionColor,
        },
      });
      syncWindowEffect(theme, settings?.terminal);
    }
    applyThemeToAll();
  };

  let retries = 0;
  let retryTimer: number | null = null;
  /** `force`: refetch even when the key did not move (the file changed). */
  const resolveActive = async (force = false) => {
    if (!initialised) return;
    const settings = currentSettings();
    const key = resolveActiveThemeName(settings?.terminal, isAppDark(settings));
    if (!force && get().activeTheme?.key === key) {
      apply(); // opacity / effect may have changed
      return;
    }
    let theme = await fetchTheme(key);
    if (!theme && key !== DEFAULT_THEME_DARK && key !== DEFAULT_THEME_LIGHT) {
      theme = await fetchTheme(isAppDark(settings) ? DEFAULT_THEME_DARK : DEFAULT_THEME_LIGHT);
    }
    // Settings may have moved on while we were fetching.
    const now = resolveActiveThemeName(currentSettings()?.terminal, isAppDark(currentSettings()));
    if (now !== key) return;
    if (!theme) {
      // The backend was not ready (app start, dev restart, settings being
      // rewritten): keep whatever we had and keep trying — giving up would
      // leave the window with no theme and no wallpaper until a reload.
      retries += 1;
      const delay = Math.min(8000, 600 * retries);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void resolveActive();
      }, delay);
      return;
    }
    retries = 0;
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
    set({ activeTheme: theme });
    apply();
  };

  // Exposed to `initTerminalThemeStore` below.
  internals.apply = apply;
  internals.resolveActive = resolveActive;

  return {
    themes: [],
    loaded: false,
    loading: false,
    activeTheme: null,
    previewTheme: null,
    pickerOpen: false,
    assetVersion: 0,

    load: async () => {
      if (get().loading) return;
      set({ loading: true });
      try {
        const themes = await api.listTerminalThemes();
        set({ themes, loaded: true });
      } catch (err) {
        console.error('Failed to list terminal themes:', err);
        toast.error('Could not load the terminal themes', { description: String(err) });
      } finally {
        set({ loading: false });
      }
      await resolveActive();
    },

    setPreview: async (key) => {
      const seq = ++previewSeq;
      if (!key) {
        if (get().previewTheme) {
          set({ previewTheme: null });
          apply();
        }
        return;
      }
      if (get().previewTheme?.key === key) return;
      const theme = await fetchTheme(key);
      if (seq !== previewSeq) return; // superseded
      set({ previewTheme: theme });
      apply();
    },

    choose: async (key, slot, onChoose) => {
      const settings = currentSettings();
      const activeSlot = themeSlotForMode(settings?.terminal, isAppDark(settings));
      const target = slot ?? activeSlot;
      const preview = get().previewTheme;
      previewSeq++;
      // Keep what is on screen as the active theme right away (no flash) —
      // only where the store drives the window, and only when the slot being
      // set is the one the current mode reads (setting the *other* slot must
      // not repaint the window).
      const takesEffect = target === activeSlot;
      set({
        previewTheme: null,
        activeTheme: initialised && takesEffect && preview?.key === key ? preview : get().activeTheme,
      });
      apply();
      if (onChoose) {
        onChoose(key, target);
        return;
      }
      if (!settings) return;
      try {
        await useAppStore.getState().updateSettings({
          ...settings,
          terminal: { ...settings.terminal, [target]: key },
        });
      } catch (err) {
        toast.error('Could not save the theme', { description: String(err) });
        await resolveActive();
      }
    },

    openPicker: () => {
      if (!get().loaded && !get().loading) void get().load();
      set({ pickerOpen: true });
    },

    closePicker: () => {
      previewSeq++;
      const hadPreview = get().previewTheme !== null;
      set({ pickerOpen: false, previewTheme: null });
      if (hadPreview) apply();
    },

    refreshFromDisk: async (keys) => {
      if (keys && keys.length > 0) {
        for (const key of keys) invalidate(key);
      } else {
        invalidate();
      }
      set({ assetVersion: get().assetVersion + 1 });
      await get().load(); // relists, then re-resolves the active theme
      // The list is back; the theme objects themselves may have changed
      // under the same key (someone edited the file), so refetch them.
      const preview = get().previewTheme;
      if (preview) {
        const fresh = await fetchTheme(preview.key);
        if (fresh && get().previewTheme?.key === fresh.key) set({ previewTheme: fresh });
      }
      await resolveActive(true);
    },

    importFile: async (path) => {
      try {
        const theme = await api.importTerminalThemeFile(path);
        invalidate(theme.key);
        await get().load();
        toast.success(`Imported "${theme.name}"`);
        return theme;
      } catch (err) {
        toast.error('Import failed', { description: String(err) });
        return null;
      }
    },

    importFolder: async (path) => {
      try {
        const report = await api.importTerminalThemeFolder(path);
        invalidate();
        await get().load();
        if (report.imported === 0) {
          toast.info('No Warp theme found in that folder');
        } else {
          toast.success(`Imported ${report.imported} theme${report.imported > 1 ? 's' : ''}`, {
            description: report.skipped > 0 ? `${report.skipped} file(s) skipped (not themes)` : undefined,
          });
        }
        return report;
      } catch (err) {
        toast.error('Import failed', { description: String(err) });
        return null;
      }
    },

    remove: async (key) => {
      try {
        await api.deleteTerminalTheme(key);
      } catch (err) {
        toast.error('Could not delete the theme', { description: String(err) });
        return false;
      }
      invalidate(key);
      if (get().previewTheme?.key === key) {
        previewSeq++;
        set({ previewTheme: null });
      }
      if (get().activeTheme?.key === key) set({ activeTheme: null });
      await get().load();
      return true;
    },
  };
});

/** The theme currently on screen (preview wins over active). */
export function useCurrentTerminalTheme(): TerminalTheme | null {
  return useTerminalThemeStore((s) => s.previewTheme ?? s.activeTheme);
}

/**
 * Start resolving / applying themes. `windowChrome: true` (Terminal window)
 * themes the whole window; `false` only feeds the xterm palettes. Returns
 * a disposer that restores the app's own look.
 */
export function initTerminalThemeStore(opts: { windowChrome?: boolean } = {}): () => void {
  chrome = opts.windowChrome ?? false;
  initialised = true;
  lastEffectKey = '';
  const disposers: Array<() => void> = [];

  void useTerminalThemeStore.getState().load();

  // Settings: theme slots, follow-mode, opacity, effect, app light/dark.
  disposers.push(
    useAppStore.subscribe((state, prev) => {
      if (state.settings !== prev.settings) void internals.resolveActive();
    })
  );
  // A theme file dropped in the folder, imported (possibly from the other
  // window) or edited by hand: pick it up without a restart. The backend
  // broadcasts to every window, so both stay in sync.
  let stopThemeWatch: (() => void) | null = null;
  let watchDisposed = false;
  void api
    .onTerminalThemesChanged((keys) => {
      void useTerminalThemeStore.getState().refreshFromDisk(keys);
    })
    .then((un) => {
      if (watchDisposed) un();
      else stopThemeWatch = un;
    })
    .catch((err) => console.warn('Terminal theme watcher not listening:', err));
  disposers.push(() => {
    watchDisposed = true;
    stopThemeWatch?.();
  });
  // OS mode flips (when the app follows the system).
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onMq = () => void internals.resolveActive();
  mq.addEventListener('change', onMq);
  disposers.push(() => mq.removeEventListener('change', onMq));
  // The user's accent / radius are set inline by lib/theme; re-assert ours.
  disposers.push(
    useThemeStore.subscribe(() => {
      if (chrome) internals.apply();
    })
  );
  // The app bootstrap toggles `dark` from the settings; the theme's
  // `details` wins in a themed window.
  const root = document.documentElement;
  const observer = new MutationObserver(() => {
    if (!chrome) return;
    const { activeTheme, previewTheme } = useTerminalThemeStore.getState();
    const theme = previewTheme ?? activeTheme;
    if (!theme) return;
    const wantDark = theme.details !== 'lighter';
    if (root.classList.contains('dark') !== wantDark) root.classList.toggle('dark', wantDark);
  });
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  disposers.push(() => observer.disconnect());
  // `window.dispatchEvent(new CustomEvent('cortx:open-theme-picker'))`.
  const onOpen = () => useTerminalThemeStore.getState().openPicker();
  window.addEventListener(OPEN_THEME_PICKER_EVENT, onOpen);
  disposers.push(() => window.removeEventListener(OPEN_THEME_PICKER_EVENT, onOpen));

  return () => {
    for (const d of disposers) d();
    initialised = false;
    const wasChrome = chrome;
    chrome = false;
    useTerminalThemeStore.setState({ activeTheme: null, previewTheme: null, pickerOpen: false });
    setXtermThemeOverride(null);
    if (wasChrome) applyWindowTheme(null, { dark: isAppDark(currentSettings()) });
    applyThemeToAll();
  };
}

// Dev-only escape hatch for CDP-driven checks (see terminalSessions.ts).
if (import.meta.env.DEV) {
  (window as unknown as { __cortxThemeStore?: typeof useTerminalThemeStore }).__cortxThemeStore = useTerminalThemeStore;
}

// This module owns singleton state: the resolved theme, the wallpaper cache
// and the `initialised` flag that `initTerminalThemeStore` sets from an effect
// that only ever runs on mount. A hot update swaps the module while React
// keeps the old effect, so the new instance stays uninitialised: the window
// keeps its colours (already written on <html>) but loses its theme object,
// and with it the wallpaper — the "my background disappeared" bug. Reload.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
