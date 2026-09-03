/**
 * Session restore (DEV-13 P2): reopen the Terminal window's tabs after the
 * app starts, Warp-style — the *layout* comes back, shells reopen in their
 * last directory (seeded with their previous scrollback tail), and nothing is
 * re-run. Services / scripts keep their leaves and show as ended until
 * restarted.
 *
 * Runs once, in the main window (the one that always boots), after the shared
 * layout and the live shell list are known.
 */
import * as api from '@/lib/tauri';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore, IS_TERMINAL_WINDOW } from '@/stores/terminalLayoutStore';
import { allWindowLeaves, projectIdOfWorkspace, replaceTerminalIds } from '@/lib/terminalLayout';

let restoredOnce = false;

export async function restoreTerminalSessions(): Promise<void> {
  if (restoredOnce || IS_TERMINAL_WINDOW) return;
  restoredOnce = true;

  const settings = useAppStore.getState().settings ?? (await api.getSettings().catch(() => null));
  if (settings?.terminal.restoreSessions === false) return;

  const layoutStore = useTerminalLayoutStore.getState();
  if (!layoutStore.loaded) return;
  const doc = layoutStore.doc;
  const leaves = allWindowLeaves(doc.window);
  if (leaves.length === 0) return;

  const alive = new Set((await api.listShells().catch(() => [])).map((s) => `shell:${s.id}`));
  const mapping: Record<string, string> = {};
  const surfaces = { ...doc.surfaces };

  for (const { tab, leaf } of leaves) {
    const id = leaf.terminalId;
    if (!id.startsWith('shell:') || alive.has(id) || mapping[id]) continue;
    try {
      const info = await api.spawnShell({
        cwd: leaf.cwd ?? undefined,
        projectId: projectIdOfWorkspace(tab.workspaceId) ?? undefined,
        restoreFrom: id,
      });
      const newId = `shell:${info.id}`;
      mapping[id] = newId;
      delete surfaces[id];
      surfaces[newId] = 'window';
    } catch (e) {
      console.warn(`Could not restore terminal ${id}`, e);
    }
  }

  if (Object.keys(mapping).length > 0) {
    layoutStore.commit((d) => ({
      ...d,
      surfaces,
      window: replaceTerminalIds(d.window, mapping),
    }));
    // Register the new shells' runtimes (their surface is now known, so
    // they stay out of the dock's tray).
    await useAppStore.getState().loadShells();
  }

  // Snapshots of terminals that are not in the layout any more are dead weight.
  const keep = allWindowLeaves(useTerminalLayoutStore.getState().doc.window).map((l) => l.leaf.terminalId);
  api.pruneTerminalSnapshots(keep).catch(() => {});

  if (doc.windowOpen) {
    api.openTerminalWindow().catch(() => {});
  }
}
