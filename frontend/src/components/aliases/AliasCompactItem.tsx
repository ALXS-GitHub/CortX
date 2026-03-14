import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { SquareTerminal, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TagBadge } from '@/components/ui/TagBadge';
import type { ShellAlias, TagDefinition } from '@/types';

interface AliasCompactItemProps {
  alias: ShellAlias;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}

export function AliasCompactItem({ alias, tagDefinitions, onEdit, onDelete, onClick }: AliasCompactItemProps) {
  return (
    <div
      className="group flex items-center h-9 border rounded-md px-3 py-1.5 cursor-pointer hover:bg-muted/50 transition-colors overflow-hidden"
      onClick={onClick}
    >
      <SquareTerminal className="size-3.5 flex-shrink-0 mr-2 text-muted-foreground" />
      <span className="font-medium text-sm font-mono truncate mr-2">{alias.name}</span>
      <span className="text-xs text-muted-foreground font-mono truncate mr-2 hidden sm:inline">
        {alias.command}
      </span>
      {alias.tags.length > 0 && (
        <span className="ml-1.5">
          <TagBadge tag={alias.tags[0]} tagDefinitions={tagDefinitions} />
        </span>
      )}
      <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
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
