import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
    case 'active':
      className += 'bg-green-500/10 text-green-600 dark:text-green-400';
      break;
    case 'inactive':
      className += 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
      break;
    case 'to test':
      className += 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
      break;
    case 'archived':
      className += 'bg-slate-500/10 text-slate-600 dark:text-slate-400';
      break;
    case 'replaced':
      className += 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
      break;
    default:
      className += 'bg-muted text-muted-foreground';
  }
  return <Badge variant="secondary" className={className}>{status}</Badge>;
}

export function ToolCard({ tool, onEdit, onDelete, onClick }: ToolCardProps) {
  return (
    <Card className="group cursor-pointer hover:border-primary/50 transition-colors" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className="mt-1 flex-shrink-0">
            <Wrench className="size-5" style={{ color: tool.color || '#6b7280' }} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium truncate">{tool.name}</h3>
              <StatusBadge status={tool.status} />
              {tool.category && (
                <Badge variant="outline" className="text-xs py-0">{tool.category}</Badge>
              )}
            </div>
            {tool.description && (
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{tool.description}</p>
            )}
            {tool.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-2">
                {tool.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs py-0">{tag}</Badge>
                ))}
              </div>
            )}
            {tool.configPaths.length > 0 && (
              <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground">
                <FileText className="size-3" />
                <span>{tool.configPaths.length} config{tool.configPaths.length > 1 ? 's' : ''}</span>
              </div>
            )}
          </div>

          <div className={cn('flex items-center gap-1', 'opacity-0 group-hover:opacity-100 transition-opacity')} onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <MoreVertical className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="size-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="size-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
