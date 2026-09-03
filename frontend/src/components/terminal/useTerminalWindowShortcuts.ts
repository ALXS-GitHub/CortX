import { useEffect } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useAppStore } from '@/stores/appStore';
import { comboFromEvent, resolveKeybindings, type KeybindingActionId } from '@/lib/keybindings';
import { pasteDroppedPaths, runAction } from './actions';

/** Actions that must also work while a text field (palette, find, rename) has focus. */
const ALWAYS_ON: ReadonlySet<KeybindingActionId> = new Set<KeybindingActionId>(['window.palette', 'terminal.find']);

/** A text field that is not xterm's hidden textarea. */
function isTextFieldOutsideXterm(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const field = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
  return field && !target.closest('.xterm');
}

/** While Control is held, the rail / strip show their tab numbers (`html[data-ctrl-held]`). */
function setCtrlHeld(held: boolean) {
  if (held) document.documentElement.setAttribute('data-ctrl-held', '');
  else document.documentElement.removeAttribute('data-ctrl-held');
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

  useEffect(() => {
    const bindings = resolveKeybindings(overrides);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Control' || (e.key === 'Meta' && navigator.platform.startsWith('Mac'))) setCtrlHeld(true);
      const combo = comboFromEvent(e);
      if (!combo) return;
      const actionId = bindings.get(combo);
      if (!actionId) return;
      if (!ALWAYS_ON.has(actionId) && isTextFieldOutsideXterm(e.target)) return;
      if (runAction(actionId)) {
        e.preventDefault();
        // Also silences the older listeners of the same window (palette).
        e.stopImmediatePropagation();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(false);
    };
    const onBlur = () => setCtrlHeld(false);
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('blur', onBlur);
      setCtrlHeld(false);
    };
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
