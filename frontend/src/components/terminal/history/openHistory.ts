/**
 * How the command-history view is asked to open (#39).
 *
 * A DOM event rather than a store, for the same reason the palette uses one
 * (`TERMINAL_EVENTS.palette` in `actions.ts`): the keybinding dispatcher, the
 * palette and — later — the input editor all want to open it, and none of them
 * should have to own its state.
 *
 * The `pick` field is what makes this view re-usable as the Ctrl+R palette of
 * the input editor (epic U2.d): opened with a callback, choosing a row hands
 * the command back to the caller instead of running it, and nothing is written
 * to any PTY. Nothing binds Ctrl+R to it yet — see the module header of
 * `CommandHistoryView.tsx` for what is left to wire.
 */

/** Custom event the mounted view listens to. */
export const HISTORY_EVENT = 'cortx:terminal-history';

export interface OpenHistoryDetail {
  /** Pre-fill the search box (the text already typed at the prompt). */
  search?: string;
  /** Start narrowed to one project. */
  projectId?: string;
  /** Start narrowed to one directory. */
  cwd?: string;
  /**
   * "Choose a command and give it back" mode. When set, rows do not run
   * anything: picking one calls this and closes the view. The caller decides
   * what the command becomes (a line in the input editor, a launch config…).
   */
  pick?: (command: string) => void;
  /** Set by the view when it handled the event, so a caller can tell. */
  handled?: boolean;
}

/**
 * Open the history view. Returns false when no view is mounted (the dock
 * before it hosts one), so a keybinding can fall through to the shell.
 */
export function openCommandHistory(detail: OpenHistoryDetail = {}): boolean {
  const payload: OpenHistoryDetail = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent<OpenHistoryDetail>(HISTORY_EVENT, { detail: payload }));
  return payload.handled === true;
}
