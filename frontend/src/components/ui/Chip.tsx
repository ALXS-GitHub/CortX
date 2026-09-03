import type { CSSProperties, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Colour-coded pill (tags, project statuses, agent states). The colour tints
 * the border, background and text through `--chip-color`; without a colour it
 * falls back to the accent.
 */
export function Chip({
  color,
  children,
  onRemove,
  dot = true,
  neutral = false,
  className,
  title,
  style,
}: {
  color?: string | null;
  children: ReactNode;
  onRemove?: () => void;
  /** Show the leading colour dot. */
  dot?: boolean;
  /** Grey chip (no colour known). */
  neutral?: boolean;
  className?: string;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn('chip', neutral && !color && 'chip-neutral', className)}
      style={{ '--chip-color': color || undefined, ...style } as CSSProperties}
      title={title}
    >
      {dot && <span className="chip-dot" />}
      {children}
      {onRemove && (
        <button
          type="button"
          className="chip-x"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove"
        >
          <X className="size-[11px]" />
        </button>
      )}
    </span>
  );
}
