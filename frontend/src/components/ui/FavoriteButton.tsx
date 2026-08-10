import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FavoriteButtonProps {
  favorite: boolean;
  onToggle: () => void;
  /** Matches the icon sizing of the row it sits in. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Star toggle shared by every list item (projects, scripts, tools, apps, aliases).
 *
 * A set star stays visible so favorites are recognizable at a glance; an unset
 * one only fades in on hover, like the other row actions. Clicks never reach the
 * row underneath, which would otherwise navigate away.
 */
export function FavoriteButton({ favorite, onToggle, size = 'md', className }: FavoriteButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        size === 'sm' ? 'size-6' : 'size-7',
        !favorite && 'opacity-0 group-hover:opacity-100 transition-opacity',
        className
      )}
      title={favorite ? 'Remove from favorites' : 'Add to favorites'}
      aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
      aria-pressed={favorite}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Star
        className={cn(
          size === 'sm' ? 'size-3' : 'size-3.5',
          favorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'
        )}
      />
    </Button>
  );
}
