import { Card, CardContent, CardHeader } from '@/components/ui/card';
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

export function ToolCardView({ tool, onEdit, onDelete, onClick }: ToolCardProps) {
  return (
    <Card className="group cursor-pointer hover:border-primary/50 transition-colors h-full flex flex-col" onClick={onClick}>
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Wrench className="size-5 flex-shrink-0" style={{ color: tool.color || '#6b7280' }} />
            <h3 className="font-medium truncate">{tool.name}</h3>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <StatusBadge status={tool.status} />
            <div
              className={cn('opacity-0 group-hover:opacity-100 transition-opacity')}
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7">
                    <MoreVertical className="size-3.5" />
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
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 flex-1 flex flex-col">
        {tool.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{tool.description}</p>
        )}
        <div className="mt-auto pt-3 space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {tool.category && (
              <Badge variant="outline" className="text-xs py-0">{tool.category}</Badge>
            )}
            {tool.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs py-0">{tag}</Badge>
            ))}
          </div>
          {tool.configPaths.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <FileText className="size-3" />
              <span>{tool.configPaths.length} config{tool.configPaths.length > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
