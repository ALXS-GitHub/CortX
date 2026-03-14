import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { SquareTerminal, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TagBadge } from '@/components/ui/TagBadge';
import type { ShellAlias, TagDefinition } from '@/types';

interface AliasCardViewProps {
  alias: ShellAlias;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}

export function AliasCardView({ alias, tagDefinitions, onEdit, onDelete, onClick }: AliasCardViewProps) {
  return (
    <Card className="group cursor-pointer hover:border-primary/50 transition-colors h-full flex flex-col overflow-hidden" onClick={onClick}>
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <SquareTerminal className="size-5 flex-shrink-0 text-muted-foreground" />
            <h3 className="font-medium font-mono truncate">{alias.name}</h3>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
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
        <p className="text-sm text-muted-foreground font-mono line-clamp-2 break-all">{alias.command}</p>
        {alias.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{alias.description}</p>
        )}
        <div className="mt-auto pt-3 space-y-2">
          {alias.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {alias.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
