/**
 * Terminal theme store (DEV-13 P3).
 *
 * Holds the theme list, the theme resolved from the settings for the
 * current light/dark mode, and a transient *preview* (picker navigation).
 * Whenever active/preview/settings/mode change it pushes the result to
 * xterm (`applyThemeToAll`) and — in the Terminal window — to the window
 * chrome (`applyWindowTheme`) and the native backdrop effect.
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

  /** (Re)load the theme list. */
  load: () => Promise<void>;
  /** Preview a theme live (`null` reverts to the active one). */
  setPreview: (key: string | null) => Promise<void>;
  /**
   * Make `key` the theme of the current mode. Saves the settings, unless
   * `onChoose` is given (the Settings page then owns the save).
   */
  choose: (key: string, onChoose?: (key: string, slot: ThemeSlot) => void) => Promise<void>;
  openPicker: () => void;
  /** Close the picker and drop the preview. */
  closePicker: () => void;
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
const internals: { apply: () => void; resolveActive: () => Promise<void> } = {
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
        look: { chromeOpacity: settings?.terminal.chromeOpacity, chromeBlur: settings?.terminal.chromeBlur },
      });
      syncWindowEffect(theme, settings?.terminal);
    }
    applyThemeToAll();
  };

  const resolveActive = async () => {
    if (!initialised) return;
    const settings = currentSettings();
    const key = resolveActiveThemeName(settings?.terminal, isAppDark(settings));
    if (get().activeTheme?.key === key) {
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

    choose: async (key, onChoose) => {
      const settings = currentSettings();
      const slot = themeSlotForMode(settings?.terminal, isAppDark(settings));
      const preview = get().previewTheme;
      previewSeq++;
      // Keep what is on screen as the active theme right away (no flash) —
      // only where the store drives the window; elsewhere (Settings page)
      // the saved settings decide.
      set({
        pickerOpen: false,
        previewTheme: null,
        activeTheme: initialised && preview?.key === key ? preview : get().activeTheme,
      });
      apply();
      if (onChoose) {
        onChoose(key, slot);
        return;
      }
      if (!settings) return;
      try {
        await useAppStore.getState().updateSettings({
          ...settings,
          terminal: { ...settings.terminal, [slot]: key },
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
