import { useState, useEffect, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { ChevronDown, EyeOff, LogOut, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { quitApp } from '@/lib/tauri';
import { useAppStore } from '@/stores/appStore';

const appWindow = getCurrentWindow();

// macOS draws its own traffic-light buttons (see `trafficLightPosition` in
// tauri.conf.json); we hide our custom minimize/maximize/close there.
const isMac = typeof navigator !== 'undefined'
  && /mac/i.test(navigator.platform || (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform || '');

/* --- 10px glyphs, pixel-aligned, stroke = currentColor --- */
function IconMinimize() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 5h8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
function IconMaximize() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
function IconRestore() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d="M3 3V2.4A1.4 1.4 0 0 1 4.4 1h4.2A1.4 1.4 0 0 1 10 2.4v4.2A1.4 1.4 0 0 1 8.6 8H8"
        stroke="currentColor"
        strokeWidth="1"
      />
      <rect x="0" y="3" width="7" height="6" rx="1.4" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function WinButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'grid h-full w-[46px] place-items-center text-muted-foreground transition-colors focus:outline-none',
        danger
          ? 'hover:bg-destructive hover:text-destructive-foreground'
          : 'hover:bg-accent hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

/**
 * Custom title bar (frosted glass). The whole strip drags the window; the
 * close button hides the app to the tray (the tray keeps the global hotkey
 * and the running services alive) — "Quit" lives in the app menu.
 */
export function TitleBar({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');
  const paletteShortcut = useAppStore((s) => s.settings?.globalHotkey);

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });
    getVersion().then(setAppVersion).catch(() => setAppVersion(''));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleHide = () => {
    appWindow.close();
  };

  const handleQuit = () => {
    quitApp().catch((err) => console.error('Failed to quit:', err));
  };

  return (
    <header
      data-tauri-drag-region
      className="glass-strong relative z-40 flex h-9 shrink-0 select-none items-center border-b border-border"
    >
      {/* Branding */}
      <div
        data-tauri-drag-region
        className={cn('flex h-full min-w-0 flex-1 items-center gap-2 pr-3', isMac ? 'pl-[76px]' : 'pl-3')}
      >
        <img src="/cortx-logo.png" alt="" className="size-[18px] shrink-0 rounded-[4px]" draggable={false} />
        <span data-tauri-drag-region className="truncate font-display text-xs font-medium tracking-tight text-muted-foreground">
          CortX
        </span>
        {appVersion && (
          <span data-tauri-drag-region className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
            v{appVersion}
          </span>
        )}
      </div>

      {/* Centre: command palette launcher */}
      {onOpenPalette && (
        <button
          type="button"
          onClick={onOpenPalette}
          className="absolute left-1/2 top-1/2 hidden h-6 w-[280px] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-border bg-card/50 px-3 text-[11px] text-faint transition-colors hover:border-border-strong hover:bg-card/80 hover:text-muted-foreground md:flex"
          title="Command palette"
        >
          <Search className="size-3" />
          <span className="flex-1 truncate text-left">Search projects, scripts, tools…</span>
          <span className="kbd">Ctrl K</span>
        </button>
      )}

      {/* Right: app menu + window controls */}
      <div className="flex h-full items-stretch">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="grid h-full w-9 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none"
            aria-label="App menu"
            title="App menu"
          >
            <ChevronDown className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            {onOpenPalette && (
              <>
                <DropdownMenuItem onClick={onOpenPalette}>
                  <Search />
                  Command palette
                  {paletteShortcut && <span className="ml-auto text-[10px] text-faint">{paletteShortcut}</span>}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={handleHide}>
              <EyeOff />
              Hide to tray
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleQuit} variant="destructive">
              <LogOut />
              Quit CortX
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {!isMac && (
          <>
            <WinButton label="Minimize" onClick={() => appWindow.minimize()}>
              <IconMinimize />
            </WinButton>
            <WinButton label={isMaximized ? 'Restore' : 'Maximize'} onClick={() => appWindow.toggleMaximize()}>
              {isMaximized ? <IconRestore /> : <IconMaximize />}
            </WinButton>
            <WinButton label="Hide to tray" danger onClick={handleHide}>
              <IconClose />
            </WinButton>
          </>
        )}
      </div>
    </header>
  );
}
