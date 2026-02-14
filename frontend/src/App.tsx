import { useEffect, useRef } from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
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
import { RunScriptDialog } from '@/components/global-scripts/RunScriptDialog';
import { useAppStore } from '@/stores/appStore';
import {
  onServiceLog,
  onServiceStatus,
  onServiceExit,
  onScriptLog,
  onScriptStatus,
  onScriptExit,
  onGlobalScriptLog,
  onGlobalScriptStatus,
  onGlobalScriptExit,
  getRunningServices,
} from '@/lib/tauri';
import type { LogEntry } from '@/types';

// Minimized terminal bar height
const MINIMIZED_TERMINAL_HEIGHT = 32;

// Component to handle dynamic padding based on terminal state
function MainContent({ children }: { children: React.ReactNode }) {
  const { terminalPanelOpen, terminalHeight } = useAppStore();

  // Calculate bottom padding based on terminal state
  const bottomPadding = terminalPanelOpen ? terminalHeight : MINIMIZED_TERMINAL_HEIGHT;

  return (
    <div
      className="flex-1 overflow-auto"
      style={{ paddingBottom: bottomPadding + 16 }} // +16 for some extra space
    >
      {children}
    </div>
  );
}

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
  const { currentView, loadProjects, loadSettings, loadGlobalScripts, loadFolders, loadScriptGroups, loadScriptsConfig } = useAppStore();

  // Keep track of whether listeners are set up
  const listenersSetUp = useRef(false);

  // Load initial data
  useEffect(() => {
    loadProjects();
    loadSettings();
    loadGlobalScripts();
    loadFolders();
    loadScriptGroups();
    loadScriptsConfig();

    // Check for running services on startup
    getRunningServices().then((serviceIds) => {
      const { updateServiceStatus } = useAppStore.getState();
      serviceIds.forEach((serviceId) => {
        updateServiceStatus(serviceId, 'running');
      });
    });
  }, [loadProjects, loadSettings, loadGlobalScripts, loadFolders, loadScriptGroups, loadScriptsConfig]);

  // Set up event listeners - only once
  useEffect(() => {
    // Prevent duplicate listener setup
    if (listenersSetUp.current) return;
    listenersSetUp.current = true;

    // Service listeners
    let unlistenServiceLog: (() => void) | undefined;
    let unlistenServiceStatus: (() => void) | undefined;
    let unlistenServiceExit: (() => void) | undefined;
    // Script listeners
    let unlistenScriptLog: (() => void) | undefined;
    let unlistenScriptStatus: (() => void) | undefined;
    let unlistenScriptExit: (() => void) | undefined;
    // Global script listeners
    let unlistenGlobalScriptLog: (() => void) | undefined;
    let unlistenGlobalScriptStatus: (() => void) | undefined;
    let unlistenGlobalScriptExit: (() => void) | undefined;
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
    };

    setupListeners();

    return () => {
      isCancelled = true;
      unlistenServiceLog?.();
      unlistenServiceStatus?.();
      unlistenServiceExit?.();
      unlistenScriptLog?.();
      unlistenScriptStatus?.();
      unlistenScriptExit?.();
      unlistenGlobalScriptLog?.();
      unlistenGlobalScriptStatus?.();
      unlistenGlobalScriptExit?.();
      listenersSetUp.current = false;
    };
  }, []);

  // Get settings from store
  const settings = useAppStore((state) => state.settings);

  // Apply theme when settings change
  useEffect(() => {
    const root = document.documentElement;
    if (settings) {
      const theme = settings.appearance.theme;
      if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.toggle('dark', prefersDark);
      } else {
        root.classList.toggle('dark', theme === 'dark');
      }
    } else {
      // Default to dark while settings load
      root.classList.add('dark');
    }
  }, [settings]);

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
      case 'dashboard':
      default:
        return <Dashboard />;
    }
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen overflow-hidden">
        <TitleBar />
        <div className="flex-1 flex overflow-hidden">
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <header className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
                <SidebarTrigger className="-ml-1" />
                <div className="text-sm font-medium text-muted-foreground">
                  {currentView === 'dashboard' && 'Dashboard'}
                  {currentView === 'project' && 'Project'}
                  {currentView === 'settings' && 'Settings'}
                  {currentView === 'scripts' && 'Scripts'}
                  {currentView === 'script-detail' && 'Script Detail'}
                </div>
              </header>
              <MainContent>{renderView()}</MainContent>
            </SidebarInset>
            <TerminalPanel />
          </SidebarProvider>
        </div>
      </div>
      <Toaster position="bottom-right" />
      <UpdateChecker />
      <ClosingModal />
      <RunScriptDialogGlobal />
    </TooltipProvider>
  );
}

export default App;
