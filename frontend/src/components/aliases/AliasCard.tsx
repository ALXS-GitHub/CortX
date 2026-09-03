import type { ComponentType } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { SquareTerminal, FileCode, Zap, MoreVertical, Pencil, Trash2, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TagBadge } from '@/components/ui/TagBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import type { ShellAlias, TagDefinition, AliasType } from '@/types';

interface AliasCardProps {
  alias: ShellAlias;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
  onToggleFavorite: () => void;
}

/** Lucide glyph for an alias type. */
export function aliasTypeGlyph(type: AliasType | undefined): ComponentType<{ className?: string }> {
  switch (type) {
    case 'script': return FileCode;
    case 'init': return Zap;
    default: return SquareTerminal;
  }
}

/** Muted tile with the alias type glyph. Shared by the list shapes and the detail header. */
export function AliasTypeIcon({ type, size = 'md', className }: { type: AliasType | undefined; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const Glyph = aliasTypeGlyph(type);
  const box = size === 'sm' ? 'size-6 rounded-[var(--rad-xs)]' : size === 'lg' ? 'size-10 rounded-[var(--rad-sm)]' : 'size-9 rounded-[var(--rad-sm)]';
  const icon = size === 'sm' ? 'size-3.5' : size === 'lg' ? 'size-5' : 'size-4';
  return (
    <span className={cn('grid shrink-0 place-items-center bg-muted text-muted-foreground', box, className)} aria-hidden>
      <Glyph className={icon} />
    </span>
  );
}

/** Small globe shown next to the name of a shimmed alias. */
export function ShimMark({ className }: { className?: string }) {
  return (
    <span title="Shim enabled — callable from any process" className={cn('inline-flex shrink-0 text-primary', className)}>
      <Globe className="size-3.5" />
    </span>
  );
}

/** The "…" menu shared by the three alias list shapes. */
export function AliasMenu({ onEdit, onDelete, className }: { onEdit: () => void; onDelete: () => void; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon-sm" className={className} aria-label="Alias actions">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
          <Pencil />
          Edit alias
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 />
          Delete alias
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Hover-only menu trigger classes (stays visible while the menu is open). */
export const hoverMenuClass = 'opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100';

/** List row (the "list" view mode). */
export function AliasCard({ alias, tagDefinitions, onEdit, onDelete, onClick, onToggleFavorite }: AliasCardProps) {
  const type = alias.aliasType || 'function';

  return (
    <Card interactive size="sm" className="group py-3" onClick={onClick}>
      <div className="flex items-center gap-4 px-4">
        <AliasTypeIcon type={type} />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-mono text-[14px] font-semibold tracking-tight">{alias.name}</h3>
            {alias.shim && <ShimMark />}
            <StatusBadge status={alias.status} className="shrink-0" />
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={alias.command}>{alias.command}</p>
          {alias.description && (
            <p className="line-clamp-1 text-xs text-muted-foreground">{alias.description}</p>
          )}
          {alias.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {alias.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
              ))}
            </div>
          )}
        </div>

        <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">{type}</Badge>

        <div className="flex shrink-0 items-center gap-1">
          <FavoriteButton favorite={alias.favorite} onToggle={onToggleFavorite} />
          <AliasMenu onEdit={onEdit} onDelete={onDelete} className={hoverMenuClass} />
        </div>
      </div>
    </Card>
  );
}
