import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ChevronDown,
  ChevronUp,
  X,
  Trash2,
  Square,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
  } = useAppStore();

  // Get all services with logs or running status
  const activeServices = Array.from(serviceRuntimes.entries())
    .filter(([, runtime]) => runtime.logs.length > 0 || runtime.status !== 'stopped')
    .map(([serviceId, runtime]) => {
      // Find the service details
      let serviceName = serviceId;
      let projectName = '';
      for (const project of projects) {
        const service = project.services.find((s) => s.id === serviceId);
        if (service) {
          serviceName = service.name;
          projectName = project.name;
          break;
        }
      }
      return { serviceId, runtime, serviceName, projectName };
    });

  // Auto-scroll ref
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeTerminalServiceId, serviceRuntimes]);

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
          <span>Terminal ({activeServices.length} active)</span>
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
            ({activeServices.length} active)
          </span>
        </div>
        <div className="flex items-center gap-1">
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
      {activeServices.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p>No active terminals. Start a service to see output here.</p>
        </div>
      ) : (
        <Tabs
          value={activeTerminalServiceId || activeServices[0]?.serviceId}
          onValueChange={setActiveTerminalServiceId}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-auto p-0">
            {activeServices.map(({ serviceId, runtime, serviceName, projectName }) => (
              <TabsTrigger
                key={serviceId}
                value={serviceId}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-3 py-1.5 gap-2"
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
                    if (runtime.status === 'running') {
                      stopService(serviceId);
                    }
                    clearServiceLogs(serviceId);
                  }}
                >
                  <X className="size-3" />
                </Button>
              </TabsTrigger>
            ))}
          </TabsList>

          {activeServices.map(({ serviceId, runtime }) => (
            <TabsContent
              key={serviceId}
              value={serviceId}
              className="flex-1 m-0 min-h-0"
            >
              <ScrollArea className="h-full" ref={scrollRef}>
                <div className="p-2 font-mono text-xs space-y-0.5">
                  {runtime.logs.length === 0 ? (
                    <div className="text-muted-foreground">
                      Waiting for output...
                    </div>
                  ) : (
                    runtime.logs.map((log, index) => (
                      <div
                        key={index}
                        className={cn(
                          'whitespace-pre-wrap break-all',
                          log.stream === 'stderr' && 'text-red-500'
                        )}
                      >
                        {log.content}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
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
