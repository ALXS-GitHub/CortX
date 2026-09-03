import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import type { TerminalTab } from '@/lib/terminalLayout';
import { TERMINAL_EVENTS, type RenameTabEventDetail } from './actions';

/**
 * State hooks shared by the tab strip and the sessions rail (kept apart from
 * the components in `tabMenu.tsx` so fast refresh stays happy).
 */

/**
 * Inline rename of a tab: the draft lives here until Enter / blur commits it.
 * Also answers the `tab.rename` shortcut, which asks the row of the active
 * tab to start editing through a window event.
 */
export function useTabRename(tab: TerminalTab, fallbackTitle: string) {
  const renameTab = useTerminalLayoutStore((s) => s.renameTab);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const start = useCallback(() => {
    setDraft(tab.title ?? fallbackTitle);
    setEditing(true);
  }, [tab.title, fallbackTitle]);
  const commit = useCallback(() => {
    setEditing(false);
    renameTab(tab.id, draft);
  }, [draft, renameTab, tab.id]);
  const cancel = useCallback(() => setEditing(false), []);

  useEffect(() => {
    const onRename = (e: Event) => {
      const detail = (e as CustomEvent<RenameTabEventDetail>).detail;
      if (!detail || detail.tabId !== tab.id || detail.handled) return;
      detail.handled = true;
      start();
    };
    window.addEventListener(TERMINAL_EVENTS.renameTab, onRename);
    return () => window.removeEventListener(TERMINAL_EVENTS.renameTab, onRename);
  }, [tab.id, start]);

  return { editing, draft, setDraft, start, commit, cancel };
}

/**
 * Where to open the context menu: a 0×0 trigger is parked under the pointer
 * (relative to the tab element) so the menu opens where the user clicked.
 */
export function useTabContextMenu() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const onContextMenu = useCallback((e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setOpen(true);
  }, []);
  return { open, setOpen, pos, onContextMenu };
}
