import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from '@/components/ui/sidebar';
import { useAppStore } from '@/stores/appStore';
import { LayoutDashboard, Settings, FolderOpen, Terminal, Circle, Play, X, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { View, ServiceStatus } from '@/types';
import { Button } from '@/components/ui/button';

// Minimized terminal bar height
const MINIMIZED_TERMINAL_HEIGHT = 32;

export function AppSidebar() {
  const {
    currentView,
    setCurrentView,
    projects,
    selectProject,
    serviceRuntimes,
    showTerminal,
    hiddenTerminalIds,
    closedTerminalIds,
    startService,
    stopService,
    closeTerminal,
    terminalPanelOpen,
    terminalHeight,
  } = useAppStore();

  // Calculate bottom padding based on terminal state
  const bottomPadding = terminalPanelOpen ? terminalHeight : MINIMIZED_TERMINAL_HEIGHT;

  const handleNavigate = (view: View) => {
    setCurrentView(view);
    if (view === 'dashboard') {
      selectProject(null);
    }
  };

  // Get all services with runtime state (running or stopped with logs), grouped by project
  const servicesByProject = new Map<string, {
    projectId: string;
    projectName: string;
    services: {
      serviceId: string;
      serviceName: string;
      status: ServiceStatus;
      isHidden: boolean;
    }[];
  }>();

  for (const [serviceId, runtime] of serviceRuntimes.entries()) {
    // Skip closed terminals
    if (closedTerminalIds.has(serviceId)) continue;
    // Only show services that have logs or are running
    if (runtime.logs.length === 0 && runtime.status === 'stopped') continue;

    // Find the project and service
    for (const project of projects) {
      const service = project.services.find((s) => s.id === serviceId);
      if (service) {
        const existing = servicesByProject.get(project.id);
        const serviceInfo = {
          serviceId,
          serviceName: service.name,
          status: runtime.status,
          isHidden: hiddenTerminalIds.has(serviceId),
        };

        if (existing) {
          existing.services.push(serviceInfo);
        } else {
          servicesByProject.set(project.id, {
            projectId: project.id,
            projectName: project.name,
            services: [serviceInfo],
          });
        }
        break;
      }
    }
  }

  const projectsWithServices = Array.from(servicesByProject.values());
  const totalServiceCount = projectsWithServices.reduce(
    (acc, p) => acc + p.services.length,
    0
  );
  const runningCount = projectsWithServices.reduce(
    (acc, p) => acc + p.services.filter(s => s.status === 'running').length,
    0
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="gap-3" tooltip="Cortx">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg overflow-hidden">
                <img src="/cortx-logo.png" alt="Cortx" className="size-8 object-contain" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-semibold">Cortx</span>
                <span className="text-xs text-muted-foreground">v0.1.0</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent style={{ paddingBottom: bottomPadding + 16 }}>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={currentView === 'dashboard'}
                  onClick={() => handleNavigate('dashboard')}
                  tooltip="Dashboard"
                >
                  <LayoutDashboard className="size-4" />
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={currentView === 'settings'}
                  onClick={() => handleNavigate('settings')}
                  tooltip="Settings"
                >
                  <Settings className="size-4" />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {projects.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Recent Projects</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {projects
                  .slice()
                  .sort((a, b) => {
                    const aDate = a.lastOpenedAt || a.createdAt;
                    const bDate = b.lastOpenedAt || b.createdAt;
                    return new Date(bDate).getTime() - new Date(aDate).getTime();
                  })
                  .slice(0, 5)
                  .map((project) => (
                    <SidebarMenuItem key={project.id}>
                      <SidebarMenuButton
                        onClick={() => selectProject(project.id)}
                        tooltip={project.name}
                      >
                        <FolderOpen className="size-4" />
                        <span>{project.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Services Section - Grouped by Project */}
        {totalServiceCount > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <span className="flex items-center gap-2">
                Services
                {runningCount > 0 && (
                  <span className="text-xs bg-green-500/20 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded-full">
                    {runningCount} running
                  </span>
                )}
              </span>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {projectsWithServices.map(({ projectId, projectName, services }) => {
                  const runningServices = services.filter(s => s.status === 'running');
                  const stoppedServices = services.filter(s => s.status !== 'running');
                  const hasRunning = runningServices.length > 0;
                  const hasStopped = stoppedServices.length > 0;

                  const handleStartAll = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    stoppedServices.forEach(s => startService(s.serviceId));
                  };

                  const handleStopAll = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    runningServices.forEach(s => stopService(s.serviceId));
                  };

                  const handleCloseAll = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    services.forEach(s => closeTerminal(s.serviceId));
                  };

                  const allStopped = !hasRunning;

                  return (
                  <SidebarMenuItem key={projectId}>
                    <SidebarMenuButton className="font-medium group/project" tooltip={projectName}>
                      <FolderOpen className="size-4" />
                      <span className="flex-1">{projectName}</span>
                      <span className="text-xs text-muted-foreground group-hover/project:hidden">
                        {services.length}
                      </span>
                      {/* Project action buttons - visible on hover */}
                      <div className="hidden group-hover/project:flex items-center gap-0.5">
                        {hasStopped && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-5 p-0 hover:bg-green-500/20 hover:text-green-500"
                            onClick={handleStartAll}
                            title="Start all services"
                          >
                            <Play className="size-3" />
                          </Button>
                        )}
                        {hasRunning && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-5 p-0 hover:bg-destructive/20 hover:text-destructive"
                            onClick={handleStopAll}
                            title="Stop all services"
                          >
                            <Square className="size-3" />
                          </Button>
                        )}
                        {allStopped && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-5 p-0 hover:bg-destructive/20 hover:text-destructive"
                            onClick={handleCloseAll}
                            title="Close all terminals"
                          >
                            <X className="size-3" />
                          </Button>
                        )}
                      </div>
                    </SidebarMenuButton>
                    <SidebarMenuSub>
                      {services.map(({ serviceId, serviceName, status, isHidden }) => (
                        <SidebarMenuSubItem key={serviceId}>
                          <SidebarMenuSubButton
                            onClick={() => showTerminal(serviceId)}
                            className="relative group/service"
                          >
                            <div className="relative">
                              <Terminal className="size-3.5" />
                              {isHidden && (
                                <Circle className="absolute -top-1 -right-1 size-1.5 fill-yellow-500 text-yellow-500 animate-pulse" />
                              )}
                            </div>
                            <span className={cn('text-xs flex-1', isHidden && 'opacity-60')}>
                              {serviceName}
                            </span>
                            {/* Status indicator */}
                            {status === 'running' ? (
                              <Circle className="size-1.5 fill-green-500 text-green-500 animate-pulse" />
                            ) : (
                              <Circle className="size-1.5 fill-muted-foreground text-muted-foreground" />
                            )}
                            {/* Action buttons - visible on hover */}
                            <div className="hidden group-hover/service:flex items-center gap-0.5 ml-1">
                              {status === 'running' ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-5 p-0 hover:bg-destructive/20 hover:text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    stopService(serviceId);
                                  }}
                                  title="Stop service"
                                >
                                  <Square className="size-3" />
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-5 p-0 hover:bg-green-500/20 hover:text-green-500"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startService(serviceId);
                                    }}
                                    title="Start service"
                                  >
                                    <Play className="size-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-5 p-0 hover:bg-destructive/20 hover:text-destructive"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      closeTerminal(serviceId);
                                    }}
                                    title="Close terminal"
                                  >
                                    <X className="size-3" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              className="text-muted-foreground"
              tooltip="Settings"
              onClick={() => handleNavigate('settings')}
            >
              <Settings className="size-4" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
