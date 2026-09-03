import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { listLaunchConfigs } from '@/lib/tauri';
import { runLaunchConfig } from '@/lib/launchConfigs';
import { isLaunchSplit, type LaunchConfig, type LaunchNode, type Project } from '@/types';

/**
 * The launch configurations on disk (`data/terminal/launch/*.yaml`), loaded
 * on mount and on demand. Shared by the settings section, the project page,
 * the Terminal window rail and the command palette.
 */
export function useLaunchConfigs(enabled = true) {
  const [configs, setConfigs] = useState<LaunchConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setConfigs(await listLaunchConfigs());
    } catch (error) {
      console.error('Failed to list launch configurations:', error);
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  return { configs, loading, loadedOnce, reload };
}

/** Number of terminals a node opens (leaves of the split tree). */
export function countLaunchLeaves(node: LaunchNode): number {
  return isLaunchSplit(node) ? node.children.reduce((n, c) => n + countLaunchLeaves(c), 0) : 1;
}

/** "2 tabs · 3 terminals" */
export function describeLaunchConfig(config: LaunchConfig): string {
  const tabs = config.tabs.length;
  const terminals = config.tabs.reduce((n, t) => n + countLaunchLeaves(t.layout), 0);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return terminals === tabs ? plural(tabs, 'tab') : `${plural(tabs, 'tab')} · ${plural(terminals, 'terminal')}`;
}

/** Project name of a configuration, or "Global". */
export function launchProjectName(config: LaunchConfig, projects: Project[]): string {
  if (!config.projectId) return 'Global';
  return projects.find((p) => p.id === config.projectId)?.name ?? 'Unknown project';
}

/** Sort: the given project's configurations first, then by name. */
export function sortLaunchConfigs(configs: LaunchConfig[], projectId?: string | null): LaunchConfig[] {
  return configs.slice().sort((a, b) => {
    if (projectId) {
      const aOwn = a.projectId === projectId ? 0 : 1;
      const bOwn = b.projectId === projectId ? 0 : 1;
      if (aOwn !== bOwn) return aOwn - bOwn;
    }
    return a.name.localeCompare(b.name);
  });
}

/** Run a configuration with the standard toasts. */
export async function runLaunchConfigWithToast(config: LaunchConfig, target?: 'window' | 'dock'): Promise<void> {
  try {
    await runLaunchConfig(config, target);
    toast.success(`Opened "${config.name}"`);
  } catch (error) {
    console.error('Failed to run the launch configuration:', error);
    toast.error(`Failed to open "${config.name}"`, { description: String(error) });
  }
}
