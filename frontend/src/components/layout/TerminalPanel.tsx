import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import AnsiToHtml from 'ansi-to-html';
import { open } from '@tauri-apps/plugin-shell';

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

// Strip ANSI escape codes and orphaned bracket sequences
function stripAnsi(str: string): string {
  // Remove proper ANSI escape codes (ESC [ ... m)
  let result = str.replace(/\x1b\[[0-9;]*m/g, '');
  // Also remove orphaned bracket sequences that look like ANSI codes (e.g., [1m, [22m, [39m)
  // These can appear when ESC character is lost during transmission
  result = result.replace(/\[([0-9;]*)m/g, '');
  return result;
}

// Process terminal output: detect URLs in clean content, then wrap them in HTML
function processTerminalContent(rawContent: string): string {
  // Strip ANSI codes to find clean URLs
  const cleanContent = stripAnsi(rawContent);

  // Find all URLs in clean content
  const urls: string[] = [];
  let match;
  const urlRegexCopy = new RegExp(urlRegex.source, 'g');
  while ((match = urlRegexCopy.exec(cleanContent)) !== null) {
    urls.push(match[0]);
  }

  // Convert ANSI to HTML
  let html = ansiConverter.toHtml(rawContent);

  // Also clean up any orphaned bracket sequences in the HTML output
  html = html.replace(/\[([0-9;]*)m/g, '');

  if (urls.length === 0) {
    return html;
  }

  // For each unique URL, wrap it in an anchor tag
  // The URL text might be split across HTML spans, so we need a flexible pattern
  for (const url of [...new Set(urls)]) {
    const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Pattern allows optional HTML tags between characters
    const pattern = escapedUrl.split('').join('(?:<[^>]*>)*');
    const regex = new RegExp(pattern, 'g');

    html = html.replace(regex, (matchedText) => {
      // matchedText contains the URL text possibly with HTML tags interspersed
      // We wrap the whole thing in an anchor, preserving internal formatting
      return `<a href="${url}" class="terminal-link" data-url="${url}">${matchedText}</a>`;
    });
  }

  return html;
}

export function TerminalPanel() {
  const {
    terminalPanelOpen,
    toggleTerminalPanel,
    activeTerminalServiceId,
    setActiveTerminalServiceId,
    serviceRuntimes,
    projects,
    stopService,
    clearServiceLogs,
    closeAllTerminals,
    hideTerminal,
    showTerminal,
    hiddenTerminalIds,
    closedTerminalIds,
  } = useAppStore();

  // Scroll state
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

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

  // Get all services with logs or running status (visible ones, excluding closed)
  const visibleServices = Array.from(serviceRuntimes.entries())
    .filter(
      ([serviceId, runtime]) =>
        !hiddenTerminalIds.has(serviceId) &&
        !closedTerminalIds.has(serviceId) &&
        (runtime.logs.length > 0 || runtime.status !== 'stopped')
    )
    .map(([serviceId, runtime]) => {
      const { serviceName, projectName, projectId } = getServiceInfo(serviceId);
      return { serviceId, runtime, serviceName, projectName, projectId };
    });

  // Get the project ID of the currently active terminal
  const activeProjectId = activeTerminalServiceId
    ? getServiceInfo(activeTerminalServiceId).projectId
    : null;

  // Get hidden services that are still running or have logs (excluding closed)
  // Filter to only show services from the same project as the active terminal
  const hiddenServices = Array.from(serviceRuntimes.entries())
    .filter(
      ([serviceId, runtime]) =>
        hiddenTerminalIds.has(serviceId) &&
        !closedTerminalIds.has(serviceId) &&
        (runtime.logs.length > 0 || runtime.status !== 'stopped')
    )
    .map(([serviceId, runtime]) => {
      const { serviceName, projectName, projectId } = getServiceInfo(serviceId);
      return { serviceId, runtime, serviceName, projectName, projectId };
    })
    .filter(({ projectId }) => !activeProjectId || projectId === activeProjectId);

  // Total active count (visible + hidden)
  const totalActiveCount = visibleServices.length + hiddenServices.length;

  // Handle scroll events to detect if user scrolled up
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setUserScrolledUp(!isAtBottom);
  }, []);

  // Scroll to bottom function
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
    setUserScrolledUp(false);
  }, []);

  // Auto-scroll when new logs arrive (only if not scrolled up)
  useEffect(() => {
    if (!userScrolledUp) {
      scrollToBottom();
    }
  }, [activeTerminalServiceId, serviceRuntimes, userScrolledUp, scrollToBottom]);

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

  const currentRuntime = activeTerminalServiceId
    ? serviceRuntimes.get(activeTerminalServiceId)
    : null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 h-64 bg-card border-t flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Terminal</span>
          <span className="text-xs text-muted-foreground">
            ({visibleServices.length} visible
            {hiddenServices.length > 0 && `, ${hiddenServices.length} hidden`})
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Hidden services dropdown */}
          {hiddenServices.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" title="Show hidden terminals">
                  <Eye className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {hiddenServices.map(({ serviceId, runtime, serviceName, projectName }) => (
                  <DropdownMenuItem key={serviceId} onClick={() => showTerminal(serviceId)}>
                    <StatusIndicator status={runtime.status} />
                    <span className="ml-2">
                      {serviceName}
                      {projectName && (
                        <span className="text-muted-foreground ml-1">({projectName})</span>
                      )}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {activeTerminalServiceId && currentRuntime && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => clearServiceLogs(activeTerminalServiceId)}
                title="Clear logs"
              >
                <Trash2 className="size-3.5" />
              </Button>
              {currentRuntime.status === 'running' && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => stopService(activeTerminalServiceId)}
                  title="Stop service"
                >
                  <Square className="size-3.5" />
                </Button>
              )}
            </>
          )}

          {/* Close all terminals button */}
          {visibleServices.length > 0 && (
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
      {visibleServices.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p>
            {hiddenServices.length > 0
              ? 'All terminals are hidden. Click the eye icon to show them.'
              : 'No active terminals. Start a service to see output here.'}
          </p>
        </div>
      ) : (
        <Tabs
          value={activeTerminalServiceId || visibleServices[0]?.serviceId}
          onValueChange={setActiveTerminalServiceId}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-auto p-0 overflow-x-auto">
            {visibleServices.map(({ serviceId, runtime, serviceName, projectName }) => (
              <TabsTrigger
                key={serviceId}
                value={serviceId}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-3 py-1.5 gap-2 shrink-0"
              >
                <StatusIndicator status={runtime.status} />
                <span className="text-xs">
                  {serviceName}
                  {projectName && (
                    <span className="text-muted-foreground ml-1">({projectName})</span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-4 p-0 ml-1 hover:bg-destructive/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Just hide the terminal, don't stop the service
                    hideTerminal(serviceId);
                  }}
                  title="Hide terminal"
                >
                  <X className="size-3" />
                </Button>
              </TabsTrigger>
            ))}
          </TabsList>

          {visibleServices.map(({ serviceId, runtime }) => (
            <TabsContent
              key={serviceId}
              value={serviceId}
              className="flex-1 m-0 min-h-0 relative"
            >
              <ScrollArea
                className="h-full"
                ref={scrollRef}
                onScrollCapture={handleScroll}
              >
                <div
                  className="p-2 font-mono text-xs space-y-0.5"
                  onClick={handleTerminalClick}
                >
                  {runtime.logs.length === 0 ? (
                    <div className="text-muted-foreground">Waiting for output...</div>
                  ) : (
                    runtime.logs.map((log, index) => (
                      <div
                        key={index}
                        className={cn(
                          'whitespace-pre-wrap break-all',
                          log.stream === 'stderr' && 'text-red-400'
                        )}
                        dangerouslySetInnerHTML={{
                          __html: processTerminalContent(log.content),
                        }}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>

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
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

function StatusIndicator({ status }: { status: string }) {
  const colors = {
    stopped: 'text-muted-foreground',
    starting: 'text-yellow-500 animate-pulse',
    running: 'text-green-500',
    error: 'text-red-500',
  };

  return (
    <Circle
      className={cn('size-2 fill-current', colors[status as keyof typeof colors] || colors.stopped)}
    />
  );
}
