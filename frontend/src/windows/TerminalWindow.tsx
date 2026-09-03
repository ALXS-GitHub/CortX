import { useEffect, useMemo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AppWindow, Loader2, Plus, SquareTerminal } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { TitleBar } from '@/components/layout/TitleBar';
import { ScopeSwitcher } from '@/components/terminal/ScopeSwitcher';
import { SessionRail } from '@/components/terminal/SessionRail';
import { WindowTabStrip } from '@/components/terminal/WindowTabStrip';
import { SplitTree } from '@/components/terminal/SplitTree';
import { TerminalStatusBar } from '@/components/terminal/TerminalStatusBar';
import { openNewTerminal } from '@/components/terminal/actions';
import { useItemMap } from '@/components/terminal/model';
import { useTerminalWindowShortcuts } from '@/components/terminal/useTerminalWindowShortcuts';
import { useAppBootstrap } from '@/hooks/useAppBootstrap';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { useAppStore } from '@/stores/appStore';
import { tabsInScope } from '@/lib/terminalLayout';
import { bootstrapThemeStyle } from '@/lib/theme';
import { onTerminalScope, showMainWindow, takeTerminalWindowScope } from '@/lib/tauri';

bootstrapThemeStyle();

/** Root of the dedicated Terminal window (DEV-13 P1). */
export function TerminalWindow() {
  useAppBootstrap();
  useTerminalWindowShortcuts();
  const loaded = useTerminalLayoutStore((s) => s.loaded);
  const setScope = useTerminalLayoutStore((s) => s.setScope);
  const win = useTerminalLayoutStore((s) => s.doc.window);
  const items = useItemMap();
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

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TitleBar
          title="Terminal"
          center={loaded ? <ScopeSwitcher /> : undefined}
          trailing={
            <Button variant="ghost" size="xs" onClick={() => void showMainWindow()} title="Bring the main window up">
              <AppWindow />
              Open CortX
            </Button>
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
              <TerminalStatusBar items={items} />
            </div>
          </div>
        )}
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
