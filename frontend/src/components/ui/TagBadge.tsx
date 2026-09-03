import { Chip } from '@/components/ui/Chip';
import type { TagDefinition } from '@/types';

interface TagBadgeProps {
  tag: string;
  tagDefinitions?: TagDefinition[];
  className?: string;
  onRemove?: () => void;
}

/** Tag as a colour-coded chip (colour comes from the tag definitions). */
export function TagBadge({ tag, tagDefinitions, className, onRemove }: TagBadgeProps) {
  const def = tagDefinitions?.find(
    (d) => d.name.toLowerCase() === tag.toLowerCase()
  );

  return (
    <Chip color={def?.color} neutral={!def?.color} dot={false} className={className} onRemove={onRemove}>
      {tag}
    </Chip>
  );
}
