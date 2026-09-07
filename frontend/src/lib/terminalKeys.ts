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
 *
 * ## ⌥ (Option) on macOS — `macOptionAsMeta`
 *
 * xterm.js offers one boolean, `macOptionIsMeta`, and neither end of it is
 * usable on its own:
 *
 * - **on** — every ⌥ chord becomes `ESC` + key. `Alt+B` / `Alt+F` (word by
 *   word in bash, zsh and every readline program) work, but ⌥ stops being a
 *   third-level shift. On the Swiss German, Swiss French, ABC-AZERTY and
 *   French-PC layouts `[ ] { } | @ # \ ~` all live on the ⌥ layer, so `⌥5`
 *   sends `ESC 5` instead of `[` and **no command containing a pipe, a brace
 *   or an e-mail address can be typed at all**.
 * - **off** (xterm's own default, and Terminal.app's) — the characters come
 *   back and every word-motion chord is lost.
 *
 * So CortX does neither by default: `macOptionIsMeta` stays off, macOS
 * composes as it intends, and this module reserves a **closed list of five
 * keys** — ⌥B, ⌥F, ⌥D, ⌥V and ⌥⌫ — which it sends to the PTY as `ESC` +
 * key itself.
 *
 * Why a fixed list is defensible here, when Warp gave up on the same problem:
 * Warp's `meta_shortcuts.rs` notes that macOS does not expose which chords
 * are dead keys, so a per-layout table is unmaintainable — and that is right.
 * This is not that table. It is five entries that do not vary by layout: `b`,
 * `f`, `d` and `v` are not dead keys on Apple's Latin layouts (those are
 * ⌥E, ⌥U, ⌥I, ⌥N and ⌥`), and their ⌥ layer holds only typographic
 * symbols (`∫ ƒ ∂ √`) that no command line needs. Anyone who disagrees
 * has `never` and `always`.
 *
 * The list matches on `event.code`, never `event.key`: with composition left
 * to macOS, `key` is already the composed glyph by the time we see it.
 */
import { useAppStore } from '@/stores/appStore';
import { IS_MAC } from '@/lib/keybindings';
import type { MacOptionAsMeta, ShiftEnterKey } from '@/types';

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

export const DEFAULT_MAC_OPTION_AS_META: MacOptionAsMeta = 'wordKeys';

/** How ⌥ behaves on macOS (`wordKeys` by default; ignored elsewhere). */
export function macOptionAsMetaMode(): MacOptionAsMeta {
  const raw = useAppStore.getState().settings?.terminal.macOptionAsMeta;
  return raw === 'never' || raw === 'always' ? raw : DEFAULT_MAC_OPTION_AS_META;
}

/** True when xterm's own `macOptionIsMeta` should be on (mode `always`). */
export function macOptionIsMetaOption(): boolean {
  return macOptionAsMetaMode() === 'always';
}

/**
 * The five chords `wordKeys` reserves, by `KeyboardEvent.code`, and what each
 * one sends. Fixed on purpose — see the module header for why this is not a
 * per-layout dead-key table.
 *
 * `⌥⌫` is readline's `backward-kill-word`, which is `ESC` + DEL (0x7f), not
 * `ESC` + BS. ⌥B / ⌥F are `backward-word` / `forward-word`, ⌥D is
 * `kill-word`; ⌥V is what Claude Code reads for "paste the image on the
 * clipboard" (zorg #28), and in a plain shell it is `yank-nth-arg`.
 */
export const MAC_OPTION_WORD_KEYS: Readonly<Record<string, string>> = {
  KeyB: 'b',
  KeyD: 'd',
  KeyF: 'f',
  KeyV: 'v',
  Backspace: '\x7f',
};

/**
 * What a ⌥ chord should send on macOS, or null to leave the event alone —
 * which means macOS composes the character, so `⌥5` stays `[`.
 *
 * Only ever answers on macOS, only in `wordKeys` mode, and only for a plain
 * ⌥ chord (no Ctrl, no Cmd) whose physical key is one of
 * [`MAC_OPTION_WORD_KEYS`]. `mode` and `isMac` are parameters so the rule can
 * be tested off a Mac.
 */
export function macOptionMetaSequence(
  e: KeyboardEvent,
  mode: MacOptionAsMeta = macOptionAsMetaMode(),
  isMac: boolean = IS_MAC
): string | null {
  if (!isMac || mode !== 'wordKeys') return null;
  if (e.type !== 'keydown') return null;
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  const key = MAC_OPTION_WORD_KEYS[e.code];
  if (key === undefined) return null;
  // ⌥⇧B is readline's `M-B`, uppercase; ⌥⇧⌫ stays DEL.
  return '\x1b' + (e.shiftKey && key.length === 1 && key >= 'a' && key <= 'z' ? key.toUpperCase() : key);
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
