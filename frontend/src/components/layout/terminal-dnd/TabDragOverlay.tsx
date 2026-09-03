import { StatusDot } from '@/components/ui/StatusDot';
import { TerminalTypeIcon } from './TerminalTypeIcon';
import type { TerminalItem } from './types';

interface TabDragOverlayProps {
  terminal: TerminalItem | null;
}

/** Ghost of the tab being dragged between panes. */
export function TabDragOverlay({ terminal }: TabDragOverlayProps) {
  if (!terminal) return null;

  return (
    <div className="glass-strong flex h-9 cursor-grabbing items-center gap-2 rounded-sm border border-border-strong bg-card px-3 text-xs text-foreground shadow-pop">
      <TerminalTypeIcon type={terminal.type} className="size-3.5 shrink-0 text-faint" />
      <StatusDot status={terminal.status} size={7} />
      <span className="max-w-[160px] truncate">{terminal.name}</span>
      {terminal.type === 'service' && terminal.detectedPorts.length > 0 && (
        <span className="shrink-0 rounded-full bg-primary/15 px-1.5 font-mono text-[10px] leading-4 text-primary">
          :{terminal.detectedPorts[0]}
          {terminal.detectedPorts.length > 1 && `+${terminal.detectedPorts.length - 1}`}
        </span>
      )}
    </div>
  );
}
