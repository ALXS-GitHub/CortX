/**
 * The terminal settings' controls: `SettingRow` (see
 * `components/settings/SettingsPrimitives.tsx`) plus what ticket #39 added —
 * the **"changed" marker** and the gestures that undo a change. They write to
 * the store as soon as a value is valid, so a card behaves identically in the
 * Settings screen and in the Terminal window's panel.
 *
 * - `SettingMark` - a dot beside the label of a setting that is away from its
 *   default. Never a colour on its own: it also carries the default in its
 *   tooltip and a `sr-only` word for a screen reader.
 * - `ResetSetting` - the per-setting gesture, right where the dot is. **No
 *   confirmation**: it changes one value, in front of you, and putting it back
 *   is the control you are already looking at.
 * - `ResetScope` - the per-group and per-page gesture, with the count of what
 *   is changed. This one *does* confirm, and the dialog **names every change**
 *   (`Padding 10 -> 8`), then leaves an **Undo** in the toast.
 * - `Group` - one titled card of terminal settings (ticket #64: what used to
 *   be a heading inside a big card), with that count and that gesture in its
 *   heading, so a card answers "is there anything of mine in here?" without
 *   being read.
 *
 * A setting may also be several fields shown as one control (the command
 * blocks select writes `blocks` and `blockLayout`): pass an array as `k`.
 *
 * All of it reads `terminalDefaults.ts`, which is where the defaults live and
 * where the comparison is unit-tested.
 */
import { useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CONTROL_WIDTH, Section, SettingRow } from '@/components/settings/SettingsPrimitives';
import { cn } from '@/lib/utils';
import { useTerminalSettings } from './useTerminalSettings';
import { TERMINAL_GROUPS } from './terminalPages';
import {
  CARD_KEYS,
  GROUP_KEYS,
  TERMINAL_SETTINGS,
  formatSettingValue,
  modifiedSettings,
  resetPatch,
  restorePatch,
  settingChanges,
  settingDefault,
  type CardId,
  type GroupId,
  type TerminalSettingKey,
} from './terminalDefaults';

/** One setting, or the fields one control writes together. */
export type SettingKeys = TerminalSettingKey | readonly TerminalSettingKey[];

function asKeys(k: SettingKeys): readonly TerminalSettingKey[] {
  return typeof k === 'string' ? [k] : k;
}

// ---------------------------------------------------------------------------
// The marker
// ---------------------------------------------------------------------------

/** A dot beside the label of a setting that is not at its default. */
export function SettingMark({ k }: { k: SettingKeys }) {
  const { terminal } = useTerminalSettings();
  const changed = modifiedSettings(terminal, asKeys(k));
  if (changed.length === 0) return null;
  const fallback = changed.map((key) => formatSettingValue(settingDefault(key, terminal))).join(', ');
  return (
    <>
      <span
        aria-hidden
        title={`Changed — the default is ${fallback}`}
        className="inline-block size-1.5 shrink-0 rounded-full bg-primary"
      />
      <span className="sr-only">(changed from the default)</span>
    </>
  );
}

/** Label text plus the marker, as one phrase for a `<Label>`. */
export function MarkedLabel({ k, children }: { k: SettingKeys; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      <SettingMark k={k} />
    </span>
  );
}

/**
 * Put one setting back, at once.
 *
 * Deliberately unconfirmed: this is one value, the control showing it is the
 * next thing along, and the change is visible the instant it lands. Nothing is
 * rendered while the setting is at its default.
 */
export function ResetSetting({ k, className }: { k: SettingKeys; className?: string }) {
  const { terminal, patch } = useTerminalSettings();
  const keys = asKeys(k);
  const changed = modifiedSettings(terminal, keys);
  if (changed.length === 0) return null;
  const fallback = changed.map((key) => formatSettingValue(settingDefault(key, terminal))).join(', ');
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={cn('shrink-0 text-faint hover:text-foreground', className)}
      title={`Back to the default (${fallback})`}
      aria-label={`Reset ${TERMINAL_SETTINGS[keys[0]].label} to its default (${fallback})`}
      onClick={() => patch(resetPatch(terminal, changed))}
    >
      <RotateCcw />
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Putting a whole group - or a whole page - back
// ---------------------------------------------------------------------------

/**
 * The count of what is changed in a scope, and the gesture that undoes it.
 *
 * **Reversibility.** This erases choices in bulk, so it asks first and the
 * question names every one of them, old value and new. The toast that follows
 * carries an exact undo, built from the values as they were a moment before.
 */
function ResetScope({ keys, title }: { keys: readonly TerminalSettingKey[]; title: string }) {
  const { terminal, patch } = useTerminalSettings();
  const [open, setOpen] = useState(false);
  const changed = modifiedSettings(terminal, keys);
  if (changed.length === 0) return null;
  const changes = settingChanges(terminal, changed);
  const plural = changed.length > 1;

  const apply = () => {
    // Captured before the patch lands: this is the exact undo.
    const undo = restorePatch(terminal, changed);
    patch(resetPatch(terminal, changed));
    toast.success(`${title}: ${changed.length} setting${plural ? 's' : ''} back to default`, {
      action: { label: 'Undo', onClick: () => patch(undo) },
    });
  };

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        title={`${changed.length} setting${plural ? 's' : ''} changed from the default`}
      >
        <RotateCcw />
        {changed.length} changed
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset {title}?</AlertDialogTitle>
            <AlertDialogDescription>
              {changed.length} setting{plural ? 's go' : ' goes'} back to the default. Nothing else in your settings is
              touched, and the toast that follows offers an undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {changes.map((c) => (
              <li
                key={c.key}
                className="flex items-baseline justify-between gap-3 rounded-sm px-1 py-0.5 odd:bg-surface-muted"
              >
                <span className="min-w-0 truncate">{c.label}</span>
                <span className="shrink-0 font-mono text-[11px]">
                  <span className="text-muted-foreground line-through">{c.from}</span>
                  <span className="text-faint"> {'→'} </span>
                  <span className="text-foreground">{c.to}</span>
                </span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={apply}>Reset {changed.length}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** "3 changed" + reset, for a whole page. Goes in the page heading. */
export function ResetCard({ card, title }: { card: CardId; title: string }) {
  return <ResetScope keys={CARD_KEYS[card]} title={title} />;
}

/**
 * One titled card of terminal settings. The title and description come from
 * `TERMINAL_GROUPS`, the same table the search reads, so a card is always
 * found under the name it shows.
 */
export function Group({ group, action, children }: { group: GroupId; action?: ReactNode; children: ReactNode }) {
  const meta = TERMINAL_GROUPS[group];
  return (
    <Section
      id={group}
      title={meta.title}
      description={meta.description}
      action={
        <>
          {action}
          <ResetScope keys={GROUP_KEYS[group]} title={meta.title} />
        </>
      }
    >
      {children}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Rows that carry the marker
// ---------------------------------------------------------------------------

interface SettingRowProps {
  k: SettingKeys;
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  /** The control under the label, full width. */
  wide?: boolean;
  /** A sub-setting of the row above. */
  indent?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

/**
 * `SettingRow`, plus the marker on the label and the reset beside the
 * control. When the setting is at its default the reset renders nothing at
 * all, so an untouched page looks exactly as it would without either.
 */
export function SettingField({ k, label, htmlFor, hint, wide, indent, disabled, children }: SettingRowProps) {
  return (
    <SettingRow
      label={<MarkedLabel k={k}>{label}</MarkedLabel>}
      htmlFor={htmlFor}
      hint={hint}
      reset={<ResetSetting k={k} />}
      wide={wide}
      indent={indent}
      disabled={disabled}
    >
      {children}
    </SettingRow>
  );
}

/** The same row, for a switch (kept as its own name: it reads better at the call site). */
export function SettingToggle(props: Omit<SettingRowProps, 'wide'>) {
  return <SettingField {...props} />;
}

interface NumberFieldProps {
  id: string;
  /** Setting this field edits, for the "changed" marker and its reset. */
  k: TerminalSettingKey;
  label: ReactNode;
  hint?: ReactNode;
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  indent?: boolean;
  /** Unit after the box (`px`, `s`, `MB`). */
  unit?: string;
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
  k,
  label,
  hint,
  value,
  min,
  max,
  step,
  disabled,
  indent,
  unit,
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
    <SettingField k={k} label={label} htmlFor={id} hint={hint} indent={indent} disabled={disabled}>
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
        className="w-24 tabular-nums"
      />
      {unit && <span className="w-6 text-xs text-muted-foreground">{unit}</span>}
    </SettingField>
  );
}

/** A text input that only writes back what it holds, unclamped. */
export function TextField({
  id,
  k,
  label,
  hint,
  value,
  onCommit,
  placeholder,
  disabled,
  wide,
  list,
  children,
}: {
  id: string;
  /** Setting this field edits, for the "changed" marker and its reset. */
  k: TerminalSettingKey;
  label: ReactNode;
  hint?: ReactNode;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Full width under the label (a command line, a font name). */
  wide?: boolean;
  list?: string;
  /** Extra nodes rendered after the input (a `<datalist>`, a warning…). */
  children?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);

  return (
    <SettingField k={k} label={label} htmlFor={id} hint={hint} wide={wide}>
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
        className={wide ? 'w-full' : CONTROL_WIDTH}
      />
      {children}
    </SettingField>
  );
}

/** A range with its value in a number box beside it, for a look setting. */
export function SliderField({
  id,
  k,
  label,
  hint,
  value,
  min,
  max,
  unit,
  disabled,
  onChange,
}: {
  id: string;
  k: TerminalSettingKey;
  label: ReactNode;
  hint?: ReactNode;
  value: number;
  min: number;
  max: number;
  unit: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  return (
    <SettingField k={k} label={label} htmlFor={id} hint={hint} disabled={disabled}>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="h-1.5 w-28 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(clamp(n));
        }}
        className="w-20 tabular-nums"
        aria-label={typeof label === 'string' ? label : undefined}
      />
      <span className="w-6 text-xs text-muted-foreground">{unit}</span>
    </SettingField>
  );
}

/** A row with a switch: the most common setting there is. */
export function SwitchField({
  k,
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
  indent,
}: {
  k: SettingKeys;
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  indent?: boolean;
}) {
  return (
    <SettingField k={k} label={label} htmlFor={id} hint={hint} disabled={disabled} indent={indent}>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </SettingField>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
}

/** A row with a select, at the standard control width. */
export function SelectField<T extends string>({
  k,
  id,
  label,
  hint,
  value,
  options,
  onChange,
  disabled,
  indent,
}: {
  k: SettingKeys;
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  indent?: boolean;
}) {
  return (
    <SettingField k={k} label={label} htmlFor={id} hint={hint} disabled={disabled} indent={indent}>
      <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
        <SelectTrigger id={id} className={CONTROL_WIDTH}>
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
    </SettingField>
  );
}