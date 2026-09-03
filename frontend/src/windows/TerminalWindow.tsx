import { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AppWindow, Loader2, Plus, Search, SquareTerminal } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { TitleBar } from '@/components/layout/TitleBar';
import { ScopeSwitcher } from '@/components/terminal/ScopeSwitcher';
import { SessionRail } from '@/components/terminal/SessionRail';
import { WindowTabStrip } from '@/components/terminal/WindowTabStrip';
import { SplitTree } from '@/components/terminal/SplitTree';
import { TerminalPalette } from '@/components/terminal/TerminalPalette';
import { FindBar } from '@/components/terminal/FindBar';
import { TerminalThemeRoot } from '@/components/terminal/theme/TerminalThemeLayer';
import { ThemePicker } from '@/components/terminal/theme/ThemePicker';
import { initTerminalThemeStore } from '@/stores/terminalThemeStore';
import { TERMINAL_EVENTS, openNewTerminal } from '@/components/terminal/actions';
import { useItemMap } from '@/components/terminal/model';
import { useTerminalFileDrop, useTerminalWheelZoom, useTerminalWindowShortcuts } from '@/components/terminal/useTerminalWindowShortcuts';
import { useAppBootstrap } from '@/hooks/useAppBootstrap';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { useAppStore } from '@/stores/appStore';
import { tabsInScope } from '@/lib/terminalLayout';
import { bootstrapThemeStyle } from '@/lib/theme';
import {
  onTerminalScope,
  showMainWindow,
  takeTerminalWindowScope,
  takeTerminalWindowLaunch,
  onTerminalLaunch,
  getLaunchConfig,
} from '@/lib/tauri';
import { runLaunchConfig } from '@/lib/launchConfigs';
import { toast } from 'sonner';

bootstrapThemeStyle();

/** Root of the dedicated Terminal window (DEV-13 P1). */
export function TerminalWindow() {
  useAppBootstrap();
  useTerminalWindowShortcuts();
  useTerminalWheelZoom();
  useTerminalFileDrop();
  const loaded = useTerminalLayoutStore((s) => s.loaded);
  const setScope = useTerminalLayoutStore((s) => s.setScope);
  const win = useTerminalLayoutStore((s) => s.doc.window);
  const items = useItemMap();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Terminal theme drives the whole window (title bar, rail, panes,
  // wallpaper, opacity), like Warp. Returns its disposer.
  useEffect(() => initTerminalThemeStore({ windowChrome: true }), []);

  // The `window.palette` keybinding action (rebindable) and the palette's own
  // items reach the dialog through this event.
  useEffect(() => {
    const onToggle = () => setPaletteOpen((v) => !v);
    window.addEventListener(TERMINAL_EVENTS.palette, onToggle);
    return () => window.removeEventListener(TERMINAL_EVENTS.palette, onToggle);
  }, []);
  // Sessions rail (default) or tab strip: one or the other, never both.
  const tabsPlacement = useAppStore((s) => s.settings?.terminal.tabsPlacement ?? 'sidebar');

  useEffect(() => {
    document.title = 'CortX Terminal';
  }, []);

  // Scope requested at creation (`cortx terminal --project`, or a project's
  // "open terminal"), applied once the shared layout is in.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    takeTerminalWindowScope()
      .then((projectId) => {
        if (!cancelled && projectId) setScope({ projectId });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loaded, setScope]);

  // Launch configuration requested at creation (`cortx terminal --layout`,
  // a project's "open a dev session"), then any pushed while open.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const run = async (launchId: string) => {
      const config = await getLaunchConfig(launchId);
      if (cancelled) return;
      if (!config) {
        toast.error('Launch configuration not found', { description: launchId });
        return;
      }
      await runLaunchConfig(config, 'window');
    };
    takeTerminalWindowLaunch()
      .then((id) => (id ? run(id) : undefined))
      .catch((e) => toast.error('Launch failed', { description: String(e) }));
    let unlisten: (() => void) | undefined;
    onTerminalLaunch((id) => {
      run(id).catch((e) => toast.error('Launch failed', { description: String(e) }));
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loaded]);

  // Scope pushed while the window is already open.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onTerminalScope((projectId) => setScope({ projectId })).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setScope]);

  // The tab on screen: the active one, else the first of the scope.
  const activeTab = useMemo(() => {
    const scoped = tabsInScope(win, win.scope);
    return scoped.find((t) => t.id === win.activeTabId) ?? scoped[0] ?? null;
  }, [win]);

  // An empty scope is never shown: a shell opens right away (once per empty
  // state, so closing the last tab on purpose does not fight the user).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    if (activeTab) {
      autoOpenedRef.current = false;
      return;
    }
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    const timer = window.setTimeout(() => void openNewTerminal(), 150);
    return () => window.clearTimeout(timer);
  }, [loaded, activeTab]);

  return (
    <TooltipProvider>
      <TerminalThemeRoot>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TitleBar
          title="Terminal"
          center={loaded ? <ScopeSwitcher /> : undefined}
          trailing={
            <>
              <Button variant="ghost" size="xs" onClick={() => setPaletteOpen(true)} title="Command palette (Ctrl+K)">
                <Search />
                <span className="kbd">Ctrl K</span>
              </Button>
              <Button variant="ghost" size="xs" onClick={() => void showMainWindow()} title="Bring the main window up">
                <AppWindow />
                Open CortX
              </Button>
            </>
          }
          closeLabel="Close window"
          onClose={() => getCurrentWindow().close()}
        />
        {!loaded ? (
          <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-faint">
            <Loader2 className="size-3.5 animate-spin" />
            Loading terminals…
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {tabsPlacement === 'sidebar' && <SessionRail />}
            <div className="flex min-w-0 flex-1 flex-col">
              {tabsPlacement === 'top' && <WindowTabStrip />}
              <div className="terminal-dock relative flex min-h-0 flex-1">
                {activeTab ? (
                  <SplitTree key={activeTab.id} tab={activeTab} items={items} isActiveTab />
                ) : (
                  <div className="flex flex-1 items-center justify-center">
                    <EmptyState
                      compact
                      icon={SquareTerminal}
                      title="No terminal here yet"
                      description={
                        win.scope === 'global'
                          ? 'Open a shell (Ctrl+Shift+T), or send a terminal here from the main window.'
                          : 'Open a shell in this project (Ctrl+Shift+T), or widen the scope to Global.'
                      }
                      action={
                        <Button onClick={() => void openNewTerminal()}>
                          <Plus />
                          New terminal
                        </Button>
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      </TerminalThemeRoot>
      <TerminalPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ThemePicker />
      <FindBar />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
