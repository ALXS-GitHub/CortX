/**
 * Notifications (DEV-13 #5, ticket #64): every notification in one place —
 * finished commands, agents that need you or are done, how they are
 * delivered, and the bell. Store-backed: mounted both in the Settings screen
 * and in the Terminal window's own panel.
 *
 * The agent notifications used to live on the Agents card, with an "only out
 * of sight" switch of their own beside the commands' one. Both fields are
 * kept (an older file may set them apart), but they are one switch here.
 */
import { useState } from 'react';
import { Segmented } from '@/components/ui/Segmented';
import { Textarea } from '@/components/ui/textarea';
import { Code, SectionNote } from '@/components/settings/SettingsPrimitives';
import { cn } from '@/lib/utils';
import { Group, NumberField, SelectField, SettingField, SwitchField } from './controls';
import {
  DEFAULT_LONG_COMMAND_SECONDS,
  NOTIFY_STYLE_OPTIONS,
  NOTIFY_WHEN_OPTIONS,
  TOAST_POSITION_OPTIONS,
  formatMutedCommands,
  parseMutedCommands,
  resolveAgentNotifyPosition,
  resolveLongCommandSeconds,
  resolveMutedCommands,
  resolveNotifyOnlyWhenHidden,
  resolveNotifyStyle,
  resolveNotifyWhen,
} from './notificationPolicy';
import { BELL_OPTIONS, resolveBellStyle } from './meta';
import { useTerminalSettings } from './useTerminalSettings';
import type { TerminalBellStyle, TerminalNotifyStyle, TerminalNotifyWhen, ToastPosition } from '@/types';

export function TerminalNotificationsSection() {
  const { terminal, patch } = useTerminalSettings();
  const off = !terminal;

  const when = resolveNotifyWhen(terminal);
  const style = resolveNotifyStyle(terminal);
  const seconds = resolveLongCommandSeconds(terminal);
  const muted = resolveMutedCommands(terminal);
  const commandsOff = off || when === 'never';
  const agentNeedsYou = terminal?.agentNotifyNeedsYou ?? true;
  const agentDone = terminal?.agentNotifyDone ?? true;
  const agentsOff = off || (!agentNeedsYou && !agentDone);
  const nothing = commandsOff && agentsOff;

  // One switch for two fields. They agree unless an older file set them
  // apart; then the switch shows on only when both are, and says so.
  const commandsHidden = resolveNotifyOnlyWhenHidden(terminal);
  const agentsHidden = terminal?.agentNotifyOnlyWhenHidden ?? true;
  const hiddenMixed = commandsHidden !== agentsHidden;

  // The muted list is a free-text field: while it has the focus it shows the
  // raw text, so a half-typed entry does not disappear from under you.
  const storedMuted = formatMutedCommands(muted);
  const [mutedText, setMutedText] = useState('');
  const [mutedFocused, setMutedFocused] = useState(false);

  const bell = resolveBellStyle(terminal);
  const position = resolveAgentNotifyPosition(terminal);

  return (
    <>
      <Group group="notifications">
        <SelectField<TerminalNotifyWhen>
          k="notifyWhen"
          id="terminal-notify-when"
          label="Notify me when"
          hint={NOTIFY_WHEN_OPTIONS.find((o) => o.value === when)?.hint}
          value={when}
          options={NOTIFY_WHEN_OPTIONS}
          onChange={(v) => patch({ notifyWhen: v })}
          disabled={off}
        />
        {when === 'failed-or-long' && (
          <NumberField
            k="longCommandSeconds"
            id="terminal-long-command-seconds"
            label="“Long” starts at"
            value={seconds}
            min={1}
            max={3600}
            unit="s"
            onCommit={(v) => patch({ longCommandSeconds: v ?? DEFAULT_LONG_COMMAND_SECONDS })}
            disabled={commandsOff}
            indent
          />
        )}
        <SettingField
          k="notifyMutedCommands"
          label="Never notify for these commands"
          htmlFor="terminal-notify-muted"
          wide
          disabled={commandsOff}
          hint={
            <>
              One per line or separated by commas. A name matches the program (<Code>claude</Code> covers{' '}
              <Code>claude --resume</Code>), a longer entry the start of the command line (<Code>npm run dev</Code>).
              Agents, editors and remote shells belong here: their exit code only says you closed them.
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
            placeholder="claude, codex, vim, ssh…"
            disabled={commandsOff}
          />
        </SettingField>
        <SectionNote>
          CortX cannot tell that a program is waiting for a password: shell integration reports where commands start and
          end, not what a running program asks for.
        </SectionNote>
      </Group>

      <Group group="agentNotify">
        <SwitchField
          k="agentNotifyNeedsYou"
          id="agent-notify-needs-you"
          label="When an agent needs you"
          hint="A question, a plan to approve, a permission prompt."
          checked={agentNeedsYou}
          onChange={(v) => patch({ agentNotifyNeedsYou: v })}
          disabled={off}
        />
        <SwitchField
          k="agentNotifyDone"
          id="agent-notify-done"
          label="When an agent is done"
          hint="Its turn ended."
          checked={agentDone}
          onChange={(v) => patch({ agentNotifyDone: v })}
          disabled={off}
        />
      </Group>

      <Group group="delivery">
        <SettingField
          k="notifyStyle"
          label="Show it as"
          hint={NOTIFY_STYLE_OPTIONS.find((o) => o.value === style)?.hint}
          disabled={nothing}
        >
          <div className={cn(nothing && 'pointer-events-none opacity-50')}>
            <Segmented<TerminalNotifyStyle>
              value={style}
              onChange={(v) => patch({ notifyStyle: v })}
              options={NOTIFY_STYLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              size="sm"
            />
          </div>
        </SettingField>
        <SwitchField
          k={['notifyOnlyWhenHidden', 'agentNotifyOnlyWhenHidden']}
          id="terminal-notify-hidden-only"
          label="Only when out of sight"
          hint={
            hiddenMixed
              ? `Currently on for ${commandsHidden ? 'commands' : 'agents'} only. Switching it sets both.`
              : 'Nothing for the terminal or the agent you are looking at.'
          }
          checked={commandsHidden && agentsHidden}
          onChange={(v) => patch({ notifyOnlyWhenHidden: v, agentNotifyOnlyWhenHidden: v })}
          disabled={nothing}
        />
        <SettingField
          k="agentNotifyPosition"
          label="Agent toasts appear"
          hint={`${TOAST_POSITION_OPTIONS.find((o) => o.value === position)?.label ?? ''} of the window. The other toasts stay bottom right.`}
          disabled={agentsOff}
        >
          <ToastPositionPicker value={position} onChange={(v) => patch({ agentNotifyPosition: v })} disabled={agentsOff} />
        </SettingField>
      </Group>

      <Group group="bell">
        <SettingField
          k="bell"
          label="When a program rings the bell"
          hint={
            <>
              {BELL_OPTIONS.find((o) => o.value === bell)?.hint} A <Code>BEL</Code> never becomes a toast, and one that
              follows a command already being reported is dropped.
            </>
          }
          disabled={off}
        >
          <div className={cn(off && 'pointer-events-none opacity-50')}>
            <Segmented<TerminalBellStyle>
              value={bell}
              onChange={(v) => patch({ bell: v })}
              options={BELL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              size="sm"
            />
          </div>
        </SettingField>
      </Group>
    </>
  );
}

/**
 * A miniature window with its six toast spots: the one you click is where the
 * agent toasts appear. Tells at a glance what a list of six labels would not.
 */
function ToastPositionPicker({
  value,
  onChange,
  disabled,
}: {
  value: ToastPosition;
  onChange: (value: ToastPosition) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Where agent notifications appear"
      className={cn(
        'relative grid h-[72px] w-[120px] grid-cols-3 grid-rows-2 gap-1 rounded-sm border border-border-control bg-surface p-1.5 pt-3.5',
        'before:absolute before:inset-x-0 before:top-0 before:h-2 before:rounded-t-sm before:border-b before:border-border before:bg-surface-muted',
        disabled && 'pointer-events-none opacity-50'
      )}
    >
      {TOAST_POSITION_OPTIONS.map((o) => {
        const on = o.value === value;
        const [row, col] = o.value.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            title={o.label}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'group flex rounded-xs transition-colors hover:bg-surface-muted',
              row === 'top' ? 'items-start' : 'items-end',
              col === 'left' ? 'justify-start' : col === 'center' ? 'justify-center' : 'justify-end'
            )}
          >
            <span
              className={cn(
                'h-2 w-6 rounded-xs border transition-colors',
                on ? 'border-primary bg-primary' : 'border-border-strong bg-surface-subtle group-hover:border-border-control'
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
