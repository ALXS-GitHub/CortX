import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { DragStartEvent } from '@dnd-kit/core';
import { TERMINAL_WINDOW_ID } from '@/stores/terminalLayoutStore';
import { terminalWindowName } from '@/lib/terminalLayout';
import { moveTabToNewWindow, moveTabToWindow } from './actions';
import { createDetachGhostSender, type DetachGhostSender } from './detachGhost';
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
 *
 * Feedback while the pointer is outside is split in two, because a page
 * cannot paint past its own window (see `detachGhost.ts` for why the usual
 * floating-window trick is not available here):
 * - over another Terminal window, *that* window draws the ghost tab under the
 *   cursor — it is told where the pointer is over an event;
 * - over anything else, this window says what releasing will do, pointing at
 *   the edge the pointer left through.
 */

const EDGE_MARGIN = 24;

/** Which side of the window the pointer left through. */
export type DetachEdge = 'left' | 'right' | 'top' | 'bottom';

/** What is being dragged, for the ghost the destination window draws. */
export interface DetachDragSubject {
  title: string;
  /** Number of panes: a split is drawn as a small group of chips. */
  panes: number;
  color: string | null;
}

const UNKNOWN_SUBJECT: DetachDragSubject = { title: 'Terminal', panes: 1, color: null };

interface DetachDragState {
  /** A tab drag is in progress in this window. */
  dragging: boolean;
  /** The pointer is outside this window: releasing detaches. */
  outside: boolean;
  /** Name of the Terminal window under the pointer, when it is another one. */
  targetName: string | null;
  /** Edge the pointer left through, for the "it went that way" marker. */
  edge: DetachEdge | null;
  begin: () => void;
  update: (outside: boolean, targetName: string | null, edge: DetachEdge | null) => void;
  end: () => void;
}

/** Feedback state for `DetachDropHint` (there is one drag at a time). */
export const useDetachDragStore = create<DetachDragState>((set) => ({
  dragging: false,
  outside: false,
  targetName: null,
  edge: null,
  begin: () => set({ dragging: true, outside: false, targetName: null, edge: null }),
  update: (outside, targetName, edge) => set({ outside, targetName, edge }),
  end: () => set({ dragging: false, outside: false, targetName: null, edge: null }),
}));

/** Is a point (CSS pixels, relative to the viewport) outside this window? */
function isOutside(x: number, y: number): boolean {
  return x < -EDGE_MARGIN || y < -EDGE_MARGIN || x > window.innerWidth + EDGE_MARGIN || y > window.innerHeight + EDGE_MARGIN;
}

/** The side the pointer is past, picking the one it is furthest beyond. */
function edgeOf(x: number, y: number): DetachEdge | null {
  const out: Array<[DetachEdge, number]> = [
    ['left', -x],
    ['right', x - window.innerWidth],
    ['top', -y],
    ['bottom', y - window.innerHeight],
  ];
  const [edge, distance] = out.reduce((a, b) => (b[1] > a[1] ? b : a));
  return distance > 0 ? edge : null;
}

export interface DetachDrag {
  /** Call from dnd-kit's `onDragStart`. */
  start: (event: DragStartEvent) => void;
  /** Call from `onDragCancel`. */
  cancel: () => void;
  /**
   * Call first thing in `onDragEnd`. Returns true when the drop was outside
   * the window and has been handled — the caller must then skip its own
   * reorder logic.
   */
  finish: (tabId: string) => boolean;
}

export interface DetachDragOptions {
  /**
   * What the dragged tab looks like, so the destination window can draw it.
   * The caller knows: it has the resolved titles and the item map.
   */
  describe?: (tabId: string) => DetachDragSubject;
}

/**
 * Wire a dnd-kit context up to the detach gesture. The hook owns the pointer
 * tracking; the caller only forwards the three drag callbacks.
 */
export function useDetachDrag(options: DetachDragOptions = {}): DetachDrag {
  const last = useRef<{ clientX: number; clientY: number; screenX: number; screenY: number } | null>(null);
  const rects = useRef<TerminalWindowRect[]>([]);
  const tracking = useRef(false);
  const subject = useRef<DetachDragSubject>(UNKNOWN_SUBJECT);
  // Lazily built once and kept in a ref: `useRef(createX())` would allocate
  // a sender on every render only to throw it away.
  const ghost = useRef<DetachGhostSender | null>(null);
  if (ghost.current === null) ghost.current = createDetachGhostSender(TERMINAL_WINDOW_ID);
  // Read through a ref: the caller re-creates `describe` on every render and
  // the drag callbacks must stay stable. Refreshed after the render rather
  // than during it; a drag only ever starts from an event, well after.
  const describe = useRef(options.describe);
  useEffect(() => {
    describe.current = options.describe;
  });

  const onPointerMove = useCallback((e: PointerEvent) => {
    last.current = { clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY };
    const outside = isOutside(e.clientX, e.clientY);
    const ratio = window.devicePixelRatio || 1;
    const hit = outside ? windowAtPhysicalPoint(rects.current, e.screenX * ratio, e.screenY * ratio) : null;
    useDetachDragStore.getState().update(outside, hit ? terminalWindowName(hit.label) : null, outside ? edgeOf(e.clientX, e.clientY) : null);
    // Over one of our other windows: it draws the tab under the cursor.
    ghost.current?.moveTo(hit?.label ?? null, {
      screenX: e.screenX,
      screenY: e.screenY,
      ...subject.current,
    });
  }, []);

  const stopTracking = useCallback(() => {
    if (!tracking.current) return;
    tracking.current = false;
    window.removeEventListener('pointermove', onPointerMove, true);
    ghost.current?.end();
    useDetachDragStore.getState().end();
  }, [onPointerMove]);

  // A drag interrupted by an unmount must not leave a listener behind.
  useEffect(() => stopTracking, [stopTracking]);

  const start = useCallback(
    (event: DragStartEvent) => {
      last.current = null;
      rects.current = [];
      tracking.current = true;
      subject.current = describe.current?.(String(event.active.id)) ?? UNKNOWN_SUBJECT;
      window.addEventListener('pointermove', onPointerMove, true);
      useDetachDragStore.getState().begin();
      // Read where the other Terminal windows are once, at the start: asking
      // the backend on every pointer move would lag the drag.
      terminalWindowRects(TERMINAL_WINDOW_ID)
        .then((r) => {
          rects.current = r;
        })
        .catch(() => {});
    },
    [onPointerMove]
  );

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
