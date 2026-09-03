import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Frame shared by every screen: a sticky glass header (optional back button,
 * title, subtitle, right-aligned actions) above the content. `fill` gives the
 * content the full height with no scroll of its own (utilities workbench),
 * otherwise the content scrolls and gets a comfortable padding.
 */
export function Screen({
  title,
  subtitle,
  eyebrow,
  actions,
  onBack,
  backLabel = 'Back',
  toolbar,
  children,
  fill,
  narrow,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Small label above the title (e.g. the parent section of a detail page). */
  eyebrow?: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  /** Second row under the header (search, filters, view switcher). */
  toolbar?: ReactNode;
  children: ReactNode;
  fill?: boolean;
  /** Constrain the content width (settings, forms). */
  narrow?: boolean;
  className?: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="glass shrink-0 border-b border-border">
        <div className="flex min-h-14 items-center gap-3 px-5">
          {onBack && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onBack}
              aria-label={backLabel}
              title={backLabel}
              className="-ml-1.5 shrink-0"
            >
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <div className="flex min-w-0 flex-1 flex-col justify-center py-2.5">
            {eyebrow && <span className="eyebrow mb-0.5">{eyebrow}</span>}
            <div className="flex min-w-0 items-baseline gap-2.5">
              <h1 className="truncate font-display text-[17px] font-semibold tracking-tight">{title}</h1>
              {subtitle && (
                <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">{subtitle}</span>
              )}
            </div>
          </div>
          {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {toolbar && <div className="flex flex-wrap items-center gap-2 px-5 pb-3">{toolbar}</div>}
      </header>
      <div className={cn('min-h-0 flex-1', fill ? 'overflow-hidden' : 'overflow-y-auto')}>
        {fill ? (
          children
        ) : (
          <div className={cn('animate-in-soft p-5 pb-8', narrow && 'mx-auto max-w-3xl', className)}>{children}</div>
        )}
      </div>
    </div>
  );
}

/** Uppercase section heading used inside screens (settings, detail pages). */
export function SectionTitle({ children, className, actions }: { children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <div className={cn('mb-2 flex items-center justify-between gap-2', className)}>
      <span className="eyebrow">{children}</span>
      {actions}
    </div>
  );
}
