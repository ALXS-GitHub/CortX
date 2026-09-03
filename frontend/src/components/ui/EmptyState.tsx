import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Centered empty / not-found placeholder with an icon, a title and an action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Less vertical padding (inside a card or a tab). */
  compact?: boolean;
}) {
  return (
    <div className={cn('grid place-items-center text-center', compact ? 'py-10' : 'h-full min-h-[40vh] p-8', className)}>
      <div className="flex max-w-sm flex-col items-center gap-3">
        <span className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <Icon className="size-7" />
        </span>
        <h3 className="font-display text-base font-semibold">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
      </div>
    </div>
  );
}
