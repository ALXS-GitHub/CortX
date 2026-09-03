import { useAppStore } from '@/stores/appStore';
import { openInExplorer, openInVscode } from '@/lib/tauri';
import { toast } from 'sonner';
import type { Project } from '@/types';

/** Shared by the project list items and cards: start / stop everything, open folder / editor. */
export function useProjectActions(project: Project) {
  const { serviceRuntimes, startService, stopService } = useAppStore();

  const runningCount = project.services.filter((s) => serviceRuntimes.get(s.id)?.status === 'running').length;

  const startAll = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
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
  };

  const stopAll = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    for (const service of project.services) {
      if (serviceRuntimes.get(service.id)?.status === 'running') {
        try {
          await stopService(service.id);
        } catch (error) {
          console.error(`Failed to stop ${service.name}:`, error);
        }
      }
    }
  };

  const openFolder = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    openInExplorer(project.rootPath).catch(console.error);
  };

  const openEditor = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    openInVscode(project.rootPath).catch((error) => {
      toast.error('Failed to open VSCode', { description: String(error) });
    });
  };

  return { runningCount, startAll, stopAll, openFolder, openEditor };
}
