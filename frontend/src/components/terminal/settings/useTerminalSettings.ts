/**
 * The one source of truth behind every terminal settings control (DEV-13 #8).
 *
 * Both the Settings page of the main window and the Terminal window's own
 * panel mount the same section components; they all read `settings.terminal`
 * from the app store and write back through `updateSettings`, which persists
 * `settings.json`. The file watcher then fires `data-changed`, the other
 * window reloads its settings, and the two stay in step — no second store, no
 * window-to-window channel.
 *
 * Writes are coalesced for 250 ms so dragging a slider or typing in a number
 * field does not rewrite the file on every keystroke. Each flush re-reads the
 * live settings, so a patch never resurrects a value another surface changed
 * in the meantime.
 */
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import type { TerminalConfig } from '@/types';

const FLUSH_DELAY_MS = 250;

// Module-level, not per-hook: two mounted sections must share one queue, or a
// pending patch from one would be written on top of the other's.
let pending: Partial<TerminalConfig> = {};
let timer: number | null = null;

function flush() {
  timer = null;
  const patch = pending;
  pending = {};
  if (Object.keys(patch).length === 0) return;
  const { settings, updateSettings } = useAppStore.getState();
  if (!settings) return;
  void updateSettings({ ...settings, terminal: { ...settings.terminal, ...patch } }).catch((err) =>
    toast.error('Could not save the terminal settings', { description: String(err) })
  );
}

/** Queue a patch on `settings.terminal`. Exported for non-React callers. */
export function patchTerminalSettings(patch: Partial<TerminalConfig>): void {
  pending = { ...pending, ...patch };
  // The store is updated optimistically by `updateSettings`, but only once
  // the debounce elapses; until then the controls read the previous value.
  // Applying the patch to the store right away keeps them responsive.
  const { settings } = useAppStore.getState();
  if (settings) {
    useAppStore.setState({ settings: { ...settings, terminal: { ...settings.terminal, ...pending } } });
  }
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(flush, FLUSH_DELAY_MS);
}

/** Write everything queued right now (on unmount, or before closing a panel). */
export function flushTerminalSettings(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    flush();
  }
}

export interface TerminalSettingsHandle {
  /** Live `settings.terminal`; null until the settings are loaded. */
  terminal: TerminalConfig | null;
  /** Merge these keys into `settings.terminal` (debounced). */
  patch: (patch: Partial<TerminalConfig>) => void;
}

export function useTerminalSettings(): TerminalSettingsHandle {
  const terminal = useAppStore((s) => s.settings?.terminal ?? null);
  const patch = useCallback((next: Partial<TerminalConfig>) => patchTerminalSettings(next), []);
  // A panel closed mid-edit must not lose the last keystroke.
  const flushRef = useRef(flushTerminalSettings);
  useEffect(() => () => flushRef.current(), []);
  return { terminal, patch };
}
