/**
 * Terminal theme in the *dock* of the main window (ticket #38).
 *
 * The Terminal window rewrites the design tokens on `<html>`
 * (`applyWindowTheme`) because the theme owns the whole window there. The
 * dock cannot do that — it is one panel of a window whose other half is the
 * app — so the same tokens (`dockChromeTokens`) are set as an inline style on
 * the dock's root element instead, and they cascade down the panel and no
 * further. Anything the dock portals out of itself (dropdowns, tooltips,
 * dialogs) renders at `<body>` level and therefore keeps the app's look,
 * which is what you want: a menu belongs to the window it floats over.
 *
 * No wallpaper here on purpose. See the module comment in
 * `styles/terminal-dock.css` for the boundary treatment, which is the other
 * half of the job.
 */
import { useMemo, type CSSProperties } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useCurrentTerminalTheme } from '@/stores/terminalThemeStore';
import { dockChromeTokens, dockThemeMode } from '@/lib/terminalTheme';
import '@/styles/terminal-dock.css';

export interface DockTheme {
  /** True while the dock's chrome wears the terminal theme. */
  themed: boolean;
  /** Token overrides to spread on the dock's root element (`{}` when not themed). */
  style: CSSProperties;
}

const NOT_THEMED: DockTheme = { themed: false, style: {} };

/**
 * The terminal theme's tokens for the expanded dock, or nothing at all when
 * the setting says the dock keeps the app skin (or only its panes do).
 */
export function useDockTheme(): DockTheme {
  const theme = useCurrentTerminalTheme();
  const terminal = useAppStore((s) => s.settings?.terminal);
  const mode = dockThemeMode(terminal);
  const chromeOpacity = terminal?.chromeOpacity;
  const chromeBlur = terminal?.chromeBlur;
  const selectionColor = terminal?.selectionColor;

  return useMemo(() => {
    if (mode !== 'chrome' || !theme) return NOT_THEMED;
    return {
      themed: true,
      style: dockChromeTokens(theme, { chromeOpacity, chromeBlur, selectionColor }) as CSSProperties,
    };
  }, [mode, theme, chromeOpacity, chromeBlur, selectionColor]);
}
