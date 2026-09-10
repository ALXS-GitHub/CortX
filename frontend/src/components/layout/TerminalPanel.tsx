import { useEffect, useRef, useState, useCallback, useMemo, Component, type ReactNode, Fragment } from 'react';
import { useAppStore, parseTerminalId, type TerminalPane } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { openTerminalWindow } from '@/components/terminal/terminalWindows';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ChevronDown,
  ChevronUp,
  X,
  Trash2,
  Square,
  Eye,
  XCircle,
  Terminal,
  AlertTriangle,
  Plus,
  AppWindow,
  SquareArrowOutUpRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { XtermView } from './XtermView';
import { CloseConfirmDialog } from '@/components/terminal/CloseConfirmDialog';
import { confirmCloseTerminals } from '@/components/terminal/actions';
import { clearTerminal } from '@/lib/terminalSessions';
import { useTerminalItems } from '@/hooks/useTerminalItems';
import { StatusDot } from '@/components/ui/StatusDot';
import { TerminalDndContext, type TerminalItem } from './terminal-dnd';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { SortableTerminalTab } from './terminal-dnd/SortableTerminalTab';
import { TerminalTypeIcon } from './terminal-dnd/TerminalTypeIcon';

/** Height of the collapsed dock strip. */
export const TERMINAL_BAR_HEIGHT = 32;

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
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-muted-foreground">
          <AlertTriangle className="size-8 text-warning" />
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

/** Small icon button of the dock toolbar. */
function DockButton({
  label,
  onClick,
  children,
  danger,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          aria-label={label}
          className={cn('size-7 rounded-[var(--rad-xs)]', danger && 'hover:bg-destructive/15 hover:text-destructive')}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

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
        'relative flex min-h-0 min-w-0 flex-1 flex-col',
        isFocused && 'ring-1 ring-inset ring-primary/40'
      )}
      onClick={onFocusPane}
    >
      {/* Left edge drop zone - detection handled by custom collision detection, starts below tabs */}
      <div
        ref={setLeftEdgeRef}
        className="pointer-events-none absolute bottom-0 left-0 top-9 z-30 w-[25%]"
      />
      {isOverLeftEdge && (
        <div className="pointer-events-none absolute bottom-0 left-0 top-9 z-20 flex w-[25%] items-center justify-center rounded-bl border-2 border-dashed border-primary bg-primary/10">
          <span className="text-xs text-muted-foreground">New pane</span>
        </div>
      )}

      {/* Right edge drop zone - detection handled by custom collision detection, starts below tabs */}
      <div
        ref={setRightEdgeRef}
        className="pointer-events-none absolute bottom-0 right-0 top-9 z-30 w-[25%]"
      />
      {isOverRightEdge && (
        <div className="pointer-events-none absolute bottom-0 right-0 top-9 z-20 flex w-[25%] items-center justify-center rounded-br border-2 border-dashed border-primary bg-primary/10">
          <span className="text-xs text-muted-foreground">New pane</span>
        </div>
      )}

      {/* Center pane drop indicator */}
      {isOverPane && !isOverLeftEdge && !isOverRightEdge && (
        <div className="pointer-events-none absolute inset-2 z-20 rounded-sm border-2 border-dashed border-primary bg-primary/10" />
      )}

      {/* Tabs bar */}
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-background/70 text-xs no-scrollbar">
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
            <div className="flex items-center px-3 text-faint">Empty pane</div>
          )}
        </SortableContext>

        {/* Pane actions — Clear/Stop live in the dock toolbar (one shared set
            for the focused pane). Only the Close-pane button is per-pane. */}
        {showRemoveButton && (
          <div className="ml-auto flex shrink-0 items-center px-1.5">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                onRemovePane();
              }}
              title="Close pane"
              aria-label="Close pane"
            >
              <X className="size-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Pane content: the persistent xterm.js session for the active tab */}
      {activeTerminal ? (
        <TerminalErrorBoundary onReset={() => onClearLogs(activeTerminal.id)}>
          <div className="relative min-h-0 flex-1">
            <XtermView terminalId={activeTerminal.id} autoFocus={isFocused} />
          </div>
        </TerminalErrorBoundary>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-faint">
          <p className="text-sm">Drop a terminal here or start a service</p>
        </div>
      )}
    </div>
  );
}

/**
 * Bottom terminal dock. Follows the app theme, sits under the current screen
 * in the main column, resizable by dragging its top edge and collapsible to a
 * one-line strip.
 */
export function TerminalPanel() {
  const {
    terminalPanelOpen,
    toggleTerminalPanel,
    terminalHeight,
    setTerminalHeight,
    projects,
    stopService,
    stopScript,
    clearServiceLogs,
    clearScriptLogs,
    closeAllTerminals,
    hideTerminal,
    openTerminal,
    terminals,
    stopGlobalScript,
    clearGlobalScriptLogs,
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
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, setTerminalHeight]);

  const allTerminals = useTerminalItems();

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
  const runningCount = useMemo(
    () => allTerminals.filter((t) => t.status === 'running' && terminals.get(t.id)?.visibility !== 'closed').length,
    [allTerminals, terminals]
  );

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

  // Dedicated Terminal window (DEV-13 P1)
  const handleOpenWindow = useCallback(() => {
    openTerminalWindow().catch((error) => toast.error(`Failed to open the terminal window: ${String(error)}`));
  }, []);

  const handleSendCurrentToWindow = useCallback(() => {
    if (!currentTerminal) return;
    useTerminalLayoutStore.getState().sendToWindow(currentTerminal.id, currentTerminal.projectId || undefined);
    handleOpenWindow();
  }, [currentTerminal, handleOpenWindow]);

  // Check if current terminal can be stopped
  const canStopCurrent = currentTerminal?.status === 'running';

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

  const newShellLabel = newShellProjectName ? `New terminal in ${newShellProjectName}` : 'New terminal';

  // "Close all" kills every shell in the dock: ask first when commands are
  // still running (same prompt as the Terminal window, see CloseConfirmDialog).
  const handleCloseAll = useCallback(() => {
    // Only what this dock actually shows — `terminalSurfaces` says which ids
    // live in a Terminal window (ticket #37), and those are not ours to count
    // in the prompt any more than they are ours to close.
    const surfaces = useAppStore.getState().terminalSurfaces;
    const alive = allTerminals.filter((t) => terminals.get(t.id)?.visibility !== 'closed');
    const ids = alive.filter((t) => surfaces[t.id] !== 'window').map((t) => t.id);
    // Say which "all" this is, but only when there is another one to confuse
    // it with: with no Terminal window holding anything, "in the dock" is
    // noise. With one, it is the whole point of the ticket.
    const inWindows = alive.length - ids.length;
    void confirmCloseTerminals(ids, inWindows > 0 ? 'Close all terminals in the dock?' : 'Close all terminals?').then(
      (ok) => {
        if (ok) closeAllTerminals();
      }
    );
  }, [allTerminals, terminals, closeAllTerminals]);

  // ---- Collapsed strip ----
  if (!terminalPanelOpen) {
    return (
      <div
        className="glass flex shrink-0 items-center border-t border-border pl-3 pr-1.5"
        style={{ height: TERMINAL_BAR_HEIGHT }}
      >
        <button
          type="button"
          onClick={toggleTerminalPanel}
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          title="Show the terminal panel"
        >
          <Terminal className="size-3.5 text-faint" />
          <span className="font-medium">Terminal</span>
          {totalActiveCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-faint">
              <span className="tabular-nums">{totalActiveCount} active</span>
              {runningCount > 0 && (
                <span className="inline-flex items-center gap-1 text-st-done">
                  <StatusDot tone="running" size={6} />
                  {runningCount} running
                </span>
              )}
            </span>
          ) : (
            <span className="text-faint">No active terminal</span>
          )}
          <ChevronUp className="ml-auto size-3.5" />
        </button>
        <DockButton label="Open the Terminal window (beta)" onClick={handleOpenWindow}>
          <AppWindow className="size-3.5" />
        </DockButton>
        <DockButton label={newShellLabel} onClick={handleNewShell}>
          <Plus className="size-3.5" />
        </DockButton>
        {/* Main window: also answers the backend's quit confirmation. */}
        <CloseConfirmDialog handleAppQuit />
      </div>
    );
  }

  // ---- Expanded dock ----
  return (
    <TerminalDndContext allTerminals={allTerminals}>
      <div
        ref={containerRef}
        className={cn(
          'terminal-dock relative flex shrink-0 flex-col border-t border-border shadow-[0_-8px_24px_-16px_hsl(var(--shadow-color)/0.4)]',
          isResizing && 'select-none'
        )}
        style={{ height: terminalHeight }}
      >
        {/* Resize handle (top edge) */}
        <div
          className="group absolute -top-1 left-0 right-0 z-40 h-2 cursor-ns-resize"
          onMouseDown={handleResizeStart}
        >
          <div className={cn('mx-auto mt-[3px] h-0.5 w-full transition-colors', isResizing ? 'bg-primary' : 'bg-transparent group-hover:bg-accent-border')} />
        </div>

        {/* Toolbar */}
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-background/70 px-3">
          <Terminal className="size-3.5 text-faint" />
          <span className="text-xs font-medium">Terminal</span>
          <span className="text-xs tabular-nums text-faint">
            {visibleTerminals.length} open
            {hiddenTerminals.length > 0 && ` · ${hiddenTerminals.length} hidden`}
            {runningCount > 0 && ` · ${runningCount} running`}
          </span>

          <div className="ml-auto flex items-center gap-0.5">
            <DockButton label={newShellLabel} onClick={handleNewShell}>
              <Plus className="size-3.5" />
            </DockButton>
            <DockButton label="Open the Terminal window (beta)" onClick={handleOpenWindow}>
              <AppWindow className="size-3.5" />
            </DockButton>

            {/* Hidden terminals tray */}
            {hiddenTerminals.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="size-7 rounded-[var(--rad-xs)]" title="Hidden terminals" aria-label="Hidden terminals">
                    <Eye className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuLabel>Hidden terminals</DropdownMenuLabel>
                  {hiddenTerminals.map((item) => {
                    return (
                      <DropdownMenuItem key={item.id} onClick={() => handleShowTerminal(item)}>
                        <TerminalTypeIcon type={item.type} className="size-3.5" />
                        <StatusDot status={item.status} size={7} />
                        <span className="truncate">
                          {item.name}
                          {item.projectName && (
                            <span className="ml-1 text-faint">· {item.projectName}</span>
                          )}
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {currentTerminal && (
              <>
                <DockButton label="Move to the Terminal window" onClick={handleSendCurrentToWindow}>
                  <SquareArrowOutUpRight className="size-3.5" />
                </DockButton>
                <DockButton label="Clear output" onClick={handleClearCurrent}>
                  <Trash2 className="size-3.5" />
                </DockButton>
                {canStopCurrent && (
                  <DockButton
                    danger
                    label={
                      currentTerminal.type === 'shell'
                        ? 'Kill shell'
                        : currentTerminal.type === 'service'
                          ? 'Stop service'
                          : 'Stop script'
                    }
                    onClick={handleStopCurrent}
                  >
                    <Square className="size-3.5" />
                  </DockButton>
                )}
              </>
            )}

            {visibleTerminals.length > 0 && (
              <DockButton label="Close all terminals" onClick={handleCloseAll}>
                <XCircle className="size-3.5" />
              </DockButton>
            )}

            <DockButton label="Minimize" onClick={toggleTerminalPanel}>
              <ChevronDown className="size-4" />
            </DockButton>
          </div>
        </div>

        {/* Panes container */}
        <div
          ref={panesContainerRef}
          className={cn(
            'flex min-h-0 flex-1',
            (isResizing || resizingPaneIndex !== null) && 'select-none'
          )}
        >
          {visibleTerminals.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <p className="text-sm">
                {hiddenTerminals.length > 0
                  ? 'All terminals are hidden — use the eye button to bring one back.'
                  : 'No active terminal. Start a service or a script, or open a shell.'}
              </p>
              <Button variant="outline" size="sm" onClick={handleNewShell}>
                <Plus className="size-3.5" />
                {newShellLabel}
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
                    <div className="flex min-h-0 min-w-0 flex-col" style={{ width: `${widthPercent}%` }}>
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
                        className="w-1 flex-shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60"
                        onMouseDown={(e) => handlePaneResizeStart(e, paneIndex)}
                      />
                    )}
                  </Fragment>
                );
              })}
            </>
          )}
        </div>

        {/* Main window: also answers the backend's quit confirmation. */}
        <CloseConfirmDialog handleAppQuit />
      </div>
    </TerminalDndContext>
  );
}
