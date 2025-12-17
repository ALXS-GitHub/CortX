import { useEffect, useRef, useState, useCallback, useMemo, memo, Component, type ReactNode, Fragment } from 'react';
import { useAppStore, type TerminalPane } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  ArrowDownToLine,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import AnsiToHtml from 'ansi-to-html';
import type { LogEntry } from '@/types';
import { open } from '@tauri-apps/plugin-shell';
import { TerminalDndContext, type TerminalItem, type TerminalType } from './terminal-dnd';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { SortableTerminalTab } from './terminal-dnd';

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
const ansiConverter = new AnsiToHtml({
  fg: '#d4d4d4',
  bg: 'transparent',
  colors: {
    0: '#1e1e1e', // black
    1: '#f44747', // red
    2: '#6a9955', // green
    3: '#dcdcaa', // yellow
    4: '#569cd6', // blue
    5: '#c586c0', // magenta
    6: '#4ec9b0', // cyan
    7: '#d4d4d4', // white
    8: '#808080', // bright black
    9: '#f44747', // bright red
    10: '#6a9955', // bright green
    11: '#dcdcaa', // bright yellow
    12: '#569cd6', // bright blue
    13: '#c586c0', // bright magenta
    14: '#4ec9b0', // bright cyan
    15: '#ffffff', // bright white
  },
});

// URL regex pattern for detecting links
const urlRegex = /(https?:\/\/[^\s<>"')\],;]+)/g;

// ANSI escape code pattern for stripping
const ansiRegex = /\x1b\[[0-9;]*m/g;

// Cache for processed terminal content - avoids expensive re-computation
// Using WeakRef approach isn't suitable here, so we use LRU-style cache
const processedContentCache = new Map<string, string>();
const MAX_CACHE_SIZE = 2000; // Allow caching ~2x max logs per terminal

// Process terminal output: detect URLs in raw content, then convert ANSI and wrap URLs
function processTerminalContent(rawContent: string): string {
  // Check cache first
  const cached = processedContentCache.get(rawContent);
  if (cached !== undefined) {
    return cached;
  }

  let html: string;

  try {
    // First, find URLs in raw content BEFORE ANSI conversion
    // This prevents ANSI codes that colorize parts of URLs from breaking detection
    const urlMatches: string[] = [];
    const contentWithPlaceholders = rawContent.replace(urlRegex, (url) => {
      const index = urlMatches.length;
      urlMatches.push(url);
      return `__URL_${index}__`;
    });

    // Convert ANSI to HTML
    html = ansiConverter.toHtml(contentWithPlaceholders);

    // Also clean up any orphaned bracket sequences in the HTML output
    html = html.replace(/\[([0-9;]*)m/g, '');

    // Replace placeholders with clickable links
    html = html.replace(/__URL_(\d+)__/g, (_, indexStr) => {
      const rawUrl = urlMatches[parseInt(indexStr)];
      // Strip ANSI codes from the URL for clean display and href
      const cleanUrl = rawUrl.replace(ansiRegex, '');
      const escapedUrl = cleanUrl.replace(/"/g, '&quot;');
      return `<span class="terminal-link" data-url="${escapedUrl}">${cleanUrl}</span>`;
    });
  } catch (error) {
    // Fallback: just escape HTML and return plain text
    console.error('Error processing terminal content:', error);
    html = rawContent
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Manage cache size - remove oldest entries if too large
  if (processedContentCache.size >= MAX_CACHE_SIZE) {
    // Delete first 500 entries (oldest)
    const keysToDelete = Array.from(processedContentCache.keys()).slice(0, 500);
    for (const key of keysToDelete) {
      processedContentCache.delete(key);
    }
  }

  // Cache the result
  processedContentCache.set(rawContent, html);

  return html;
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
  onStopTerminal,
  onRemovePane,
  onFocusPane,
  showRemoveButton,
  handleTerminalClick,
}: {
  pane: TerminalPane;
  paneTerminals: TerminalItem[];
  activeTerminal: TerminalItem | null;
  isFocused: boolean;
  onSelectTerminal: (terminalId: string) => void;
  onHideTerminal: (terminalId: string) => void;
  onClearLogs: (terminalId: string) => void;
  onStopTerminal: (terminalId: string) => void;
  onRemovePane: () => void;
  onFocusPane: () => void;
  showRemoveButton: boolean;
  handleTerminalClick: (e: React.MouseEvent) => void;
}) {
  // Scroll state for this pane
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Scroll to bottom function
  const scrollToBottom = useCallback(() => {
    if (!scrollAreaRef.current) return;
    const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
    setUserScrolledUp(false);
  }, []);

  // Handle scroll events to detect if user scrolled up
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setUserScrolledUp(!isAtBottom);
  }, []);

  // Auto-scroll when logs change (only if not scrolled up)
  useEffect(() => {
    if (!userScrolledUp && activeTerminal) {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  }, [activeTerminal?.logs.length, userScrolledUp, scrollToBottom]);

  // Scroll to bottom when switching active terminal in this pane
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [pane.activeTerminalId, scrollToBottom]);

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
          items={pane.terminalIds}
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

        {/* Pane actions */}
        <div className="ml-auto flex items-center shrink-0 px-1">
          {activeTerminal && (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearLogs(activeTerminal.id);
                }}
                title="Clear logs"
              >
                <Trash2 className="size-3" />
              </Button>
              {activeTerminal.status === 'running' && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStopTerminal(activeTerminal.id);
                  }}
                  title="Stop"
                >
                  <Square className="size-3" />
                </Button>
              )}
            </>
          )}
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

      {/* Pane content - shows active terminal's logs */}
      {activeTerminal ? (
        <TerminalErrorBoundary onReset={() => onClearLogs(activeTerminal.id)}>
          <div ref={scrollAreaRef} className="flex-1 min-h-0 relative">
            {/* Absolute container gives ScrollArea explicit dimensions */}
            <div className="absolute inset-0">
              <ScrollArea
                className="h-full w-full"
                onScrollCapture={handleScroll}
              >
                <div
                  className="p-2 font-mono text-xs space-y-0.5"
                  onClick={handleTerminalClick}
                >
                  {activeTerminal.logs.length === 0 ? (
                    <div className="text-muted-foreground">Waiting for output...</div>
                  ) : (
                    <TerminalLogs logs={activeTerminal.logs} />
                  )}
                </div>
              </ScrollArea>
            </div>
            {/* Scroll to bottom button */}
            {userScrolledUp && (
              <Button
                variant="secondary"
                size="icon-sm"
                className="absolute bottom-2 right-4 z-10 shadow-md opacity-90 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  scrollToBottom();
                }}
                title="Scroll to bottom"
              >
                <ArrowDownToLine className="size-4" />
              </Button>
            )}
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
    activeTerminalServiceId,
    activeTerminalScriptId,
    serviceRuntimes,
    scriptRuntimes,
    projects,
    stopService,
    stopScript,
    clearServiceLogs,
    clearScriptLogs,
    closeAllTerminals,
    hideTerminal,
    hideScriptTerminal,
    showTerminal,
    showScriptTerminal,
    hiddenTerminalIds,
    closedTerminalIds,
    // Multi-pane state
    terminalPanes,
    focusedPaneId,
    removePane,
    setActiveTerminalInPane,
    focusPane,
    resizePanes,
  } = useAppStore();

  // Combined active terminal ID (prefixed to distinguish types)
  const activeTerminalId = activeTerminalScriptId
    ? `script:${activeTerminalScriptId}`
    : activeTerminalServiceId
    ? `service:${activeTerminalServiceId}`
    : null;

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
        detectedPort: runtime.detectedPort,
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
        lastExitCode: runtime.lastExitCode,
        lastSuccess: runtime.lastSuccess,
      });
    }

    return items;
  }, [serviceRuntimes, scriptRuntimes, getServiceInfo, getScriptInfo]);

  // Helper to extract raw ID from prefixed ID
  const getRawId = (prefixedId: string) => prefixedId.split(':')[1];

  // Get visible terminals (not hidden, not closed, has logs or is active)
  const visibleTerminals = useMemo(() => {
    return allTerminals.filter((item) => {
      const rawId = getRawId(item.id);
      const isHidden = hiddenTerminalIds.has(rawId);
      const isClosed = closedTerminalIds.has(rawId);
      const hasActivity = item.logs.length > 0 ||
        (item.type === 'service' && item.status !== 'stopped') ||
        (item.type === 'script' && item.status !== 'idle');
      return !isHidden && !isClosed && hasActivity;
    });
  }, [allTerminals, hiddenTerminalIds, closedTerminalIds]);

  // Get the project ID of the currently active terminal
  const activeProjectId = useMemo(() => {
    if (!activeTerminalId) return null;
    const activeItem = allTerminals.find((t) => t.id === activeTerminalId);
    return activeItem?.projectId || null;
  }, [activeTerminalId, allTerminals]);

  // Get hidden terminals (filter by active project)
  const hiddenTerminals = useMemo(() => {
    return allTerminals.filter((item) => {
      const rawId = getRawId(item.id);
      const isHidden = hiddenTerminalIds.has(rawId);
      const isClosed = closedTerminalIds.has(rawId);
      const hasActivity = item.logs.length > 0 ||
        (item.type === 'service' && item.status !== 'stopped') ||
        (item.type === 'script' && item.status !== 'idle');
      const sameProject = !activeProjectId || item.projectId === activeProjectId;
      return isHidden && !isClosed && hasActivity && sameProject;
    });
  }, [allTerminals, hiddenTerminalIds, closedTerminalIds, activeProjectId]);

  // Total active count (visible + hidden)
  const totalActiveCount = visibleTerminals.length + hiddenTerminals.length;

  // Handle stop for current terminal
  const handleStopCurrent = useCallback(async () => {
    if (!activeTerminalId) return;
    const [type, rawId] = activeTerminalId.split(':');
    if (type === 'script') {
      await stopScript(rawId);
    } else {
      await stopService(rawId);
    }
  }, [activeTerminalId, stopScript, stopService]);

  // Handle hide terminal (removes from pane, can be restored)
  const handleHideTerminal = useCallback((terminalId: string) => {
    const [type, rawId] = terminalId.split(':');
    if (type === 'script') {
      hideScriptTerminal(rawId);
    } else {
      hideTerminal(rawId);
    }
  }, [hideTerminal, hideScriptTerminal]);

  // Handle show terminal from hidden list
  const handleShowTerminal = useCallback((item: TerminalItem) => {
    const rawId = getRawId(item.id);
    if (item.type === 'script') {
      showScriptTerminal(rawId);
    } else {
      showTerminal(rawId);
    }
  }, [showTerminal, showScriptTerminal]);

  // Handle clear logs for current terminal
  const handleClearCurrent = useCallback(() => {
    if (!activeTerminalId) return;
    const [type, rawId] = activeTerminalId.split(':');
    if (type === 'script') {
      clearScriptLogs(rawId);
    } else {
      clearServiceLogs(rawId);
    }
  }, [activeTerminalId, clearScriptLogs, clearServiceLogs]);

  // Get current terminal info
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

  // Handle link clicks in terminal output
  const handleTerminalClick = useCallback(async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('terminal-link')) {
      e.preventDefault();
      const url = target.dataset.url;
      if (url) {
        try {
          await open(url);
        } catch (error) {
          console.error('Failed to open URL:', error);
        }
      }
    }
  }, []);

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

  // Get active terminal info for a pane
  const getActiveTerminalForPane = useCallback((pane: TerminalPane): TerminalItem | null => {
    if (!pane.activeTerminalId) return null;
    return allTerminals.find(t => t.id === pane.activeTerminalId) || null;
  }, [allTerminals]);

  // Get all terminals in a pane
  const getTerminalsInPane = useCallback((pane: TerminalPane): TerminalItem[] => {
    return pane.terminalIds
      .map(id => allTerminals.find(t => t.id === id))
      .filter((t): t is TerminalItem => t !== undefined);
  }, [allTerminals]);

  // Clear logs for a specific pane's terminal
  const handleClearPaneLogs = useCallback((terminalId: string) => {
    const [type, rawId] = terminalId.split(':');
    if (type === 'script') {
      clearScriptLogs(rawId);
    } else {
      clearServiceLogs(rawId);
    }
  }, [clearScriptLogs, clearServiceLogs]);

  // Stop service/script for a pane's terminal
  const handleStopPaneTerminal = useCallback(async (terminalId: string) => {
    const [type, rawId] = terminalId.split(':');
    if (type === 'script') {
      await stopScript(rawId);
    } else {
      await stopService(rawId);
    }
  }, [stopScript, stopService]);

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
                    title={currentTerminal.type === 'script' ? 'Stop script' : 'Stop service'}
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
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <p>
                {hiddenTerminals.length > 0
                  ? 'All terminals are hidden. Click the eye icon to show them.'
                  : 'No active terminals. Start a service or script to see output here.'}
              </p>
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
                        onStopTerminal={handleStopPaneTerminal}
                        onRemovePane={() => removePane(pane.id)}
                        onFocusPane={() => focusPane(pane.id)}
                        showRemoveButton={terminalPanes.length > 1}
                        handleTerminalClick={handleTerminalClick}
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

// Memoized log line component to prevent unnecessary re-renders
const LogLine = memo(function LogLine({ log }: { log: LogEntry }) {
  return (
    <div
      className={cn(
        'whitespace-pre-wrap break-all',
        log.stream === 'stderr' && 'text-red-400'
      )}
      dangerouslySetInnerHTML={{
        __html: processTerminalContent(log.content),
      }}
    />
  );
});

// Memoized terminal logs component - only re-renders when logs array changes
const TerminalLogs = memo(function TerminalLogs({ logs }: { logs: LogEntry[] }) {
  return (
    <>
      {logs.map((log, index) => (
        <LogLine key={index} log={log} />
      ))}
    </>
  );
});

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

  const colors = type === 'script' ? scriptColors : serviceColors;

  return (
    <Circle
      className={cn('size-2 fill-current', colors[status as keyof typeof colors] || 'text-muted-foreground')}
    />
  );
}
