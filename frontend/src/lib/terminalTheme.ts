/**
 * Terminal themes (DEV-13 P3): resolution, xterm palette, and the
 * whole-window chrome theming of the Terminal window.
 *
 * A theme (Warp's YAML, see `cortx_core::terminal::themes`) carries one
 * background, one accent, one foreground, 16 ANSI colours and a
 * `darker` / `lighter` hint. In the Terminal window the theme drives
 * *everything* the way Warp does: `applyWindowTheme` rewrites the design
 * tokens on `<html>` (canvas, cards, glass, borders, text, accent) so the
 * title bar, the sessions rail, the panes and every popover follow it. The
 * xterm palette is derived from the same object (`themeToXterm`).
 *
 * Transparency: the Terminal window is created transparent. The window
 * background is painted by `.terminal-window-root` with the theme colour at
 * `--terminal-window-alpha` (the "window opacity" setting); the wallpaper
 * layer sits above it and the xterm canvases are see-through, so opacity,
 * wallpaper and acrylic / mica all compose like in Warp.
 */
import type { ITheme } from '@xterm/xterm';
import type { AppSettings, TerminalConfig, TerminalTheme } from '@/types';
import { accentForeground, bootstrapThemeStyle } from '@/lib/theme';

export const DEFAULT_THEME_DARK = 'dark-modern';
export const DEFAULT_THEME_LIGHT = 'light-modern';

/** `window.dispatchEvent(new CustomEvent(OPEN_THEME_PICKER_EVENT))` opens the picker. */
export const OPEN_THEME_PICKER_EVENT = 'cortx:open-theme-picker';

/** Class set on `<html>` while the Terminal window is themed. */
export const WINDOW_THEME_CLASS = 'terminal-window';

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Light / dark mode of the *app* (settings + OS), independent of any theme override on `<html>`. */
export function isAppDark(settings: AppSettings | null | undefined): boolean {
  const mode = settings?.appearance.theme ?? 'system';
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Which settings slot the current mode reads (and the picker writes). */
export function themeSlotForMode(terminal: TerminalConfig | undefined, isDark: boolean): 'themeDark' | 'themeLight' {
  if (terminal?.themeFollowsApp === false) return 'themeDark';
  return isDark ? 'themeDark' : 'themeLight';
}

/** Theme key to use for the mode; bundled defaults when nothing is set. */
export function resolveActiveThemeName(terminal: TerminalConfig | undefined, isDark: boolean): string {
  const slot = themeSlotForMode(terminal, isDark);
  const chosen = terminal?.[slot]?.trim();
  if (chosen) return chosen;
  return slot === 'themeDark' ? DEFAULT_THEME_DARK : DEFAULT_THEME_LIGHT;
}

export function clampOpacity(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 100;
  return Math.min(100, Math.max(50, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Colour maths (hex only — the theme format guarantees hex)
// ---------------------------------------------------------------------------

export type Rgba = [number, number, number, number];

export function parseHex(hex: string): Rgba | null {
  const h = hex.trim().replace(/^#/, '');
  const full =
    h.length === 3 || h.length === 4
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  if (full.length !== 6 && full.length !== 8) return null;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return null;
  if (full.length === 6) return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  return [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, (n & 255) / 255];
}

function toHex([r, g, b]: Rgba): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

/** `rgba()` string of a hex colour with a new alpha. */
export function rgba(hex: string, alpha: number): string {
  const c = parseHex(hex) ?? [128, 128, 128, 1];
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** Linear mix of two hex colours (`t` = share of `b`), as hex. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a) ?? [0, 0, 0, 1];
  const cb = parseHex(b) ?? [0, 0, 0, 1];
  const k = Math.max(0, Math.min(1, t));
  return toHex([ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k, 1]);
}

// ---------------------------------------------------------------------------
// xterm palette
// ---------------------------------------------------------------------------

export function themeCursor(theme: TerminalTheme): string {
  return theme.cortx?.cursor ?? theme.foreground;
}

export function themeSelection(theme: TerminalTheme): string {
  return theme.cortx?.selection ?? rgba(theme.foreground, 0.25);
}

/**
 * xterm `ITheme` for a theme. With `transparentBackground` the canvas is
 * see-through (the window root paints the colour, wallpaper on top).
 */
export function themeToXterm(theme: TerminalTheme, opts: { transparentBackground?: boolean } = {}): ITheme {
  const { normal, bright } = theme.terminal_colors;
  const selection = themeSelection(theme);
  return {
    background: opts.transparentBackground ? rgba(theme.background, 0) : theme.background,
    foreground: theme.foreground,
    cursor: themeCursor(theme),
    cursorAccent: theme.background,
    selectionBackground: selection,
    selectionInactiveBackground: theme.cortx?.selection ? selection : rgba(theme.foreground, 0.15),
    black: normal.black,
    red: normal.red,
    green: normal.green,
    yellow: normal.yellow,
    blue: normal.blue,
    magenta: normal.magenta,
    cyan: normal.cyan,
    white: normal.white,
    brightBlack: bright.black,
    brightRed: bright.red,
    brightGreen: bright.green,
    brightYellow: bright.yellow,
    brightBlue: bright.blue,
    brightMagenta: bright.magenta,
    brightCyan: bright.cyan,
    brightWhite: bright.white,
  };
}

// The theme every xterm session should use (set by the theme store; null =
// derive from the app's CSS tokens as before).
let xtermOverride: TerminalTheme | null = null;

export function setXtermThemeOverride(theme: TerminalTheme | null): void {
  xtermOverride = theme;
}

export function getXtermThemeOverride(): TerminalTheme | null {
  return xtermOverride;
}

// ---------------------------------------------------------------------------
// Window chrome
// ---------------------------------------------------------------------------

let windowThemeActive = false;

/** True while `applyWindowTheme` has a theme applied to `<html>` (Terminal window only). */
export function isWindowThemeActive(): boolean {
  return windowThemeActive;
}

const CHROME_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--theme-primary',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--border',
  '--border-strong',
  '--input',
  '--ring',
  '--text-faint',
  '--accent-border',
  '--bg-sidebar',
  '--bg-glass',
  '--bg-input',
  '--bg-terminal',
  '--terminal-fg',
  '--tab-active-bg',
  '--btn-outline-bg',
  '--canvas-wash',
  '--terminal-window-bg',
  '--terminal-window-alpha',
  '--terminal-selection',
  '--terminal-cursor',
] as const;

/** The design tokens a theme maps to (also used by the settings preview strip). */
export function chromeTokens(theme: TerminalTheme, opacity = 100): Record<string, string> {
  const dark = theme.details !== 'lighter';
  const bg = theme.background;
  const fg = theme.foreground;
  const ac = theme.accent;
  const alpha = clampOpacity(opacity) / 100;
  // Surfaces lift towards white on both sides: a dark theme's card is a hair
  // lighter than the canvas, a light theme's card is nearly white.
  const card = dark ? mix(bg, '#ffffff', 0.06) : mix(bg, '#ffffff', 0.45);
  return {
    '--background': 'transparent',
    '--foreground': fg,
    '--card': card,
    '--card-foreground': fg,
    '--popover': rgba(card, 0.94),
    '--popover-foreground': fg,
    '--primary': ac,
    '--primary-foreground': accentForeground(ac),
    '--theme-primary': ac,
    '--secondary': mix(bg, fg, 0.1),
    '--secondary-foreground': fg,
    '--muted': mix(bg, fg, 0.08),
    '--muted-foreground': mix(fg, bg, 0.35),
    '--accent': rgba(ac, dark ? 0.18 : 0.14),
    '--accent-foreground': fg,
    '--border': rgba(fg, 0.12),
    '--border-strong': rgba(fg, 0.2),
    '--input': rgba(fg, 0.16),
    '--ring': ac,
    '--text-faint': mix(fg, bg, 0.5),
    '--accent-border': rgba(ac, 0.4),
    '--bg-sidebar': rgba(card, 0.55 * alpha),
    '--bg-glass': rgba(card, 0.72 * alpha),
    '--bg-input': rgba(card, 0.9),
    // Panes are see-through: the root paints the colour, wallpaper above.
    '--bg-terminal': 'transparent',
    '--terminal-fg': fg,
    '--tab-active-bg': rgba(ac, 0.18),
    '--btn-outline-bg': rgba(card, 0.7),
    '--canvas-wash': 'none',
    '--terminal-window-bg': rgba(bg, alpha),
    '--terminal-window-alpha': alpha.toFixed(3),
    '--terminal-selection': themeSelection(theme),
    '--terminal-cursor': themeCursor(theme),
  };
}

/**
 * Theme the whole Terminal window: rewrite the design tokens on `<html>`
 * and set the `dark` class from the theme's `details`. `null` restores the
 * app's own look (`dark` per `opts.dark`, accent from the theme store).
 */
export function applyWindowTheme(theme: TerminalTheme | null, opts: { opacity?: number; dark?: boolean } = {}): void {
  const root = document.documentElement;
  if (!theme) {
    if (!windowThemeActive) return;
    windowThemeActive = false;
    for (const token of CHROME_TOKENS) root.style.removeProperty(token);
    root.classList.remove(WINDOW_THEME_CLASS);
    if (opts.dark !== undefined) root.classList.toggle('dark', opts.dark);
    // Put the user's accent / radius back (they were inline too).
    bootstrapThemeStyle();
    return;
  }
  const tokens = chromeTokens(theme, opts.opacity);
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
  root.classList.add(WINDOW_THEME_CLASS);
  root.classList.toggle('dark', theme.details !== 'lighter');
  windowThemeActive = true;
}
