import { Circle, FileCode, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
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

interface TabDragOverlayProps {
  terminal: TerminalItem | null;
}

export function TabDragOverlay({ terminal }: TabDragOverlayProps) {
  if (!terminal) return null;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 bg-card border rounded shadow-lg text-xs cursor-grabbing">
      {terminal.type === 'script' ? (
        <FileCode className="size-3 text-muted-foreground shrink-0" />
      ) : (
        <Terminal className="size-3 text-muted-foreground shrink-0" />
      )}
      <StatusIndicator status={terminal.status} type={terminal.type} />
      <span className="truncate max-w-[150px]">{terminal.name}</span>
      {terminal.type === 'service' && terminal.detectedPort && (
        <span className="text-[10px] px-1 py-0.5 rounded bg-primary/20 text-primary font-mono shrink-0">
          :{terminal.detectedPort}
        </span>
      )}
    </div>
  );
}
