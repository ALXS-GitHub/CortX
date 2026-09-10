import { TagBadge } from '@/components/ui/TagBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { AliasMenu, ShimMark, hoverMenuClass } from './AliasCard';
import { ALIAS_TYPE_GLYPH } from './aliasGlyphs';
import type { ShellAlias, TagDefinition } from '@/types';

interface AliasCompactItemProps {
  alias: ShellAlias;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
  onToggleFavorite: () => void;
}

/** One-line row; rendered inside a bordered list container by AliasesView. */
export function AliasCompactItem({ alias, tagDefinitions, onEdit, onDelete, onClick, onToggleFavorite }: AliasCompactItemProps) {
  const Glyph = ALIAS_TYPE_GLYPH[alias.aliasType || 'function'];

  return (
    <div
      className="group flex h-10 cursor-pointer items-center gap-2 border-b border-border px-3 transition-colors last:border-b-0 hover:bg-accent/50"
      onClick={onClick}
    >
      <Glyph className="size-3.5 shrink-0 text-faint" />

      <TruncatedText className="min-w-0 font-mono text-sm font-medium">{alias.name}</TruncatedText>
      {alias.shim && <ShimMark />}

      <StatusBadge status={alias.status} className="shrink-0" />

      {alias.tags.length > 0 && (
        <TagBadge tag={alias.tags[0]} tagDefinitions={tagDefinitions} className="shrink-0" />
      )}

      <TruncatedText className="hidden min-w-0 flex-1 font-mono text-[11px] text-faint sm:block">
        {alias.command}
      </TruncatedText>
      <span className="flex-1 sm:hidden" />

      <FavoriteButton favorite={alias.favorite} onToggle={onToggleFavorite} size="sm" />

      <AliasMenu onEdit={onEdit} onDelete={onDelete} className={hoverMenuClass} />
    </div>
  );
}
