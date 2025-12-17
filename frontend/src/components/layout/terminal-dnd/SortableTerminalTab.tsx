import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Circle, FileCode, Terminal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { TerminalItem, TerminalType } from './types';

function StatusIndicator({ status, type }: { status: string; type?: TerminalType }) {
  const serviceColors = {
    stopped: 'text-muted-foreground',
    starting: 'text-yellow-500 animate-pulse',
    running: 'text-green-500',
    error: 'text-red-500',
  };

  const scriptColors = {
    idle: 'text-muted-foreground',
    running: 'text-blue-500 animate-pulse',
    completed: 'text-green-500',
    failed: 'text-red-500',
  };

  const colors = type === 'script' ? scriptColors : serviceColors;

  return (
    <Circle
      className={cn('size-2 fill-current', colors[status as keyof typeof colors] || 'text-muted-foreground')}
    />
  );
}

interface SortableTerminalTabProps {
  terminal: TerminalItem;
  paneId: string;
  isActive: boolean;
  onSelect: () => void;
  onHide: () => void;
}

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
        "group/tab flex items-center gap-1.5 px-2 py-1.5 border-r select-none min-w-0 max-w-[200px]",
        "hover:bg-muted/50 transition-colors cursor-grab",
        isActive && "bg-background border-b-2 border-b-primary",
        isDragging && "opacity-50 bg-muted/30"
      )}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      {...attributes}
      {...listeners}
    >
      {terminal.type === 'script' ? (
        <FileCode className="size-3 text-muted-foreground shrink-0 pointer-events-none" />
      ) : (
        <Terminal className="size-3 text-muted-foreground shrink-0 pointer-events-none" />
      )}
      <StatusIndicator status={terminal.status} type={terminal.type} />
      <span className="truncate pointer-events-none">{terminal.name}</span>
      {terminal.type === 'service' && terminal.detectedPort && (
        <span className="text-[10px] px-1 py-0.5 rounded bg-primary/20 text-primary font-mono shrink-0 pointer-events-none">
          :{terminal.detectedPort}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0 ml-auto opacity-0 group-hover/tab:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onHide();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Close tab"
      >
        <X className="size-3 pointer-events-none" />
      </Button>
    </div>
  );
}
