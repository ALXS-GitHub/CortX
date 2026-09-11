/**
 * Small controls shared by the terminal settings sections. They write to the
 * store as soon as a value is valid, so the same card behaves identically in
 * the Settings page and in the Terminal window's panel.
 *
 * Ticket #39 added the other half: the **"changed" marker** and the gestures
 * that undo a change. A panel of seventy controls is unreadable when nothing
 * distinguishes the nine values you chose from the sixty serde chose for you,
 * and that - not the order of the cards - is what "I get lost in there" was
 * about. So:
 *
 * - `SettingMark` - a dot beside the label of a setting that is away from its
 *   default. Never a colour on its own: it also carries the default in its
 *   tooltip and a `sr-only` word for a screen reader.
 * - `ResetSetting` - the per-setting gesture, right where the dot is. **No
 *   confirmation**: it changes one value, in front of you, and putting it back
 *   is the control you are already looking at.
 * - `ResetScope` - the per-group and per-card gesture, with the count of what
 *   is changed. This one *does* confirm, and the dialog **names every change**
 *   (`Padding 10 -> 8`), because twenty choices erased in one click with
 *   nothing on screen to say which is a trap. It then leaves an **Undo** in
 *   the toast - the dialog can be click-throughed, and the exact previous
 *   values are cheap to hold.
 * - `Group` - unchanged in look, plus that count and that gesture in its
 *   heading, so a group answers "is there anything of mine in here?" without
 *   being read.
 *
 * All of it reads `terminalDefaults.ts`, which is where the defaults live and
 * where the comparison is unit-tested.
 */
import { useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
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
import { Field, ToggleField } from '@/components/settings/SettingsPrimitives';
import { cn } from '@/lib/utils';
import { useTerminalSettings } from './useTerminalSettings';
import {
  CARD_KEYS,
  GROUP_KEYS,
  TERMINAL_SETTINGS,
  formatSettingValue,
  isSettingModified,
  modifiedSettings,
  resetPatch,
  restorePatch,
  settingChanges,
  settingDefault,
  type CardId,
  type GroupId,
  type TerminalSettingKey,
} from './terminalDefaults';

// ---------------------------------------------------------------------------
// The marker
// ---------------------------------------------------------------------------

/** A dot beside the label of a setting that is not at its default. */
export function SettingMark({ k }: { k: TerminalSettingKey }) {
  const { terminal } = useTerminalSettings();
  if (!isSettingModified(terminal, k)) return null;
  const fallback = formatSettingValue(settingDefault(k, terminal));
  return (
    <>
      <span
        aria-hidden
        title={`Changed \u2014 the default is ${fallback}`}
        className="inline-block size-1.5 shrink-0 rounded-full bg-primary"
      />
      <span className="sr-only">(changed from the default)</span>
    </>
  );
}

/** Label text plus the marker, as one phrase for a `<Label>`. */
export function MarkedLabel({ k, children }: { k: TerminalSettingKey; children: ReactNode }) {
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
 * next thing along, and the change is visible the instant it lands. A
 * confirmation here would be noise on the gesture people will use most.
 * Nothing is rendered while the setting is at its default.
 */
export function ResetSetting({ k, className }: { k: TerminalSettingKey; className?: string }) {
  const { terminal, patch } = useTerminalSettings();
  if (!isSettingModified(terminal, k)) return null;
  const meta = TERMINAL_SETTINGS[k];
  const fallback = formatSettingValue(settingDefault(k, terminal));
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={cn('shrink-0 text-faint hover:text-foreground', className)}
      title={`Back to the default (${fallback})`}
      aria-label={`Reset ${meta.label} to its default (${fallback})`}
      onClick={() => patch(resetPatch(terminal, [k]))}
    >
      <RotateCcw />
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Putting a whole group - or a whole card - back
// ---------------------------------------------------------------------------

/**
 * The count of what is changed in a scope, and the gesture that undoes it.
 *
 * The count is the point of the whole ticket at the scale above one setting:
 * a heading that says "3 changed" is what lets a panel of seventy controls be
 * skimmed instead of read.
 *
 * **Reversibility.** This erases choices in bulk, so it asks first and the
 * question names every one of them, old value and new. That alone is not
 * enough - a dialog is a thing people click through - so the toast that
 * follows carries an exact undo, built from the values as they were a moment
 * before. Two safety nets rather than one, because the cost of the mistake
 * scales with the number of keys: twenty settings silently flattened is not
 * recoverable from memory.
 */
function ResetScope({
  keys,
  title,
  compact,
}: {
  keys: readonly TerminalSettingKey[];
  title: string;
  compact?: boolean;
}) {
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
            <AlertDialogTitle>Reset {compact ? title.toLowerCase() : title}?</AlertDialogTitle>
            <AlertDialogDescription>
              {changed.length} setting{plural ? 's go' : ' goes'} back to the default. Nothing else in your settings is
              touched, and the toast that follows offers an undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-[13px]">
            {changes.map((c) => (
              <li
                key={c.key}
                className="flex items-baseline justify-between gap-3 rounded-sm px-1 py-0.5 odd:bg-muted/40"
              >
                <span className="min-w-0 truncate">{c.label}</span>
                <span className="shrink-0 font-mono text-[11px]">
                  <span className="text-muted-foreground line-through">{c.from}</span>
                  <span className="text-faint"> {'\u2192'} </span>
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

/** "3 changed" + reset, for a whole card. Goes in the card header's action slot. */
export function ResetCard({ card, title }: { card: CardId; title: string }) {
  return <ResetScope keys={CARD_KEYS[card]} title={title} />;
}

/**
 * The same, scoped to one group, for a card that draws its own heading rather
 * than using `Group` - the shortcuts card, whose second half already has a
 * reset of its own for the keybindings.
 */
export function ResetGroup({ group, title }: { group: GroupId; title: string }) {
  return <ResetScope keys={GROUP_KEYS[group]} title={title} />;
}

/**
 * A named group of settings inside one card.
 *
 * The integrated terminal card holds thirty-odd controls; without a heading
 * every couple of them the list reads as one undifferentiated stack and
 * nobody finds the block settings among the completion settings (ticket #26).
 * Purely a heading and its own vertical rhythm — no state, no collapsing.
 */
export function Group({ title, group, children }: { title: string; group?: GroupId; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h4 className="eyebrow">{title}</h4>
        {group && <ResetScope keys={GROUP_KEYS[group]} title={title} compact />}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Field wrappers that carry the marker
// ---------------------------------------------------------------------------

/**
 * `Field`, plus the marker on the label and the reset beside the control.
 *
 * The reset sits next to the control rather than inside the `<Label>` on
 * purpose: a `<button>` inside a label is interactive content the label would
 * also forward clicks through, and there is nowhere in a label to put it that
 * does not fight the text. Next to the control is where the eye already is,
 * and when the setting is at its default it renders nothing at all - so an
 * untouched panel looks exactly as it did before this ticket.
 */
export function SettingField({
  k,
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  k: TerminalSettingKey;
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Field label={<MarkedLabel k={k}>{label}</MarkedLabel>} htmlFor={htmlFor} hint={hint} className={className}>
      <div className="flex items-start gap-2">
        {children}
        <ResetSetting k={k} />
      </div>
    </Field>
  );
}

/** `ToggleField`, plus the marker; the reset joins the switch on the right. */
export function SettingToggle({
  k,
  id,
  label,
  hint,
  children,
}: {
  k: TerminalSettingKey;
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ToggleField id={id} label={<MarkedLabel k={k}>{label}</MarkedLabel>} hint={hint}>
      <ResetSetting k={k} />
      {children}
    </ToggleField>
  );
}

interface NumberFieldProps {
  id: string;
  /** Setting this field edits, for the "changed" marker and its reset. */
  k?: TerminalSettingKey;
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
  k,
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
    <Field label={k ? <MarkedLabel k={k}>{label}</MarkedLabel> : label} htmlFor={id} hint={hint}>
      <div className="flex items-center gap-2">
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
        {k && <ResetSetting k={k} />}
      </div>
    </Field>
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
  className,
  list,
  children,
}: {
  id: string;
  /** Setting this field edits, for the "changed" marker and its reset. */
  k?: TerminalSettingKey;
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
    <Field label={k ? <MarkedLabel k={k}>{label}</MarkedLabel> : label} htmlFor={id} hint={hint}>
      <div className="flex items-center gap-2">
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
          className={cn('min-w-0 flex-1 font-mono text-[12px]', className)}
        />
        {k && <ResetSetting k={k} />}
      </div>
      {children}
    </Field>
  );
}
