import { Badge } from '@/components/ui/badge';
import type { TagDefinition } from '@/types';

interface TagBadgeProps {
  tag: string;
  tagDefinitions?: TagDefinition[];
  className?: string;
}

export function TagBadge({ tag, tagDefinitions, className }: TagBadgeProps) {
  const def = tagDefinitions?.find(
    (d) => d.name.toLowerCase() === tag.toLowerCase()
  );

  if (def?.color) {
    return (
      <Badge
        variant="outline"
        className={className}
        style={{
          borderColor: def.color,
          color: def.color,
          backgroundColor: `${def.color}10`,
        }}
      >
        {tag}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={className}>
      {tag}
    </Badge>
  );
}
