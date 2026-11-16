import { create } from 'zustand';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { saveWindowState } from '@/lib/tauri';

/**
 * The in-app update, shared by the dialog shown at startup (`UpdateChecker`)
 * and the Updates card of the Settings, so a check started from one is seen
 * by the other and an install runs once.
 *
 * - `idle`: nothing checked yet in this run.
 * - `checking`: asking the release feed.
 * - `upToDate`: the feed has nothing newer than this build.
 * - `available`: `update` is newer and can be installed.
 * - `downloading`: the installer is coming down (`downloaded` / `total` bytes).
 * - `installing`: downloaded; the installer takes over and the app relaunches.
 * - `error`: the last check or install failed, `error` says why — never
 *   swallowed: a failed download used to put the button back as if nothing
 *   had happened (0.15.13, whose feed pointed at a missing file).
 */
export type UpdatePhase = 'idle' | 'checking' | 'upToDate' | 'available' | 'downloading' | 'installing' | 'error';

interface UpdateState {
  phase: UpdatePhase;
  update: Update | null;
  downloaded: number;
  total: number;
  error: string | null;
  lastChecked: number | null;
  /** The startup dialog. */
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  /** Ask the feed. `openDialog`: show the dialog when something is found (the startup check). */
  checkForUpdate: (opts?: { openDialog?: boolean }) => Promise<void>;
  /** Download and install `update`, then relaunch. */
  install: () => Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useUpdateStore = create<UpdateState>((set, get) => ({
  phase: 'idle',
  update: null,
  downloaded: 0,
  total: 0,
  error: null,
  lastChecked: null,
  dialogOpen: false,
  setDialogOpen: (dialogOpen) => set({ dialogOpen }),

  checkForUpdate: async ({ openDialog = false } = {}) => {
    const { phase } = get();
    if (phase === 'checking' || phase === 'downloading' || phase === 'installing') return;
    set({ phase: 'checking', error: null });
    try {
      const update = await check();
      set({
        update,
        phase: update ? 'available' : 'upToDate',
        lastChecked: Date.now(),
        dialogOpen: openDialog && !!update ? true : get().dialogOpen,
      });
    } catch (e) {
      console.error('Failed to check for updates:', e);
      set({ phase: 'error', error: `Could not check for updates: ${message(e)}`, lastChecked: Date.now() });
    }
  },

  install: async () => {
    const { update, phase } = get();
    if (!update || phase === 'downloading' || phase === 'installing') return;
    set({ phase: 'downloading', downloaded: 0, total: 0, error: null });
    try {
      // The installer ends this process without the save done on a normal
      // quit; keep the window sizes it is about to throw away.
      await saveWindowState().catch((err) => console.error('Failed to save the window state:', err));
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            set({ total: event.data.contentLength ?? 0 });
            break;
          case 'Progress':
            set((s) => ({ downloaded: s.downloaded + event.data.chunkLength }));
            break;
          case 'Finished':
            set({ phase: 'installing' });
            break;
        }
      });
      await relaunch();
    } catch (e) {
      console.error('Failed to install update:', e);
      set({ phase: 'error', error: `The update failed: ${message(e)}` });
    }
  },
}));

/** Download progress in percent, or null while the size is unknown. */
export function updateProgress(downloaded: number, total: number): number | null {
  return total > 0 ? Math.min(100, (downloaded / total) * 100) : null;
}
