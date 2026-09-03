import { useState } from 'react';
import { Copy, MoreVertical, Pencil, Play, Plus, Rocket, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { useAppStore } from '@/stores/appStore';
import { deleteLaunchConfig, saveLaunchConfig } from '@/lib/tauri';
import { launchIdFromName } from '@/lib/launchConfigs';
import { projectColor } from '@/components/terminal/model';
import type { LaunchConfig } from '@/types';
import { LaunchConfigDialog } from './LaunchConfigDialog';
import { describeLaunchConfig, launchProjectName, runLaunchConfigWithToast, sortLaunchConfigs, useLaunchConfigs } from './useLaunchConfigs';

/**
 * Settings section: the launch configurations on disk, with run / edit /
 * duplicate / delete and a "New configuration" button.
 */
export function LaunchConfigsSection() {
  const projects = useAppStore((s) => s.projects);
  const { configs, loadedOnce, reload } = useLaunchConfigs();
  const [editing, setEditing] = useState<LaunchConfig | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<LaunchConfig | null>(null);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (config: LaunchConfig) => {
    setEditing(config);
    setDialogOpen(true);
  };

  const handleDuplicate = async (config: LaunchConfig) => {
    const name = `${config.name} copy`;
    try {
      await saveLaunchConfig({ ...config, id: launchIdFromName(name), name });
      toast.success(`Duplicated as "${name}"`);
      await reload();
    } catch (e) {
      toast.error('Failed to duplicate the configuration', { description: String(e) });
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await deleteLaunchConfig(target.id);
      toast.success(`Deleted "${target.name}"`);
      await reload();
    } catch (e) {
      toast.error('Failed to delete the configuration', { description: String(e) });
    }
  };

  const sorted = sortLaunchConfigs(configs);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="size-4 text-faint" />
          Launch configurations
        </CardTitle>
        <CardDescription>
          Presets that open a set of terminals — tabs and splits — in a project, optionally typing a command in each. Stored as
          YAML under <code className="rounded-xs bg-muted px-1 py-px font-mono text-[11px] text-foreground">data/terminal/launch</code>,
          synced by the git backup.
        </CardDescription>
        {sorted.length > 0 && (
          <CardAction>
            <Button variant="outline" size="sm" onClick={openNew}>
              <Plus />
              New configuration
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-strong">
            <EmptyState
              compact
              icon={Rocket}
              title={loadedOnce ? 'No launch configuration yet' : 'Loading…'}
              description={
                loadedOnce
                  ? 'Create one here, or save the tabs of the Terminal window from its sessions rail.'
                  : undefined
              }
              action={
                loadedOnce ? (
                  <Button onClick={openNew}>
                    <Plus />
                    New configuration
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {sorted.map((config) => (
              <div
                key={config.id}
                className="group flex h-11 items-center gap-3 rounded-sm border border-border px-3 transition-colors hover:border-border-strong hover:bg-accent/40"
              >
                <Rocket className="size-4 shrink-0 text-faint" />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-[13px] font-medium">{config.name}</span>
                  {config.projectId ? (
                    <Chip color={projectColor(config.projectId)} className="shrink-0">
                      {launchProjectName(config, projects)}
                    </Chip>
                  ) : (
                    <Chip neutral dot={false} className="shrink-0">
                      Global
                    </Chip>
                  )}
                  <span className="shrink-0 text-xs text-faint">
                    {describeLaunchConfig(config)}
                    {config.window === 'dock' && ' · dock'}
                  </span>
                </div>
                <Button variant="outline" size="xs" onClick={() => void runLaunchConfigWithToast(config)}>
                  <Play />
                  Run
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${config.name}`}>
                      <MoreVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(config)}>
                      <Pencil />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void handleDuplicate(config)}>
                      <Copy />
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleting(config)}>
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <LaunchConfigDialog open={dialogOpen} onOpenChange={setDialogOpen} config={editing} onSaved={() => void reload()} />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete launch configuration</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deleting?.name}"? The YAML file is removed; terminals already open are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
