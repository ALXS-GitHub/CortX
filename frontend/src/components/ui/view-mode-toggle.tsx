import { LayoutGrid, List, Rows3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ListViewMode } from '@/types';

const modes: { value: ListViewMode; icon: typeof LayoutGrid; label: string }[] = [
  { value: 'card', icon: LayoutGrid, label: 'Card view' },
  { value: 'list', icon: List, label: 'List view' },
  { value: 'compact', icon: Rows3, label: 'Compact view' },
];

interface ViewModeToggleProps {
  value: ListViewMode;
  onChange: (value: ListViewMode) => void;
}

export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <div className="flex items-center border rounded-md">
      {modes.map(({ value: mode, icon: Icon, label }) => (
        <Tooltip key={mode}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-8 w-8 p-0 rounded-none first:rounded-l-md last:rounded-r-md',
                value === mode && 'bg-muted'
              )}
              onClick={() => onChange(mode)}
            >
              <Icon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
