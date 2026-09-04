import { useEffect } from 'react';
import { AppWindow, ExternalLink, SquareTerminal } from 'lucide-react';
import { TERMINAL_WINDOW_ID } from '@/stores/terminalLayoutStore';
import { cn } from '@/lib/utils';
import { useDetachDragStore, type DetachEdge } from './useDetachDrag';
import { initDetachGhost, useDetachGhostStore } from './detachGhost';

/**
 * Everything the detach gesture draws (ticket #20 + Alexis' feedback of
 * 2026-09-04). Mounted once at the root of the Terminal window, it plays two
 * roles at the same time — the window a tab is leaving, and the window a tab
 * is arriving in — because either can happen to any window.
 *
 * **Leaving.** The drag overlay is clipped by the window, so once the pointer
 * is out there is nothing left to see. The pill says what releasing will do,
 * and a lit edge says which way the tab went, so the gesture stays anchored
 * to something even when the cursor is over the desktop.
 *
 * **Arriving.** A tab dragged over this window from another one is drawn
 * here, under the cursor, with its panes if it is a split — the ghost a
 * browser would paint in a floating window, painted by the window that is
 * about to receive it instead. See `detachGhost.ts` for why.
 */

const EDGE_CLASS: Record<DetachEdge, string> = {
  left: 'inset-y-0 left-0 w-1 bg-gradient-to-r',
  right: 'inset-y-0 right-0 w-1 bg-gradient-to-l',
  top: 'inset-x-0 top-0 h-1 bg-gradient-to-b',
  bottom: 'inset-x-0 bottom-0 h-1 bg-gradient-to-t',
};

/** The tab under the cursor, drawn by the window it is being dropped into. */
function IncomingGhost() {
  const active = useDetachGhostStore((s) => s.active);
  const x = useDetachGhostStore((s) => s.x);
  const y = useDetachGhostStore((s) => s.y);
  const title = useDetachGhostStore((s) => s.title);
  const panes = useDetachGhostStore((s) => s.panes);
  const color = useDetachGhostStore((s) => s.color);
  if (!active) return null;
  return (
    <>
      {/* The window is the drop target as a whole: outline it, and mark the
          strip the tab will join. */}
      <div className="pointer-events-none fixed inset-0 z-[99] ring-2 ring-inset ring-primary/50" aria-hidden />
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[99] h-9 bg-primary/10" aria-hidden />
      <div
        className="pointer-events-none fixed z-[101] flex h-9 max-w-[320px] items-center gap-2 rounded-[var(--rad-xs)] border border-border-strong bg-popover/95 px-3 text-xs text-foreground shadow-lg backdrop-blur"
        style={{ left: x, top: y, transform: 'translate(-28px, -18px) rotate(-1.5deg)' }}
        aria-hidden
      >
        {color && <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
        <SquareTerminal className="size-3.5 shrink-0 text-faint" />
        <span className="truncate">{title}</span>
        {panes > 1 && (
          <span className="flex shrink-0 items-center gap-px rounded-[5px] border border-border p-px" aria-hidden>
            {Array.from({ length: Math.min(panes, 4) }, (_, i) => (
              // Not `--tab-active-bg`: it is `rgba(accent, .18)`, and a theme
              // whose accent is near-black (aespa_wda: #0c161f) turns into a
              // dark smear over a wallpaper instead of a visible pane chip.
              <span key={i} className="h-3 w-2.5 rounded-[3px] bg-[var(--tt-surface-active)]" />
            ))}
          </span>
        )}
      </div>
    </>
  );
}

/** What releasing the tab will do, drawn by the window it is leaving. */
function LeavingHint() {
  const outside = useDetachDragStore((s) => s.dragging && s.outside);
  const targetName = useDetachDragStore((s) => s.targetName);
  const edge = useDetachDragStore((s) => s.edge);
  if (!outside) return null;
  return (
    <>
      {edge && (
        <div
          className={cn('pointer-events-none fixed z-[100] from-primary/70 to-transparent', EDGE_CLASS[edge])}
          aria-hidden
        />
      )}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex justify-center">
        <div className="flex items-center gap-2 rounded-full border border-border-strong bg-popover/95 px-3.5 py-1.5 text-xs text-foreground shadow-lg backdrop-blur">
          {targetName ? <AppWindow className="size-3.5 text-primary" /> : <ExternalLink className="size-3.5 text-primary" />}
          {targetName ? `Release to move to ${targetName}` : 'Release to open in a new window'}
        </div>
      </div>
    </>
  );
}

export function DetachDropHint() {
  // Ghosts coming from the other Terminal windows.
  useEffect(() => initDetachGhost(TERMINAL_WINDOW_ID), []);
  return (
    <>
      <LeavingHint />
      <IncomingGhost />
    </>
  );
}
