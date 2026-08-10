import type { ReactNode } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Form primitives shared by every utility panel. They live in the socle rather
 * than in each module so the whole section keeps one look, and so a module is
 * a few dozen lines of logic instead of a pile of markup.
 */

export function Row({
  label,
  hint,
  className,
  children,
}: {
  label?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <Label className="text-xs font-medium text-muted-foreground">{label}</Label>}
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label?: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const clamp = (n: number) => {
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  };

  return (
    <Row label={label} hint={hint}>
      <div className="relative">
        <Input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const next = Number(e.target.value);
            onChange(clamp(Number.isFinite(next) ? next : (min ?? 0)));
          }}
          className={suffix ? 'pr-10' : undefined}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </Row>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  maxLength,
  mono,
}: {
  label?: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  mono?: boolean;
}) {
  return (
    <Row label={label} hint={hint}>
      <Input
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className={mono ? 'font-mono' : undefined}
      />
    </Row>
  );
}

export function SelectField<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label?: string;
  hint?: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <Row label={label} hint={hint}>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

/**
 * Standard two-column panel: settings on the left, result on the right.
 * Collapses to a single column below `lg`.
 */
export function PanelLayout({ options, output }: { options: ReactNode; output: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <div className="space-y-4">{options}</div>
      <div className="min-w-0 space-y-3">{output}</div>
    </div>
  );
}
