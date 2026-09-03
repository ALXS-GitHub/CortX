import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { loadThemeImage, useCurrentTerminalTheme } from '@/stores/terminalThemeStore';

/**
 * Wallpaper of the current terminal theme, painted behind the whole
 * Terminal window (`background_image` + `cortx.blur` / `cortx.imageFit`).
 * Sits at `z-index: -1` inside `.terminal-window-root`, i.e. above the
 * window background colour and below every panel.
 */
export function TerminalThemeLayer() {
  const theme = useCurrentTerminalTheme();
  const key = theme?.key;
  const imagePath = theme?.background_image?.path;
  const [src, setSrc] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!key || !imagePath) return;
    let cancelled = false;
    loadThemeImage(key).then((url) => {
      if (cancelled) return;
      setSrc(url ? { key, url } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [key, imagePath]);

  // A stale `src` (previous theme) is ignored rather than cleared: the key
  // check below hides it until the new wallpaper is in.
  if (!theme || !imagePath || !src || src.key !== theme.key) return null;

  const image = theme.background_image;
  const opacity = Math.max(0, Math.min(1, (image?.opacity ?? 100) / 100));
  const fit = theme.cortx?.imageFit ?? 'cover';
  const blur = Math.max(0, theme.cortx?.blur ?? 0);
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
  return <div aria-hidden className="terminal-theme-layer" style={style} />;
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
