import type { CSSProperties } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TagDefinition } from '@/types';

interface TagBadgeProps {
  tag: string;
  tagDefinitions?: TagDefinition[];
  className?: string;
  onRemove?: () => void;
}

/**
 * A tag (Zinc tag: it classifies, it signals nothing). The colour from the tag
 * definitions, when there is one, shows as a dot.
 */
export function TagBadge({ tag, tagDefinitions, className, onRemove }: TagBadgeProps) {
  const def = tagDefinitions?.find((d) => d.name.toLowerCase() === tag.toLowerCase());
  return (
    <span className={cn('tag', className)} style={{ '--chip-color': def?.color || undefined } as CSSProperties}>
      {def?.color && <span className="chip-dot" />}
      {tag}
      {onRemove && (
        <button
          type="button"
          className="chip-x"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${tag}`}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}
