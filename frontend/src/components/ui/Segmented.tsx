import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

export interface SegOption<T extends string> {
  value: T;
  label?: string;
  icon?: ComponentType<{ className?: string }>;
  title?: string;
}

/** Segmented control (iOS-style) to switch between a few options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegOption<T>[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="group"
      data-slot="segmented"
      className={cn(
        'inline-flex items-center gap-1 rounded-sm bg-muted p-1',
        size === 'sm' ? 'text-xs' : 'text-sm',
        className
      )}
    >
      {options.map((o) => {
        const Icon = o.icon;
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title ?? o.label}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-[calc(var(--rad-sm)-2px)] font-medium transition-colors',
              size === 'sm' ? 'h-7 px-2' : 'h-8 px-3',
              o.label ? '' : size === 'sm' ? 'w-7 px-0' : 'w-8 px-0',
              active
                ? 'bg-[var(--tab-active-bg)] text-[var(--tab-active-fg)] shadow-[var(--tab-active-shadow)]'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {Icon && <Icon className="size-4" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
