import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Wrench, MoreVertical, Pencil, Trash2, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TagBadge } from '@/components/ui/TagBadge';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import type { Tool, TagDefinition } from '@/types';

interface ToolCardProps {
  tool: Tool;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
  onToggleFavorite: () => void;
}

export function ToolCard({ tool, tagDefinitions, onEdit, onDelete, onClick, onToggleFavorite }: ToolCardProps) {
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
            </div>
            {tool.description && (
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{tool.description}</p>
            )}
            {tool.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-2">
                {tool.tags.map((tag) => (
                  <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
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

          <div className="flex items-center gap-1">
            <FavoriteButton favorite={tool.favorite} onToggle={onToggleFavorite} />
            <div className={cn('opacity-0 group-hover:opacity-100 transition-opacity')} onClick={(e) => e.stopPropagation()}>
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
        </div>
      </CardContent>
    </Card>
  );
}
