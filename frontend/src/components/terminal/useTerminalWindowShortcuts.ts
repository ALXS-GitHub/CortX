import { useEffect } from 'react';
import { useTerminalWindowPrefsStore } from '@/stores/terminalWindowPrefsStore';
import { closeActiveLeaf, cycleLeaf, cycleTab, openNewTerminal, splitActiveLeaf } from './actions';

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Window-level shortcuts of the Terminal window. Registered in the capture
 * phase so they win over xterm.js, which otherwise swallows every key:
 *
 * - Ctrl+Shift+T new terminal · Ctrl+Shift+W close leaf
 * - Ctrl+Shift+D split right · Ctrl+Shift+E split down
 * - Ctrl+Tab / Ctrl+Shift+Tab next / previous tab
 * - Ctrl+B toggle the session rail
 * - Alt+Arrow move focus between leaves
 */
export function useTerminalWindowShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'tab') {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      if (mod && e.shiftKey && !e.altKey) {
        switch (key) {
          case 't':
            e.preventDefault();
            void openNewTerminal();
            return;
          case 'w':
            e.preventDefault();
            closeActiveLeaf();
            return;
          case 'd':
            e.preventDefault();
            void splitActiveLeaf('horizontal');
            return;
          case 'e':
            e.preventDefault();
            void splitActiveLeaf('vertical');
            return;
        }
      }
      if (mod && !e.shiftKey && !e.altKey && key === 'b') {
        e.preventDefault();
        useTerminalWindowPrefsStore.getState().toggleRail();
        return;
      }
      // Alt+Arrow only steals the key when there is another leaf to go to;
      // otherwise the shell keeps its own Alt+Arrow bindings.
      if (e.altKey && !mod && !e.shiftKey && !isTextField(e.target)) {
        if (key === 'arrowright' || key === 'arrowdown') {
          if (cycleLeaf(1)) e.preventDefault();
        } else if (key === 'arrowleft' || key === 'arrowup') {
          if (cycleLeaf(-1)) e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);
}
