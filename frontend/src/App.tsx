import { useEffect } from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { TerminalPanel } from '@/components/layout/TerminalPanel';
import { Dashboard } from '@/views/Dashboard';
import { ProjectView } from '@/views/ProjectView';
import { Settings } from '@/views/Settings';
import { useAppStore } from '@/stores/appStore';
import { onServiceLog, onServiceStatus, onServiceExit, getRunningServices } from '@/lib/tauri';
import type { LogEntry } from '@/types';

function App() {
  const {
    currentView,
    loadProjects,
    loadSettings,
    updateServiceStatus,
    appendServiceLog,
  } = useAppStore();

  // Load initial data
  useEffect(() => {
    loadProjects();
    loadSettings();

    // Check for running services on startup
    getRunningServices().then((serviceIds) => {
      serviceIds.forEach((serviceId) => {
        updateServiceStatus(serviceId, 'running');
      });
    });
  }, [loadProjects, loadSettings, updateServiceStatus]);

  // Set up event listeners
  useEffect(() => {
    let unlistenLog: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    const setupListeners = async () => {
      unlistenLog = await onServiceLog((payload) => {
        const logEntry: LogEntry = {
          timestamp: new Date().toISOString(),
          stream: payload.stream,
          content: payload.content,
        };
        appendServiceLog(payload.serviceId, logEntry);
      });

      unlistenStatus = await onServiceStatus((payload) => {
        updateServiceStatus(payload.serviceId, payload.status, payload.pid);
      });

      unlistenExit = await onServiceExit((payload) => {
        console.log(`Service ${payload.serviceId} exited with code ${payload.exitCode}`);
      });
    };

    setupListeners();

    return () => {
      unlistenLog?.();
      unlistenStatus?.();
      unlistenExit?.();
    };
  }, [appendServiceLog, updateServiceStatus]);

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
      case 'dashboard':
      default:
        return <Dashboard />;
    }
  };

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <div className="text-sm font-medium text-muted-foreground">
              {currentView === 'dashboard' && 'Dashboard'}
              {currentView === 'project' && 'Project'}
              {currentView === 'settings' && 'Settings'}
            </div>
          </header>
          <div className="flex-1 overflow-auto pb-20">
            {renderView()}
          </div>
        </SidebarInset>
        <TerminalPanel />
      </SidebarProvider>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

export default App;
