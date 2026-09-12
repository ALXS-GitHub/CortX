/**
 * One theme card of the picker (DEV-13 P3): the theme's *real* look rather
 * than a name to guess from — its background (gradient included), its
 * wallpaper at the opacity the file asks for, a mock prompt in the ANSI
 * colours, and the name with a `bundled` / `user` badge.
 *
 * Wallpapers are read on demand (`loadThemeImage`, a base64 data URL): a
 * card only asks for its picture once it has been near the viewport, so
 * opening the picker with 40 imported themes does not inline 40 images.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Image as ImageIcon, Moon, Pencil, Sun } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { themeAccentCss, themeCanvasCss } from '@/lib/terminalTheme';
import { loadThemeImage, useTerminalThemeStore } from '@/stores/terminalThemeStore';
import { cn } from '@/lib/utils';
import type { TerminalThemeSummary } from '@/types';

/** True once the element has been (or is) near the viewport. */
function useNearViewport(ref: React.RefObject<HTMLElement | null>): boolean {
  // No observer (jsdom, very old webview): treat everything as visible.
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { root: null, rootMargin: '240px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, near]);
  return near;
}

/** The theme's wallpaper as a data URL, loaded only when `enabled`. */
function useThemeImage(key: string, enabled: boolean): string | null {
  const assetVersion = useTerminalThemeStore((s) => s.assetVersion);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadThemeImage(key).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [key, enabled, assetVersion]);
  return url;
}

export interface ThemeCardProps {
  theme: TerminalThemeSummary;
  /** The theme currently saved in the slot being edited. */
  selected: boolean;
  /** Used by the *other* slot (dark vs light) — shown as a discreet hint. */
  usedElsewhere?: boolean;
  onPick: () => void;
  /** Hover / focus: live-preview this theme (no-op where preview is off). */
  onHover?: () => void;
  onLeave?: () => void;
  /**
   * Open the studio on this theme. A bundled theme cannot be written to, so
   * the button offers to duplicate it instead of failing on Save — which is
   * why the caller is told which of the two the user asked for.
   */
  onEdit?: (mode: 'edit' | 'duplicate') => void;
}

/**
 * Deleting a theme from here was removed on purpose: the cards are what you
 * *browse*, one hover away from a live preview, and a destructive button in
 * that path is a trap. The themes are plain files — the picker's "Themes
 * folder" button opens them, and a file removed there disappears from the
 * gallery straight away (the folder is watched).
 *
 * Editing is a different matter and does live here: it is not destructive,
 * it is the only place the theme you are looking at is identified, and the
 * alternative was finding the yaml by hand. It appears on hover so the
 * gallery still reads as a gallery.
 */
export function ThemeCard({ theme, selected, usedElsewhere, onPick, onHover, onLeave, onEdit }: ThemeCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const image = useThemeImage(theme.key, near && theme.hasImage);
  const [, red, green, yellow, blue, magenta, cyan] = theme.swatches;
  const dark = theme.details !== 'lighter';
  // The theme's own wallpaper opacity, so the card looks like the window will.
  const imageOpacity = Math.max(0, Math.min(100, theme.imageOpacity ?? 100)) / 100;

  const bundled = theme.source === 'bundled';

  return (
    <div ref={ref} className="group relative" onMouseEnter={onHover} onMouseLeave={onLeave}>
      {onEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(bundled ? 'duplicate' : 'edit');
          }}
          title={bundled ? 'Duplicate this theme and edit the copy' : 'Edit this theme'}
          aria-label={bundled ? `Duplicate ${theme.name}` : `Edit ${theme.name}`}
          className="absolute right-1.5 top-1.5 z-10 grid size-6 place-items-center rounded-[6px] border border-border-strong bg-[var(--bg-glass)] text-foreground opacity-0 backdrop-blur transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        >
          {bundled ? <Copy className="size-3" /> : <Pencil className="size-3" />}
        </button>
      )}
      <button
        type="button"
        data-theme-card={theme.key}
        aria-pressed={selected}
        onClick={onPick}
        onFocus={onHover}
        onBlur={onLeave}
        className={cn(
          'block w-full overflow-hidden rounded-lg border text-left transition-shadow',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          selected ? 'border-primary shadow-pop' : 'border-border-strong hover:shadow-pop'
        )}
      >
        <div className="relative h-[112px]" style={{ background: themeCanvasCss(theme) }}>
          {image && (
            <div
              aria-hidden
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url("${image}")`, opacity: imageOpacity }}
            />
          )}
          <div
            className="relative flex h-full flex-col justify-between p-2.5 font-mono text-[10.5px] leading-[1.45]"
            style={{ color: theme.foreground }}
          >
            <div className="min-w-0 truncate">
              <span style={{ color: green }}>~/cortx</span>{' '}
              <span
                style={{
                  background: themeAccentCss(theme),
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                ❯
              </span>{' '}
              <span>git status</span>
              <span className="ml-px inline-block h-[1.05em] w-[2px] align-text-bottom" style={{ background: theme.foreground }} />
            </div>
            <div className="min-w-0 truncate">
              <span style={{ color: blue }}>src</span> <span style={{ color: magenta }}>modified</span>{' '}
              <span style={{ color: red }}>2 errors</span> <span style={{ color: cyan }}>·</span>{' '}
              <span style={{ color: yellow }}>1 warning</span>
            </div>
            <div className="flex gap-px overflow-hidden rounded-[3px]" aria-hidden>
              {theme.swatches.map((c, i) => (
                <span key={i} className="block h-2 flex-1" style={{ background: c }} />
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 border-t border-border bg-card px-2.5 py-1.5">
          {selected ? (
            <Check className="size-3.5 shrink-0 text-primary" aria-label="Chosen" />
          ) : (
            <span
              className="size-2.5 shrink-0 rounded-full border border-border-strong"
              style={{ background: themeAccentCss(theme) }}
              aria-hidden
            />
          )}
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{theme.name}</span>
          {usedElsewhere && !selected && (
            <span className="text-[10px] text-faint" title="Used by the other mode">
              in use
            </span>
          )}
          {theme.hasImage && <ImageIcon className="size-3 shrink-0 text-faint" aria-label="Has a wallpaper" />}
          {dark ? (
            <Moon className="size-3 shrink-0 text-faint" aria-label="Dark theme" />
          ) : (
            <Sun className="size-3 shrink-0 text-faint" aria-label="Light theme" />
          )}
          <Badge variant={theme.source === 'bundled' ? 'secondary' : 'outline'} className="shrink-0">
            {theme.source === 'bundled' ? 'bundled' : 'user'}
          </Badge>
        </div>
      </button>
    </div>
  );
}
