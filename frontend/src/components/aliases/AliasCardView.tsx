import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Globe } from 'lucide-react';
import { TagBadge } from '@/components/ui/TagBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { AliasTypeIcon, AliasMenu, ShimMark, hoverMenuClass } from './AliasCard';
import type { ShellAlias, TagDefinition } from '@/types';

interface AliasCardViewProps {
  alias: ShellAlias;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
  onToggleFavorite: () => void;
}

/** Card (the "card" view mode). */
export function AliasCardView({ alias, tagDefinitions, onEdit, onDelete, onClick, onToggleFavorite }: AliasCardViewProps) {
  const type = alias.aliasType || 'function';

  return (
    <Card interactive size="sm" className="group h-full gap-3" onClick={onClick}>
      <div className="flex items-start gap-3 px-4">
        <AliasTypeIcon type={type} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-mono text-[14px] font-semibold tracking-tight">{alias.name}</h3>
            {alias.shim && <ShimMark />}
            <StatusBadge status={alias.status} className="shrink-0" />
          </div>
          {alias.description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{alias.description}</p>
          )}
        </div>
        <FavoriteButton favorite={alias.favorite} onToggle={onToggleFavorite} />
        <AliasMenu onEdit={onEdit} onDelete={onDelete} className={hoverMenuClass} />
      </div>

      <div className="px-4">
        <p className="line-clamp-2 break-all rounded-sm bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground" title={alias.command}>
          {alias.command || '(no command)'}
        </p>
      </div>

      {alias.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4">
          {alias.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 border-t border-border px-4 pt-3">
        <Badge variant="outline">{type}</Badge>
        {alias.shim && (
          <Badge variant="secondary" title="Shim enabled — callable from any process">
            <Globe />
            shim
          </Badge>
        )}
        {alias.executionOrder != null && (
          <span className="ml-auto font-mono text-[11px] text-faint" title="Execution order">
            #{alias.executionOrder}
          </span>
        )}
      </div>
    </Card>
  );
}
