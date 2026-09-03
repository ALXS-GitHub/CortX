import { useEffect, useRef, useState, useCallback, useMemo, Component, type ReactNode, Fragment } from 'react';
import { useAppStore, parseTerminalId, type TerminalPane } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChevronDown,
  ChevronUp,
  X,
  Trash2,
  Square,
  Circle,
  Eye,
  XCircle,
  GripHorizontal,
  Terminal,
  FileCode,
  AlertTriangle,
  Plus,
  SquareTerminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { XtermView } from './XtermView';
import { clearTerminal } from '@/lib/terminalSessions';
import { TerminalDndContext, type TerminalItem, type TerminalType } from './terminal-dnd';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { SortableTerminalTab } from './terminal-dnd';

/** Last path segment, tolerant of both separators and trailing slashes. */
function basename(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

// Error boundary to prevent crashes from taking down the whole app
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class TerminalErrorBoundary extends Component<{ children: ReactNode; onReset: () => void }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Terminal panel error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-muted-foreground">
          <AlertTriangle className="size-8 text-yellow-500" />
          <p className="text-sm">Terminal display error occurred</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              this.setState({ hasError: false });
              this.props.onReset();
            }}
          >
            Reset Terminal
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Create ANSI to HTML converter with dark theme colors
// Droppable pane component with edge drop zones
function DroppablePaneContent({
  pane,
  paneTerminals,
  activeTerminal,
  isFocused,
  onSelectTerminal,
  onHideTerminal,
  onClearLogs,
  onRemovePane,
  onFocusPane,
  showRemoveButton,
}: {
  pane: TerminalPane;
  paneTerminals: TerminalItem[];
  activeTerminal: TerminalItem | null;
  isFocused: boolean;
  onSelectTerminal: (terminalId: string) => void;
  onHideTerminal: (terminalId: string) => void;
  onClearLogs: (terminalId: string) => void;
  onRemovePane: () => void;
  onFocusPane: () => void;
  showRemoveButton: boolean;
}) {
  // Main pane drop zone (for dropping into center)
  const { setNodeRef: setPaneRef, isOver: isOverPane } = useDroppable({
    id: `pane-drop-${pane.id}`,
    data: {
      type: 'pane',
      paneId: pane.id,
    },
  });

  // Left edge drop zone for creating new pane
  const { setNodeRef: setLeftEdgeRef, isOver: isOverLeftEdge } = useDroppable({
    id: `edge-left-${pane.id}`,
    data: {
      type: 'edge',
      position: 'left',
      referencePaneId: pane.id,
    },
  });

  // Right edge drop zone for creating new pane
  const { setNodeRef: setRightEdgeRef, isOver: isOverRightEdge } = useDroppable({
    id: `edge-right-${pane.id}`,
    data: {
      type: 'edge',
      position: 'right',
      referencePaneId: pane.id,
    },
  });

  return (
    <div
      ref={setPaneRef}
      className={cn(
        'flex flex-col min-w-0 min-h-0 relative flex-1',
        isFocused && 'ring-1 ring-primary/50 ring-inset'
      )}
      onClick={onFocusPane}
    >
      {/* Left edge drop zone - detection handled by custom collision detection, starts below tabs */}
      <div
        ref={setLeftEdgeRef}
        className="absolute left-0 top-9 bottom-0 w-[25%] z-30 pointer-events-none"
      />
      {isOverLeftEdge && (
        <div className="absolute left-0 top-9 bottom-0 w-[25%] bg-muted/50 border-2 border-dashed border-primary rounded-bl flex items-center justify-center z-20 pointer-events-none">
          <span className="text-xs text-muted-foreground">New Pane</span>
        </div>
      )}

      {/* Right edge drop zone - detection handled by custom collision detection, starts below tabs */}
      <div
        ref={setRightEdgeRef}
        className="absolute right-0 top-9 bottom-0 w-[25%] z-30 pointer-events-none"
      />
      {isOverRightEdge && (
        <div className="absolute right-0 top-9 bottom-0 w-[25%] bg-muted/50 border-2 border-dashed border-primary rounded-br flex items-center justify-center z-20 pointer-events-none">
          <span className="text-xs text-muted-foreground">New Pane</span>
        </div>
      )}

      {/* Center pane drop indicator */}
      {isOverPane && !isOverLeftEdge && !isOverRightEdge && (
        <div className="absolute inset-2 bg-primary/10 border-2 border-primary border-dashed rounded z-20 pointer-events-none" />
      )}

      {/* Tabs bar */}
      <div className="flex items-center bg-muted/30 border-b text-xs shrink-0 overflow-x-auto">
        <SortableContext
          items={paneTerminals.map((t) => t.id)}
          strategy={horizontalListSortingStrategy}
        >
          {paneTerminals.length > 0 ? (
            paneTerminals.map((terminal) => (
              <SortableTerminalTab
                key={terminal.id}
                terminal={terminal}
                paneId={pane.id}
                isActive={pane.activeTerminalId === terminal.id}
                onSelect={() => onSelectTerminal(terminal.id)}
                onHide={() => onHideTerminal(terminal.id)}
              />
            ))
          ) : (
            <div className="px-2 py-1.5 text-muted-foreground">Empty pane</div>
          )}
        </SortableContext>

        {/* Pane actions — Clear/Stop live in the top panel toolbar (one shared set
            for the focused pane). Only the Close-pane button is per-pane. */}
        <div className="ml-auto flex items-center shrink-0 px-1">
          {showRemoveButton && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                onRemovePane();
              }}
              title="Close pane"
              className="ml-1 border-l pl-1"
            >
              <X className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Pane content: the persistent xterm.js session for the active tab */}
      {activeTerminal ? (
        <TerminalErrorBoundary onReset={() => onClearLogs(activeTerminal.id)}>
          <div className="flex-1 min-h-0 relative">
            <XtermView terminalId={activeTerminal.id} autoFocus={isFocused} />
          </div>
        </TerminalErrorBoundary>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-muted-foreground gap-2">
          <p className="text-sm">Drop a terminal here or start a service</p>
        </div>
      )}
    </div>
  );
}

export function TerminalPanel() {
  const {
    terminalPanelOpen,
    toggleTerminalPanel,
    terminalHeight,
    setTerminalHeight,
    serviceRuntimes,
    scriptRuntimes,
    projects,
    stopService,
    stopScript,
    clearServiceLogs,
    clearScriptLogs,
    closeAllTerminals,
    hideTerminal,
    openTerminal,
    terminals,
    globalScripts,
    globalScriptRuntimes,
    stopGlobalScript,
    clearGlobalScriptLogs,
    shellRuntimes,
    openShell,
    killShell,
    selectedProjectId,
    // Multi-pane state
    terminalPanes,
    focusedPaneId,
    removePane,
    setActiveTerminalInPane,
    focusPane,
    resizePanes,
  } = useAppStore();

  // The "current" terminal = the active tab of the focused pane.
  const activeTerminalId = useMemo(() => {
    const focusedPane = terminalPanes.find((p) => p.id === focusedPaneId);
    return focusedPane?.activeTerminalId ?? null;
  }, [terminalPanes, focusedPaneId]);

  // Container ref for resize functionality
  const containerRef = useRef<HTMLDivElement>(null);

  // Resize state
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartY = useRef(0);
  const resizeStartHeight = useRef(0);

  // Handle resize drag
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = terminalHeight;
  }, [terminalHeight]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = resizeStartY.current - e.clientY;
      const newHeight = resizeStartHeight.current + deltaY;
      setTerminalHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setTerminalHeight]);

  // Get service info helper
  const getServiceInfo = useCallback(
    (serviceId: string) => {
      let serviceName = serviceId;
      let projectName = '';
      let projectId = '';
      for (const project of projects) {
        const service = project.services.find((s) => s.id === serviceId);
        if (service) {
          serviceName = service.name;
          projectName = project.name;
          projectId = project.id;
          break;
        }
      }
      return { serviceName, projectName, projectId };
    },
    [projects]
  );

  // Get script info helper
  const getScriptInfo = useCallback(
    (scriptId: string) => {
      let scriptName = scriptId;
      let projectName = '';
      let projectId = '';
      for (const project of projects) {
        const script = project.scripts?.find((s) => s.id === scriptId);
        if (script) {
          scriptName = script.name;
          projectName = project.name;
          projectId = project.id;
          break;
        }
      }
      return { scriptName, projectName, projectId };
    },
    [projects]
  );

  // Build unified list of all terminal items (services + scripts)
  const allTerminals = useMemo(() => {
    const items: TerminalItem[] = [];

    // Add services
    for (const [serviceId, runtime] of serviceRuntimes.entries()) {
      const { serviceName, projectName, projectId } = getServiceInfo(serviceId);
      items.push({
        id: `service:${serviceId}`,
        type: 'service',
        name: serviceName,
        projectName,
        projectId,
        status: runtime.status,
        logs: runtime.logs,
        detectedPorts: runtime.detectedPorts,
        activeMode: runtime.activeMode,
      });
    }

    // Add scripts
    for (const [scriptId, runtime] of scriptRuntimes.entries()) {
      const { scriptName, projectName, projectId } = getScriptInfo(scriptId);
      items.push({
        id: `script:${scriptId}`,
        type: 'script',
        name: scriptName,
        projectName,
        projectId,
        status: runtime.status,
        logs: runtime.logs,
        detectedPorts: [],
        lastExitCode: runtime.lastExitCode,
        lastSuccess: runtime.lastSuccess,
      });
    }

    // Add global scripts
    for (const [scriptId, runtime] of globalScriptRuntimes.entries()) {
      const script = globalScripts.find(s => s.id === scriptId);
      items.push({
        id: `global-script:${scriptId}`,
        type: 'global-script',
        name: script?.name || 'Unknown Script',
        projectName: 'Global',
        projectId: '',
        status: runtime.status,
        logs: runtime.logs,
        detectedPorts: [],
        lastExitCode: runtime.lastExitCode,
        lastSuccess: runtime.lastSuccess,
      });
    }

    // Add interactive shells
    for (const [shellId, runtime] of shellRuntimes.entries()) {
      const project = runtime.projectId ? projects.find((p) => p.id === runtime.projectId) : undefined;
      items.push({
        id: `shell:${shellId}`,
        type: 'shell',
        name: `${basename(runtime.program).replace(/\.exe$/i, '')} · ${basename(runtime.cwd)}`,
        projectName: project?.name ?? '',
        projectId: project?.id ?? '',
        status:
          runtime.status === 'running'
            ? 'running'
            : runtime.exitCode === 0 || runtime.exitCode == null
              ? 'completed'
              : 'failed',
        logs: [],
        detectedPorts: [],
        lastExitCode: runtime.exitCode ?? undefined,
        cwd: runtime.cwd,
      });
    }

    return items;
  }, [serviceRuntimes, scriptRuntimes, globalScriptRuntimes, shellRuntimes, globalScripts, projects, getServiceInfo, getScriptInfo]);

  // Filter `allTerminals` using the canonical Terminal entity visibility.
  const visibleTerminals = useMemo(() => {
    return allTerminals.filter((item) => terminals.get(item.id)?.visibility === 'visible');
  }, [allTerminals, terminals]);

  // Get the project ID of the currently active terminal
  const activeProjectId = useMemo(() => {
    if (!activeTerminalId) return null;
    const activeItem = allTerminals.find((t) => t.id === activeTerminalId);
    return activeItem?.projectId || null;
  }, [activeTerminalId, allTerminals]);

  // Get hidden terminals (filter by active project) — these populate the "hidden tray".
  const hiddenTerminals = useMemo(() => {
    return allTerminals.filter((item) => {
      const t = terminals.get(item.id);
      if (t?.visibility !== 'hidden') return false;
      const sameProject = !activeProjectId || item.projectId === activeProjectId;
      return sameProject;
    });
  }, [allTerminals, terminals, activeProjectId]);

  // Total active count (visible + hidden)
  const totalActiveCount = visibleTerminals.length + hiddenTerminals.length;

  // Resolve terminal kind + runtimeKey from the prefixed terminal ID.
  const resolveTerminal = useCallback((id: string) => {
    const t = terminals.get(id);
    if (t) return { kind: t.kind, runtimeKey: t.runtimeKey };
    // Fallback: parse the ID directly for cases where the Terminal entity hasn't been created yet.
    return parseTerminalId(id);
  }, [terminals]);

  // Handle stop for current terminal
  const handleStopCurrent = useCallback(async () => {
    if (!activeTerminalId) return;
    const parsed = resolveTerminal(activeTerminalId);
    if (!parsed) return;
    if (parsed.kind === 'shell') await killShell(parsed.runtimeKey);
    else if (parsed.kind === 'global-script') await stopGlobalScript(parsed.runtimeKey);
    else if (parsed.kind === 'script') await stopScript(parsed.runtimeKey);
    else await stopService(parsed.runtimeKey);
  }, [activeTerminalId, resolveTerminal, stopScript, stopService, stopGlobalScript, killShell]);

  // Hide terminal (removes from pane, runtime preserved — can be restored from tray).
  const handleHideTerminal = useCallback((id: string) => {
    hideTerminal(id);
  }, [hideTerminal]);

  // Restore a terminal from the hidden tray into the focused pane.
  const handleShowTerminal = useCallback((item: TerminalItem) => {
    const parsed = resolveTerminal(item.id);
    if (!parsed) return;
    openTerminal(parsed.kind, parsed.runtimeKey);
  }, [openTerminal, resolveTerminal]);

  // Clear logs of the current terminal
  const handleClearCurrent = useCallback(() => {
    if (!activeTerminalId) return;
    const parsed = resolveTerminal(activeTerminalId);
    if (!parsed) return;
    clearTerminal(activeTerminalId);
    if (parsed.kind === 'global-script') clearGlobalScriptLogs(parsed.runtimeKey);
    else if (parsed.kind === 'script') clearScriptLogs(parsed.runtimeKey);
    else if (parsed.kind === 'service') clearServiceLogs(parsed.runtimeKey);
  }, [activeTerminalId, resolveTerminal, clearScriptLogs, clearServiceLogs, clearGlobalScriptLogs]);

  // Open a new interactive shell. Working directory = the active tab's project,
  // else the project selected in the sidebar, else the home directory.
  const newShellProjectId = activeProjectId || selectedProjectId || undefined;
  const newShellProjectName = useMemo(
    () => (newShellProjectId ? projects.find((p) => p.id === newShellProjectId)?.name : undefined),
    [newShellProjectId, projects]
  );
  const handleNewShell = useCallback(async () => {
    try {
      await openShell({ projectId: newShellProjectId });
    } catch (error) {
      console.error('Failed to open shell:', error);
      toast.error(`Failed to open terminal: ${String(error)}`);
    }
  }, [openShell, newShellProjectId]);

  // Get current terminal info (UI item for the focused pane's active tab)
  const currentTerminal = useMemo(() => {
    if (!activeTerminalId) return null;
    return allTerminals.find((t) => t.id === activeTerminalId) || null;
  }, [activeTerminalId, allTerminals]);

  // Check if current terminal can be stopped
  const canStopCurrent = useMemo(() => {
    if (!currentTerminal) return false;
    if (currentTerminal.type === 'service') {
      return currentTerminal.status === 'running';
    } else {
      return currentTerminal.status === 'running';
    }
  }, [currentTerminal]);

  // Pane resize handlers
  const panesContainerRef = useRef<HTMLDivElement>(null);
  const [resizingPaneIndex, setResizingPaneIndex] = useState<number | null>(null);
  const resizePaneStartX = useRef(0);
  const resizePaneStartWidths = useRef<{ id: string; width: number }[]>([]);

  const handlePaneResizeStart = useCallback((e: React.MouseEvent, paneIndex: number) => {
    e.preventDefault();
    setResizingPaneIndex(paneIndex);
    resizePaneStartX.current = e.clientX;
    resizePaneStartWidths.current = terminalPanes.map(p => ({ id: p.id, width: p.width }));
  }, [terminalPanes]);

  useEffect(() => {
    if (resizingPaneIndex === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!panesContainerRef.current) return;

      const containerWidth = panesContainerRef.current.getBoundingClientRect().width;
      const deltaX = e.clientX - resizePaneStartX.current;
      const deltaPercent = (deltaX / containerWidth) * 100;

      const newWidths = [...resizePaneStartWidths.current];
      const leftPane = newWidths[resizingPaneIndex];
      const rightPane = newWidths[resizingPaneIndex + 1];

      if (leftPane && rightPane) {
        // Apply delta to left pane, subtract from right pane
        const newLeftWidth = Math.max(15, leftPane.width + deltaPercent);
        const newRightWidth = Math.max(15, rightPane.width - deltaPercent);

        // Only apply if both panes would be at least 15%
        if (newLeftWidth >= 15 && newRightWidth >= 15) {
          newWidths[resizingPaneIndex] = { ...leftPane, width: newLeftWidth };
          newWidths[resizingPaneIndex + 1] = { ...rightPane, width: newRightWidth };
          resizePanes(newWidths);
        }
      }
    };

    const handleMouseUp = () => {
      setResizingPaneIndex(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingPaneIndex, resizePanes]);

  // Get active terminal info for a pane (UI item, not Terminal entity)
  const getActiveTerminalForPane = useCallback((pane: TerminalPane): TerminalItem | null => {
    if (!pane.activeTerminalId) return null;
    return allTerminals.find(t => t.id === pane.activeTerminalId) || null;
  }, [allTerminals]);

  // Get all terminals in a pane — derived from canonical `terminals` map filtered by paneId.
  const getTerminalsInPane = useCallback((pane: TerminalPane): TerminalItem[] => {
    const itemsById = new Map(allTerminals.map((item) => [item.id, item]));
    const result: TerminalItem[] = [];
    for (const t of terminals.values()) {
      if (t.paneId === pane.id && t.visibility === 'visible') {
        const item = itemsById.get(t.id);
        if (item) result.push(item);
      }
    }
    // Sort by Terminal.order to preserve user-defined tab order
    const orderById = new Map<string, number>();
    for (const t of terminals.values()) orderById.set(t.id, t.order);
    return result.sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0));
  }, [allTerminals, terminals]);

  // Clear logs for a specific pane's terminal
  const handleClearPaneLogs = useCallback((id: string) => {
    const parsed = resolveTerminal(id);
    if (!parsed) return;
    clearTerminal(id);
    if (parsed.kind === 'global-script') clearGlobalScriptLogs(parsed.runtimeKey);
    else if (parsed.kind === 'script') clearScriptLogs(parsed.runtimeKey);
    else if (parsed.kind === 'service') clearServiceLogs(parsed.runtimeKey);
  }, [resolveTerminal, clearScriptLogs, clearServiceLogs, clearGlobalScriptLogs]);

  if (!terminalPanelOpen) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t">
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-8 rounded-none gap-2"
          onClick={toggleTerminalPanel}
        >
          <ChevronUp className="size-4" />
          <span>Terminal ({totalActiveCount} active)</span>
        </Button>
      </div>
    );
  }

  return (
    <TerminalDndContext allTerminals={allTerminals}>
      <div
        ref={containerRef}
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 bg-card border-t flex flex-col",
          isResizing && "select-none"
        )}
        style={{ height: terminalHeight }}
      >
        {/* Resize handle */}
        <div
          className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-primary/50 transition-colors flex items-center justify-center group"
          onMouseDown={handleResizeStart}
        >
          <div className="absolute -top-1 left-0 right-0 h-3" /> {/* Larger hit area */}
          <GripHorizontal className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-2 py-1 border-b bg-muted/50 mt-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Terminal</span>
            <span className="text-xs text-muted-foreground">
              ({visibleTerminals.length} visible
              {hiddenTerminals.length > 0 && `, ${hiddenTerminals.length} hidden`})
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleNewShell}
              title={newShellProjectName ? `New terminal in ${newShellProjectName}` : 'New terminal'}
            >
              <Plus className="size-4" />
            </Button>

            {/* Hidden terminals dropdown */}
            {hiddenTerminals.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" title="Show hidden terminals">
                    <Eye className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {hiddenTerminals.map((item) => (
                    <DropdownMenuItem key={item.id} onClick={() => handleShowTerminal(item)}>
                      {item.type === 'script' ? (
                        <FileCode className="size-3 mr-2 text-muted-foreground" />
                      ) : item.type === 'shell' ? (
                        <SquareTerminal className="size-3 mr-2 text-muted-foreground" />
                      ) : (
                        <Terminal className="size-3 mr-2 text-muted-foreground" />
                      )}
                      <StatusIndicator status={item.status} type={item.type} />
                      <span className="ml-2">
                        {item.name}
                        {item.projectName && (
                          <span className="text-muted-foreground ml-1">({item.projectName})</span>
                        )}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {currentTerminal && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleClearCurrent}
                  title="Clear logs"
                >
                  <Trash2 className="size-3.5" />
                </Button>
                {canStopCurrent && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleStopCurrent}
                    title={
                      currentTerminal.type === 'shell'
                        ? 'Kill shell'
                        : currentTerminal.type === 'service'
                          ? 'Stop service'
                          : 'Stop script'
                    }
                  >
                    <Square className="size-3.5" />
                  </Button>
                )}
              </>
            )}

            {/* Close all terminals button */}
            {visibleTerminals.length > 0 && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={closeAllTerminals}
                title="Close all terminals"
              >
                <XCircle className="size-3.5" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleTerminalPanel}
              title="Minimize"
            >
              <ChevronDown className="size-4" />
            </Button>
          </div>
        </div>

        {/* Panes container */}
        <div
          ref={panesContainerRef}
          className={cn(
            'flex-1 flex min-h-0',
            (isResizing || resizingPaneIndex !== null) && 'select-none'
          )}
        >
          {visibleTerminals.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <p>
                {hiddenTerminals.length > 0
                  ? 'All terminals are hidden. Click the eye icon to show them.'
                  : 'No active terminals. Start a service or script, or open a shell.'}
              </p>
              <Button variant="outline" size="sm" onClick={handleNewShell} className="gap-1.5">
                <Plus className="size-3.5" />
                {newShellProjectName ? `New terminal in ${newShellProjectName}` : 'New terminal'}
              </Button>
            </div>
          ) : (
            <>
              {terminalPanes.map((pane, paneIndex) => {
                const paneTerminals = getTerminalsInPane(pane);
                const activeTerminal = getActiveTerminalForPane(pane);
                const isFocused = focusedPaneId === pane.id;
                const totalWidth = terminalPanes.reduce((sum, p) => sum + p.width, 0);
                const widthPercent = (pane.width / totalWidth) * 100;

                return (
                  <Fragment key={pane.id}>
                    {/* Pane - flex container to allow children to use flex-1 */}
                    <div className="flex flex-col min-h-0 min-w-0" style={{ width: `${widthPercent}%` }}>
                      <DroppablePaneContent
                        pane={pane}
                        paneTerminals={paneTerminals}
                        activeTerminal={activeTerminal}
                        isFocused={isFocused}
                        onSelectTerminal={(terminalId) => setActiveTerminalInPane(pane.id, terminalId)}
                        onHideTerminal={handleHideTerminal}
                        onClearLogs={handleClearPaneLogs}
                        onRemovePane={() => removePane(pane.id)}
                        onFocusPane={() => focusPane(pane.id)}
                        showRemoveButton={terminalPanes.length > 1}
                      />
                    </div>

                    {/* Resize handle between panes */}
                    {paneIndex < terminalPanes.length - 1 && (
                      <div
                        className="w-1 bg-border hover:bg-primary/50 cursor-col-resize flex-shrink-0 transition-colors"
                        onMouseDown={(e) => handlePaneResizeStart(e, paneIndex)}
                      />
                    )}
                  </Fragment>
                );
              })}
            </>
          )}
        </div>
      </div>
    </TerminalDndContext>
  );
}

function StatusIndicator({ status, type }: { status: string; type?: TerminalType }) {
  // Service statuses: stopped, starting, running, error
  // Script statuses: idle, running, completed, failed
  const serviceColors = {
    stopped: 'text-muted-foreground',
    starting: 'text-yellow-500 animate-pulse',
    running: 'text-green-500',
    error: 'text-red-500',
  };

  const scriptColors = {
    idle: 'text-muted-foreground',
    running: 'text-blue-500 animate-pulse',
    completed: 'text-green-500',
    failed: 'text-red-500',
  };

  const colors = type === 'service' ? serviceColors : scriptColors;

  return (
    <Circle
      className={cn('size-2 fill-current', colors[status as keyof typeof colors] || 'text-muted-foreground')}
    />
  );
}
