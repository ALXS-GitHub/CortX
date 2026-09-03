import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X } from 'lucide-react';
import { TerminalTypeIcon } from './TerminalTypeIcon';
import { cn } from '@/lib/utils';
import { StatusDot } from '@/components/ui/StatusDot';
import type { TerminalItem } from './types';

interface SortableTerminalTabProps {
  terminal: TerminalItem;
  paneId: string;
  isActive: boolean;
  onSelect: () => void;
  onHide: () => void;
}

/**
 * One tab of a terminal pane. Draggable between panes (dnd-kit); the active
 * tab blends into the terminal canvas below it with an accent line on top.
 */
export function SortableTerminalTab({
  terminal,
  paneId,
  isActive,
  onSelect,
  onHide,
}: SortableTerminalTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: terminal.id,
    data: {
      type: 'tab',
      terminalId: terminal.id,
      paneId,
      terminal,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group/tab relative flex h-9 min-w-0 max-w-[220px] cursor-grab select-none items-center gap-2 border-r border-border px-3 text-xs transition-colors',
        isActive
          ? 'bg-terminal text-foreground'
          : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
        isDragging && 'opacity-50'
      )}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      {...attributes}
      {...listeners}
    >
      {isActive && <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 rounded-b-full bg-primary" />}
      <TerminalTypeIcon type={terminal.type} className="pointer-events-none size-3.5 shrink-0 text-faint" />
      <StatusDot status={terminal.status} size={7} className="pointer-events-none" />
      <span className="pointer-events-none truncate" title={terminal.cwd}>{terminal.name}</span>
      {terminal.type === 'service' && terminal.detectedPorts.length > 0 && (
        <span
          className="pointer-events-none shrink-0 rounded-full bg-primary/15 px-1.5 font-mono text-[10px] leading-4 text-primary"
          title={terminal.detectedPorts.length > 1 ? `Listening on: ${terminal.detectedPorts.join(', ')}` : undefined}
        >
          :{terminal.detectedPorts[0]}
          {terminal.detectedPorts.length > 1 && `+${terminal.detectedPorts.length - 1}`}
        </span>
      )}
      <button
        type="button"
        className="ml-auto grid size-5 shrink-0 place-items-center rounded-[6px] text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/tab:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onHide();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Hide tab (the process keeps running)"
        aria-label="Hide tab"
      >
        <X className="pointer-events-none size-3" />
      </button>
    </div>
  );
}
