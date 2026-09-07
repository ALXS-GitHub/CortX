/**
 * Terminal notifications (DEV-13 #5). Store-backed: mounted both in the
 * Settings page and in the Terminal window's own panel.
 */
import { useState } from 'react';
import { Bell, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Segmented } from '@/components/ui/Segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Code, Field, Section, ToggleField } from '@/components/settings/SettingsPrimitives';
import { NumberField } from './controls';
import {
  DEFAULT_LONG_COMMAND_SECONDS,
  DEFAULT_MUTED_COMMANDS,
  NOTIFY_STYLE_OPTIONS,
  NOTIFY_WHEN_OPTIONS,
  formatMutedCommands,
  parseMutedCommands,
  resolveLongCommandSeconds,
  resolveMutedCommands,
  resolveNotifyOnlyWhenHidden,
  resolveNotifyStyle,
  resolveNotifyWhen,
} from './notificationPolicy';
import { BELL_OPTIONS, resolveBellStyle } from './meta';
import { useTerminalSettings } from './useTerminalSettings';
import type { TerminalBellStyle, TerminalNotifyStyle, TerminalNotifyWhen } from '@/types';

export function TerminalNotificationsSection() {
  const { terminal, patch } = useTerminalSettings();

  const when = resolveNotifyWhen(terminal);
  const style = resolveNotifyStyle(terminal);
  const onlyWhenHidden = resolveNotifyOnlyWhenHidden(terminal);
  const seconds = resolveLongCommandSeconds(terminal);
  const muted = resolveMutedCommands(terminal);
  const disabled = !terminal || when === 'never';

  // The muted list is a free-text field: while it has the focus it shows the
  // raw text, so a half-typed entry does not disappear from under you.
  const storedMuted = formatMutedCommands(muted);
  const [mutedText, setMutedText] = useState('');
  const [mutedFocused, setMutedFocused] = useState(false);

  const bell = resolveBellStyle(terminal);
  const whenHint = NOTIFY_WHEN_OPTIONS.find((o) => o.value === when)?.hint;
  const styleHint = NOTIFY_STYLE_OPTIONS.find((o) => o.value === style)?.hint;
  const bellHint = BELL_OPTIONS.find((o) => o.value === bell)?.hint;
  const isDefaultMuted = formatMutedCommands([...DEFAULT_MUTED_COMMANDS]) === storedMuted;

  return (
    <Section
      title="Notifications"
      icon={Bell}
      description="Shell integration marks the end of every command — quitting Claude Code, leaving vim or interrupting a watcher all look the same from the outside. These rules decide which of them is worth interrupting you."
    >
      <Field
        label="Notify me when"
        htmlFor="terminal-notify-when"
        hint={whenHint}
      >
        <Select
          value={when}
          onValueChange={(v: TerminalNotifyWhen) => patch({ notifyWhen: v, notifyOnLongCommand: v !== 'never' })}
          disabled={!terminal}
        >
          <SelectTrigger id="terminal-notify-when" className="w-[300px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOTIFY_WHEN_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <NumberField
        id="terminal-long-command-seconds"
        label={<span className="text-xs text-muted-foreground">“Long” starts at (seconds)</span>}
        value={seconds}
        min={1}
        max={3600}
        onCommit={(v) => patch({ longCommandSeconds: v ?? DEFAULT_LONG_COMMAND_SECONDS })}
        disabled={disabled || when !== 'failed-or-long'}
      />

      <ToggleField
        id="terminal-notify-hidden-only"
        label="Only for terminals out of sight"
        hint="A command that ends in the pane you are watching stays silent. Turn this off to be told about every command, foreground included."
      >
        <Switch
          id="terminal-notify-hidden-only"
          checked={onlyWhenHidden}
          onCheckedChange={(v) => patch({ notifyOnlyWhenHidden: v })}
          disabled={disabled}
        />
      </ToggleField>

      <Field label="Show it as" hint={styleHint}>
        <div className={disabled ? 'pointer-events-none opacity-50' : undefined}>
          <Segmented<TerminalNotifyStyle>
            value={style}
            onChange={(v) => patch({ notifyStyle: v })}
            options={NOTIFY_STYLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            size="sm"
          />
        </div>
      </Field>

      <Field
        label="Never notify for these commands"
        htmlFor="terminal-notify-muted"
        hint={
          <>
            One per line or separated by commas. A name matches the program (<Code>claude</Code> covers{' '}
            <Code>claude --resume</Code>), a longer entry matches the start of the command line (
            <Code>npm run dev</Code>). Agents, editors and remote shells belong here: their exit code only says that you
            closed them — under PowerShell a Ctrl+C even reads as <Code>exit 1</Code>.
          </>
        }
      >
        <Textarea
          id="terminal-notify-muted"
          value={mutedFocused ? mutedText : storedMuted}
          rows={3}
          spellCheck={false}
          onFocus={() => {
            setMutedText(storedMuted);
            setMutedFocused(true);
          }}
          onBlur={() => setMutedFocused(false)}
          onChange={(e) => {
            setMutedText(e.target.value);
            patch({ notifyMutedCommands: parseMutedCommands(e.target.value) });
          }}
          className="font-mono text-[12px]"
          placeholder="claude, codex, vim, ssh…"
          disabled={disabled}
        />
      </Field>
      {!isDefaultMuted && (
        <Button
          variant="outline"
          size="xs"
          onClick={() => {
            const next = [...DEFAULT_MUTED_COMMANDS];
            setMutedText(formatMutedCommands(next));
            patch({ notifyMutedCommands: next });
          }}
          disabled={disabled}
        >
          <RotateCcw />
          Reset the list
        </Button>
      )}

      <Field
        label="When a program rings the bell"
        hint={
          <>
            {bellHint} A <Code>BEL</Code> is a byte a program sends to ask for attention — the end of a long build, a
            shell completion that found nothing. It is a different event from the rules above, which fire when a{' '}
            <em>command</em> ends, so the two are kept on separate channels: the bell never becomes a toast or a desktop
            notification, and a bell that arrives in the wake of a command already being reported is dropped, so one
            event is never signalled twice.
          </>
        }
      >
        <div className={!terminal ? 'pointer-events-none opacity-50' : undefined}>
          <Segmented<TerminalBellStyle>
            value={bell}
            onChange={(v) => patch({ bell: v })}
            options={BELL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            size="sm"
          />
        </div>
      </Field>

      <p className="text-xs text-faint">
        CortX cannot tell that a program is waiting for a password: shell integration reports command boundaries, not what
        a running program does with its input. Reading the output for a prompt would fire on any text containing the
        word, so it is deliberately not offered.
      </p>
    </Section>
  );
}
