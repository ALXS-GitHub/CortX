import { invoke } from '@tauri-apps/api/core';
import { getAllWebviewWindows } from '@tauri-apps/api/webviewWindow';
import { PRIMARY_TERMINAL_WINDOW } from '@/lib/terminalLayout';
import { restoreTerminalSessions } from '@/lib/terminalRestore';

/**
 * Creating, raising and locating the Terminal windows (DEV-13, ticket #20).
 *
 * There used to be exactly one, created by `open_terminal_window`. A tab can
 * now be moved to a window of its own, so the backend takes a label:
 * `open_terminal_window_labelled`. The command is called through `invoke`
 * rather than `lib/tauri.ts` because the two files have different owners
 * while DEV-13 is in flight; the wrapper falls back to the old command for
 * the first window so a build without the new one still works.
 */

export interface OpenTerminalWindowOptions {
  /** Project scope to apply on creation. */
  projectId?: string | null;
  /** Launch configuration to run on creation. */
  launch?: string | null;
  /**
   * Where to put a brand-new window, in *logical* screen pixels (the top-left
   * corner). Used when a tab is dropped outside the window it came from, so
   * the new window shows up under the pointer instead of in the middle of the
   * screen. Ignored when the window already exists.
   */
  position?: { x: number; y: number } | null;
}

/**
 * Open (or raise) the Terminal window with this label.
 *
 * Entering terminal mode is what restores the saved sessions — starting CortX
 * does not (see `lib/terminalRestore`). The restore runs once per run and is
 * awaited *before* the window opens, so the window never mounts a tab whose
 * shell is about to be replaced.
 */
export async function openTerminalWindow(
  label: string = PRIMARY_TERMINAL_WINDOW,
  options: OpenTerminalWindowOptions = {}
): Promise<void> {
  await restoreTerminalSessions();
  const projectId = options.projectId ?? null;
  const launch = options.launch ?? null;
  const position = options.position ?? null;
  try {
    await invoke('open_terminal_window_labelled', {
      label,
      projectId,
      launch,
      x: position ? Math.round(position.x) : null,
      y: position ? Math.round(position.y) : null,
    });
  } catch (error) {
    // Older binary (or the command not registered yet): the first window can
    // still be opened the way it always was; a detached one cannot.
    if (label !== PRIMARY_TERMINAL_WINDOW) throw error;
    await invoke('open_terminal_window', { projectId, launch });
  }
}

/** A Terminal window's label, or null for the main window / anything else. */
export function terminalWindowLabel(label: string): string | null {
  if (label === PRIMARY_TERMINAL_WINDOW) return label;
  return label.startsWith(`${PRIMARY_TERMINAL_WINDOW}-`) ? label : null;
}

export interface TerminalWindowRect {
  label: string;
  /** Outer rectangle in *physical* screen pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where every visible Terminal window is on screen, so a tab dropped outside
 * its own window can land in one of the others (as a browser does) instead of
 * always spawning a new one.
 */
export async function terminalWindowRects(exclude?: string): Promise<TerminalWindowRect[]> {
  const windows = await getAllWebviewWindows();
  const out: TerminalWindowRect[] = [];
  await Promise.all(
    windows.map(async (w) => {
      if (!terminalWindowLabel(w.label) || w.label === exclude) return;
      try {
        if (!(await w.isVisible())) return;
        const pos = await w.outerPosition();
        const size = await w.outerSize();
        out.push({ label: w.label, x: pos.x, y: pos.y, width: size.width, height: size.height });
      } catch {
        // A window closing while we look at it is not an error.
      }
    })
  );
  return out;
}

/** The Terminal window under a *physical* screen point, if any. */
export function windowAtPhysicalPoint(rects: TerminalWindowRect[], x: number, y: number): TerminalWindowRect | null {
  return rects.find((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) ?? null;
}
