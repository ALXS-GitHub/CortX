/**
 * The three layout helpers every settings surface is built from. They used to
 * live inside `views/Settings.tsx`; the terminal sections are now mounted both
 * there and in the Terminal window's own settings panel, so they moved here.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** One settings section: a card with a title, a description and optional header action. */
export function Section({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {Icon && <Icon className="size-4 text-faint" />}
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      {children && <CardContent className={cn('space-y-4', className)}>{children}</CardContent>}
    </Card>
  );
}

/** Label + control + hint. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    // `content-start`: in a multi-column row the tallest field (the one with
    // a hint) sets the height, and without it the shorter fields stretch
    // their rows and drop their label to the middle.
    <div className={cn('grid content-start gap-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Inline code snippet inside a hint. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-xs bg-muted px-1 py-px font-mono text-[11px] text-foreground">{children}</code>;
}

/** A switch (or any control) on the right, its label and explanation on the left. */
export function ToggleField({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">{children}</div>
    </div>
  );
}
