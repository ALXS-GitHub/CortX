import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Frame shared by every screen, inside the shell's panel (Zinc page header):
 * an optional back button and eyebrow, the page title in the display face
 * with its subtitle under it, right-aligned actions, and an optional toolbar
 * row (search, filters, view switcher). A hairline separates the header from
 * the content, which scrolls on its own. `fill` gives the content the full
 * height with no scroll or padding of its own (workbenches); `narrow` centres
 * it at a reading width (settings, forms).
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
      <header className="shrink-0 border-b border-border">
        <div className="flex items-center gap-3 px-6 pb-4 pt-5">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label={backLabel}
              title={backLabel}
              className="-ml-2 shrink-0"
            >
              <ArrowLeft />
            </Button>
          )}
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            {eyebrow && <span className="eyebrow mb-0.5">{eyebrow}</span>}
            <h1 className="zn-page-title truncate">{title}</h1>
            {subtitle && <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{subtitle}</p>}
          </div>
          {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {toolbar && <div className="flex flex-wrap items-center gap-2 px-6 pb-3">{toolbar}</div>}
      </header>
      <div className={cn('min-h-0 flex-1', fill ? 'overflow-hidden' : 'overflow-y-auto')}>
        {fill ? (
          children
        ) : (
          <div className={cn('animate-in-soft px-6 pb-10 pt-5', narrow && 'mx-auto max-w-3xl', className)}>{children}</div>
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
