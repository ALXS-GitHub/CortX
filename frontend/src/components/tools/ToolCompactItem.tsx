import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Wrench, MoreVertical, Pencil, Trash2, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TagBadge } from '@/components/ui/TagBadge';
import { TruncatedText } from '@/components/ui/TruncatedText';
import type { Tool, TagDefinition } from '@/types';

interface ToolCardProps {
  tool: Tool;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}

export function ToolCompactItem({ tool, tagDefinitions, onEdit, onDelete, onClick }: ToolCardProps) {
  return (
    <div
      className="group flex items-center h-9 border rounded-md px-3 py-1.5 cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={onClick}
    >
      <Wrench className="size-3.5 flex-shrink-0 mr-2" style={{ color: tool.color || '#6b7280' }} />
      <TruncatedText className="font-medium text-sm flex-1 min-w-0 mr-2">{tool.name}</TruncatedText>
      <StatusBadge status={tool.status} />
      {tool.tags.length > 0 && (
        <span className="ml-1.5 flex-shrink-0">
          <TagBadge tag={tool.tags[0]} tagDefinitions={tagDefinitions} />
        </span>
      )}
      <div className="ml-2 flex items-center gap-1.5 flex-shrink-0">
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
