import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Keyboard, MousePointerClick, RotateCcw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DEFAULT_SHIFT_ENTER } from '@/lib/terminalKeys';
import { useAppStore } from '@/stores/appStore';
import type { ShiftEnterKey, TerminalConfig } from '@/types';
import {
  IS_MAC,
  KEYBINDING_ACTIONS,
  KEYBINDING_CATEGORIES,
  comboFromEvent,
  conflicts,
  effectiveCombos,
  formatCombo,
  isOverridden,
  keybindingAction,
  type KeybindingActionId,
  type KeybindingOverrides,
} from '@/lib/keybindings';
import { cn } from '@/lib/utils';

interface ShortcutsSectionProps {
  /** The user's overrides (`settings.terminal.keybindings`); undefined = all defaults. */
  value: KeybindingOverrides | undefined;
  /** Reports the next overrides record; the page holds the state and saves it. */
  onChange: (next: KeybindingOverrides) => void;
}

/** One labelled row of the "Keys and selection" card. */
function BehaviourRow({ id, label, hint, children }: { id: string; label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * Settings card for what the keys and the mouse do inside a terminal, as
 * opposed to the window shortcuts below it. These three are saved as soon as
 * they change (the Settings page's Save button only owns the fields it
 * renders itself).
 */
function KeysAndSelectionCard() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const terminal = settings?.terminal;

  const patch = (next: Partial<TerminalConfig>) => {
    if (!settings) return;
    updateSettings({ ...settings, terminal: { ...settings.terminal, ...next } }).catch((err) =>
      toast.error('Could not save the terminal settings', { description: String(err) })
    );
  };

  const copyOnSelect = terminal?.copyOnSelect ?? true;
  const shiftEnter = terminal?.shiftEnter ?? DEFAULT_SHIFT_ENTER;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MousePointerClick className="size-4 text-faint" />
          Keys and selection
        </CardTitle>
        <CardDescription>How the keyboard and the mouse behave inside a terminal. Saved as soon as you change them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <BehaviourRow
          id="terminal-copy-on-select"
          label="Copy on select"
          hint={
            <>
              Selecting with the mouse copies straight away, like Warp. Ctrl+C then keeps interrupting the running program instead of
              copying — Ctrl+Shift+C copies whenever you need it.
            </>
          }
        >
          <Switch id="terminal-copy-on-select" checked={copyOnSelect} onCheckedChange={(v) => patch({ copyOnSelect: v })} disabled={!settings} />
        </BehaviourRow>

        <BehaviourRow
          id="terminal-shift-enter"
          label="Shift+Enter sends"
          hint="A plain terminal sends the same key for Enter and Shift+Enter. ESC+Enter is what Claude Code's /terminal-setup binds, and what zsh and fish insert a new line for."
        >
          <Select value={shiftEnter} onValueChange={(v: ShiftEnterKey) => patch({ shiftEnter: v })} disabled={!settings}>
            <SelectTrigger id="terminal-shift-enter" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="escape-enter">A new line (ESC + Enter)</SelectItem>
              <SelectItem value="enter">The same thing as Enter</SelectItem>
            </SelectContent>
          </Select>
        </BehaviourRow>

      </CardContent>
    </Card>
  );
}

/**
 * One row: the action, its combo(s) as `kbd` chips, "Change" (then press the
 * new keys — Esc cancels, Backspace unbinds) and a per-row reset once it
 * differs from the default. A warning shows when another action answers to
 * the same combo.
 */
function ShortcutRow({
  id,
  overrides,
  recording,
  conflictsWith,
  onRecord,
  onReset,
}: {
  id: KeybindingActionId;
  overrides: KeybindingOverrides;
  recording: boolean;
  conflictsWith: string[];
  onRecord: () => void;
  onReset: () => void;
}) {
  const action = keybindingAction(id);
  const combos = effectiveCombos(id, overrides);
  const overridden = isOverridden(id, overrides);
  return (
    <div className={cn('group/row flex flex-col gap-1 rounded-sm px-2 py-1.5 transition-colors', recording ? 'bg-accent' : 'hover:bg-accent/50')}>
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-[13px]">{action.label}</span>
        <div className="flex min-w-0 shrink items-center gap-1">
          {recording ? (
            <span className="animate-pulse text-xs text-primary">Press the new shortcut… (Esc cancels, Backspace clears)</span>
          ) : combos.length === 0 ? (
            <span className="text-xs text-faint">none</span>
          ) : (
            combos.map((c) => (
              <kbd key={c} className={cn('kbd', overridden && 'border-accent-border text-foreground')}>
                {formatCombo(c)}
              </kbd>
            ))
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="xs" onClick={onRecord} disabled={recording} className="min-w-16">
            {recording ? 'Listening' : 'Change'}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onReset}
            title="Reset to default"
            aria-label="Reset to default"
            className={cn('transition-opacity', overridden ? 'opacity-100' : 'pointer-events-none opacity-0')}
          >
            <RotateCcw />
          </Button>
        </div>
      </div>
      {conflictsWith.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-st-progress">
          <TriangleAlert className="size-3.5 shrink-0" />
          Also bound to {conflictsWith.join(', ')} — only the first one in this list runs.
        </p>
      )}
    </div>
  );
}

/**
 * Settings card for the Terminal window shortcuts (Warp-like defaults,
 * grouped by category). Standalone: the Settings page holds the overrides
 * record and saves it under `terminal.keybindings`.
 */
export function ShortcutsSection({ value, onChange }: ShortcutsSectionProps) {
  const overrides = useMemo(() => value ?? {}, [value]);
  const [recording, setRecording] = useState<KeybindingActionId | null>(null);

  // Which other actions share each action's combos, for the inline warning.
  const conflictLabels = useMemo(() => {
    const out = new Map<KeybindingActionId, string[]>();
    for (const c of conflicts(overrides)) {
      for (const id of c.actionIds) {
        const others = c.actionIds.filter((o) => o !== id).map((o) => `${keybindingAction(o).label} (${formatCombo(c.combo)})`);
        out.set(id, [...(out.get(id) ?? []), ...others]);
      }
    }
    return out;
  }, [overrides]);

  const overriddenCount = useMemo(() => KEYBINDING_ACTIONS.filter((a) => isOverridden(a.id, overrides)).length, [overrides]);

  // Capture the next chord while a row is listening. Registered in the
  // capture phase so the page's own shortcuts do not react to it.
  useEffect(() => {
    if (!recording) return;
    const id = recording;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        setRecording(null);
        return;
      }
      if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        onChange({ ...overrides, [id]: '' });
        setRecording(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return; // a bare modifier: keep listening
      const defaults = keybindingAction(id).defaults;
      const next = { ...overrides };
      if (defaults.length === 1 && defaults[0] === combo) delete next[id];
      else next[id] = combo;
      onChange(next);
      setRecording(null);
    };
    const onBlur = () => setRecording(null);
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('blur', onBlur);
    };
  }, [recording, overrides, onChange]);

  const reset = (id: KeybindingActionId) => {
    if (!(id in overrides)) return;
    const next = { ...overrides };
    delete next[id];
    onChange(next);
  };

  return (
    <>
    <KeysAndSelectionCard />
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Keyboard className="size-4 text-faint" />
          Terminal shortcuts
        </CardTitle>
        <CardDescription>
          Keyboard shortcuts of the Terminal window. Click Change, then press the keys you want
          {IS_MAC ? ' (⌘ stands in for Ctrl)' : ''}. They apply the next time you press them.
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => onChange({})} disabled={overriddenCount === 0}>
            <RotateCcw />
            Reset all
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {KEYBINDING_CATEGORIES.map((category) => (
          <div key={category}>
            <p className="eyebrow mb-1 px-2">{category}</p>
            <div className="flex flex-col">
              {KEYBINDING_ACTIONS.filter((a) => a.category === category).map((a) => (
                <ShortcutRow
                  key={a.id}
                  id={a.id}
                  overrides={overrides}
                  recording={recording === a.id}
                  conflictsWith={conflictLabels.get(a.id) ?? []}
                  onRecord={() => setRecording(a.id)}
                  onReset={() => reset(a.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
    </>
  );
}
