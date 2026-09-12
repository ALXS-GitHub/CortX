import { useEffect } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useAppStore } from '@/stores/appStore';
import { IS_MAC, comboFromEvent, resolveKeybindings, type KeybindingActionId } from '@/lib/keybindings';
import { endTabCycle, pasteDroppedPaths, runAction } from './actions';
import { adjustTerminalZoom } from '@/lib/terminalSessions';

/** Actions that must also work while a text field (palette, find, rename) has focus. */
const ALWAYS_ON: ReadonlySet<KeybindingActionId> = new Set<KeybindingActionId>(['window.palette', 'terminal.find']);

/**
 * A text field that belongs to the window's chrome rather than to a terminal:
 * the palette's search box, the find bar, a tab being renamed. Those keep
 * their keys; a terminal never does.
 *
 * The test is the *session container* (`.cortx-xterm`), not xterm's own root
 * (`.xterm`). Since the universal input editor (ticket #15) the thing holding
 * the focus while you type at a prompt is a real `<textarea>` of ours
 * (`.cortx-uinput-field`), and it is a **sibling** of `.xterm` inside that
 * container — so every shortcut but the palette and the find bar was silently
 * dropped the moment the caret was in a session, which is where it is
 * essentially all the time. Ctrl+Shift+T only worked with a tab focused, and
 * Ctrl+Shift+D never worked at all, since splitting is something you ask for
 * from inside the pane you are splitting.
 */
function isTextFieldOutsideTerminal(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const field = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
  return field && !target.closest('.cortx-xterm');
}

/** While Control is held, the rail / strip show their tab numbers (`html[data-ctrl-held]`). */
let ctrlHeld = false;

/**
 * The single place that knows whether Ctrl (⌘) is down — the tab numbers hang
 * off it, and so does the Ctrl+Tab cycle (issue 45b).
 *
 * Giving the cycle its own keyup listener was the obvious thing to do and the
 * wrong one: it is precisely the detector that ticket #34 had to make
 * self-healing, because the keyup is simply never delivered when the window
 * loses the keyboard mid-press. A second, naive one would strand a snapshot
 * the same way the attribute used to be stranded. So the release edge is
 * published from here instead, once, and every consequence of it hangs off
 * this transition.
 */
function setCtrlHeld(held: boolean) {
  if (held === ctrlHeld) return;
  ctrlHeld = held;
  if (held) document.documentElement.setAttribute('data-ctrl-held', '');
  else document.documentElement.removeAttribute('data-ctrl-held');
  // Ctrl came up (or the window can no longer tell that it did): a Ctrl+Tab
  // gesture in flight ends here, and the recently-used stack is committed.
  if (!held) endTabCycle();
}

/**
 * The modifier that arms Ctrl+N, read from the event's own modifier state
 * (⌘ on macOS, like `comboFromEvent`). Reading the flag rather than tracking
 * keydown/keyup pairs is what makes the hint self-healing: whatever happened
 * to the keyup, the next event the window sees carries the truth.
 */
function primaryHeld(e: KeyboardEvent | MouseEvent | WheelEvent): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey;
}

/**
 * Reveal the tab numbers while Ctrl (⌘) is down — and, above all, stop
 * revealing them once it is up (ticket #34). A symmetric keydown/keyup pair
 * is not enough: the keyup is simply never delivered when the window loses
 * the keyboard mid-press (Alt+Tab, a native menu, an Explorer window opened
 * from the menu, another Terminal window taking over), and the attribute
 * then stayed on forever. So the state is re-derived from `ctrlKey` /
 * `metaKey` on every keyboard and pointer event, and cleared outright
 * whenever the window stops being the one that would receive the keyup.
 */
function useCtrlHeldHint() {
  useEffect(() => {
    const sync = (e: KeyboardEvent | MouseEvent | WheelEvent) => setCtrlHeld(primaryHeld(e));
    const clear = () => setCtrlHeld(false);
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') setCtrlHeld(false);
    };
    // Capture, so a `stopPropagation` further down cannot strand the hint.
    window.addEventListener('keydown', sync, { capture: true });
    window.addEventListener('keyup', sync, { capture: true });
    window.addEventListener('pointermove', sync, { capture: true, passive: true });
    window.addEventListener('pointerdown', sync, { capture: true });
    window.addEventListener('blur', clear);
    window.addEventListener('focus', clear);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', sync, { capture: true });
      window.removeEventListener('keyup', sync, { capture: true });
      window.removeEventListener('pointermove', sync, { capture: true });
      window.removeEventListener('pointerdown', sync, { capture: true });
      window.removeEventListener('blur', clear);
      window.removeEventListener('focus', clear);
      document.removeEventListener('visibilitychange', onVisibility);
      setCtrlHeld(false);
    };
  }, []);
}

/**
 * Window-level shortcuts of the Terminal window: a thin dispatcher over the
 * keybinding registry (`@/lib/keybindings`, user overrides in
 * `settings.terminal.keybindings`) and `runAction`. Registered in the
 * capture phase so it wins over xterm.js, which otherwise swallows every key.
 * An action that finds nothing to do (no pane that way, single tab) lets the
 * key fall through to the shell.
 */
export function useTerminalWindowShortcuts() {
  const overrides = useAppStore((s) => s.settings?.terminal.keybindings);
  useCtrlHeldHint();

  useEffect(() => {
    const bindings = resolveKeybindings(overrides);
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e);
      if (!combo) return;
      const actionId = bindings.get(combo);
      if (!actionId) return;
      if (!ALWAYS_ON.has(actionId) && isTextFieldOutsideTerminal(e.target)) return;
      if (runAction(actionId)) {
        e.preventDefault();
        // Also silences the older listeners of the same window (palette).
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [overrides]);
}

/**
 * Files dragged from the OS onto a pane: their paths are typed into the
 * terminal under the pointer (quoted when needed). Mount once in the window.
 */
export function useTerminalFileDrop() {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== 'drop') return;
        pasteDroppedPaths(event.payload.paths, event.payload.position);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

/**
 * One notch of a detented mouse wheel, in CSS pixels: what Chromium reports
 * for `deltaY` in pixel mode at the default "3 lines per notch". It is both
 * the unit the two other delta modes are converted into and the distance that
 * buys one zoom step — so a mouse keeps its one-notch-one-step feel.
 */
const WHEEL_NOTCH_PX = 100;
/** `deltaMode: 1` (lines) — three of them make a notch. */
const WHEEL_LINE_PX = WHEEL_NOTCH_PX / 3;
/** `deltaMode: 2` (pages) — a screenful, four notches. */
const WHEEL_PAGE_PX = WHEEL_NOTCH_PX * 4;
/**
 * Accumulated travel that makes one zoom step. Raise it for a calmer
 * trackpad, lower it for a livelier one; at `WHEEL_NOTCH_PX` a mouse notch
 * lands exactly one step and leaves nothing behind.
 */
const ZOOM_WHEEL_STEP_PX = WHEEL_NOTCH_PX;
/** A pause this long starts a fresh gesture (the leftover is dropped). */
const ZOOM_WHEEL_IDLE_MS = 200;

/** `deltaY` in CSS pixels, whatever unit the device reports it in. */
function wheelDeltaPx(e: WheelEvent): number {
  if (e.deltaMode === 1) return e.deltaY * WHEEL_LINE_PX;
  if (e.deltaMode === 2) return e.deltaY * WHEEL_PAGE_PX;
  return e.deltaY;
}

/**
 * Ctrl + mouse wheel zooms every terminal of the window (like browsers and
 * Warp). Registered in the capture phase on `window` with `passive: false`
 * so xterm never scrolls the buffer instead.
 *
 * Ticket #36: a zoom step per event made a trackpad unusable — a pinch is a
 * burst of tiny pixel deltas, so every one of them used to be a whole font
 * size. The travel is accumulated instead and spent in whole notches, which
 * leaves a detented mouse at exactly one step per notch and turns a trackpad
 * into a gradual zoom. The leftover is kept (so slow scrolling still gets
 * there) but dropped when the gesture reverses or stops.
 */
export function useTerminalWheelZoom() {
  useEffect(() => {
    let travel = 0;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = wheelDeltaPx(e);
      const now = e.timeStamp || performance.now();
      // A new gesture: after a pause, or as soon as the user pushes back the
      // other way — carrying the leftover across would swallow the reversal.
      if (now - last > ZOOM_WHEEL_IDLE_MS || travel * delta < 0) travel = 0;
      last = now;
      travel += delta;
      // Wheel down (positive) zooms out, like every browser.
      while (Math.abs(travel) >= ZOOM_WHEEL_STEP_PX) {
        const step = travel < 0 ? 1 : -1;
        travel += step * ZOOM_WHEEL_STEP_PX;
        adjustTerminalZoom(step);
      }
    };
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => window.removeEventListener('wheel', onWheel, { capture: true });
  }, []);
}
