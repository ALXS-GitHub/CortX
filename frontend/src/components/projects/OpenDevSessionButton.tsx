import { ChevronDown, Settings2, SquareTerminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppStore } from '@/stores/appStore';
import { defaultLaunchConfigFor } from '@/lib/launchConfigs';
import { describeLaunchConfig, runLaunchConfigWithToast, useLaunchConfigs } from '@/components/terminal/launch/useLaunchConfigs';
import type { Project } from '@/types';

/**
 * Project header action: open a dev session. One launch configuration for
 * the project runs directly; several are listed in a menu; none opens a
 * single shell at the project root (nothing is saved).
 */
export function OpenDevSessionButton({ project }: { project: Project }) {
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const { configs } = useLaunchConfigs();
  const own = configs.filter((c) => c.projectId === project.id).sort((a, b) => a.name.localeCompare(b.name));

  if (own.length <= 1) {
    const config = own[0];
    return (
      <Button
        variant="outline"
        onClick={() => void runLaunchConfigWithToast(config ?? defaultLaunchConfigFor(project))}
        title={config ? `Run "${config.name}"` : 'Open a terminal at the project root'}
      >
        <SquareTerminal />
        Open a dev session
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <SquareTerminal />
          Open a dev session
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {own.map((c) => (
          <DropdownMenuItem key={c.id} onClick={() => void runLaunchConfigWithToast(c)}>
            <SquareTerminal />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{c.name}</span>
              <span className="truncate text-[11px] text-faint">{describeLaunchConfig(c)}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setCurrentView('settings')}>
          <Settings2 />
          Manage…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
