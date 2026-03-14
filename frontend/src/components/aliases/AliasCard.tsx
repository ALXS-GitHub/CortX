import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { SquareTerminal, FileCode, Zap, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import type { AliasType } from '@/types';

const aliasTypeIcon = (type: AliasType) => {
  switch (type) {
    case 'script': return <FileCode className="size-5 text-muted-foreground" />;
    case 'init': return <Zap className="size-5 text-muted-foreground" />;
    default: return <SquareTerminal className="size-5 text-muted-foreground" />;
  }
};
import { cn } from '@/lib/utils';
import { TagBadge } from '@/components/ui/TagBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { ShellAlias, TagDefinition } from '@/types';

interface AliasCardProps {
  alias: ShellAlias;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}

export function AliasCard({ alias, tagDefinitions, onEdit, onDelete, onClick }: AliasCardProps) {
  return (
    <Card className="group cursor-pointer hover:border-primary/50 transition-colors overflow-hidden" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className="mt-1 flex-shrink-0">
            {aliasTypeIcon(alias.aliasType || 'function')}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium font-mono truncate">{alias.name}</h3>
              <StatusBadge status={alias.status} />
            </div>
            <p className="text-sm text-muted-foreground mt-0.5 font-mono truncate">
              {alias.command}
            </p>
            {alias.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{alias.description}</p>
            )}
            {alias.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-2">
                {alias.tags.map((tag) => (
                  <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
                ))}
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
