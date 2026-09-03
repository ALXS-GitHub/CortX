import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { loadThemeImage, useCurrentTerminalTheme } from '@/stores/terminalThemeStore';

type Fit = 'cover' | 'contain' | 'tile' | 'center';

/**
 * Wallpaper of the current terminal theme, painted behind the whole
 * Terminal window (`background_image` + `cortx.blur` / `cortx.imageFit`,
 * each overridable from Settings: `wallpaperOpacity`, `wallpaperBlur`,
 * `wallpaperFit`), plus a `wallpaperDim` overlay in the theme colour that
 * tones the picture down. Sits at `z-index: -1` inside
 * `.terminal-window-root`, above the window background colour and below
 * every panel.
 */
export function TerminalThemeLayer() {
  const theme = useCurrentTerminalTheme();
  const look = useAppStore((s) => s.settings?.terminal);
  const key = theme?.key;
  const imagePath = theme?.background_image?.path;
  const [src, setSrc] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!key || !imagePath) return;
    let cancelled = false;
    let retry: number | null = null;
    const load = (attempt: number) => {
      loadThemeImage(key).then((url) => {
        if (cancelled) return;
        if (url) {
          setSrc({ key, url });
          return;
        }
        // The backend may not have been ready (dev restart, file being
        // written): try again a few times before giving up.
        if (attempt < 3) retry = window.setTimeout(() => load(attempt + 1), 1500 * (attempt + 1));
      });
    };
    load(0);
    return () => {
      cancelled = true;
      if (retry !== null) window.clearTimeout(retry);
    };
  }, [key, imagePath]);

  // A stale `src` (previous theme) is ignored rather than cleared: the key
  // check below hides it until the new wallpaper is in.
  if (!theme || !imagePath || !src || src.key !== theme.key) return null;

  const image = theme.background_image;
  const opacityPct = look?.wallpaperOpacity ?? image?.opacity ?? 100;
  const opacity = Math.max(0, Math.min(1, opacityPct / 100));
  const fit: Fit = look?.wallpaperFit ?? theme.cortx?.imageFit ?? 'cover';
  const blur = Math.max(0, look?.wallpaperBlur ?? theme.cortx?.blur ?? 0);
  const dim = Math.max(0, Math.min(90, look?.wallpaperDim ?? 0)) / 100;
  const style: CSSProperties = {
    backgroundImage: `url("${src.url}")`,
    backgroundSize: fit === 'cover' ? 'cover' : fit === 'contain' ? 'contain' : 'auto',
    backgroundRepeat: fit === 'tile' ? 'repeat' : 'no-repeat',
    opacity,
  };
  if (blur > 0) {
    style.filter = `blur(${blur}px)`;
    // Bleed past the edges so the blur never fades to transparent there.
    style.inset = `${-blur * 2}px`;
  }
  return (
    <>
      <div aria-hidden className="terminal-theme-layer" style={style} />
      {dim > 0 && (
        <div
          aria-hidden
          className="terminal-theme-layer"
          style={{ backgroundImage: 'none', backgroundColor: theme.background, opacity: dim }}
        />
      )}
    </>
  );
}

/**
 * Wrap the Terminal window's content in this: it paints the theme's
 * background at the window opacity and mounts the wallpaper layer. The
 * store must be started with `initTerminalThemeStore({ windowChrome: true })`.
 */
export function TerminalThemeRoot({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('terminal-window-root', className)}>
      <TerminalThemeLayer />
      {children}
    </div>
  );
}
