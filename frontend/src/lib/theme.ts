import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Visual theme (Halcyon). The light/dark *mode* lives in the backend settings
 * (`settings.appearance.theme`) so the CLI/TUI can read it; the purely cosmetic
 * knobs below (accent colour, corner radius, font family) are per-machine and
 * persisted in localStorage, like the view preferences.
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export type FontChoice = 'halcyon' | 'system' | 'mono';
/** Visual skin: the Halcyon design (default) or the previous neutral look. */
export type Skin = 'halcyon' | 'classic';

export interface ThemeStyle {
  /** Skin. `classic` restores the pre-Halcyon neutral theme (Inter, greys,
   *  small radii, no glass) — the accent / radius knobs only apply to
   *  `halcyon`; the font family applies to both. */
  skin: Skin;
  /** Accent colour (hex) — `undefined` = default Halcyon teal. */
  accent?: string;
  /** Corner radius in rem. */
  radius: number;
  /** Font family. */
  font: FontChoice;
}

export const SKIN_PRESETS: { name: string; value: Skin; description: string }[] = [
  { name: 'Halcyon', value: 'halcyon', description: 'Tinted canvas, frosted glass, accent colour — shared with Zorg.' },
  { name: 'Classic', value: 'classic', description: 'The previous neutral look: Inter, greys, small corners.' },
];

export const ACCENT_PRESETS = [
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

export const RADIUS_PRESETS = [
  { name: 'Square', value: 0.4 },
  { name: 'Soft', value: 1 },
  { name: 'Round', value: 1.5 },
] as const;

export const FONT_PRESETS: { name: string; value: FontChoice }[] = [
  { name: 'Halcyon', value: 'halcyon' },
  { name: 'System', value: 'system' },
  { name: 'Mono', value: 'mono' },
];

const DEFAULT_STYLE: ThemeStyle = { skin: 'halcyon', radius: 1, font: 'halcyon' };

/** Pick a readable text colour (light/dark) for a hex accent. */
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

/** Apply the light/dark mode to <html>. Follows the OS when `mode` is "system". */
export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.classList.toggle('dark', mode === 'dark' || (mode === 'system' && sysDark));
}

function applyStyleToDom(style: ThemeStyle): void {
  const root = document.documentElement;
  root.dataset.skin = style.skin;
  root.dataset.font = style.font;
  if (style.skin === 'classic') {
    // The classic skin owns its palette and radius (styles/theme-classic.css).
    root.style.removeProperty('--primary');
    root.style.removeProperty('--primary-foreground');
    root.style.removeProperty('--radius');
    return;
  }
  if (style.accent) {
    root.style.setProperty('--primary', style.accent);
    root.style.setProperty('--primary-foreground', accentForeground(style.accent));
  } else {
    root.style.removeProperty('--primary');
    root.style.removeProperty('--primary-foreground');
  }
  root.style.setProperty('--radius', `${style.radius}rem`);
}

interface ThemeStore extends ThemeStyle {
  setStyle: (patch: Partial<ThemeStyle>) => void;
  reset: () => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_STYLE,
      setStyle: (patch) => {
        const next = { ...pickStyle(get()), ...patch };
        applyStyleToDom(next);
        set(next);
      },
      reset: () => {
        applyStyleToDom(DEFAULT_STYLE);
        set({ ...DEFAULT_STYLE, accent: undefined });
      },
    }),
    {
      name: 'cortx-theme',
      partialize: (s) => pickStyle(s),
      onRehydrateStorage: () => (state) => {
        applyStyleToDom(state ? pickStyle(state) : DEFAULT_STYLE);
      },
    }
  )
);

function pickStyle(s: ThemeStyle): ThemeStyle {
  return { skin: s.skin ?? 'halcyon', accent: s.accent, radius: s.radius, font: s.font };
}

/** Apply the persisted style before React paints (call once at startup). */
export function bootstrapThemeStyle(): void {
  applyStyleToDom(pickStyle(useThemeStore.getState()));
}
