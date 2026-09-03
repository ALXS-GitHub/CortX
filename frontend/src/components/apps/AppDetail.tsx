import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
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
  ArrowLeft,
  Pencil,
  AppWindow,
  FolderOpen,
  ExternalLink,
  FileText,
  Globe,
  StickyNote,
  Rocket,
  Play,
  Star,
  MoreVertical,
  Trash2,
  Link2,
  Code,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { AppForm } from './AppForm';
import { AppIcon } from './AppCard';
import { TagBadge } from '@/components/ui/TagBadge';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { toast } from 'sonner';
import { launchApp as launchAppApi, openAppConfig, openAppUrl, openInExplorer } from '@/lib/tauri';
import type { UpdateAppInput } from '@/types';

/** Card with a titled header row (icon, title, optional count and actions). */
function Section({
  icon: Icon,
  title,
  count,
  actions,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className="gap-3">
      <div className="flex items-center justify-between gap-3 px-4">
        <h2 className="inline-flex items-center gap-2 font-display text-base font-semibold">
          <Icon className="size-4 text-faint" />
          {title}
          {count !== undefined && count > 0 && <Badge variant="secondary">{count}</Badge>}
        </h2>
        {actions}
      </div>
      <div className="px-4">{children}</div>
    </Card>
  );
}

/** Label / value row of the information grid. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-2 text-sm">{children}</div>
    </>
  );
}

const codeClass = 'rounded-xs bg-muted px-1.5 py-0.5 font-mono text-[11px]';

export function AppDetail() {
  const {
    apps,
    tagDefinitions,
    settings,
    selectedAppId,
    setCurrentView,
    updateAppItem,
    deleteApp,
  } = useAppStore();

  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const app = useMemo(
    () => apps.find((a) => a.id === selectedAppId),
    [apps, selectedAppId]
  );

  const handleToggleFavorite = async () => {
    if (!app) return;
    try {
      await updateAppItem(app.id, { favorite: !app.favorite });
    } catch (e) {
      toast.error('Failed to update favorite', { description: String(e) });
    }
  };

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
      <Screen title="App" eyebrow="Apps" onBack={() => setCurrentView('apps')} backLabel="Back to apps">
        <EmptyState
          icon={AppWindow}
          title="App not found"
          description="It may have been removed from another window or from the CLI."
          action={
            <Button onClick={() => setCurrentView('apps')}>
              <ArrowLeft />
              Back to apps
            </Button>
          }
        />
      </Screen>
    );
  }

  const toolboxUrl = app.toolboxUrl ? resolveToolboxUrl(app.toolboxUrl) : null;
  const configs = app.configPaths.length;

  return (
    <Screen
      eyebrow="Apps"
      title={
        <span className="inline-flex items-center gap-2">
          <AppIcon color={app.color} size="sm" />
          {app.name}
          <StatusBadge status={app.status} />
        </span>
      }
      subtitle={app.description || (app.executablePath ? <span className="font-mono">{app.executablePath}</span> : undefined)}
      onBack={() => setCurrentView('apps')}
      backLabel="Back to apps"
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-pressed={app.favorite}
            onClick={handleToggleFavorite}
            title={app.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={app.favorite ? 'fill-warning text-warning' : ''} />
          </Button>
          {app.homepage && (
            <Button variant="outline" onClick={() => handleOpenUrl(app.homepage!)} title={app.homepage}>
              <Globe />
              Homepage
            </Button>
          )}
          <Button onClick={handleLaunch}>
            <Rocket />
            Launch
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowEditForm(true)}>
                <Pencil />
                Edit app
              </DropdownMenuItem>
              {toolboxUrl && (
                <DropdownMenuItem onClick={() => handleOpenUrl(toolboxUrl)}>
                  <Link2 />
                  Open toolbox page
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setShowDeleteDialog(true)}>
                <Trash2 />
                Delete app
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <div className="space-y-4">
        {/* Launch */}
        <Section
          icon={Play}
          title="Launch"
          actions={
            <Button size="sm" variant="outline" onClick={handleLaunch}>
              <Rocket className="size-3.5" />
              Launch {app.name}
            </Button>
          }
        >
          {app.executablePath || app.launchArgs ? (
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
              {app.executablePath && (
                <>
                  <span className="text-faint">exe</span>
                  <TruncatedText className="min-w-0 text-foreground/80">{app.executablePath}</TruncatedText>
                </>
              )}
              {app.launchArgs && (
                <>
                  <span className="text-faint">args</span>
                  <TruncatedText className="min-w-0">{app.launchArgs}</TruncatedText>
                </>
              )}
            </div>
          ) : (
            <p className="text-xs text-faint">No executable path configured.</p>
          )}
        </Section>

        {/* Information */}
        <Section icon={AppWindow} title="Information">
          <div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-2.5">
            <Row label="Status">
              {app.status ? <StatusBadge status={app.status} /> : <span className="text-xs text-faint">—</span>}
            </Row>

            {app.version && (
              <Row label="Version">
                <code className={codeClass}>{app.version}</code>
              </Row>
            )}

            {app.homepage && (
              <Row label="Homepage">
                <TruncatedText className="min-w-0 flex-1 text-xs text-muted-foreground">{app.homepage}</TruncatedText>
                <Button variant="ghost" size="icon-xs" onClick={() => handleOpenUrl(app.homepage!)} title="Open homepage" aria-label="Open homepage">
                  <ExternalLink />
                </Button>
              </Row>
            )}

            {toolboxUrl && (
              <Row label="Toolbox">
                <TruncatedText className="min-w-0 flex-1 text-xs text-muted-foreground">{toolboxUrl}</TruncatedText>
                <Button variant="ghost" size="icon-xs" onClick={() => handleOpenUrl(toolboxUrl)} title="Open toolbox page" aria-label="Open toolbox page">
                  <ExternalLink />
                </Button>
              </Row>
            )}

            {app.tags.length > 0 && (
              <Row label="Tags">
                <div className="flex flex-wrap gap-1">
                  {app.tags.map((tag) => (
                    <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
                  ))}
                </div>
              </Row>
            )}
          </div>
        </Section>

        {/* Configuration paths */}
        {configs > 0 && (
          <Section icon={FileText} title="Configuration paths" count={configs}>
            <div className="space-y-2">
              {app.configPaths.map((config, index) => (
                <div key={index} className="flex items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-2">
                  {config.isDirectory ? <FolderOpen className="size-4 shrink-0 text-faint" /> : <FileText className="size-4 shrink-0 text-faint" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {config.label && <span className="truncate text-sm font-medium">{config.label}</span>}
                      {config.isDirectory && <Badge variant="outline">dir</Badge>}
                    </div>
                    <p className="truncate font-mono text-[11px] text-muted-foreground" title={config.path}>{config.path}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handleOpenConfig(index)}>
                      <Code />
                      VSCode
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const path = config.isDirectory ? config.path : config.path.replace(/[\\/][^\\/]*$/, '');
                        openInExplorer(path).catch((err) => toast.error('Failed to open explorer', { description: String(err) }));
                      }}
                    >
                      <FolderOpen />
                      Explorer
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Notes */}
        {app.notes && (
          <Section icon={StickyNote} title="Notes">
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{app.notes}</p>
          </Section>
        )}
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

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete app</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{app.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Screen>
  );
}
