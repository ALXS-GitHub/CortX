import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { ServiceItem } from '@/components/projects/ServiceItem';
import { ServiceForm } from '@/components/projects/ServiceForm';
import { ProjectForm } from '@/components/projects/ProjectForm';
import { EnvironmentTab } from '@/components/env';
import { ScriptsTab } from '@/components/scripts';
import { AgentsView, BetaBadge } from '@/components/agents';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusDot } from '@/components/ui/StatusDot';
import { TagBadge } from '@/components/ui/TagBadge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  Play,
  Square,
  FolderOpen,
  Pencil,
  Trash2,
  Code,
  Terminal,
  FileKey,
  FileCode,
  Bot,
  ChevronDown,
  Star,
  MoreVertical,
  Link2,
  ArrowLeft,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { openInExplorer, openInVscode, openToolUrl } from '@/lib/tauri';
import type { Service, CreateServiceInput, UpdateServiceInput, UpdateProjectInput } from '@/types';
import { toast } from 'sonner';

export function ProjectView() {
  const {
    projects,
    selectedProjectId,
    selectProject,
    setCurrentView,
    settings,
    tagDefinitions,
    addService,
    updateService,
    deleteService,
    updateProject,
    deleteProject,
    serviceRuntimes,
    startService,
    stopService,
    agentSessions,
  } = useAppStore();

  const [showServiceForm, setShowServiceForm] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [deletingService, setDeletingService] = useState<Service | null>(null);
  const [showEditProject, setShowEditProject] = useState(false);
  const [showDeleteProject, setShowDeleteProject] = useState(false);
  // State for Start All mode/preset selection
  // undefined = use default, null = explicitly none, string = use that value
  const [selectedModeForAll, setSelectedModeForAll] = useState<string | undefined>();
  const [selectedPresetForAll, setSelectedPresetForAll] = useState<string | null | undefined>();
  const [startAllPopoverOpen, setStartAllPopoverOpen] = useState(false);

  const project = projects.find((p) => p.id === selectedProjectId);

  if (!project) {
    return (
      <Screen title="Project" onBack={() => setCurrentView('dashboard')}>
        <EmptyState
          icon={FolderOpen}
          title="Project not found"
          description="It may have been removed from another window or from the CLI."
          action={
            <Button onClick={() => setCurrentView('dashboard')}>
              <ArrowLeft />
              Back to projects
            </Button>
          }
        />
      </Screen>
    );
  }

  // Sessions are loaded lazily (Agents view / tab); 0 until then.
  const projectAgentCount = agentSessions.filter((s) => s.projectId === project.id).length;

  const runningServices = project.services.filter((s) => {
    const runtime = serviceRuntimes.get(s.id);
    return runtime?.status === 'running';
  });

  const handleBack = () => {
    selectProject(null);
  };

  const handleOpenFolder = () => {
    openInExplorer(project.rootPath).catch(console.error);
  };

  const handleOpenInVscode = () => {
    openInVscode(project.rootPath).catch((error) => {
      toast.error('Failed to open VSCode', {
        description: String(error),
      });
    });
  };

  const handleToggleFavorite = async () => {
    try {
      await updateProject(project.id, { favorite: !project.favorite });
    } catch (e) {
      toast.error('Failed to update favorite', { description: String(e) });
    }
  };

  const handleAddService = async (data: CreateServiceInput | UpdateServiceInput) => {
    await addService(project.id, data as CreateServiceInput);
    toast.success('Service added');
  };

  const handleEditService = async (data: CreateServiceInput | UpdateServiceInput) => {
    if (editingService) {
      await updateService(editingService.id, data as UpdateServiceInput);
      setEditingService(null);
      toast.success('Service updated');
    }
  };

  const handleDeleteService = async () => {
    if (deletingService) {
      await deleteService(deletingService.id);
      setDeletingService(null);
      toast.success('Service deleted');
    }
  };

  const handleEditProject = async (data: UpdateProjectInput) => {
    await updateProject(project.id, data);
    toast.success('Project updated');
  };

  const handleDeleteProject = async () => {
    await deleteProject(project.id);
    setCurrentView('dashboard');
    toast.success('Project deleted');
  };

  const handleStartAll = async (mode?: string, argPreset?: string) => {
    for (const service of project.services) {
      const runtime = serviceRuntimes.get(service.id);
      if (!runtime || runtime.status === 'stopped') {
        try {
          // Only pass mode if the service has this mode defined
          const serviceHasMode = mode && service.modes && service.modes[mode];
          // Only pass preset if the service has this preset defined
          const serviceHasPreset = argPreset && service.argPresets && service.argPresets[argPreset];
          await startService(
            service.id,
            serviceHasMode ? mode : undefined,
            serviceHasPreset ? argPreset : undefined
          );
        } catch (error) {
          console.error(`Failed to start ${service.name}:`, error);
        }
      }
    }
    const labels = [mode, argPreset].filter(Boolean);
    const labelStr = labels.length > 0 ? ` (${labels.join(' + ')})` : '';
    toast.success(`Started all services${labelStr}`);
  };

  // Collect all unique mode names across all services
  const allModeNames = [...new Set(
    project.services
      .flatMap(s => s.modes ? Object.keys(s.modes) : [])
  )].sort();

  // Collect all unique preset names across all services
  const allPresetNames = [...new Set(
    project.services
      .flatMap(s => s.argPresets ? Object.keys(s.argPresets) : [])
  )].sort();

  const hasAnyModes = allModeNames.length > 0;
  const hasAnyPresets = allPresetNames.length > 0;

  const handleStopAll = async () => {
    for (const service of project.services) {
      const runtime = serviceRuntimes.get(service.id);
      if (runtime?.status === 'running') {
        try {
          await stopService(service.id);
        } catch (error) {
          console.error(`Failed to stop ${service.name}:`, error);
        }
      }
    }
    toast.success('Stopped all services');
  };

  const toolboxUrl = project.toolboxUrl
    ? project.toolboxUrl.startsWith('/') && settings?.toolboxBaseUrl
      ? `${settings.toolboxBaseUrl.replace(/\/+$/, '')}${project.toolboxUrl}`
      : project.toolboxUrl
    : null;

  const total = project.services.length;
  const running = runningServices.length;

  // Primary launch control shown in the header.
  const launchControl = total === 0 ? null : running > 0 ? (
    <Button variant="outline" onClick={handleStopAll} className="text-destructive hover:text-destructive">
      <Square />
      Stop all
      {running < total && <span className="text-xs text-muted-foreground">({running}/{total})</span>}
    </Button>
  ) : hasAnyModes || hasAnyPresets ? (
    <div className="flex items-center">
      <Button className="rounded-r-none" onClick={() => handleStartAll()}>
        <Play />
        Start all
      </Button>
      <Popover open={startAllPopoverOpen} onOpenChange={setStartAllPopoverOpen}>
        <PopoverTrigger asChild>
          <Button className="rounded-l-none border-l border-l-primary-foreground/25 px-2" aria-label="Start all with options">
            <ChevronDown className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 gap-3 p-3">
          {hasAnyModes && (
            <div className="space-y-1.5">
              <Label className="text-xs">Mode</Label>
              <Select
                value={selectedModeForAll || '_default'}
                onValueChange={(v) => setSelectedModeForAll(v === '_default' ? undefined : v)}
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_default">Default</SelectItem>
                  {allModeNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {hasAnyPresets && (
            <div className="space-y-1.5">
              <Label className="text-xs">Preset</Label>
              <Select
                value={selectedPresetForAll === null ? '_none' : selectedPresetForAll || '_default'}
                onValueChange={(v) => setSelectedPresetForAll(v === '_default' ? undefined : v === '_none' ? null : v)}
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue placeholder="Select preset" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_default">Default</SelectItem>
                  <SelectItem value="_none">None</SelectItem>
                  {allPresetNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            size="sm"
            className="w-full"
            onClick={() => {
              // null means "None" (pass empty string to skip default), undefined means "Default"
              handleStartAll(selectedModeForAll, selectedPresetForAll === null ? '' : selectedPresetForAll);
              setStartAllPopoverOpen(false);
            }}
          >
            <Play className="size-3.5" />
            Start all
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  ) : (
    <Button onClick={() => handleStartAll()}>
      <Play />
      Start all
    </Button>
  );

  return (
    <Screen
      eyebrow="Project"
      title={
        <span className="inline-flex items-center gap-2">
          {running > 0 && <StatusDot tone="running" size={8} />}
          {project.name}
          <StatusBadge status={project.status} />
        </span>
      }
      subtitle={<span className="font-mono">{project.rootPath}</span>}
      onBack={handleBack}
      backLabel="Back to projects"
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-pressed={project.favorite}
            onClick={handleToggleFavorite}
            title={project.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={project.favorite ? 'fill-warning text-warning' : ''} />
          </Button>
          <Button variant="outline" onClick={handleOpenInVscode} title="Open in VSCode">
            <Code />
            VSCode
          </Button>
          <Button variant="outline" size="icon" onClick={handleOpenFolder} title="Open folder" aria-label="Open folder">
            <FolderOpen />
          </Button>
          {launchControl}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowEditProject(true)}>
                <Pencil />
                Edit project
              </DropdownMenuItem>
              {toolboxUrl && (
                <DropdownMenuItem onClick={() => openToolUrl(toolboxUrl).catch((e) => toast.error('Failed to open URL', { description: String(e) }))}>
                  <Link2 />
                  Open toolbox page
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setShowDeleteProject(true)}>
                <Trash2 />
                Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      {/* Description, tags, toolbox link */}
      {(project.description || project.tags.length > 0 || toolboxUrl) && (
        <div className="mb-5 flex flex-col gap-2">
          {project.description && <p className="max-w-3xl text-sm text-muted-foreground">{project.description}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            {project.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
            ))}
            {toolboxUrl && (
              <button
                type="button"
                className="inline-flex items-center gap-1 truncate text-xs text-primary hover:underline"
                onClick={() => openToolUrl(toolboxUrl).catch((e) => toast.error('Failed to open URL', { description: String(e) }))}
                title={toolboxUrl}
              >
                <Link2 className="size-3" />
                {project.toolboxUrl}
              </button>
            )}
          </div>
        </div>
      )}

      <Tabs defaultValue="services" className="gap-5">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="services" className="flex-none">
            <Terminal />
            Services
            {total > 0 && <TabsCount>{total}</TabsCount>}
          </TabsTrigger>
          <TabsTrigger value="environment" className="flex-none">
            <FileKey />
            Environment
            {project.envFiles?.length > 0 && <TabsCount>{project.envFiles.length}</TabsCount>}
          </TabsTrigger>
          <TabsTrigger value="scripts" className="flex-none">
            <FileCode />
            Scripts
            {project.scripts?.length > 0 && <TabsCount>{project.scripts.length}</TabsCount>}
          </TabsTrigger>
          <TabsTrigger value="agents" className="flex-none">
            <Bot />
            Agents
            {projectAgentCount > 0 ? <TabsCount>{projectAgentCount}</TabsCount> : <BetaBadge />}
          </TabsTrigger>
        </TabsList>

        {/* Services Tab */}
        <TabsContent value="services" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold">Services</h2>
              <p className="text-xs text-muted-foreground">
                {total} service{total !== 1 ? 's' : ''} configured
                {running > 0 && ` · ${running} running`}
              </p>
            </div>
            <Button size="sm" variant={total === 0 ? 'default' : 'outline'} onClick={() => setShowServiceForm(true)}>
              <Plus className="size-4" />
              Add service
            </Button>
          </div>

          {total === 0 ? (
            <div className="rounded-lg border border-dashed border-border-strong">
              <EmptyState
                compact
                icon={Play}
                title="No services configured"
                description="A service is a long-running command (dev server, API, watcher) started from this project."
                action={
                  <Button onClick={() => setShowServiceForm(true)}>
                    <Plus />
                    Add service
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="space-y-3">
              {project.services
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((service) => (
                  <ServiceItem
                    key={service.id}
                    service={service}
                    projectPath={project.rootPath}
                    onEdit={() => setEditingService(service)}
                    onDelete={() => setDeletingService(service)}
                  />
                ))}
            </div>
          )}
        </TabsContent>

        {/* Environment Tab */}
        <TabsContent value="environment">
          <EnvironmentTab project={project} />
        </TabsContent>

        {/* Scripts Tab */}
        <TabsContent value="scripts">
          <ScriptsTab project={project} />
        </TabsContent>

        {/* Agents Tab (beta) */}
        <TabsContent value="agents">
          <AgentsView projectId={project.id} />
        </TabsContent>
      </Tabs>

      {/* Add Service Dialog */}
      <ServiceForm
        open={showServiceForm}
        onOpenChange={setShowServiceForm}
        projectPath={project.rootPath}
        onSubmit={handleAddService}
      />

      {/* Edit Service Dialog */}
      {editingService && (
        <ServiceForm
          open={!!editingService}
          onOpenChange={(open) => !open && setEditingService(null)}
          service={editingService}
          projectPath={project.rootPath}
          onSubmit={handleEditService}
        />
      )}

      {/* Delete Service Confirmation */}
      <AlertDialog open={!!deletingService} onOpenChange={(open) => !open && setDeletingService(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete service</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deletingService?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteService}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Project Dialog */}
      <ProjectForm
        open={showEditProject}
        onOpenChange={setShowEditProject}
        project={project}
        onSubmit={handleEditProject}
      />

      {/* Delete Project Confirmation */}
      <AlertDialog open={showDeleteProject} onOpenChange={setShowDeleteProject}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project</AlertDialogTitle>
            <AlertDialogDescription>
              Remove "{project.name}" from CortX? Your files on disk are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteProject}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Screen>
  );
}
