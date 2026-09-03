import type { CSSProperties } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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

/** Tinted tile with the tool icon, coloured with the tool's colour. Shared by the list shapes and the detail header. */
export function ToolIcon({ color, size = 'md', className }: { color?: string | null; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const c = color || 'var(--text-faint)';
  const box = size === 'sm' ? 'size-6 rounded-[var(--rad-xs)]' : size === 'lg' ? 'size-10 rounded-[var(--rad-sm)]' : 'size-9 rounded-[var(--rad-sm)]';
  const icon = size === 'sm' ? 'size-3.5' : size === 'lg' ? 'size-5' : 'size-4';
  return (
    <span
      className={cn('grid shrink-0 place-items-center', box, className)}
      style={{ color: c, backgroundColor: `color-mix(in srgb, ${c} 14%, transparent)` } as CSSProperties}
      aria-hidden
    >
      <Wrench className={icon} />
    </span>
  );
}

/** The "…" menu shared by the three tool list shapes. */
export function ToolMenu({ onEdit, onDelete, className }: { onEdit: () => void; onDelete: () => void; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon-sm" className={className} aria-label="Tool actions">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
          <Pencil />
          Edit tool
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 />
          Delete tool
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Hover-only menu trigger classes (stays visible while the menu is open). */
export const hoverMenuClass = 'opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100';

/** List row (the "list" view mode). */
export function ToolCard({ tool, tagDefinitions, onEdit, onDelete, onClick, onToggleFavorite }: ToolCardProps) {
  const configs = tool.configPaths.length;

  return (
    <Card interactive size="sm" className="group py-3" onClick={onClick}>
      <div className="flex items-center gap-4 px-4">
        <ToolIcon color={tool.color} />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-display text-[15px] font-semibold tracking-tight">{tool.name}</h3>
            <StatusBadge status={tool.status} className="shrink-0" />
          </div>
          {tool.description && (
            <p className="line-clamp-1 text-xs text-muted-foreground">{tool.description}</p>
          )}
          {tool.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {tool.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
              ))}
            </div>
          )}
        </div>

        {configs > 0 && (
          <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex" title="Configuration paths">
            <FileText />
            {configs} config{configs > 1 ? 's' : ''}
          </Badge>
        )}

        <div className="flex shrink-0 items-center gap-1">
          <FavoriteButton favorite={tool.favorite} onToggle={onToggleFavorite} />
          <ToolMenu onEdit={onEdit} onDelete={onDelete} className={hoverMenuClass} />
        </div>
      </div>
    </Card>
  );
}
