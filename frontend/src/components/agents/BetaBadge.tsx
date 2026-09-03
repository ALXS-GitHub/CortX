import { cn } from '@/lib/utils';

/** Tiny accent pill flagging a section still in beta. */
export function BetaBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-4 shrink-0 items-center rounded-full border border-accent-border bg-accent px-1.5 text-[10px] font-semibold uppercase leading-none tracking-wide text-primary',
        className,
      )}
    >
      beta
    </span>
  );
}
