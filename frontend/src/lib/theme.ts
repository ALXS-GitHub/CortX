import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyTheme, type NeutralId, type ThemeSeed } from '@zinc/ui/theme';

/**
 * The app's colours, built by the Zinc theme engine (`@zinc/ui/theme`) from
 * three seeds: a neutral, an accent and a mode.
 *
 * - **Neutral + accent** are a per-machine preference (localStorage, shared by
 *   the main window and the Terminal windows — same origin). The accent is a
 *   Zinc preset or any colour; CortX's default is teal.
 * - **Mode** lives in the backend settings (`settings.appearance.theme`) so
 *   the CLI / TUI can read it, and it can be `system`, which Zinc does not
 *   know: it is resolved here before the seed reaches the engine.
 *
 * The engine writes every `color` token inline on `<html>`. A themed Terminal
 * window writes its own tokens there too (`lib/terminalTheme.ts`), so while
 * one is applied the app theme stands back (`setAppThemeSuspended`).
 */

export type ThemeMode = 'system' | 'light' | 'dark';

/** The colour seeds the user picks (the mode is not one of them, see above). */
export interface ThemeColors {
  neutral: NeutralId;
  accent: ThemeSeed['accent'];
}

export const DEFAULT_COLORS: ThemeColors = { neutral: 'ardoise', accent: { preset: 'teal' } };

/** Colours offered for terminal tabs and project dots (not the app accent). */
export const TAB_COLORS = [
  { name: 'Teal', value: '#0d9488' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Sky', value: '#2aa6f0' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Coral', value: '#fb5d6b' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Slate', value: '#64748b' },
] as const;

/** Pick a readable text colour (light/dark) for a hex background. */
export function accentForeground(hex: string): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const r = Number.parseInt(full.slice(0, 2), 16) / 255;
  const g = Number.parseInt(full.slice(2, 4), 16) / 255;
  const b = Number.parseInt(full.slice(4, 6), 16) / 255;
  if ([r, g, b].some(Number.isNaN)) return '#ffffff';
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.55 ? '#0b1220' : '#ffffff';
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

let mode: ThemeMode = 'system';
let suspended = false;

function resolvedDark(m: ThemeMode): boolean {
  if (m === 'dark') return true;
  if (m === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(colors: ThemeColors): void {
  const dark = resolvedDark(mode);
  if (suspended) {
    // A themed Terminal window owns the tokens; only the mode class is ours,
    // and the window's theme store puts its own back if it disagrees.
    document.documentElement.classList.toggle('dark', dark);
    return;
  }
  applyTheme({ ...colors, mode: dark ? 'dark' : 'light' });
}

/** Apply the light/dark mode. Follows the OS when `m` is "system". */
export function applyThemeMode(m: ThemeMode): void {
  mode = m;
  apply(useThemeStore.getState());
}

/**
 * While a Terminal window theme is applied, the app theme must not write its
 * tokens over it. Lifting the suspension re-applies the app theme.
 */
export function setAppThemeSuspended(value: boolean): void {
  suspended = value;
  if (!value) apply(useThemeStore.getState());
}

interface ThemeStore extends ThemeColors {
  setColors: (patch: Partial<ThemeColors>) => void;
  reset: () => void;
}

function isColors(v: unknown): v is ThemeColors {
  if (!v || typeof v !== 'object') return false;
  const c = v as Partial<ThemeColors>;
  return typeof c.neutral === 'string' && !!c.accent && typeof c.accent === 'object';
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_COLORS,
      setColors: (patch) => {
        const next = { neutral: get().neutral, accent: get().accent, ...patch };
        set(next);
        apply(next);
      },
      reset: () => {
        set(DEFAULT_COLORS);
        apply(DEFAULT_COLORS);
      },
    }),
    {
      // A new key: the Halcyon knobs (skin / radius / font) are gone and an
      // old hex accent would not be a Zinc seed.
      name: 'cortx-theme-colors',
      partialize: (s) => ({ neutral: s.neutral, accent: s.accent }),
      merge: (persisted, current) => (isColors(persisted) ? { ...current, ...persisted } : current),
    }
  )
);

/** Apply the persisted colours before React paints (call once at startup). */
export function bootstrapThemeStyle(): void {
  apply(useThemeStore.getState());
}

// Another window changed the colours: follow it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== 'cortx-theme-colors') return;
    void Promise.resolve(useThemeStore.persist.rehydrate()).then(() => apply(useThemeStore.getState()));
  });
}
