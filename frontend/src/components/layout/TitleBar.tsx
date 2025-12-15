import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

const appWindow = getCurrentWindow();

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Check initial maximized state
    appWindow.isMaximized().then(setIsMaximized);

    // Listen for window resize to update maximized state
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });

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
      {/* Left side - App branding */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 px-3 h-full"
      >
        <img
          src="/cortx-logo.png"
          alt="Cortx"
          className="size-5 pointer-events-none"
          draggable={false}
        />
        <span
          data-tauri-drag-region
          className="text-sm font-medium text-sidebar-foreground"
        >
          Cortx
        </span>
      </div>

      {/* Right side - Window controls */}
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
    </div>
  );
}
