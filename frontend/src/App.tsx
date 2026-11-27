import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { AppTopBar } from '@/components/layout/AppTopBar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { TerminalPanel } from '@/components/layout/TerminalPanel';
import { UpdateChecker } from '@/components/UpdateChecker';
import { ClosingModal } from '@/components/ClosingModal';
import { Dashboard } from '@/views/Dashboard';
import { ProjectView } from '@/views/ProjectView';
import { Settings } from '@/views/Settings';
import { GlobalScriptsView } from '@/components/global-scripts/GlobalScriptsView';
import { GlobalScriptDetail } from '@/components/global-scripts/GlobalScriptDetail';
import { ToolsView } from '@/components/tools/ToolsView';
import { ToolDetail } from '@/components/tools/ToolDetail';
import { AliasesView } from '@/components/aliases/AliasesView';
import { AliasDetail } from '@/components/aliases/AliasDetail';
import { AppsView } from '@/components/apps/AppsView';
import { AppDetail } from '@/components/apps/AppDetail';
import { UtilitiesView } from '@/components/utilities/UtilitiesView';
import { AgentsView } from '@/components/agents';
import { RunScriptDialog } from '@/components/global-scripts/RunScriptDialog';
import { CommandPalette } from '@/components/command-palette/CommandPalette';
import { useCommandPaletteShortcut } from '@/components/command-palette/useCommandPaletteShortcut';
import { useAppStore } from '@/stores/appStore';
import { bootstrapThemeStyle } from '@/lib/theme';
import { useAppBootstrap } from '@/hooks/useAppBootstrap';
import { onOpenCommandPalette } from '@/lib/tauri';
import { SETTINGS_PAGE_KEY, storePage } from '@/components/settings/settingsNav';

// Accent / radius / font are per-machine and applied before the first paint.
bootstrapThemeStyle();

function RunScriptDialogGlobal() {
  const { runScriptDialogTarget, closeRunScriptDialog } = useAppStore();
  return (
    <RunScriptDialog
      script={runScriptDialogTarget}
      open={!!runScriptDialogTarget}
      onOpenChange={(open) => { if (!open) closeRunScriptDialog(); }}
    />
  );
}

function App() {
  const currentView = useAppStore((state) => state.currentView);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useCommandPaletteShortcut(paletteOpen, setPaletteOpen);

  // OS-level global hotkey -> toggle palette (window is shown + focused on
  // the backend side before this fires).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onOpenCommandPalette(() => {
      setPaletteOpen((v) => !v);
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useAppBootstrap();

  // "Terminal settings…" from the Terminal window's palette: it brings this
  // window up and asks for the Settings screen.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<{ section?: string } | null>('cortx-open-settings', (event) => {
      // "Open in CortX" from the Terminal window lands on the Terminal pages.
      if (event.payload?.section === 'terminal') storePage(SETTINGS_PAGE_KEY, 'terminal-shell');
      useAppStore.getState().setCurrentView('settings');
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // "Open in Agents" from a terminal tab running Claude Code / Codex: the
  // backend raises this window (`reveal_agent_session`) and names the session
  // to open. Selecting it before switching view is safe — AgentsView only
  // clears the selection when it unmounts.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<string>('open-agent-session', (event) => {
      const store = useAppStore.getState();
      store.selectAgentSession(event.payload);
      store.setCurrentView('agents');
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const renderView = () => {
    switch (currentView) {
      case 'project':
        return <ProjectView />;
      case 'settings':
        return <Settings />;
      case 'scripts':
        return <GlobalScriptsView />;
      case 'script-detail':
        return <GlobalScriptDetail />;
      case 'tools':
        return <ToolsView />;
      case 'tool-detail':
        return <ToolDetail />;
      case 'aliases':
        return <AliasesView />;
      case 'alias-detail':
        return <AliasDetail />;
      case 'apps':
        return <AppsView />;
      case 'app-detail':
        return <AppDetail />;
      case 'utilities':
        return <UtilitiesView />;
      case 'agents':
        return <AgentsView />;
      case 'dashboard':
      default:
        return <Dashboard />;
    }
  };

  return (
    <TooltipProvider>
      {/* Zinc shell: the top bar and the navigation sit on the shell
          background; the screen and the terminal dock live in one raised
          panel, `shell-gap` away from the window edges. */}
      <div className="flex h-screen flex-col overflow-hidden bg-bg text-foreground">
        <AppTopBar onOpenPalette={() => setPaletteOpen(true)} />
        <div className="flex min-h-0 flex-1">
          <AppSidebar />
          <div className="mb-1.5 mr-1.5 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            {/* Each screen owns its scrolling (see layout/Screen) */}
            <main className="min-h-0 flex-1 overflow-auto" key={currentView}>
              {renderView()}
            </main>
            <TerminalPanel />
          </div>
        </div>
      </div>
      <Toaster position="bottom-right" />
      <UpdateChecker />
      <ClosingModal />
      <RunScriptDialogGlobal />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </TooltipProvider>
  );
}

export default App;
