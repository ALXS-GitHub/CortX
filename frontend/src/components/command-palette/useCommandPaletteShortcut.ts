import { useEffect } from 'react';

/**
 * Register a global Cmd+K / Ctrl+K keydown listener that opens the palette.
 * Ignores the shortcut while it's already open (cmdk handles its own keys).
 */
export function useCommandPaletteShortcut(open: boolean, setOpen: (open: boolean) => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Cmd+K on macOS, Ctrl+K elsewhere.
      const isToggle = e.key === 'k' && (e.metaKey || e.ctrlKey);
      if (!isToggle) return;
      e.preventDefault();
      setOpen(!open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);
}
