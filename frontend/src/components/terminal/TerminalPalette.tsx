import { useMemo, useState, type ReactNode } from 'react';
import {
  AppWindow,
  Columns2,
  Copy,
  CopyPlus,
  Eraser,
  FolderOpen,
  Globe,
  Hash,
  History,
  Maximize2,
  Minimize2,
  PanelLeft,
  Pencil,
  Plus,
  Rocket,
  Rows2,
  Save,
  Search,
  Settings2,
  SquareArrowOutDownLeft,
  SwatchBook,
  X,
  ZoomIn,
  ZoomOut,
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
import { showMainWindow } from '@/lib/tauri';
import { collectLeaves, projectIdOfWorkspace } from '@/lib/terminalLayout';
import { comboLabelFor, tabShortcutNumber, type KeybindingActionId } from '@/lib/keybindings';
import { openThemePicker, runAction, sendLeafToDock, terminalCwd } from './actions';
import { openTerminalSettingsPanel } from './settings/meta';
import { activeLeafOf, tabTitle, useItemMap, visibleTabOrder } from './model';
import { SaveLaunchConfigDialog } from './launch/SaveLaunchConfigDialog';
import { CommandHistoryView } from './history/CommandHistoryView';
import { openCommandHistory } from './history/openHistory';
import { launchProjectName, runLaunchConfigWithToast, sortLaunchConfigs, useLaunchConfigs } from './launch/useLaunchConfigs';

interface TerminalPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Right-aligned shortcut hint of a palette row. */
function Hint({ children }: { children: ReactNode }) {
  return children ? <span className="ml-auto pl-3 text-xs text-faint">{children}</span> : null;
}

/**
 * Command palette of the Terminal window (Ctrl+K). Everything that would
 * otherwise need a button in the way: every keyboard action with its current
 * combo, launch configurations (run, save the current tabs), scope, theme,
 * settings.
 */
export function TerminalPalette({ open, onOpenChange }: TerminalPaletteProps) {
  const [query, setQuery] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const projects = useAppStore((s) => s.projects);
  const keybindings = useAppStore((s) => s.settings?.terminal.keybindings);
  const tabsPlacement = useAppStore((s) => s.settings?.terminal.tabsPlacement ?? 'sidebar');
  const win = useTerminalLayoutStore((s) => s.doc.window);
  const closedTabs = useTerminalLayoutStore((s) => s.closedTabs);
  const setScope = useTerminalLayoutStore((s) => s.setScope);
  const items = useItemMap();
  const { configs } = useLaunchConfigs(open);

  const scopedProjectId = win.scope === 'global' ? null : win.scope.projectId;
  const sortedConfigs = useMemo(() => sortLaunchConfigs(configs, scopedProjectId), [configs, scopedProjectId]);
  // Projects worth scoping to: those with tabs, plus the current one.
  const scopeProjects = useMemo(() => {
    const withTabs = new Set(win.tabs.map((t) => projectIdOfWorkspace(t.workspaceId)).filter(Boolean));
    if (scopedProjectId) withTabs.add(scopedProjectId);
    return projects.filter((p) => withTabs.has(p.id));
  }, [projects, win.tabs, scopedProjectId]);
  const orderedTabs = useMemo(() => visibleTabOrder(win, projects, tabsPlacement), [win, projects, tabsPlacement]);
  const activeTab = win.tabs.find((t) => t.id === win.activeTabId) ?? null;
  const activeLeaf = activeTab ? activeLeafOf(activeTab) : null;
  const multi = activeTab ? collectLeaves(activeTab.layout).length > 1 : false;
  const maximized = Boolean(activeTab?.maximizedLeafId);
  const cwd = activeLeaf ? terminalCwd(activeLeaf.terminalId) ?? activeLeaf.cwd ?? null : null;

  const combo = (id: KeybindingActionId) => comboLabelFor(id, keybindings);

  const handleOpenChange = (next: boolean) => {
    if (!next) setQuery('');
    onOpenChange(next);
  };

  const run = (fn: () => void | Promise<void>) => {
    handleOpenChange(false);
    void fn();
  };
  // Actions that want the keyboard focus afterwards (find, rename) must run
  // once the dialog has given it back — after its 200 ms exit animation.
  const runAfterClose = (id: KeybindingActionId) => run(() => void setTimeout(() => runAction(id), 300));

  return (
    <>
      <CommandDialog open={open} onOpenChange={handleOpenChange}>
        <CommandInput placeholder="Terminal command…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Terminal">
            <CommandItem value="new terminal" onSelect={() => run(() => void runAction('tab.new'))}>
              <Plus />
              New terminal
              <Hint>{combo('tab.new')}</Hint>
            </CommandItem>
            {activeLeaf && (
              <>
                <CommandItem value="split right" onSelect={() => run(() => void runAction('pane.splitRight'))}>
                  <Columns2 />
                  Split right
                  <Hint>{combo('pane.splitRight')}</Hint>
                </CommandItem>
                <CommandItem value="split down" onSelect={() => run(() => void runAction('pane.splitDown'))}>
                  <Rows2 />
                  Split down
                  <Hint>{combo('pane.splitDown')}</Hint>
                </CommandItem>
                {(multi || maximized) && (
                  <CommandItem value="maximize restore pane layout" onSelect={() => run(() => void runAction('pane.maximize'))}>
                    {maximized ? <Minimize2 /> : <Maximize2 />}
                    {maximized ? 'Restore layout' : 'Maximize pane'}
                    <Hint>{combo('pane.maximize')}</Hint>
                  </CommandItem>
                )}
                <CommandItem value="find in terminal search" onSelect={() => runAfterClose('terminal.find')}>
                  <Search />
                  Find in terminal
                  <Hint>{combo('terminal.find')}</Hint>
                </CommandItem>
                <CommandItem value="clear terminal scrollback" onSelect={() => run(() => void runAction('terminal.clear'))}>
                  <Eraser />
                  Clear terminal
                  <Hint>{combo('terminal.clear')}</Hint>
                </CommandItem>
                <CommandItem value="rename tab" onSelect={() => runAfterClose('tab.rename')}>
                  <Pencil />
                  Rename tab
                  <Hint>{combo('tab.rename')}</Hint>
                </CommandItem>
                <CommandItem value="duplicate tab" onSelect={() => run(() => void runAction('tab.duplicate'))}>
                  <CopyPlus />
                  Duplicate tab
                  <Hint>{combo('tab.duplicate')}</Hint>
                </CommandItem>
                {cwd && (
                  <>
                    <CommandItem value="copy path working directory cwd" onSelect={() => run(() => void runAction('terminal.copyCwd'))}>
                      <Copy />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span>Copy path</span>
                        <span className="truncate font-mono text-[11px] text-faint">{cwd}</span>
                      </div>
                      <Hint>{combo('terminal.copyCwd')}</Hint>
                    </CommandItem>
                    <CommandItem value="open in explorer finder working directory" onSelect={() => run(() => void runAction('terminal.openCwd'))}>
                      <FolderOpen />
                      Open in Explorer
                      <Hint>{combo('terminal.openCwd')}</Hint>
                    </CommandItem>
                  </>
                )}
                <CommandItem value="send to dock" onSelect={() => run(() => sendLeafToDock(activeLeaf.terminalId))}>
                  <SquareArrowOutDownLeft />
                  Send this pane to the dock
                </CommandItem>
                <CommandItem value="close pane" onSelect={() => run(() => void runAction('tab.close'))}>
                  <X />
                  Close this pane
                  <Hint>{combo('tab.close')}</Hint>
                </CommandItem>
              </>
            )}
            {closedTabs.length > 0 && (
              <CommandItem value="reopen closed tab" onSelect={() => run(() => void runAction('tab.reopen'))}>
                <History />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span>Reopen closed tab</span>
                  <span className="truncate text-xs text-faint">{closedTabs[0].title ?? 'Untitled'}</span>
                </div>
                <Hint>{combo('tab.reopen')}</Hint>
              </CommandItem>
            )}
            <CommandItem value="zoom in bigger font" onSelect={() => run(() => void runAction('terminal.zoomIn'))}>
              <ZoomIn />
              Zoom in
              <Hint>{combo('terminal.zoomIn')}</Hint>
            </CommandItem>
            <CommandItem value="zoom out smaller font" onSelect={() => run(() => void runAction('terminal.zoomOut'))}>
              <ZoomOut />
              Zoom out
              <Hint>{combo('terminal.zoomOut')}</Hint>
            </CommandItem>
            <CommandItem value="zoom reset font size" onSelect={() => run(() => void runAction('terminal.zoomReset'))}>
              <ZoomOut className="opacity-0" />
              Reset zoom
              <Hint>{combo('terminal.zoomReset')}</Hint>
            </CommandItem>
            <CommandItem
              value="command history search past commands rerun failures"
              onSelect={() =>
                run(() =>
                  // After the dialog's exit animation, like find and rename:
                  // two dialogs must not fight over the keyboard focus.
                  // Scoped to a project, the history opens on that project;
                  // in Global scope it opens on everything, like the window.
                  void setTimeout(() => openCommandHistory({ projectId: scopedProjectId ?? undefined }), 300)
                )
              }
            >
              <History />
              <div className="flex min-w-0 flex-1 flex-col">
                <span>Command history…</span>
                <span className="truncate text-xs text-faint">Search, filter and re-run what has run here before</span>
              </div>
              <Hint>{combo('window.history')}</Hint>
            </CommandItem>
            <CommandItem value="toggle sessions rail sidebar" onSelect={() => run(() => void runAction('window.rail'))}>
              <PanelLeft />
              Toggle the sessions rail
              <Hint>{combo('window.rail')}</Hint>
            </CommandItem>
          </CommandGroup>

          {orderedTabs.length > 1 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Tabs">
                {orderedTabs.map((tab, i) => {
                  const n = i + 1;
                  // Past nine tabs Ctrl+9 means "the last tab", so only the
                  // tabs a digit really reaches carry a hint (ticket #34).
                  const shortcut = tabShortcutNumber(n, orderedTabs.length);
                  const actionId = shortcut ? (`tab.goto${shortcut}` as KeybindingActionId) : null;
                  return (
                    <CommandItem
                      key={tab.id}
                      value={`go to tab ${n} ${tabTitle(tab, items)}`}
                      onSelect={() => run(() => useTerminalLayoutStore.getState().setActiveTab(tab.id))}
                    >
                      <Hash />
                      <span className="w-4 text-right font-mono text-xs tabular-nums text-faint">{n}</span>
                      <span className="truncate">{tabTitle(tab, items)}</span>
                      {tab.id === win.activeTabId && <span className="text-xs text-faint">· current</span>}
                      <Hint>{actionId ? combo(actionId) : null}</Hint>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          )}

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
              {win.scope === 'global' ? <Hint>current</Hint> : <Hint>{combo('window.scopeGlobal')}</Hint>}
            </CommandItem>
            {scopeProjects.map((p) => (
              <CommandItem key={p.id} value={`scope project ${p.name}`} onSelect={() => run(() => setScope({ projectId: p.id }))}>
                <Globe className="opacity-0" />
                {p.name}
                {scopedProjectId === p.id && <Hint>current</Hint>}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading="Window">
            <CommandItem value="open theme picker terminal themes colours" onSelect={() => run(openThemePicker)}>
              <SwatchBook />
              Open theme picker
            </CommandItem>
            <CommandItem
              value="terminal settings shortcuts keybindings notifications preferences"
              onSelect={() => run(openTerminalSettingsPanel)}
            >
              <Settings2 />
              Terminal settings…
              <Hint>Ctrl ,</Hint>
            </CommandItem>
            <CommandItem value="open cortx main window" onSelect={() => run(() => showMainWindow())}>
              <AppWindow />
              Open CortX
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <SaveLaunchConfigDialog open={saveOpen} onOpenChange={setSaveOpen} />
      {/*
        The history view (#39) is mounted here rather than in the window root
        because it is opened the same way the palette is — from a keybinding,
        from this list, and later from the input editor — and because a
        surface nobody has opened must cost nothing: it renders null until an
        `openCommandHistory` event arrives.
      */}
      <CommandHistoryView />
    </>
  );
}
