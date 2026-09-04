/**
 * Keys a plain VT terminal cannot express, and the CortX settings that drive
 * them (`settings.terminal`, mirrored in `cortx_core::models::TerminalConfig`).
 *
 * ## Shift+Enter
 *
 * Enter and Shift+Enter both send a bare CR in a classic terminal, so the
 * program under the PTY cannot tell them apart: pressing Shift+Enter in
 * Claude Code submits the prompt instead of adding a line. Terminals solve
 * this either with the Kitty keyboard protocol / `modifyOtherKeys` — which
 * xterm.js 6 does not implement — or by sending a distinct sequence.
 *
 * Claude Code's own `/terminal-setup` picks the second route for editors: it
 * writes a VS Code keybinding on `shift+enter` whose
 * `workbench.action.terminal.sendSequence` text is ESC followed by CR
 * (verified in the installed `claude.exe` bundle, 2026-09-04). ESC CR is also
 * exactly what Alt/Option+Enter already sends — the binding Claude Code
 * recommends on macOS Terminal.app — and what zsh (`self-insert-unmeta`) and
 * fish insert a literal new line for.
 *
 * Claude Code does support the Kitty protocol and `modifyOtherKeys`, but it
 * only turns them on for a hard-coded list of terminals (iTerm2, kitty,
 * WezTerm, Ghostty, tmux, Windows Terminal, Warp), so answering its queries
 * would not help CortX. Hence ESC CR.
 *
 * ## Ctrl+Enter
 *
 * Warp accepts **both** Shift+Enter and Ctrl+Enter for "new line, do not
 * submit", so a habit built in Warp carries over. CortX does the same: the
 * two combinations are the same key here, encoded by the same `shiftEnter`
 * setting. Ctrl+**Shift**+Enter is deliberately left alone — it is the
 * `pane.maximize` shortcut (see `lib/keybindings.ts`).
 */
import { useAppStore } from '@/stores/appStore';
import type { ShiftEnterKey } from '@/types';

/** ESC + CR: "new line, do not submit" for Claude Code, zsh and fish. */
export const ESC_CR = String.fromCharCode(0x1b, 0x0d);

export const DEFAULT_SHIFT_ENTER: ShiftEnterKey = 'escape-enter';
/** Wheel animation in ms. Long enough to read as a glide, short enough to feel instant. */
export const DEFAULT_SMOOTH_SCROLL_DURATION = 100;
const MAX_SMOOTH_SCROLL_DURATION = 500;

/** How Shift+Enter (and Ctrl+Enter) is encoded (`escape-enter` by default). */
export function shiftEnterMode(): ShiftEnterKey {
  return useAppStore.getState().settings?.terminal.shiftEnter ?? DEFAULT_SHIFT_ENTER;
}

/**
 * True for the two chords that mean "new line, do not submit": Shift+Enter
 * and Ctrl+Enter. Ctrl+Shift+Enter is **not** one of them (`pane.maximize`),
 * and neither is anything carrying Alt or Meta.
 */
export function isNewlineEnter(e: KeyboardEvent): boolean {
  if (e.key !== 'Enter' || e.altKey || e.metaKey) return false;
  return e.shiftKey !== e.ctrlKey;
}

/** A mouse selection is copied as soon as it ends (default true). */
export function copyOnSelectEnabled(): boolean {
  return useAppStore.getState().settings?.terminal.copyOnSelect ?? true;
}

/** Wheel scrolling animation in ms, clamped to 0–500 (0 = instant). */
export function smoothScrollDuration(): number {
  const raw = useAppStore.getState().settings?.terminal.smoothScrollDuration;
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_SMOOTH_SCROLL_DURATION;
  return Math.min(MAX_SMOOTH_SCROLL_DURATION, Math.max(0, Math.round(raw)));
}

/**
 * The bytes to send for a key xterm.js would encode ambiguously, or null to
 * let xterm handle the event as usual.
 *
 * Only Shift+Enter and Ctrl+Enter qualify today. Everything else — Enter,
 * Ctrl+C/D/Z, the arrows, Alt+arrows, Home/End, Tab and Shift+Tab — is left
 * to xterm, which already encodes them the way the shell expects.
 *
 * This is the **classic** path, the one used when the universal input editor
 * is off (which is the default): it is what makes Ctrl+Enter work inside
 * Claude Code today. The editor has the same rule of its own, in
 * `terminalInputState.ts`.
 */
export function overrideKeySequence(e: KeyboardEvent): string | null {
  if (e.type !== 'keydown') return null;
  if (!isNewlineEnter(e)) return null;
  return shiftEnterMode() === 'escape-enter' ? ESC_CR : null;
}
