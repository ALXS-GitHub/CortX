import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { Minus, Square, X, Copy, ChevronDown, EyeOff, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { quitApp } from '@/lib/tauri';

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

  // The X button now hides the window to the system tray. The tray icon
  // keeps the app alive so the global hotkey stays active and running
  // services aren't stopped.
  const handleClose = () => {
    appWindow.close();
  };

  // Explicit quit — runs the service-cleanup flow and exits the process.
  const handleQuit = () => {
    quitApp().catch((err) => console.error('Failed to quit:', err));
  };

  return (
    <div
      data-tauri-drag-region
      className="h-9 flex items-center justify-between bg-sidebar border-b border-sidebar-border select-none"
    >
      {/* Left side - App branding. The traffic-lights live in the row BELOW
          on macOS (see MacosTrafficLights), so the same pl-14 works on every OS. */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 pl-14 pr-3 h-full min-w-0"
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

      {/* Right side */}
      <div className="flex items-center h-full">
        {/* App-level menu (Hide to tray / Quit). Shown on every platform —
            it's the only way to truly quit since X now hides to tray. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'h-full px-3 flex items-center justify-center',
              'hover:bg-sidebar-accent transition-colors',
              'focus:outline-none'
            )}
            aria-label="App menu"
          >
            <ChevronDown className="size-4 text-sidebar-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleClose}>
              <EyeOff className="size-4 mr-2" />
              Hide to Tray
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleQuit} className="text-destructive focus:text-destructive">
              <LogOut className="size-4 mr-2" />
              Quit CortX
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Window controls (Win/Linux). On macOS the native traffic lights
            on the left already handle these. */}
        {!isMac && (
          <>
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
                'hover:bg-sidebar-accent transition-colors',
                'focus:outline-none'
              )}
              aria-label="Hide to tray"
              title="Hide to tray"
            >
              <X className="size-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
