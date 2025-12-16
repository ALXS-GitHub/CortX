import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { ServiceItem } from '@/components/projects/ServiceItem';
import { ServiceForm } from '@/components/projects/ServiceForm';
import { ProjectForm } from '@/components/projects/ProjectForm';
import { EnvironmentTab } from '@/components/env';
import { ScriptsTab } from '@/components/scripts';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  ArrowLeft,
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
} from 'lucide-react';
import { openInExplorer, openInVscode } from '@/lib/tauri';
import type { Service, CreateServiceInput, UpdateServiceInput, UpdateProjectInput } from '@/types';
import { toast } from 'sonner';

export function ProjectView() {
  const {
    projects,
    selectedProjectId,
    selectProject,
    setCurrentView,
    addService,
    updateService,
    deleteService,
    updateProject,
    deleteProject,
    serviceRuntimes,
    startService,
    stopService,
  } = useAppStore();

  const [showServiceForm, setShowServiceForm] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [deletingService, setDeletingService] = useState<Service | null>(null);
  const [showEditProject, setShowEditProject] = useState(false);
  const [showDeleteProject, setShowDeleteProject] = useState(false);

  const project = projects.find((p) => p.id === selectedProjectId);

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <p className="text-muted-foreground mb-4">Project not found</p>
        <Button onClick={() => setCurrentView('dashboard')}>
          <ArrowLeft className="size-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

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

  const handleStartAll = async () => {
    for (const service of project.services) {
      const runtime = serviceRuntimes.get(service.id);
      if (!runtime || runtime.status === 'stopped') {
        try {
          await startService(service.id);
        } catch (error) {
          console.error(`Failed to start ${service.name}:`, error);
        }
      }
    }
    toast.success('Started all services');
  };

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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            {project.description && (
              <p className="text-muted-foreground mt-1">{project.description}</p>
            )}
            <p className="text-sm text-muted-foreground font-mono mt-2">
              {project.rootPath}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenInVscode}>
            <Code className="size-4 mr-2" />
            Open in VSCode
          </Button>
          <Button variant="outline" size="sm" onClick={handleOpenFolder}>
            <FolderOpen className="size-4 mr-2" />
            Open Folder
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowEditProject(true)}>
            <Pencil className="size-4 mr-2" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteProject(true)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      {/* Tabs for Services and Environment */}
      <Tabs defaultValue="services" className="space-y-4">
        <TabsList>
          <TabsTrigger value="services" className="flex items-center gap-2">
            <Terminal className="size-4" />
            Services
            {project.services.length > 0 && (
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                {project.services.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="environment" className="flex items-center gap-2">
            <FileKey className="size-4" />
            Environment
            {project.envFiles?.length > 0 && (
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                {project.envFiles.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="scripts" className="flex items-center gap-2">
            <FileCode className="size-4" />
            Scripts
            {project.scripts?.length > 0 && (
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                {project.scripts.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Services Tab */}
        <TabsContent value="services" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Services</h2>
              <p className="text-sm text-muted-foreground">
                {project.services.length} service{project.services.length !== 1 ? 's' : ''} configured
                {runningServices.length > 0 && ` (${runningServices.length} running)`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {project.services.length > 0 && (
                <>
                  {runningServices.length > 0 ? (
                    <Button variant="outline" size="sm" onClick={handleStopAll}>
                      <Square className="size-4 mr-2" />
                      Stop All
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={handleStartAll}>
                      <Play className="size-4 mr-2" />
                      Start All
                    </Button>
                  )}
                </>
              )}
              <Button size="sm" onClick={() => setShowServiceForm(true)}>
                <Plus className="size-4 mr-2" />
                Add Service
              </Button>
            </div>
          </div>

          {project.services.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg border-dashed">
              <Play className="size-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No services configured</h3>
              <p className="text-muted-foreground mb-4">
                Add services to define how to start your project
              </p>
              <Button onClick={() => setShowServiceForm(true)}>
                <Plus className="size-4 mr-2" />
                Add Service
              </Button>
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
            <AlertDialogTitle>Delete Service</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingService?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteService} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
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
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{project.name}"? This will remove the project from your dashboard. Your files will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteProject} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
