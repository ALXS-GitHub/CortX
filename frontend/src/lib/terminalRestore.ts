/**
 * Session restore (DEV-13 P2): reopen the Terminal window's tabs, Warp-style —
 * the *layout* comes back, shells reopen in their last directory (seeded with
 * their previous scrollback tail), and nothing is re-run. Services / scripts
 * keep their leaves and show as ended until restarted.
 *
 * **Lazy on purpose.** Starting CortX must not start a terminal: respawning
 * every saved shell at boot costs a PTY (and a shell profile, and whatever
 * `cortx init` pulls in) per tab, for a window nobody has asked for yet. So
 * `bootTerminalRestore` only tidies snapshots, and reopens the Terminal window
 * when it was up at the last quit; the shells themselves are respawned by
 * `restoreTerminalSessions`, which `openTerminalWindow` awaits — the first
 * time terminal mode is entered, and once per run.
 */
import * as api from '@/lib/tauri';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore, IS_TERMINAL_WINDOW } from '@/stores/terminalLayoutStore';
import { allWindowLeaves, projectIdOfWorkspace, replaceTerminalIds } from '@/lib/terminalLayout';
import { openTerminalWindow } from '@/components/terminal/terminalWindows';

let restoreStarted: Promise<void> | null = null;

/**
 * Respawn the shells of the saved layout, once per run. Callers await the
 * same promise, so opening two Terminal windows at once cannot restore twice.
 */
export function restoreTerminalSessions(): Promise<void> {
  restoreStarted ??= runRestore().catch((e) => {
    console.warn('Session restore failed', e);
  });
  return restoreStarted;
}

async function runRestore(): Promise<void> {

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
  // A tab that was never brought to the front has no recorded size. Its pane
  // is laid out like the others, so a sibling's size is the right guess.
  const fallbackSize = leaves.map(({ leaf }) => leaf).find((l) => l.cols && l.rows);

  for (const { tab, leaf } of leaves) {
    const id = leaf.terminalId;
    if (!id.startsWith('shell:') || alive.has(id) || mapping[id]) continue;
    try {
      const info = await api.spawnShell({
        cwd: leaf.cwd ?? undefined,
        projectId: projectIdOfWorkspace(tab.workspaceId) ?? undefined,
        // The size the pane had when the app closed. Without it the shell
        // starts at the backend default, prints its prompt (and whatever the
        // profile shows above it), and is only then resized — which leaves
        // the line editor writing several lines above the prompt.
        cols: leaf.cols ?? fallbackSize?.cols,
        rows: leaf.rows ?? fallbackSize?.rows,
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

}

/**
 * What session restore does at app start: nothing that costs a process. The
 * snapshots of terminals that left the layout are dead weight, and a Terminal
 * window that was up at the last quit is reopened — which is what triggers the
 * shell restore, through `openTerminalWindow`.
 */
export async function bootTerminalRestore(): Promise<void> {
  if (IS_TERMINAL_WINDOW) return;
  const settings = useAppStore.getState().settings ?? (await api.getSettings().catch(() => null));
  if (settings?.terminal.restoreSessions === false) return;
  const doc = useTerminalLayoutStore.getState().doc;
  const keep = allWindowLeaves(doc.window).map((l) => l.leaf.terminalId);
  api.pruneTerminalSnapshots(keep).catch(() => {});
  if (doc.windowOpen) {
    openTerminalWindow().catch(() => {});
  }
}
