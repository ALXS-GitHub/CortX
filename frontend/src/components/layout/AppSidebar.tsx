import { useState, useEffect } from 'react';
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
  useSidebar,
} from '@/components/ui/sidebar';
import { useAppStore } from '@/stores/appStore';
import { LayoutDashboard, Settings, FolderOpen, Terminal, Circle, Play, X, Square, FileCode, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { View, ServiceStatus, ScriptStatus } from '@/types';
import { getVersion } from '@tauri-apps/api/app';

// Minimized terminal bar height
const MINIMIZED_TERMINAL_HEIGHT = 32;

export function AppSidebar() {
  const [appVersion, setAppVersion] = useState<string>('');
  const { state: sidebarState } = useSidebar();
  const isCollapsed = sidebarState === 'collapsed';

  const {
    currentView,
    setCurrentView,
    projects,
    selectProject,
    serviceRuntimes,
    scriptRuntimes,
    showTerminal,
    hiddenTerminalIds,
    closedTerminalIds,
    startService,
    stopService,
    closeTerminal,
    runScript,
    stopScript,
    closeScriptTerminal,
    showScriptTerminal,
    terminalPanelOpen,
    terminalHeight,
    globalScripts,
    globalScriptRuntimes,
    stopGlobalScript,
    closeGlobalScriptTerminal,
    showGlobalScriptTerminal,
    openRunScriptDialog,
  } = useAppStore();

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(''));
  }, []);

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

  // Get all scripts with runtime state, grouped by project
  const scriptsByProject = new Map<string, {
    projectId: string;
    projectName: string;
    scripts: {
      scriptId: string;
      scriptName: string;
      status: ScriptStatus;
      isHidden: boolean;
    }[];
  }>();

  for (const [scriptId, runtime] of scriptRuntimes.entries()) {
    // Skip closed terminals
    if (closedTerminalIds.has(scriptId)) continue;
    // Only show scripts that have logs or are not idle
    if (runtime.logs.length === 0 && runtime.status === 'idle') continue;

    // Find the project and script
    for (const project of projects) {
      const script = project.scripts?.find((s) => s.id === scriptId);
      if (script) {
        const existing = scriptsByProject.get(project.id);
        const scriptInfo = {
          scriptId,
          scriptName: script.name,
          status: runtime.status,
          isHidden: hiddenTerminalIds.has(scriptId),
        };

        if (existing) {
          existing.scripts.push(scriptInfo);
        } else {
          scriptsByProject.set(project.id, {
            projectId: project.id,
            projectName: project.name,
            scripts: [scriptInfo],
          });
        }
        break;
      }
    }
  }

  const projectsWithScripts = Array.from(scriptsByProject.values());
  const totalScriptCount = projectsWithScripts.reduce(
    (acc, p) => acc + p.scripts.length,
    0
  );
  const runningScriptsCount = projectsWithScripts.reduce(
    (acc, p) => acc + p.scripts.filter(s => s.status === 'running').length,
    0
  );

  // Get global scripts with runtime state
  const globalScriptsWithRuntime = Array.from(globalScriptRuntimes.entries())
    .filter(([scriptId, runtime]) => {
      if (closedTerminalIds.has(scriptId)) return false;
      return runtime.logs.length > 0 || runtime.status !== 'idle';
    })
    .map(([scriptId, runtime]) => {
      const script = globalScripts.find(s => s.id === scriptId);
      return {
        scriptId,
        scriptName: script?.name || 'Unknown',
        status: runtime.status,
        isHidden: hiddenTerminalIds.has(scriptId),
      };
    });

  const runningGlobalScriptsCount = globalScriptsWithRuntime.filter(
    s => s.status === 'running'
  ).length;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className={cn("gap-3", isCollapsed && "justify-center")} tooltip="Cortx">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg overflow-hidden flex-shrink-0">
                <img src="/cortx-logo.png" alt="Cortx" className="size-8 object-contain" />
              </div>
              {!isCollapsed && (
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">Cortx</span>
                  {appVersion && <span className="text-xs text-muted-foreground">v{appVersion}</span>}
                </div>
              )}
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
                  isActive={currentView === 'scripts' || currentView === 'script-detail'}
                  onClick={() => handleNavigate('scripts')}
                  tooltip="Scripts"
                >
                  <ScrollText className="size-4" />
                  <span>Scripts</span>
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
                          <div
                            role="button"
                            tabIndex={0}
                            className="size-5 p-0 flex items-center justify-center rounded hover:bg-green-500/20 hover:text-green-500 cursor-pointer"
                            onClick={handleStartAll}
                            onKeyDown={(e) => e.key === 'Enter' && handleStartAll(e as unknown as React.MouseEvent)}
                            title="Start all services"
                          >
                            <Play className="size-3" />
                          </div>
                        )}
                        {hasRunning && (
                          <div
                            role="button"
                            tabIndex={0}
                            className="size-5 p-0 flex items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer"
                            onClick={handleStopAll}
                            onKeyDown={(e) => e.key === 'Enter' && handleStopAll(e as unknown as React.MouseEvent)}
                            title="Stop all services"
                          >
                            <Square className="size-3" />
                          </div>
                        )}
                        {allStopped && (
                          <div
                            role="button"
                            tabIndex={0}
                            className="size-5 p-0 flex items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer"
                            onClick={handleCloseAll}
                            onKeyDown={(e) => e.key === 'Enter' && handleCloseAll(e as unknown as React.MouseEvent)}
                            title="Close all terminals"
                          >
                            <X className="size-3" />
                          </div>
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
                                <div
                                  role="button"
                                  tabIndex={0}
                                  className="size-5 p-0 flex items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    stopService(serviceId);
                                  }}
                                  onKeyDown={(e) => e.key === 'Enter' && stopService(serviceId)}
                                  title="Stop service"
                                >
                                  <Square className="size-3" />
                                </div>
                              ) : (
                                <>
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    className="size-5 p-0 flex items-center justify-center rounded hover:bg-green-500/20 hover:text-green-500 cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startService(serviceId);
                                    }}
                                    onKeyDown={(e) => e.key === 'Enter' && startService(serviceId)}
                                    title="Start service"
                                  >
                                    <Play className="size-3" />
                                  </div>
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    className="size-5 p-0 flex items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      closeTerminal(serviceId);
                                    }}
                                    onKeyDown={(e) => e.key === 'Enter' && closeTerminal(serviceId)}
                                    title="Close terminal"
                                  >
                                    <X className="size-3" />
                                  </div>
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

        {/* Scripts Section - Grouped by Project */}
        {totalScriptCount > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <span className="flex items-center gap-2">
                Scripts
                {runningScriptsCount > 0 && (
                  <span className="text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full">
                    {runningScriptsCount} running
                  </span>
                )}
              </span>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {projectsWithScripts.map(({ projectId, projectName, scripts }) => {
                  const runningScripts = scripts.filter(s => s.status === 'running');
                  const hasRunning = runningScripts.length > 0;

                  const handleStopAllScripts = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    runningScripts.forEach(s => stopScript(s.scriptId));
                  };

                  const handleCloseAllScripts = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    scripts.forEach(s => closeScriptTerminal(s.scriptId));
                  };

                  const allStopped = !hasRunning;

                  return (
                  <SidebarMenuItem key={projectId}>
                    <SidebarMenuButton className="font-medium group/project" tooltip={projectName}>
                      <FolderOpen className="size-4" />
                      <span className="flex-1">{projectName}</span>
                      <span className="text-xs text-muted-foreground group-hover/project:hidden">
                        {scripts.length}
                      </span>
                      {/* Project action buttons - visible on hover */}
                      <div className="hidden group-hover/project:flex items-center gap-0.5">
                        {hasRunning && (
                          <div
                            role="button"
                            tabIndex={0}
                            className="size-5 p-0 flex items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer"
                            onClick={handleStopAllScripts}
                            onKeyDown={(e) => e.key === 'Enter' && handleStopAllScripts(e as unknown as React.MouseEvent)}
                            title="Stop all scripts"
                          >
                            <Square className="size-3" />
                          </div>
                        )}
                        {allStopped && (
                          <div
                            role="button"
                            tabIndex={0}
                            className="size-5 p-0 flex items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer"
                            onClick={handleCloseAllScripts}
                            onKeyDown={(e) => e.key === 'Enter' && handleCloseAllScripts(e as unknown as React.MouseEvent)}
                            title="Close all script terminals"
                          >
                            <X className="size-3" />
                          </div>
                        )}
                      </div>
                    </SidebarMenuButton>
                    <SidebarMenuSub>
                      {scripts.map(({ scriptId, scriptName, status, isHidden }) => {
                        const isRunning = status === 'running';
                        const isCompleted = status === 'completed';
                        const isFailed = status === 'failed';

                        // Status color
                        let statusColor = 'fill-muted-foreground text-muted-foreground'; // idle
                        if (isRunning) {
                          statusColor = 'fill-blue-500 text-blue-500 animate-pulse';
                        } else if (isCompleted) {
                          statusColor = 'fill-green-500 text-green-500';
                        } else if (isFailed) {
                          statusColor = 'fill-red-500 text-red-500';
                        }

                        return (
                        <SidebarMenuSubItem key={scriptId}>
                          <SidebarMenuSubButton
                            onClick={() => showScriptTerminal(scriptId)}
                            className="relative group/script"
                          >
                            <div className="relative">
                              <FileCode className="size-3.5" />
                              {isHidden && (
                                <Circle className="absolute -top-1 -right-1 size-1.5 fill-yellow-500 text-yellow-500 animate-pulse" />
                              )}
                            </div>
                            <span className={cn('text-xs flex-1', isHidden && 'opacity-60')}>
                              {scriptName}
                            </span>
                            {/* Status indicator */}
                            <Circle className={cn('size-1.5', statusColor)} />
                            {/* Action buttons - visible on hover */}
                            <div className="hidden group-hover/script:flex items-center gap-0.5 ml-1">
                              {isRunning ? (
                                <div
                                  role="button"
                                  tabIndex={0}
                                  className="size-5 p-0 flex items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    stopScript(scriptId);
                                  }}
                                  onKeyDown={(e) => e.key === 'Enter' && stopScript(scriptId)}
                                  title="Stop script"
                                >
                                  <Square className="size-3" />
                                </div>
                              ) : (
                                <>
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    className="size-5 p-0 flex items-center justify-center rounded hover:bg-blue-500/20 hover:text-blue-500 cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      runScript(scriptId);
                                    }}
                                    onKeyDown={(e) => e.key === 'Enter' && runScript(scriptId)}
                                    title="Run script"
                                  >
                                    <Play className="size-3" />
                                  </div>
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    className="size-5 p-0 flex items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      closeScriptTerminal(scriptId);
                                    }}
                                    onKeyDown={(e) => e.key === 'Enter' && closeScriptTerminal(scriptId)}
                                    title="Close terminal"
                                  >
                                    <X className="size-3" />
                                  </div>
                                </>
                              )}
                            </div>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Global Scripts Section */}
        {globalScriptsWithRuntime.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <span className="flex items-center gap-2">
                Global Scripts
                {runningGlobalScriptsCount > 0 && (
                  <span className="text-xs bg-purple-500/20 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded-full">
                    {runningGlobalScriptsCount} running
                  </span>
                )}
              </span>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {globalScriptsWithRuntime.map(({ scriptId, scriptName, status, isHidden }) => {
                  const isRunning = status === 'running';
                  const isCompleted = status === 'completed';
                  const isFailed = status === 'failed';

                  let statusColor = 'fill-muted-foreground text-muted-foreground';
                  if (isRunning) {
                    statusColor = 'fill-purple-500 text-purple-500 animate-pulse';
                  } else if (isCompleted) {
                    statusColor = 'fill-green-500 text-green-500';
                  } else if (isFailed) {
                    statusColor = 'fill-red-500 text-red-500';
                  }

                  return (
                    <SidebarMenuItem key={scriptId}>
                      <SidebarMenuButton
                        onClick={() => showGlobalScriptTerminal(scriptId)}
                        className="relative group/gscript"
                        tooltip={scriptName}
                      >
                        <div className="relative">
                          <ScrollText className="size-4" />
                          {isHidden && (
                            <Circle className="absolute -top-1 -right-1 size-1.5 fill-yellow-500 text-yellow-500 animate-pulse" />
                          )}
                        </div>
                        <span className={cn('text-xs flex-1', isHidden && 'opacity-60')}>
                          {scriptName}
                        </span>
                        <Circle className={cn('size-1.5', statusColor)} />
                        <div className="hidden group-hover/gscript:flex items-center gap-0.5 ml-1">
                          {isRunning ? (
                            <div
                              role="button"
                              tabIndex={0}
                              className="size-5 p-0 flex items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                stopGlobalScript(scriptId);
                              }}
                              onKeyDown={(e) => e.key === 'Enter' && stopGlobalScript(scriptId)}
                              title="Stop script"
                            >
                              <Square className="size-3" />
                            </div>
                          ) : (
                            <>
                              <div
                                role="button"
                                tabIndex={0}
                                className="size-5 p-0 flex items-center justify-center rounded hover:bg-purple-500/20 hover:text-purple-500 cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const gs = globalScripts.find(s => s.id === scriptId);
                                  if (gs) openRunScriptDialog(gs);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const gs = globalScripts.find(s => s.id === scriptId);
                                    if (gs) openRunScriptDialog(gs);
                                  }
                                }}
                                title="Run script"
                              >
                                <Play className="size-3" />
                              </div>
                              <div
                                role="button"
                                tabIndex={0}
                                className="size-5 p-0 flex items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  closeGlobalScriptTerminal(scriptId);
                                }}
                                onKeyDown={(e) => e.key === 'Enter' && closeGlobalScriptTerminal(scriptId)}
                                title="Close terminal"
                              >
                                <X className="size-3" />
                              </div>
                            </>
                          )}
                        </div>
                      </SidebarMenuButton>
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
