/**
 * Small controls shared by the terminal settings sections. They write to the
 * store as soon as a value is valid, so the same card behaves identically in
 * the Settings page and in the Terminal window's panel.
 */
import { useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/settings/SettingsPrimitives';
import { cn } from '@/lib/utils';

/**
 * A named group of settings inside one card.
 *
 * The integrated terminal card holds thirty-odd controls; without a heading
 * every couple of them the list reads as one undifferentiated stack and
 * nobody finds the block settings among the completion settings (ticket #26).
 * Purely a heading and its own vertical rhythm — no state, no collapsing.
 */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <h4 className="eyebrow">{title}</h4>
      {children}
    </section>
  );
}

interface NumberFieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** Empty input commits `undefined` instead of being rejected. */
  allowEmpty?: boolean;
  onCommit: (value: number | undefined) => void;
}

/**
 * A number input that keeps what you type. Committing on every keystroke and
 * clamping there would rewrite `1` into `8` before you reached `12`, so a
 * value outside the range only lands (clamped) when the field loses the focus.
 */
export function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  step,
  disabled,
  className,
  placeholder,
  allowEmpty,
  onCommit,
}: NumberFieldProps) {
  const stored = value === undefined ? '' : String(value);
  // While the field has the focus it shows what is being typed; the rest of
  // the time it mirrors the stored value, so no effect has to sync the two.
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);

  const commit = (raw: string, clamp: boolean) => {
    if (raw.trim() === '') {
      if (allowEmpty) onCommit(undefined);
      return;
    }
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    if (n < min || n > max) {
      if (!clamp) return;
      onCommit(Math.min(max, Math.max(min, n)));
      return;
    }
    onCommit(n);
  };

  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={focused ? text : stored}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => {
          setText(stored);
          setFocused(true);
        }}
        onBlur={(e) => {
          setFocused(false);
          commit(e.target.value, true);
        }}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value, false);
        }}
        className={cn('w-28 font-mono text-[12px]', className)}
      />
    </Field>
  );
}

/** A text input that only writes back what it holds, unclamped. */
export function TextField({
  id,
  label,
  hint,
  value,
  onCommit,
  placeholder,
  disabled,
  className,
  list,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  list?: string;
  /** Extra nodes rendered after the input (a `<datalist>`, a swatch…). */
  children?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);

  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        value={focused ? text : value}
        list={list}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => {
          setText(value);
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          onCommit(e.target.value);
        }}
        className={cn('font-mono text-[12px]', className)}
      />
      {children}
    </Field>
  );
}
