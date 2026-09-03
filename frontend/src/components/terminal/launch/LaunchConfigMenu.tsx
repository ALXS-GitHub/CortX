import { useState, type ReactNode } from 'react';
import { Rocket } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppStore } from '@/stores/appStore';
import type { LaunchConfig } from '@/types';
import { describeLaunchConfig, launchProjectName, runLaunchConfigWithToast, useLaunchConfigs } from './useLaunchConfigs';

/**
 * "Run a launch configuration" menu of the Terminal window: the scoped
 * project's configurations first, then the others with their project name.
 * The list is refreshed every time the menu opens.
 */
export function LaunchConfigMenu({
  scopedProjectId,
  target = 'window',
  children,
}: {
  scopedProjectId?: string | null;
  target?: 'window' | 'dock';
  /** The trigger (a button). */
  children: ReactNode;
}) {
  const projects = useAppStore((s) => s.projects);
  const [open, setOpen] = useState(false);
  // `enabled` flips on every open, which is what refreshes the list.
  const { configs, loadedOnce } = useLaunchConfigs(open);

  const own = scopedProjectId ? configs.filter((c) => c.projectId === scopedProjectId) : [];
  const others = configs.filter((c) => !own.includes(c));
  const scopedName = scopedProjectId ? projects.find((p) => p.id === scopedProjectId)?.name : undefined;

  const run = (config: LaunchConfig) => void runLaunchConfigWithToast(config, target);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="min-w-56">
        {configs.length === 0 && (
          <DropdownMenuItem disabled>
            <Rocket />
            {loadedOnce ? 'No launch configuration yet' : 'Loading…'}
          </DropdownMenuItem>
        )}
        {own.length > 0 && (
          <>
            <DropdownMenuLabel>{scopedName ?? 'This project'}</DropdownMenuLabel>
            {own.map((c) => (
              <DropdownMenuItem key={c.id} onClick={() => run(c)}>
                <Rocket />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{c.name}</span>
                  <span className="truncate text-[11px] text-faint">{describeLaunchConfig(c)}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
        {own.length > 0 && others.length > 0 && <DropdownMenuSeparator />}
        {others.length > 0 && (
          <>
            {own.length > 0 && <DropdownMenuLabel>Other</DropdownMenuLabel>}
            {others.map((c) => (
              <DropdownMenuItem key={c.id} onClick={() => run(c)}>
                <Rocket />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{c.name}</span>
                  <span className="truncate text-[11px] text-faint">
                    {launchProjectName(c, projects)} · {describeLaunchConfig(c)}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
