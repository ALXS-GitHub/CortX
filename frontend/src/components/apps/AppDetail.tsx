import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  ChevronLeft,
  Pencil,
  AppWindow,
  FolderOpen,
  ExternalLink,
  FileText,
  Globe,
  StickyNote,
  Rocket,
  Play,
  Trash2,
  Tag,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { AppForm } from './AppForm';
import { TagBadge } from '@/components/ui/TagBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { toast } from 'sonner';
import { launchApp as launchAppApi, openAppConfig, openAppUrl, openInExplorer } from '@/lib/tauri';
import type { UpdateAppInput } from '@/types';

export function AppDetail() {
  const {
    apps,
    tagDefinitions,
    settings,
    selectedAppId,
    setCurrentView,
    updateAppItem,
    deleteApp,
    selectApp,
  } = useAppStore();

  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const app = useMemo(
    () => apps.find((a) => a.id === selectedAppId),
    [apps, selectedAppId]
  );

  const handleUpdate = async (data: UpdateAppInput) => {
    if (!app) return;
    await updateAppItem(app.id, data);
    toast.success('App updated');
  };

  const handleDelete = async () => {
    if (!app) return;
    try {
      await deleteApp(app.id);
      toast.success('App deleted');
      setCurrentView('apps');
    } catch (e) {
      toast.error('Failed to delete app', { description: String(e) });
    }
    setShowDeleteDialog(false);
  };

  const handleLaunch = async () => {
    if (!app) return;
    try {
      await launchAppApi(app.id);
      toast.success(`Launched ${app.name}`);
    } catch (e) {
      toast.error('Failed to launch app', { description: String(e) });
    }
  };

  const handleOpenConfig = async (index: number) => {
    if (!app) return;
    try {
      await openAppConfig(app.id, index);
    } catch (e) {
      toast.error('Failed to open config', { description: String(e) });
    }
  };

  const resolveToolboxUrl = (url: string): string => {
    if (url.startsWith('/') && settings?.toolboxBaseUrl) {
      const base = settings.toolboxBaseUrl.replace(/\/+$/, '');
      return `${base}${url}`;
    }
    return url;
  };

  const handleOpenUrl = async (url: string) => {
    try {
      await openAppUrl(url);
    } catch (e) {
      toast.error('Failed to open URL', { description: String(e) });
    }
  };

  if (!app) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => setCurrentView('apps')}>
          <ChevronLeft className="size-4 mr-2" />
          Back to Apps
        </Button>
        <p className="text-muted-foreground mt-4">App not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Back + Header */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => setCurrentView('apps')} className="mb-4">
          <ChevronLeft className="size-4 mr-2" />
          Back to Apps
        </Button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <AppWindow className="size-8" style={{ color: app.color || '#6b7280' }} />
            <div>
              <h1 className="text-2xl font-bold">{app.name}</h1>
              {app.description && (
                <p className="text-sm text-muted-foreground mt-0.5">{app.description}</p>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowEditForm(true)}>
            <Pencil className="size-4 mr-2" />
            Edit
          </Button>
        </div>
      </div>

      {/* Launch Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Play className="size-4" />
            Launch
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={handleLaunch} className="w-full" size="lg">
            <Rocket className="size-5 mr-2" />
            Launch {app.name}
          </Button>
          {app.executablePath && (
            <div className="text-sm">
              <span className="text-muted-foreground">Executable:</span>
              <code className="ml-2 px-1.5 py-0.5 bg-muted rounded text-xs font-mono">{app.executablePath}</code>
            </div>
          )}
          {app.launchArgs && (
            <div className="text-sm">
              <span className="text-muted-foreground">Arguments:</span>
              <code className="ml-2 px-1.5 py-0.5 bg-muted rounded text-xs font-mono">{app.launchArgs}</code>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AppWindow className="size-4" />
            Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Status:</span>
            <StatusBadge status={app.status} />
          </div>

          {app.version && (
            <div>
              <span className="text-muted-foreground">Version:</span>
              <code className="ml-2 px-1.5 py-0.5 bg-muted rounded text-xs font-mono">{app.version}</code>
            </div>
          )}

          {app.homepage && (
            <div className="flex items-center gap-2">
              <Globe className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Homepage:</span>
              <span className="text-xs truncate">{app.homepage}</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => handleOpenUrl(app.homepage!)}>
                <ExternalLink className="size-3 mr-1" />
                Open
              </Button>
            </div>
          )}

          {app.toolboxUrl && (
            <div className="flex items-center gap-2">
              <Globe className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Toolbox:</span>
              <span className="text-xs truncate">{resolveToolboxUrl(app.toolboxUrl)}</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => handleOpenUrl(resolveToolboxUrl(app.toolboxUrl!))}>
                <ExternalLink className="size-3 mr-1" />
                Open
              </Button>
            </div>
          )}

          {app.tags.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Tag className="size-3.5 text-muted-foreground" />
              {app.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Configs Card */}
      {app.configPaths.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="size-4" />
              Configuration Paths
              <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                {app.configPaths.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {app.configPaths.map((config, index) => (
                <div key={index} className="flex items-center justify-between p-2 rounded-md border">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {config.label && (
                        <span className="text-sm font-medium">{config.label}</span>
                      )}
                      {config.isDirectory && (
                        <Badge variant="outline" className="text-xs py-0">dir</Badge>
                      )}
                    </div>
                    <p className="text-xs font-mono text-muted-foreground truncate mt-0.5">{config.path}</p>
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleOpenConfig(index)}
                    >
                      Open in VSCode
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        const path = config.isDirectory ? config.path : config.path.replace(/[\\/][^\\/]*$/, '');
                        openInExplorer(path).catch((err) => toast.error('Failed to open explorer', { description: String(err) }));
                      }}
                    >
                      <FolderOpen className="size-3 mr-1" />
                      Explorer
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes Card */}
      {app.notes && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <StickyNote className="size-4" />
              Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{app.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Delete Section */}
      <div className="border-t pt-6">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowDeleteDialog(true)}
        >
          <Trash2 className="size-4 mr-2" />
          Delete App
        </Button>
      </div>

      {/* Edit Form */}
      <AppForm
        open={showEditForm}
        onOpenChange={setShowEditForm}
        app={app}
        apps={apps}
        tagDefinitions={tagDefinitions}
        onSubmit={handleUpdate}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete App</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{app.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
