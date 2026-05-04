import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { Minus, Square, X, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

const appWindow = getCurrentWindow();

// macOS draws its own traffic-light buttons on the left; we hide our custom
// minimize/maximize/close UI there and reserve enough left padding so the
// app branding does not collide with them.
const isMac = typeof navigator !== 'undefined'
  && /mac/i.test(navigator.platform || (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform || '');

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    // Check initial maximized state
    appWindow.isMaximized().then(setIsMaximized);

    // Listen for window resize to update maximized state
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });

    // Get app version
    getVersion().then(setAppVersion).catch(() => setAppVersion(''));

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleMinimize = () => {
    appWindow.minimize();
  };

  const handleMaximize = () => {
    appWindow.toggleMaximize();
  };

  const handleClose = () => {
    appWindow.close();
  };

  return (
    <div
      data-tauri-drag-region
      className="h-9 flex items-center justify-between bg-sidebar border-b border-sidebar-border select-none"
    >
      {/* Left side - App branding.
          On Windows/Linux pl-14 accounts for the collapsed sidebar (~3rem + padding).
          On macOS we shift further right (pl-20) to clear the traffic-light buttons. */}
      <div
        data-tauri-drag-region
        className={cn(
          'flex items-center gap-2 pr-3 h-full min-w-0',
          isMac ? 'pl-20' : 'pl-14',
        )}
      >
        <span
          data-tauri-drag-region
          className="text-sm font-medium text-sidebar-foreground whitespace-nowrap"
        >
          Cortx
          {appVersion && (
            <span className="text-xs text-muted-foreground ml-1.5 font-normal">
              v{appVersion}
            </span>
          )}
        </span>
      </div>

      {/* Right side - Window controls. Hidden on macOS, where the native
          traffic-light buttons handle minimize/maximize/close. */}
      {!isMac && (
        <div className="flex items-center h-full">
          <button
            onClick={handleMinimize}
            className={cn(
              'h-full px-4 flex items-center justify-center',
              'hover:bg-sidebar-accent transition-colors',
              'focus:outline-none'
            )}
            aria-label="Minimize"
          >
            <Minus className="size-4 text-sidebar-foreground" />
          </button>
          <button
            onClick={handleMaximize}
            className={cn(
              'h-full px-4 flex items-center justify-center',
              'hover:bg-sidebar-accent transition-colors',
              'focus:outline-none'
            )}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? (
              <Copy className="size-3.5 text-sidebar-foreground" />
            ) : (
              <Square className="size-3.5 text-sidebar-foreground" />
            )}
          </button>
          <button
            onClick={handleClose}
            className={cn(
              'h-full px-4 flex items-center justify-center',
              'hover:bg-destructive hover:text-white transition-colors',
              'focus:outline-none'
            )}
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
