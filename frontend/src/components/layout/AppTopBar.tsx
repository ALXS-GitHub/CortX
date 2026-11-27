import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { ChevronDown, EyeOff, LogOut, Search } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { quitApp } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { useViewPrefsStore } from '@/stores/viewPrefsStore';
import { IconClose, IconMaximize, IconMinimize, IconRestore, WinButton } from './TitleBar';
import { appWindow, isMac } from './windowChrome';

/** Width of the collapsed sidebar (icon rail), shared with `AppSidebar`. */
export const RAIL_WIDTH = 56;

/**
 * The main window's top strip (Zinc shell). It sits on the shell background
 * like the navigation, with no surface or border of its own: the brand above
 * the sidebar, the search pill that opens the command palette in the middle,
 * the app menu and the window buttons on the right. The whole strip drags the
 * window. The X hides to the tray (services and the global hotkey stay alive);
 * quitting is in the app menu.
 *
 * The Terminal window keeps its own `TitleBar`.
 */
export function AppTopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const paletteShortcut = useAppStore((s) => s.settings?.globalHotkey);
  const { sidebarCollapsed, sidebarWidth } = useViewPrefsStore();

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

  const hide = () => appWindow.close();
  const quit = () => quitApp().catch((err) => console.error('Failed to quit:', err));

  return (
    <header data-tauri-drag-region className="relative z-40 flex h-11 shrink-0 select-none items-center">
      {/* Brand, as wide as the sidebar below it */}
      <div
        data-tauri-drag-region
        className={cn('flex h-full shrink-0 items-center gap-2', isMac ? 'pl-[76px]' : 'pl-4', sidebarCollapsed && 'justify-center pl-0')}
        style={{ width: sidebarCollapsed ? RAIL_WIDTH : sidebarWidth }}
      >
        <img src="/cortx-logo.png" alt="" className="size-[18px] shrink-0 rounded-[4px]" draggable={false} />
        {!sidebarCollapsed && (
          <>
            <span data-tauri-drag-region className="font-display text-[15px] font-semibold text-foreground">
              CortX
            </span>
            {appVersion && (
              <span data-tauri-drag-region className="font-mono text-[11px] text-faint">
                {appVersion}
              </span>
            )}
          </>
        )}
      </div>

      {/* Search: opens the command palette */}
      <div data-tauri-drag-region className="flex h-full min-w-0 flex-1 items-center justify-center px-3">
        <button
          type="button"
          onClick={onOpenPalette}
          className="zn-search hidden max-w-[440px] text-left hover:border-border-strong md:flex"
          title="Command palette"
        >
          <Search aria-hidden />
          <span className="flex-1 truncate text-[13.5px]">Search projects, scripts, tools…</span>
          <span className="kbd">Ctrl K</span>
        </button>
      </div>

      {/* App menu + window controls */}
      <div className="flex h-full shrink-0 items-stretch">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="grid h-full w-10 place-items-center text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none"
            aria-label="App menu"
            title="App menu"
          >
            <ChevronDown className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem onClick={onOpenPalette}>
              <Search />
              Command palette
              {paletteShortcut && <span className="ml-auto text-xs text-faint">{paletteShortcut}</span>}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={hide}>
              <EyeOff />
              Hide to tray
            </DropdownMenuItem>
            <DropdownMenuItem onClick={quit} variant="destructive">
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
            <WinButton label="Hide to tray" danger onClick={hide}>
              <IconClose />
            </WinButton>
          </>
        )}
      </div>
    </header>
  );
}
