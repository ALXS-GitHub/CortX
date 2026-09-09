import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AppWindow, Loader2, Plus, Search, SlidersHorizontal, SquareTerminal } from 'lucide-react';
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
import { BetaBadge } from '@/components/ui/BetaBadge';
import { ThemePicker } from '@/components/terminal/theme/ThemePicker';
import { TerminalSettingsView } from '@/components/terminal/settings/TerminalSettingsView';
import { OPEN_TERMINAL_SETTINGS_EVENT, openTerminalSettingsPanel } from '@/components/terminal/settings/meta';
import { flushTerminalSettings } from '@/components/terminal/settings/useTerminalSettings';
import { initTerminalThemeStore } from '@/stores/terminalThemeStore';
import { TERMINAL_EVENTS, openNewTerminal } from '@/components/terminal/actions';
import { useItemMap } from '@/components/terminal/model';
import { useTerminalFileDrop, useTerminalWheelZoom, useTerminalWindowShortcuts } from '@/components/terminal/useTerminalWindowShortcuts';
import { useAppBootstrap } from '@/hooks/useAppBootstrap';
import { useTerminalLayoutStore, TERMINAL_WINDOW_ID } from '@/stores/terminalLayoutStore';
import { useAppStore } from '@/stores/appStore';
import { collectLeaves, findLeaf, PRIMARY_TERMINAL_WINDOW, tabIsLocal, tabsInScope, terminalWindowIdOf, terminalWindowName } from '@/lib/terminalLayout';
import { fitTerminal, focusTerminal, listTerminalSessionIds } from '@/lib/terminalSessions';
import { cn } from '@/lib/utils';
import { openTerminalWindow } from '@/components/terminal/terminalWindows';
import { DetachDropHint } from '@/components/terminal/DetachDropHint';
import { SubshellBanner } from '@/components/terminal/SubshellBanner';
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

/** Is this the window a tab lands in by default (`terminal`)? */
const IS_PRIMARY_WINDOW = TERMINAL_WINDOW_ID === PRIMARY_TERMINAL_WINDOW;
/** "Terminal" for the first window, "Terminal 2"… for a detached one. */
const WINDOW_NAME = terminalWindowName(TERMINAL_WINDOW_ID);

/**
 * Closing a Terminal window only hides it (the backend prevents the close),
 * so this webview keeps running. `self` says whether the user has hidden
 * *this* window: while it is hidden it must not put itself back into the
 * document's list of open windows — but while it is visible it must, because
 * the backend clears `windowOpen` whenever the first window is hidden, even
 * if a detached one is still up.
 */
const hidden = { self: false };

/**
 * Root of a Terminal window (DEV-13 P1). Since ticket #20 there can be
 * several: they share one document, each drawing the tabs whose `windowId`
 * is its own Tauri label.
 */
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
  // Terminal settings, full space (ticket #27): a panel that takes the content
  // area over, not a tab and no longer a dialog. See `TerminalSettingsView`.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => {
    // The controls save on a short debounce; closing must not drop the last one.
    flushTerminalSettings();
    setSettingsOpen(false);
  }, []);

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
    document.title = IS_PRIMARY_WINDOW ? 'CortX Terminal' : `CortX ${WINDOW_NAME}`;
  }, []);

  // Which Terminal windows are up is part of the shared document, so the next
  // start brings every one of them back (ticket #20). The webview survives a
  // close (the backend hides the window instead of destroying it), hence the
  // focus listener: coming back up must put the window back in the list.
  const windowOpen = useTerminalLayoutStore((s) => s.doc.windowOpen);
  useEffect(() => {
    if (!loaded) return;
    const layout = useTerminalLayoutStore.getState();
    if (!hidden.self) layout.markWindowOpen(TERMINAL_WINDOW_ID);
    let unlistenFocus: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    let cancelled = false;
    const win = getCurrentWindow();
    win
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) return;
        hidden.self = false;
        useTerminalLayoutStore.getState().markWindowOpen(TERMINAL_WINDOW_ID);
      })
      .then((u) => (cancelled ? u() : (unlistenFocus = u)));
    // Raw listener on purpose: `onCloseRequested` destroys the window when the
    // handler does not prevent it, and CortX only ever hides it.
    win
      .listen('tauri://close-requested', () => {
        hidden.self = true;
        useTerminalLayoutStore.getState().markWindowClosed(TERMINAL_WINDOW_ID);
      })
      .then((u) => (cancelled ? u() : (unlistenClose = u)));
    return () => {
      cancelled = true;
      unlistenFocus?.();
      unlistenClose?.();
    };
    // `windowOpen` is a dependency on purpose: see the repair below.
  }, [loaded, windowOpen]);

  // The first window brings its detached siblings back with it. It boots
  // after session restore has respawned the shells (restore is what opens
  // it), so the siblings never attach to terminals that are already gone.
  //
  // Only the siblings that still hold a tab (ticket #37). `openWindows`
  // remembers a window that was up, not a window that has anything in it, so
  // one you detached a tab into and later emptied came back at every start —
  // blank, and offered as a destination for the rest of the session. An empty
  // detached window closes itself a moment later anyway (see `hasOwnTabs`
  // below); not opening it is the same answer without the flicker.
  const reopenedSiblings = useRef(false);
  useEffect(() => {
    if (!loaded || !IS_PRIMARY_WINDOW || reopenedSiblings.current) return;
    reopenedSiblings.current = true;
    const { doc } = useTerminalLayoutStore.getState();
    for (const label of doc.openWindows ?? []) {
      if (label === PRIMARY_TERMINAL_WINDOW) continue;
      if (!doc.window.tabs.some((t) => terminalWindowIdOf(t) === label)) continue;
      openTerminalWindow(label).catch((e) => console.warn(`Could not reopen ${label}`, e));
    }
  }, [loaded]);

  // Everything that asks for the settings — the palette entry, the title bar
  // button, the OSC 52 toast — goes through this one event, so none of them
  // has to know where the panel lives.
  useEffect(() => {
    const onOpen = () => setSettingsOpen(true);
    window.addEventListener(OPEN_TERMINAL_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TERMINAL_SETTINGS_EVENT, onOpen);
  }, []);

  // Ctrl+, toggles the settings panel — the shortcut that opens it closes it
  // again, like Ctrl+K on the palette. Not part of the rebindable registry
  // yet (`lib/keybindings.ts` has no `window.settings` action); the palette
  // entry is the discoverable way in.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      if (e.key !== ',') return;
      e.preventDefault();
      if (settingsOpen) closeSettings();
      else setSettingsOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen, closeSettings]);

  // Coming back from the panel. The tree of terminals was only hidden, never
  // unmounted (see the render below), and `fit()` is a no-op on a box with no
  // size — so every pane still holds the size it had, and the PTYs were never
  // resized. Re-fitting anyway is what covers the window being resized while
  // the panel was up; two frames so the layout has settled first. Focus goes
  // back to the pane the user left, which `XtermView`'s `autoFocus` effect
  // cannot do on its own (it never re-ran: nothing about it changed).
  const settingsWasOpen = useRef(false);
  useEffect(() => {
    if (settingsOpen) {
      settingsWasOpen.current = true;
      return;
    }
    if (!settingsWasOpen.current) return;
    settingsWasOpen.current = false;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        for (const id of listTerminalSessionIds()) fitTerminal(id);
        if (!activeTab) return;
        const leaf =
          (activeTab.activeLeafId ? findLeaf(activeTab.layout, activeTab.activeLeafId) : null) ??
          collectLeaves(activeTab.layout)[0];
        if (leaf) focusTerminal(leaf.terminalId);
      });
    });
    return () => cancelAnimationFrame(frame);
    // `activeTab` is read, not watched: it only matters on the frame the
    // panel closes on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen]);

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

  // Does this window still hold anything, whatever the scope shows?
  const hasOwnTabs = useMemo(() => win.tabs.some(tabIsLocal), [win]);

  // An empty scope is never shown: a shell opens right away (once per empty
  // state, so closing the last tab on purpose does not fight the user).
  // A *detached* window that runs out of tabs closes instead — that is what
  // moving its last tab elsewhere means, and it is what a browser does.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    if (activeTab) {
      autoOpenedRef.current = false;
      return;
    }
    if (!IS_PRIMARY_WINDOW && !hasOwnTabs) {
      const timer = window.setTimeout(() => {
        hidden.self = true;
        useTerminalLayoutStore.getState().markWindowClosed(TERMINAL_WINDOW_ID);
        void getCurrentWindow().close();
      }, 150);
      return () => window.clearTimeout(timer);
    }
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    const timer = window.setTimeout(() => void openNewTerminal(), 150);
    return () => window.clearTimeout(timer);
  }, [loaded, activeTab, hasOwnTabs]);

  return (
    <TooltipProvider>
      <TerminalThemeRoot>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TitleBar
          title={WINDOW_NAME}
          badge={<BetaBadge />}
          center={loaded ? <ScopeSwitcher /> : undefined}
          trailing={
            <>
              <Button variant="ghost" size="xs" onClick={() => setPaletteOpen(true)} title="Command palette (Ctrl+K)">
                <Search />
                <span className="kbd">Ctrl K</span>
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={openTerminalSettingsPanel}
                title="Terminal settings (Ctrl+,)"
                aria-label="Terminal settings"
              >
                <SlidersHorizontal />
              </Button>
              <Button variant="ghost" size="xs" onClick={() => void showMainWindow()} title="Bring the main window up">
                <AppWindow />
                Open CortX
              </Button>
            </>
          }
          closeLabel="Close window"
          onClose={() => {
            // Recorded before the window goes: `openWindows` is what the next
            // start reads to decide which Terminal windows to bring back.
            hidden.self = true;
            useTerminalLayoutStore.getState().markWindowClosed(TERMINAL_WINDOW_ID);
            void getCurrentWindow().close();
          }}
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
                {/* Settings take the content area over (ticket #27), but the
                    terminals are only *hidden*: unmounting the tree would take
                    every xterm instance with it and a running agent would lose
                    its output. A hidden box has no size, so nothing is resized
                    and no PTY is told the window shrank. */}
                <div className={cn('flex min-h-0 min-w-0 flex-1', settingsOpen && 'hidden')}>
                  {/* "A sub-shell is running here without shell integration"
                      (ticket #16) — an offer, never an automatic injection. */}
                  <SubshellBanner />
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
                {/* Rendered after the tree so it wins the stacking order, and
                    only while open: the cards subscribe to the settings store,
                    and a closed panel should not be listening. */}
                {settingsOpen && <TerminalSettingsView onClose={closeSettings} />}
              </div>
            </div>
          </div>
        )}
      </div>
      </TerminalThemeRoot>
      <TerminalPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ThemePicker />
      <FindBar />
      <DetachDropHint />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
