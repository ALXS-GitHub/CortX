import { useMemo, useState } from 'react';
import {
  AppWindow,
  Columns2,
  Globe,
  PanelLeft,
  Plus,
  Rocket,
  Rows2,
  Save,
  SquareArrowOutDownLeft,
  X,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { useTerminalWindowPrefsStore } from '@/stores/terminalWindowPrefsStore';
import { showMainWindow } from '@/lib/tauri';
import { projectIdOfWorkspace } from '@/lib/terminalLayout';
import { closeActiveLeaf, openNewTerminal, sendLeafToDock, splitActiveLeaf } from './actions';
import { activeLeafOf } from './model';
import { SaveLaunchConfigDialog } from './launch/SaveLaunchConfigDialog';
import { launchProjectName, runLaunchConfigWithToast, sortLaunchConfigs, useLaunchConfigs } from './launch/useLaunchConfigs';

interface TerminalPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Command palette of the Terminal window (Ctrl+K). Everything that would
 * otherwise need a button in the way: launch configurations (run, save the
 * current tabs), scope, splits, dock hand-off, rail.
 */
export function TerminalPalette({ open, onOpenChange }: TerminalPaletteProps) {
  const [query, setQuery] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const projects = useAppStore((s) => s.projects);
  const win = useTerminalLayoutStore((s) => s.doc.window);
  const setScope = useTerminalLayoutStore((s) => s.setScope);
  const toggleRail = useTerminalWindowPrefsStore((s) => s.toggleRail);
  const { configs } = useLaunchConfigs(open);

  const scopedProjectId = win.scope === 'global' ? null : win.scope.projectId;
  const sortedConfigs = useMemo(() => sortLaunchConfigs(configs, scopedProjectId), [configs, scopedProjectId]);
  // Projects worth scoping to: those with tabs, plus the current one.
  const scopeProjects = useMemo(() => {
    const withTabs = new Set(win.tabs.map((t) => projectIdOfWorkspace(t.workspaceId)).filter(Boolean));
    if (scopedProjectId) withTabs.add(scopedProjectId);
    return projects.filter((p) => withTabs.has(p.id));
  }, [projects, win.tabs, scopedProjectId]);
  const activeTab = win.tabs.find((t) => t.id === win.activeTabId) ?? null;
  const activeLeaf = activeTab ? activeLeafOf(activeTab) : null;

  const handleOpenChange = (next: boolean) => {
    if (!next) setQuery('');
    onOpenChange(next);
  };

  const run = (fn: () => void | Promise<void>) => {
    handleOpenChange(false);
    void fn();
  };

  return (
    <>
      <CommandDialog open={open} onOpenChange={handleOpenChange}>
        <CommandInput placeholder="Terminal command…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Terminal">
            <CommandItem value="new terminal" onSelect={() => run(openNewTerminal)}>
              <Plus />
              New terminal
              <span className="ml-auto text-xs text-faint">Ctrl Shift T</span>
            </CommandItem>
            {activeLeaf && (
              <>
                <CommandItem value="split right" onSelect={() => run(() => splitActiveLeaf('horizontal'))}>
                  <Columns2 />
                  Split right
                  <span className="ml-auto text-xs text-faint">Ctrl Shift D</span>
                </CommandItem>
                <CommandItem value="split down" onSelect={() => run(() => splitActiveLeaf('vertical'))}>
                  <Rows2 />
                  Split down
                  <span className="ml-auto text-xs text-faint">Ctrl Shift E</span>
                </CommandItem>
                <CommandItem value="send to dock" onSelect={() => run(() => sendLeafToDock(activeLeaf.terminalId))}>
                  <SquareArrowOutDownLeft />
                  Send this pane to the dock
                </CommandItem>
                <CommandItem value="close pane" onSelect={() => run(closeActiveLeaf)}>
                  <X />
                  Close this pane
                  <span className="ml-auto text-xs text-faint">Ctrl Shift W</span>
                </CommandItem>
              </>
            )}
            <CommandItem value="toggle sessions rail sidebar" onSelect={() => run(toggleRail)}>
              <PanelLeft />
              Toggle the sessions rail
              <span className="ml-auto text-xs text-faint">Ctrl B</span>
            </CommandItem>
            <CommandItem value="open cortx main window" onSelect={() => run(() => showMainWindow())}>
              <AppWindow />
              Open CortX
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading="Launch configurations">
            <CommandItem value="save tabs as launch configuration" onSelect={() => run(() => setSaveOpen(true))}>
              <Save />
              Save these tabs as a launch configuration…
            </CommandItem>
            {sortedConfigs.map((config) => (
              <CommandItem
                key={config.id}
                value={`run launch ${config.name} ${launchProjectName(config, projects)}`}
                onSelect={() => run(() => runLaunchConfigWithToast(config, 'window'))}
              >
                <Rocket />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">Run {config.name}</span>
                  <span className="truncate text-xs text-faint">{launchProjectName(config, projects)}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading="Scope">
            <CommandItem value="scope global all projects" onSelect={() => run(() => setScope('global'))}>
              <Globe />
              Global
              {win.scope === 'global' && <span className="ml-auto text-xs text-faint">current</span>}
            </CommandItem>
            {scopeProjects.map((p) => (
              <CommandItem key={p.id} value={`scope project ${p.name}`} onSelect={() => run(() => setScope({ projectId: p.id }))}>
                <Globe className="opacity-0" />
                {p.name}
                {scopedProjectId === p.id && <span className="ml-auto text-xs text-faint">current</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <SaveLaunchConfigDialog open={saveOpen} onOpenChange={setSaveOpen} />
    </>
  );
}
