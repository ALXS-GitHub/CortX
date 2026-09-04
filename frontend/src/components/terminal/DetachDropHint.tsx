import { AppWindow, ExternalLink } from 'lucide-react';
import { useDetachDragStore } from './useDetachDrag';

/**
 * What a tab dragged past the edge of the window will do when released
 * (ticket #20). The drag overlay is clipped by the window, so without this
 * the gesture has no feedback at all once the pointer is outside.
 */
export function DetachDropHint() {
  const outside = useDetachDragStore((s) => s.dragging && s.outside);
  const targetName = useDetachDragStore((s) => s.targetName);
  if (!outside) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex justify-center">
      <div className="flex items-center gap-2 rounded-full border border-border-strong bg-popover/95 px-3.5 py-1.5 text-xs text-foreground shadow-lg backdrop-blur">
        {targetName ? <AppWindow className="size-3.5 text-primary" /> : <ExternalLink className="size-3.5 text-primary" />}
        {targetName ? `Release to move to ${targetName}` : 'Release to open in a new window'}
      </div>
    </div>
  );
}
