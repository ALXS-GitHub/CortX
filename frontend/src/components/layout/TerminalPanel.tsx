import { useEffect, useRef, useState, useCallback, useMemo, memo, Component, type ReactNode } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  ArrowDown,
  XCircle,
  GripHorizontal,
  Terminal,
  FileCode,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import AnsiToHtml from 'ansi-to-html';
import type { LogEntry, ServiceStatus, ScriptStatus } from '@/types';
import { open } from '@tauri-apps/plugin-shell';

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

// Cache for processed terminal content - avoids expensive re-computation
// Using WeakRef approach isn't suitable here, so we use LRU-style cache
const processedContentCache = new Map<string, string>();
const MAX_CACHE_SIZE = 2000; // Allow caching ~2x max logs per terminal

// Process terminal output: detect URLs in clean content, then wrap them in HTML
function processTerminalContent(rawContent: string): string {
  // Check cache first
  const cached = processedContentCache.get(rawContent);
  if (cached !== undefined) {
    return cached;
  }

  let html: string;

  try {
    // Convert ANSI to HTML
    html = ansiConverter.toHtml(rawContent);

    // Also clean up any orphaned bracket sequences in the HTML output
    html = html.replace(/\[([0-9;]*)m/g, '');

    // Find URLs directly in the HTML output (simpler, safer approach)
    // This handles the common case where URLs are not split by ANSI codes
    html = html.replace(urlRegex, (url) => {
      // Escape the URL for use in data attribute
      const escapedUrl = url.replace(/"/g, '&quot;');
      return `<span class="terminal-link" data-url="${escapedUrl}">${url}</span>`;
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

// Terminal item type for unified handling
type TerminalType = 'service' | 'script';

interface TerminalItem {
  id: string;
  type: TerminalType;
  name: string;
  projectName: string;
  projectId: string;
  status: ServiceStatus | ScriptStatus;
  logs: LogEntry[];
  detectedPort?: number;
  activeMode?: string;
  lastExitCode?: number;
  lastSuccess?: boolean;
}

export function TerminalPanel() {
  const {
    terminalPanelOpen,
    toggleTerminalPanel,
    terminalHeight,
    setTerminalHeight,
    activeTerminalServiceId,
    setActiveTerminalServiceId,
    activeTerminalScriptId,
    setActiveTerminalScriptId,
    serviceRuntimes,
    scriptRuntimes,
    projects,
    stopService,
    stopScript,
    clearServiceLogs,
    clearScriptLogs,
    closeAllTerminals,
    hideTerminal,
    showTerminal,
    hiddenTerminalIds,
    closedTerminalIds,
  } = useAppStore();

  // Combined active terminal ID (prefixed to distinguish types)
  const activeTerminalId = activeTerminalScriptId
    ? `script:${activeTerminalScriptId}`
    : activeTerminalServiceId
    ? `service:${activeTerminalServiceId}`
    : null;

  // Scroll state
  const containerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

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

  // Handle scroll events to detect if user scrolled up
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setUserScrolledUp(!isAtBottom);
  }, []);

  // Scroll to bottom function - finds the scroll viewport directly
  const scrollToBottom = useCallback(() => {
    if (!containerRef.current) return;

    // Find the scroll viewport directly within our container
    const viewport = containerRef.current.querySelector('[data-radix-scroll-area-viewport]');
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
    setUserScrolledUp(false);
  }, []);

  // Scroll to bottom when switching terminals - with delay to ensure DOM is updated
  useEffect(() => {
    // Use double requestAnimationFrame to ensure the tab switch is complete
    // and the new content is rendered before scrolling
    const frame1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    });
    return () => cancelAnimationFrame(frame1);
  }, [activeTerminalId, scrollToBottom]);

  // Auto-scroll when new logs arrive (only if not scrolled up)
  useEffect(() => {
    if (!userScrolledUp) {
      // Small delay to ensure new content is rendered
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  }, [serviceRuntimes, scriptRuntimes, userScrolledUp, scrollToBottom]);

  // Handle switching active terminal
  const handleSwitchTerminal = useCallback(
    (terminalId: string) => {
      const [type, rawId] = terminalId.split(':');
      if (type === 'script') {
        setActiveTerminalScriptId(rawId);
        // Note: setActiveTerminalScriptId already clears activeTerminalServiceId
      } else {
        setActiveTerminalServiceId(rawId);
        // Note: setActiveTerminalServiceId already clears activeTerminalScriptId
      }
    },
    [setActiveTerminalServiceId, setActiveTerminalScriptId]
  );

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
                  <DropdownMenuItem key={item.id} onClick={() => showTerminal(getRawId(item.id))}>
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

      {/* Tabs and content */}
      {visibleTerminals.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p>
            {hiddenTerminals.length > 0
              ? 'All terminals are hidden. Click the eye icon to show them.'
              : 'No active terminals. Start a service or script to see output here.'}
          </p>
        </div>
      ) : (
        <Tabs
          value={activeTerminalId || visibleTerminals[0]?.id}
          onValueChange={handleSwitchTerminal}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-auto p-0 overflow-x-auto overflow-y-hidden">
            {visibleTerminals.map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-3 py-1.5 gap-2 shrink-0"
              >
                {item.type === 'script' ? (
                  <FileCode className="size-3 text-muted-foreground" />
                ) : (
                  <Terminal className="size-3 text-muted-foreground" />
                )}
                <StatusIndicator status={item.status} type={item.type} />
                <span className="text-xs">
                  {item.name}
                  {item.activeMode && (
                    <span className="text-muted-foreground ml-1">({item.activeMode})</span>
                  )}
                  {item.projectName && !item.activeMode && (
                    <span className="text-muted-foreground ml-1">({item.projectName})</span>
                  )}
                </span>
                {item.type === 'service' && item.detectedPort && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-mono">
                    :{item.detectedPort}
                  </span>
                )}
                {item.type === 'script' && item.status !== 'idle' && item.status !== 'running' && (
                  <span
                    className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded font-mono',
                      item.lastSuccess
                        ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                        : 'bg-red-500/20 text-red-600 dark:text-red-400'
                    )}
                  >
                    {item.lastSuccess ? 'OK' : `Exit ${item.lastExitCode}`}
                  </span>
                )}
                <div
                  role="button"
                  tabIndex={0}
                  className="size-4 p-0 ml-1 flex items-center justify-center rounded hover:bg-destructive/20 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Just hide the terminal, don't stop the service/script
                    hideTerminal(getRawId(item.id));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      hideTerminal(getRawId(item.id));
                    }
                  }}
                  title="Hide terminal"
                >
                  <X className="size-3" />
                </div>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Only render the active terminal's content - major performance optimization */}
          {currentTerminal && (
            <div className="flex-1 min-h-0 relative">
              <TerminalErrorBoundary onReset={handleClearCurrent}>
                <ScrollArea
                  className="h-full"
                  onScrollCapture={handleScroll}
                >
                  <div
                    className="p-2 font-mono text-xs space-y-0.5"
                    onClick={handleTerminalClick}
                  >
                    {currentTerminal.logs.length === 0 ? (
                      <div className="text-muted-foreground">Waiting for output...</div>
                    ) : (
                      <TerminalLogs logs={currentTerminal.logs} />
                    )}
                  </div>
                </ScrollArea>
              </TerminalErrorBoundary>

              {/* Scroll to bottom button */}
              {userScrolledUp && (
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="absolute bottom-2 right-4 shadow-md"
                  onClick={scrollToBottom}
                  title="Scroll to bottom"
                >
                  <ArrowDown className="size-3.5" />
                </Button>
              )}
            </div>
          )}
        </Tabs>
      )}
    </div>
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
