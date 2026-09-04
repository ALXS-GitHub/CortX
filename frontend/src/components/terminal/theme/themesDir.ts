/**
 * Where the terminal themes live on disk, for the picker's "Themes folder"
 * button (DEV-13 P3).
 *
 * The folder is `<app data>/terminal/themes` and the app data directory is
 * `directories::ProjectDirs::from("com", "cortx", "Cortx")` on the Rust side
 * (`Storage::new`). Nothing exposes it to the frontend yet, so this asks the
 * backend first — `terminal_themes_dir` is a two-line command someone may
 * have added since — and otherwise rebuilds the same path the way
 * `directories` does, per platform:
 *
 * | OS      | `dataDir()`                       | ProjectDirs layout                  |
 * |---------|-----------------------------------|-------------------------------------|
 * | Windows | `%APPDATA%`                       | `<org>\<app>\data`  → `cortx\Cortx\data` |
 * | macOS   | `~/Library/Application Support`   | `com.cortx.Cortx`                   |
 * | Linux   | `$XDG_DATA_HOME` (`~/.local/share`) | `cortx` (app name, lowercased)    |
 *
 * Verified on the owner's machine: `%APPDATA%\cortx\Cortx\data\terminal\themes`.
 */
import { invoke } from '@tauri-apps/api/core';
import { dataDir, join } from '@tauri-apps/api/path';
import { openInExplorer } from '@/lib/tauri';

let cached: Promise<string> | null = null;

async function resolveThemesDir(): Promise<string> {
  try {
    const dir = await invoke<string>('terminal_themes_dir');
    if (typeof dir === 'string' && dir.length > 0) return dir;
  } catch {
    // Command not registered in this build: compose the path instead.
  }
  const base = await dataDir();
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Windows/i.test(ua)) return join(base, 'cortx', 'Cortx', 'data', 'terminal', 'themes');
  if (/Mac/i.test(ua)) return join(base, 'com.cortx.Cortx', 'terminal', 'themes');
  return join(base, 'cortx', 'terminal', 'themes');
}

/** Absolute path of `data/terminal/themes` (resolved once per session). */
export function terminalThemesDir(): Promise<string> {
  cached ??= resolveThemesDir().catch((err) => {
    cached = null; // a transient failure must not stick for the session
    throw err;
  });
  return cached;
}

/** Reveal the themes folder in the OS file manager. */
export async function openTerminalThemesDir(): Promise<void> {
  await openInExplorer(await terminalThemesDir());
}
