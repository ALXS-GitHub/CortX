import { useEffect, useRef, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { TitleBar } from '@/components/layout/TitleBar';
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
import { applyThemeMode, bootstrapThemeStyle } from '@/lib/theme';
import {
  onServiceLog,
  onServiceStatus,
  onServiceExit,
  onServicePorts,
  onScriptLog,
  onScriptStatus,
  onScriptExit,
  onGlobalScriptLog,
  onGlobalScriptStatus,
  onGlobalScriptExit,
  onDataChanged,
  onOpenCommandPalette,
  getRunningServices,
  onShellExit,
} from '@/lib/tauri';
import type { LogEntry } from '@/types';

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
  const { currentView, loadProjects, loadSettings, loadGlobalScripts, loadTagDefinitions, loadScriptsConfig, loadTools, loadAliases, loadStatusDefinitions, loadApps } = useAppStore();
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

  // Keep track of whether listeners are set up
  const listenersSetUp = useRef(false);

  // Load initial data
  useEffect(() => {
    loadProjects();
    loadSettings();
    loadGlobalScripts();
    loadTagDefinitions();
    loadScriptsConfig();
    loadTools();
    loadAliases();
    loadStatusDefinitions();
    loadApps();

    // Shell tabs still alive in the backend (e.g. after a webview reload)
    useAppStore.getState().loadShells();

    // Check for running services on startup
    getRunningServices().then((serviceIds) => {
      const { updateServiceStatus } = useAppStore.getState();
      serviceIds.forEach((serviceId) => {
        updateServiceStatus(serviceId, 'running');
      });
    });
  }, [loadProjects, loadSettings, loadGlobalScripts, loadTagDefinitions, loadScriptsConfig, loadTools, loadAliases, loadStatusDefinitions, loadApps]);

  // Set up event listeners - only once
  useEffect(() => {
    // Prevent duplicate listener setup
    if (listenersSetUp.current) return;
    listenersSetUp.current = true;

    // Service listeners
    let unlistenServiceLog: (() => void) | undefined;
    let unlistenServiceStatus: (() => void) | undefined;
    let unlistenServiceExit: (() => void) | undefined;
    let unlistenServicePorts: (() => void) | undefined;
    // Script listeners
    let unlistenScriptLog: (() => void) | undefined;
    let unlistenScriptStatus: (() => void) | undefined;
    let unlistenScriptExit: (() => void) | undefined;
    // Global script listeners
    let unlistenGlobalScriptLog: (() => void) | undefined;
    let unlistenGlobalScriptStatus: (() => void) | undefined;
    let unlistenGlobalScriptExit: (() => void) | undefined;
    // Shell (integrated terminal tab) listener
    let unlistenShellExit: (() => void) | undefined;
    // Data change listener (file watcher)
    let unlistenDataChanged: (() => void) | undefined;
    let isCancelled = false;

    const setupListeners = async () => {
      // Service event listeners
      unlistenServiceLog = await onServiceLog((payload) => {
        if (isCancelled) return;
        const { appendServiceLog } = useAppStore.getState();
        const logEntry: LogEntry = {
          timestamp: new Date().toISOString(),
          stream: payload.stream,
          content: payload.content,
        };
        appendServiceLog(payload.serviceId, logEntry);
      });

      unlistenServiceStatus = await onServiceStatus((payload) => {
        if (isCancelled) return;
        const { updateServiceStatus } = useAppStore.getState();
        updateServiceStatus(payload.serviceId, payload.status, payload.pid, payload.activeMode, payload.activeArgPreset);
      });

      unlistenServiceExit = await onServiceExit((payload) => {
        if (isCancelled) return;
        console.log(`Service ${payload.serviceId} exited with code ${payload.exitCode}`);
      });

      unlistenServicePorts = await onServicePorts((payload) => {
        if (isCancelled) return;
        const { updateServiceDetectedPorts } = useAppStore.getState();
        updateServiceDetectedPorts(payload.serviceId, payload.ports);
      });

      // Script event listeners
      unlistenScriptLog = await onScriptLog((payload) => {
        if (isCancelled) return;
        const { appendScriptLog } = useAppStore.getState();
        const logEntry: LogEntry = {
          timestamp: new Date().toISOString(),
          stream: payload.stream,
          content: payload.content,
        };
        appendScriptLog(payload.scriptId, logEntry);
      });

      unlistenScriptStatus = await onScriptStatus((payload) => {
        if (isCancelled) return;
        const { updateScriptStatus } = useAppStore.getState();
        updateScriptStatus(payload.scriptId, payload.status, payload.pid);
      });

      unlistenScriptExit = await onScriptExit((payload) => {
        if (isCancelled) return;
        console.log(`Script ${payload.scriptId} exited with code ${payload.exitCode}, success: ${payload.success}`);
        const { setScriptExitResult } = useAppStore.getState();
        setScriptExitResult(payload.scriptId, payload.exitCode, payload.success);
      });

      // Global script event listeners
      unlistenGlobalScriptLog = await onGlobalScriptLog((payload) => {
        if (isCancelled) return;
        const { appendGlobalScriptLog } = useAppStore.getState();
        const logEntry: LogEntry = {
          timestamp: new Date().toISOString(),
          stream: payload.stream,
          content: payload.content,
        };
        appendGlobalScriptLog(payload.scriptId, logEntry);
      });

      unlistenGlobalScriptStatus = await onGlobalScriptStatus((payload) => {
        if (isCancelled) return;
        const { updateGlobalScriptStatus } = useAppStore.getState();
        updateGlobalScriptStatus(payload.scriptId, payload.status, payload.pid);
      });

      unlistenGlobalScriptExit = await onGlobalScriptExit((payload) => {
        if (isCancelled) return;
        console.log(`Global script ${payload.scriptId} exited with code ${payload.exitCode}, success: ${payload.success}`);
        const { setGlobalScriptExitResult, updateExecutionRecordOnExit } = useAppStore.getState();
        setGlobalScriptExitResult(payload.scriptId, payload.exitCode, payload.success);
        updateExecutionRecordOnExit(payload.scriptId, payload.exitCode ?? null, payload.success);
      });

      unlistenShellExit = await onShellExit((payload) => {
        if (isCancelled) return;
        const { markShellExited } = useAppStore.getState();
        markShellExited(payload.shellId, payload.exitCode);
      });

      // File watcher: reload all data when external changes detected
      unlistenDataChanged = await onDataChanged(() => {
        if (isCancelled) return;
        const store = useAppStore.getState();
        store.loadProjects();
        store.loadGlobalScripts();
        store.loadTagDefinitions();
        store.loadSettings();
        store.loadTools();
        store.loadAliases();
        store.loadStatusDefinitions();
        store.loadApps();
      });
    };

    setupListeners();

    return () => {
      isCancelled = true;
      unlistenServiceLog?.();
      unlistenServiceStatus?.();
      unlistenServiceExit?.();
      unlistenServicePorts?.();
      unlistenScriptLog?.();
      unlistenScriptStatus?.();
      unlistenScriptExit?.();
      unlistenGlobalScriptLog?.();
      unlistenGlobalScriptStatus?.();
      unlistenGlobalScriptExit?.();
      unlistenShellExit?.();
      unlistenDataChanged?.();
      listenersSetUp.current = false;
    };
  }, []);

  // Light / dark mode follows the app settings (and the OS when "system").
  const themeMode = useAppStore((state) => state.settings?.appearance.theme);
  useEffect(() => {
    // Default to dark while settings load.
    if (!themeMode) {
      document.documentElement.classList.add('dark');
      return;
    }
    applyThemeMode(themeMode);
    if (themeMode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyThemeMode('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [themeMode]);

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
      <div className="flex h-screen flex-col overflow-hidden text-foreground">
        <TitleBar onOpenPalette={() => setPaletteOpen(true)} />
        <div className="flex min-h-0 flex-1">
          <AppSidebar />
          <div className="flex min-w-0 flex-1 flex-col">
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
