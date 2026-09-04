import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';
import { TERMINAL_WINDOW_ID } from '@/stores/terminalLayoutStore';
import { terminalWindowName } from '@/lib/terminalLayout';
import { moveTabToNewWindow, moveTabToWindow } from './actions';
import { terminalWindowRects, windowAtPhysicalPoint, type TerminalWindowRect } from './terminalWindows';

/**
 * Dragging a tab out of its window (DEV-13, ticket #20).
 *
 * A drop outside the window is not a DOM event anyone hands us: no element is
 * under the pointer, so dnd-kit ends the drag with `over: null` and that is
 * all it knows. What makes this work is that the pointer keeps reporting
 * while a button is held — Chromium captures the mouse to the WebView for the
 * whole gesture — so a plain `pointermove` listener sees coordinates outside
 * the viewport, and `pointerup` still arrives. `screenX` / `screenY` then say
 * where on the desktop the tab was dropped.
 *
 * From there:
 * - over another Terminal window (their rectangles are read once, when the
 *   drag starts) → the tab moves into it, like a browser;
 * - over nothing → a new Terminal window opens at the drop point.
 *
 * The tab's shell never restarts: only the document changes, and the window
 * that receives the tab attaches to the PTY and replays its scrollback.
 */

const EDGE_MARGIN = 24;

interface DetachDragState {
  /** A tab drag is in progress in this window. */
  dragging: boolean;
  /** The pointer is outside this window: releasing detaches. */
  outside: boolean;
  /** Name of the Terminal window under the pointer, when it is another one. */
  targetName: string | null;
  begin: () => void;
  update: (outside: boolean, targetName: string | null) => void;
  end: () => void;
}

/** Feedback state for `DetachDropHint` (there is one drag at a time). */
export const useDetachDragStore = create<DetachDragState>((set) => ({
  dragging: false,
  outside: false,
  targetName: null,
  begin: () => set({ dragging: true, outside: false, targetName: null }),
  update: (outside, targetName) => set({ outside, targetName }),
  end: () => set({ dragging: false, outside: false, targetName: null }),
}));

/** Is a point (CSS pixels, relative to the viewport) outside this window? */
function isOutside(x: number, y: number): boolean {
  return x < -EDGE_MARGIN || y < -EDGE_MARGIN || x > window.innerWidth + EDGE_MARGIN || y > window.innerHeight + EDGE_MARGIN;
}

export interface DetachDrag {
  /** Call from dnd-kit's `onDragStart`. */
  start: () => void;
  /** Call from `onDragCancel`. */
  cancel: () => void;
  /**
   * Call first thing in `onDragEnd`. Returns true when the drop was outside
   * the window and has been handled — the caller must then skip its own
   * reorder logic.
   */
  finish: (tabId: string) => boolean;
}

/**
 * Wire a dnd-kit context up to the detach gesture. The hook owns the pointer
 * tracking; the caller only forwards the three drag callbacks.
 */
export function useDetachDrag(): DetachDrag {
  const last = useRef<{ clientX: number; clientY: number; screenX: number; screenY: number } | null>(null);
  const rects = useRef<TerminalWindowRect[]>([]);
  const tracking = useRef(false);

  const onPointerMove = useCallback((e: PointerEvent) => {
    last.current = { clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY };
    const outside = isOutside(e.clientX, e.clientY);
    const ratio = window.devicePixelRatio || 1;
    const hit = outside ? windowAtPhysicalPoint(rects.current, e.screenX * ratio, e.screenY * ratio) : null;
    useDetachDragStore.getState().update(outside, hit ? terminalWindowName(hit.label) : null);
  }, []);

  const stopTracking = useCallback(() => {
    if (!tracking.current) return;
    tracking.current = false;
    window.removeEventListener('pointermove', onPointerMove, true);
    useDetachDragStore.getState().end();
  }, [onPointerMove]);

  // A drag interrupted by an unmount must not leave a listener behind.
  useEffect(() => stopTracking, [stopTracking]);

  const start = useCallback(() => {
    last.current = null;
    rects.current = [];
    tracking.current = true;
    window.addEventListener('pointermove', onPointerMove, true);
    useDetachDragStore.getState().begin();
    // Read where the other Terminal windows are once, at the start: asking
    // the backend on every pointer move would lag the drag.
    terminalWindowRects(TERMINAL_WINDOW_ID)
      .then((r) => {
        rects.current = r;
      })
      .catch(() => {});
  }, [onPointerMove]);

  const finish = useCallback(
    (tabId: string) => {
      const at = last.current;
      stopTracking();
      if (!at || !isOutside(at.clientX, at.clientY)) return false;
      const ratio = window.devicePixelRatio || 1;
      const hit = windowAtPhysicalPoint(rects.current, at.screenX * ratio, at.screenY * ratio);
      if (hit) {
        void moveTabToWindow(tabId, hit.label);
        return true;
      }
      // Put the new window's title bar under the pointer rather than its
      // top-left corner, so the tab appears where it was dropped.
      void moveTabToNewWindow(tabId, { x: at.screenX - 140, y: at.screenY - 16 });
      return true;
    },
    [stopTracking]
  );

  return { start, cancel: stopTracking, finish };
}
