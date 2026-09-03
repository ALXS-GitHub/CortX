/**
 * Restore snapshots written by the GUI (DEV-13 P2).
 *
 * The backend keeps a raw tail of every PTY stream, but raw bytes carry
 * cursor movement and open colour attributes, which scramble when replayed
 * into a terminal of another size. xterm.js can instead serialise what is
 * actually *on screen* — plain lines with colours — so this window snapshots
 * its own sessions that way every 30 s and when the app is closing. Rust
 * prefers a fresh GUI snapshot over its raw tail.
 */
import * as api from '@/lib/tauri';
import { listTerminalSessionIds, serializeTerminalSession } from '@/lib/terminalSessions';
import { useAppStore } from '@/stores/appStore';

const INTERVAL_MS = 30_000;
let timer: number | null = null;
const lastStored = new Map<string, string>();

/** Serialise and store every session of this window (skips unchanged ones). */
export async function storeTerminalSnapshots(force = false): Promise<void> {
  const cfg = useAppStore.getState().settings?.terminal;
  if (cfg?.restoreScrollback === false) return;
  const lines = Math.max(20, Math.min(2000, cfg?.restoreScrollbackLines ?? 200));
  const writes: Promise<void>[] = [];
  for (const id of listTerminalSessionIds()) {
    const text = serializeTerminalSession(id, lines);
    if (!text) continue;
    if (!force && lastStored.get(id) === text) continue;
    lastStored.set(id, text);
    writes.push(api.storeTerminalSnapshot(id, text).catch(() => {}));
  }
  await Promise.all(writes);
}

/** Periodic snapshots for the life of this window. Idempotent. */
export function startTerminalSnapshotScheduler(): () => void {
  if (timer === null) {
    timer = window.setInterval(() => void storeTerminalSnapshots(), INTERVAL_MS);
  }
  return () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}
