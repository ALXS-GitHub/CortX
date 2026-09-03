import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { activeLeafOf } from './model';
import { collectLeaves, projectIdOfWorkspace, type SplitDirection, type TerminalTab } from '@/lib/terminalLayout';

/**
 * Imperative actions of the Terminal window. They read the stores at call
 * time (no stale closures) so every entry point — rail footer, "+" button,
 * empty state, leaf header, keyboard shortcuts — shares one implementation.
 */

/** Live cwd of a terminal (shell integration), else the cwd its shell opened in. */
function terminalCwd(terminalId: string): string | undefined {
  const app = useAppStore.getState();
  const live = app.terminalStates.get(terminalId)?.cwd;
  if (live) return live;
  if (terminalId.startsWith('shell:')) return app.shellRuntimes.get(terminalId.slice('shell:'.length))?.cwd;
  return undefined;
}

/** Where a brand-new shell starts: after the current leaf, else the scoped project, else home. */
function resolveSpawnTarget(tab: TerminalTab | null, leafTerminalId?: string) {
  const { doc } = useTerminalLayoutStore.getState();
  const { projects } = useAppStore.getState();
  const scope = doc.window.scope;
  const scopedProjectId = scope === 'global' ? undefined : scope.projectId;
  const tabProjectId = tab ? projectIdOfWorkspace(tab.workspaceId) ?? undefined : undefined;
  const projectId = scopedProjectId ?? tabProjectId;
  const fromLeaf = leafTerminalId ?? (tab ? activeLeafOf(tab).terminalId : undefined);
  const cwd =
    (fromLeaf ? terminalCwd(fromLeaf) : undefined) ??
    (projectId ? projects.find((p) => p.id === projectId)?.rootPath : undefined);
  return { projectId, cwd };
}

/** Open a new shell in a new tab of the current scope. */
export async function openNewTerminal(): Promise<void> {
  const layout = useTerminalLayoutStore.getState();
  const { projectId, cwd } = resolveSpawnTarget(layout.activeTab());
  try {
    const shellId = await useAppStore.getState().openShell({ projectId, cwd, surface: 'window' });
    useTerminalLayoutStore.getState().addTerminalToWindow(`shell:${shellId}`, { projectId });
  } catch (error) {
    console.error('Failed to open a terminal:', error);
    toast.error(`Failed to open terminal: ${String(error)}`);
  }
}

/**
 * Open a new shell next to a leaf. `horizontal` puts it to the right,
 * `vertical` below (see `SplitDirection`).
 */
export async function splitLeaf(tabId: string, leafId: string, direction: SplitDirection): Promise<void> {
  const layout = useTerminalLayoutStore.getState();
  const tab = layout.doc.window.tabs.find((t) => t.id === tabId) ?? null;
  const leafTerminalId = tab ? collectLeaves(tab.layout).find((l) => l.id === leafId)?.terminalId : undefined;
  const { projectId, cwd } = resolveSpawnTarget(tab, leafTerminalId);
  try {
    const shellId = await useAppStore.getState().openShell({ projectId, cwd, surface: 'window' });
    useTerminalLayoutStore.getState().addTerminalToWindow(`shell:${shellId}`, {
      projectId,
      splitFrom: { tabId, leafId, direction },
    });
  } catch (error) {
    console.error('Failed to split the terminal:', error);
    toast.error(`Failed to open terminal: ${String(error)}`);
  }
}

/**
 * Shells die with their leaf; services and scripts keep running in the
 * backend (the main window can still find them), the window just stops
 * showing them.
 */
function releaseTerminal(terminalId: string) {
  if (!terminalId.startsWith('shell:')) return;
  const app = useAppStore.getState();
  // `closeTerminal` only kills shells it knows; a shell spawned by the other
  // window may not be registered here yet, so make sure the process goes.
  if (!app.terminals.has(terminalId)) {
    app.killShell(terminalId.slice('shell:'.length)).catch(() => {});
  }
  app.closeTerminal(terminalId);
}

/** Remove one leaf from the window and, for shells, kill the process. */
export function closeLeaf(terminalId: string): void {
  useTerminalLayoutStore.getState().removeTerminalFromWindow(terminalId, null);
  releaseTerminal(terminalId);
}

/** Close a whole tab: every leaf leaves the window, shells are killed. */
export function closeTabAndRelease(tabId: string): void {
  const ids = useTerminalLayoutStore.getState().closeTab(tabId);
  for (const id of ids) releaseTerminal(id);
}

/** Hand a terminal back to the main window's dock. */
export function sendLeafToDock(terminalId: string): void {
  useTerminalLayoutStore.getState().sendToDock(terminalId);
}

/** Close the active leaf of the active tab (Ctrl+Shift+W). */
export function closeActiveLeaf(): void {
  const tab = useTerminalLayoutStore.getState().activeTab();
  if (!tab) return;
  closeLeaf(activeLeafOf(tab).terminalId);
}

/** Split the active leaf of the active tab (Ctrl+Shift+D / E). */
export function splitActiveLeaf(direction: SplitDirection): Promise<void> {
  const tab = useTerminalLayoutStore.getState().activeTab();
  if (!tab) return openNewTerminal();
  return splitLeaf(tab.id, activeLeafOf(tab).id, direction);
}

/** Jump to the next / previous tab of the current scope (Ctrl+Tab). */
export function cycleTab(delta: 1 | -1): void {
  const layout = useTerminalLayoutStore.getState();
  const tabs = layout.scopedTabs();
  if (tabs.length < 2) return;
  const current = tabs.findIndex((t) => t.id === layout.doc.window.activeTabId);
  const next = tabs[(current + delta + tabs.length) % tabs.length];
  layout.setActiveTab(next.id);
}

/**
 * Move the active leaf of the active tab in visual order (Alt+Arrow).
 * Returns false when there is nothing to move to, so the key can fall
 * through to the shell.
 */
export function cycleLeaf(delta: 1 | -1): boolean {
  const layout = useTerminalLayoutStore.getState();
  const tab = layout.activeTab();
  if (!tab) return false;
  const leaves = collectLeaves(tab.layout);
  if (leaves.length < 2) return false;
  const current = leaves.findIndex((l) => l.id === tab.activeLeafId);
  const next = leaves[(current + delta + leaves.length) % leaves.length];
  layout.setActiveLeaf(tab.id, next.id);
  useAppStore.getState().markTerminalSeen(next.terminalId);
  return true;
}
