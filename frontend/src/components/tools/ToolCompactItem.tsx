import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Wrench, MoreVertical, Pencil, Trash2, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Tool } from '@/types';

interface ToolCardProps {
  tool: Tool;
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}

function StatusBadge({ status }: { status: string }) {
  let className = 'text-xs ';
  switch (status.toLowerCase()) {
    case 'active': className += 'bg-green-500/10 text-green-600 dark:text-green-400'; break;
    case 'inactive': className += 'bg-gray-500/10 text-gray-600 dark:text-gray-400'; break;
    case 'to test': className += 'bg-amber-500/10 text-amber-600 dark:text-amber-400'; break;
    case 'archived': className += 'bg-slate-500/10 text-slate-600 dark:text-slate-400'; break;
    case 'replaced': className += 'bg-orange-500/10 text-orange-600 dark:text-orange-400'; break;
    default: className += 'bg-muted text-muted-foreground';
  }
  return <Badge variant="secondary" className={className}>{status}</Badge>;
}

export function ToolCompactItem({ tool, onEdit, onDelete, onClick }: ToolCardProps) {
  return (
    <div
      className="group flex items-center h-9 border rounded-md px-3 py-1.5 cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={onClick}
    >
      <Wrench className="size-3.5 flex-shrink-0 mr-2" style={{ color: tool.color || '#6b7280' }} />
      <span className="font-medium text-sm truncate mr-2">{tool.name}</span>
      <StatusBadge status={tool.status} />
      {tool.category && (
        <Badge variant="outline" className="text-xs py-0 ml-1.5">{tool.category}</Badge>
      )}
      <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
        {tool.configPaths.length > 0 && (
          <div className={cn(
            'flex items-center gap-1 text-xs text-muted-foreground',
            'opacity-0 group-hover:opacity-100 transition-opacity',
          )}>
            <FileText className="size-3" />
            <span>{tool.configPaths.length}</span>
          </div>
        )}
        <div
          className={cn('opacity-0 group-hover:opacity-100 transition-opacity')}
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6">
                <MoreVertical className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="size-4 mr-2" />Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                <Trash2 className="size-4 mr-2" />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
