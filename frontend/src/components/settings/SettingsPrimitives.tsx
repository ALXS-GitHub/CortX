/**
 * The one visual system every settings surface is built from (ticket #64).
 *
 * There used to be four: `Section`/`Field` here, `SettingField`/`Group` in the
 * terminal controls, a local `Row` in the terminal appearance card, a
 * `BehaviourRow` in the shortcuts card — plus hand-written label + switch
 * pairs. Each drew its label, hint and control a little differently, which is
 * most of what read as "ugly". Now:
 *
 * - `Section` — a heading (title, one-line description, optional action on
 *   the right) above a card (`surface-subtle`, hairline border, no shadow).
 * - Inside the card, **rows separated by hairlines**: `SettingRow` puts the
 *   label and hint on the left and a short control on the right, or — `wide`
 *   — the control under the label at full width. `indent` marks a setting
 *   that depends on the one above it.
 * - `SectionBody` for free content inside a card (a preview, a list),
 *   `SectionNote` for a line of explanation, `SectionSubheading` to split a
 *   long card.
 *
 * The terminal wrappers in `components/terminal/settings/controls.tsx` add
 * the "changed" dot and the reset gesture on top of `SettingRow`.
 */
import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useSectionVisible } from './settingsNav';

/** Width of a short control in a row (select, text input, colour field). */
export const CONTROL_WIDTH = 'w-56';

/** One titled card. Skipped when a search filters it out (`id`). */
export function Section({
  id,
  title,
  description,
  action,
  children,
  className,
}: {
  /** The id the page definition lists it under, for the search. */
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const visible = useSectionVisible(id);
  if (!visible) return null;
  return (
    <section className="space-y-2.5">
      <div className="flex min-h-7 items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children && (
        <div className={cn('divide-y divide-border rounded-md border border-border bg-surface-subtle', className)}>
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * One setting: label and hint on the left, the control on the right — or,
 * `wide`, the control under them at full width (font field, text areas,
 * lists, colour rows).
 */
export function SettingRow({
  label,
  htmlFor,
  hint,
  reset,
  wide,
  indent,
  disabled,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  /** The per-setting reset gesture, drawn beside the control (or the label, when wide). */
  reset?: ReactNode;
  wide?: boolean;
  /** A sub-setting of the row above it. */
  indent?: boolean;
  /** Greys the label; the control carries its own `disabled`. */
  disabled?: boolean;
  children: ReactNode;
}) {
  const text = (
    <div className="min-w-0 flex-1">
      <Label htmlFor={htmlFor} className={cn('leading-5', disabled && 'text-muted-foreground')}>
        {label}
      </Label>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
  return (
    <div className={cn('px-4 py-3', indent && 'pl-10')}>
      {wide ? (
        <>
          <div className="flex items-start justify-between gap-3">
            {text}
            {reset && <div className="flex shrink-0 items-center">{reset}</div>}
          </div>
          <div className="mt-2.5">{children}</div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-6">
          {text}
          <div className="flex shrink-0 items-center gap-2">
            {reset}
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

/** Free content inside a card, with the row padding. */
export function SectionBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-4 py-3', className)}>{children}</div>;
}

/** A line of explanation inside a card. */
export function SectionNote({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warning' }) {
  return (
    <p className={cn('px-4 py-2.5 text-xs', tone === 'warning' ? 'text-st-progress' : 'text-muted-foreground')}>
      {children}
    </p>
  );
}

/** Splits a long card in two, with a small capitalised heading. */
export function SectionSubheading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 px-4 pt-3 pb-1">
      <span className="eyebrow">{children}</span>
      {action}
    </div>
  );
}

/** Title and one-line description of a settings page, with its action on the right. */
export function PageHeading({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="zn-section-title">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** Inline code snippet inside a hint. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-xs bg-surface-muted px-1 py-px font-mono text-[11px] text-foreground">{children}</code>;
}
