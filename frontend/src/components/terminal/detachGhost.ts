/**
 * Seeing the tab you are dragging out of the window (DEV-13, ticket #20,
 * Alexis' feedback of 2026-09-04).
 *
 * The detach gesture worked but was invisible: a web page cannot paint
 * outside its own window, so the moment the pointer crossed the edge the
 * dragged tab simply vanished and only a hint pill was left behind.
 *
 * Three ways out were considered:
 *
 * 1. **A borderless, transparent, always-on-top Tauri window** moved on every
 *    `pointermove` — what a browser does. Ruled out here, twice over.
 *    Mechanically, the frontend cannot do it: `capabilities/default.json`
 *    grants `core:window:default`, which is read-only (`allow-inner-position`,
 *    `allow-outer-size`, …) and carries neither `allow-create` /
 *    `allow-create-webview-window` nor `allow-set-position`,
 *    `allow-set-ignore-cursor-events`, `allow-show`. So it needs either a
 *    capability change or a backend command — and beyond that, a WebView2
 *    window costs ~100–200 ms to build, which is dead time at the very start
 *    of the gesture, and keeping one warm per Terminal window costs tens of
 *    megabytes for a hint. The exact patch is in the report if it is ever
 *    wanted.
 * 2. **An OS drag loop** (`tauri-plugin-drag` and friends). It is for dragging
 *    *files* out to other applications, it is not a dependency of this project,
 *    and it swallows the pointer stream the detach logic is built on — the
 *    `pointerup` that decides where the tab lands would never arrive.
 * 3. **Let the destination window draw the ghost.** Which is what this file
 *    does. Every window a tab can be dropped into is one of ours, with its own
 *    webview: while the pointer is over another Terminal window, the source
 *    window tells it where the pointer is and what is being dragged, and *that*
 *    window paints the ghost tab under the cursor and lights up its tab strip.
 *    No new permission (`core:event:default` already allows `emitTo`), no new
 *    window, and the feedback lands exactly where the tab is going.
 *
 * Over the desktop or another application there is nothing of ours to paint
 * on; that case keeps the in-window hint, which `DetachDropHint` now points
 * at the edge the pointer left through.
 *
 * Coordinates travel as **CSS screen pixels** (`PointerEvent.screenX/Y`). The
 * receiver subtracts its own `window.screenX/Y`, which is the same space, so
 * the conversion is synchronous — no IPC round trip per frame.
 */
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { create } from 'zustand';

export const DETACH_GHOST_EVENT = 'cortx:terminal-detach-ghost';
export const DETACH_GHOST_END_EVENT = 'cortx:terminal-detach-ghost-end';

export interface DetachGhostPayload {
  /** Label of the window the drag started in (a window ignores its own). */
  from: string;
  /** Pointer position in CSS screen pixels. */
  screenX: number;
  screenY: number;
  /** Name of the dragged tab. */
  title: string;
  /** How many panes it holds (a split is drawn as a small group). */
  panes: number;
  /** The tab's colour, when it has one. */
  color: string | null;
}

interface GhostState {
  /** A tab from another window is hovering this one. */
  active: boolean;
  /** Pointer position in this window's CSS pixels. */
  x: number;
  y: number;
  title: string;
  panes: number;
  color: string | null;
  show: (p: DetachGhostPayload) => void;
  hide: () => void;
}

/** What `DetachDropHint` draws when this window is the *destination*. */
export const useDetachGhostStore = create<GhostState>((set) => ({
  active: false,
  x: 0,
  y: 0,
  title: '',
  panes: 1,
  color: null,
  show: (p) =>
    set({
      active: true,
      // `window.screenX/Y` is the viewport origin in the same CSS screen
      // space as `PointerEvent.screenX/Y`.
      x: p.screenX - (window.screenX || 0),
      y: p.screenY - (window.screenY || 0),
      title: p.title,
      panes: Math.max(1, p.panes),
      color: p.color,
    }),
  hide: () => set({ active: false }),
}));

/**
 * Listen for ghosts coming from the other Terminal windows. Call once from
 * the window root; returns a disposer.
 */
export function initDetachGhost(selfLabel: string): () => void {
  let disposed = false;
  const stops: UnlistenFn[] = [];
  const add = (p: Promise<UnlistenFn>) =>
    void p
      .then((un) => {
        if (disposed) un();
        else stops.push(un);
      })
      .catch((err) => console.warn('Detach ghost listener not attached:', err));

  add(
    listen<DetachGhostPayload>(DETACH_GHOST_EVENT, (event) => {
      if (event.payload.from === selfLabel) return;
      useDetachGhostStore.getState().show(event.payload);
    })
  );
  add(
    listen<{ from: string }>(DETACH_GHOST_END_EVENT, (event) => {
      if (event.payload.from === selfLabel) return;
      useDetachGhostStore.getState().hide();
    })
  );

  return () => {
    disposed = true;
    for (const stop of stops) stop();
    useDetachGhostStore.getState().hide();
  };
}

/**
 * Sender side: keeps track of which window is currently showing our ghost so
 * it can be told to stop when the pointer moves on (or the drag ends).
 */
export interface DetachGhostSender {
  /** The pointer is over `label` (null = over nothing of ours). */
  moveTo: (label: string | null, payload: Omit<DetachGhostPayload, 'from'>) => void;
  /** The drag is over (dropped or cancelled). */
  end: () => void;
}

/**
 * A gaming mouse reports well past 120 Hz and every emit is an IPC round
 * trip, so positions are sent at most once a frame. A ghost 16 ms behind the
 * cursor is invisible; a saturated IPC channel is not.
 */
const MIN_INTERVAL_MS = 16;

export function createDetachGhostSender(from: string): DetachGhostSender {
  let target: string | null = null;
  let lastSent = 0;
  // The window closed mid-drag: nothing to recover, the next pointer move
  // re-reads the rectangles anyway.
  const stopOne = (label: string) => void emitTo(label, DETACH_GHOST_END_EVENT, { from }).catch(() => {});
  return {
    moveTo(label, payload) {
      if (target && target !== label) {
        stopOne(target);
        lastSent = 0; // the new window must be told at once, not next frame
      }
      target = label;
      if (!label) return;
      const now = performance.now();
      if (now - lastSent < MIN_INTERVAL_MS) return;
      lastSent = now;
      void emitTo(label, DETACH_GHOST_EVENT, { ...payload, from }).catch(() => {});
    },
    end() {
      if (target) stopOne(target);
      target = null;
      lastSent = 0;
    },
  };
}
