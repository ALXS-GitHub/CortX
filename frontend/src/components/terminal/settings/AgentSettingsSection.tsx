/**
 * Agents (agent mode): the dot colours, the agent notifications, what "New
 * agent" runs and how the grid tiles behave. Store-backed like the other
 * cards — mounted in the Settings page and in the Terminal window's panel.
 *
 * Everything here is observation and presentation: CortX reads what the
 * agents write on their own (their live registry, their transcripts, the
 * terminal's output) and never sends them anything — except, for "New agent",
 * the command you chose, typed as you would type it.
 */
import { Bot } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ColorField } from '@/components/ui/ColorField';
import { Code, Section } from '@/components/settings/SettingsPrimitives';
import { cn } from '@/lib/utils';
import type { GridTileInfo, TerminalConfig, ToastPosition } from '@/types';
import { resolveAgentNotifyPosition, TOAST_POSITION_OPTIONS } from './notificationPolicy';
import { AgentPhaseDot } from '../TerminalStatusGlyph';
import { DEFAULT_AGENT_COLORS, type AgentColorKey } from '../agentColors';
import {
  GRID_TILE_INFO_OPTIONS,
  GRID_TILE_TEXT_SCALE_OPTIONS,
  resolveGridTileInfo,
  resolveGridTileTextScale,
} from '../gridTileInfo';
import { Segmented } from '@/components/ui/Segmented';
import type { AgentPhase } from '../agentPhase';
import { Group, ResetCard, SettingField, SettingToggle } from './controls';
import { useTerminalSettings } from './useTerminalSettings';

type ColorSetting = 'agentColorWorking' | 'agentColorNeedsYou' | 'agentColorDone' | 'agentColorIdle';

const COLORS: Array<{ key: AgentColorKey; field: ColorSetting; phase: AgentPhase; label: string; hint: string }> = [
  { key: 'working', field: 'agentColorWorking', phase: 'working', label: 'Working', hint: 'Pulsing while the agent is busy on a turn.' },
  {
    key: 'needsYou',
    field: 'agentColorNeedsYou',
    phase: 'needs-you',
    label: 'Needs you',
    hint: 'A calling ring when it is stopped on you: a question, a plan to approve, a permission prompt.',
  },
  { key: 'done', field: 'agentColorDone', phase: 'done', label: 'Done, not seen', hint: 'Solid once its turn ended and until you look at it.' },
  { key: 'idle', field: 'agentColorIdle', phase: 'idle', label: 'Idle', hint: 'A ring: finished, seen, waiting for your next prompt.' },
];

export function AgentSettingsSection() {
  const { terminal, patch } = useTerminalSettings();
  const disabled = !terminal;
  const promptOpacity = terminal?.agentPromptOpacity ?? 95;
  const tileInfo = resolveGridTileInfo(terminal);
  const position = resolveAgentNotifyPosition(terminal);
  const toggleInfo = (value: GridTileInfo) => {
    const next = tileInfo.includes(value) ? tileInfo.filter((v) => v !== value) : [...tileInfo, value];
    patch({ gridTileInfo: GRID_TILE_INFO_OPTIONS.map((o) => o.value).filter((v) => next.includes(v)) });
  };

  return (
    <Section
      title="Agents"
      icon={Bot}
      action={<ResetCard card="agents" title="Agents" />}
      description="How CortX shows the agents (Claude Code, Codex) running in its terminals. It watches what they write on their own — their session files and their output — and only sends them what you write in the agent prompt."
    >
      <Group title="Dot colours" group="agents">
        <p className="text-xs text-faint">
          A family of their own: no shell, service or script dot ever uses them. Empty = CortX&rsquo;s colour.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {COLORS.map((c) => {
            const value = terminal?.[c.field] ?? '';
            return (
              <SettingField key={c.key} k={c.field} label={c.label} hint={c.hint}>
                <div className="flex items-center gap-2">
                  <AgentPhaseDot phase={c.phase} size={9} />
                  <ColorField
                    value={value}
                    onChange={(hex) => patch({ [c.field]: hex || undefined } as Partial<TerminalConfig>)}
                    clearable
                    placeholder={DEFAULT_AGENT_COLORS[c.key]}
                    swatches={Object.values(DEFAULT_AGENT_COLORS)}
                    disabled={disabled}
                    aria-label={`${c.label} colour`}
                    className="w-40"
                  />
                </div>
              </SettingField>
            );
          })}
        </div>
      </Group>

      <Group title="Notifications">
        <SettingToggle
          k="agentNotifyNeedsYou"
          id="agent-notify-needs-you"
          label="When an agent needs you"
          hint="A question, a plan to approve, a permission prompt."
        >
          <Switch
            id="agent-notify-needs-you"
            checked={terminal?.agentNotifyNeedsYou ?? true}
            onCheckedChange={(v) => patch({ agentNotifyNeedsYou: v })}
            disabled={disabled}
          />
        </SettingToggle>
        <SettingToggle k="agentNotifyDone" id="agent-notify-done" label="When an agent is done" hint="Its turn ended.">
          <Switch
            id="agent-notify-done"
            checked={terminal?.agentNotifyDone ?? true}
            onCheckedChange={(v) => patch({ agentNotifyDone: v })}
            disabled={disabled}
          />
        </SettingToggle>
        <SettingToggle
          k="agentNotifyOnlyWhenHidden"
          id="agent-notify-hidden"
          label="Only for agents out of sight"
          hint="Not for the one you are looking at. How a notification shows (a toast, the desktop, both) follows the Notifications card."
        >
          <Switch
            id="agent-notify-hidden"
            checked={terminal?.agentNotifyOnlyWhenHidden ?? true}
            onCheckedChange={(v) => patch({ agentNotifyOnlyWhenHidden: v })}
            disabled={disabled}
          />
        </SettingToggle>
        <SettingField
          k="agentNotifyPosition"
          label="Appear"
          hint={`${TOAST_POSITION_OPTIONS.find((o) => o.value === position)?.label ?? ''} of the window. Only the agent toasts move; the others stay bottom right.`}
        >
          <ToastPositionPicker value={position} onChange={(v) => patch({ agentNotifyPosition: v })} disabled={disabled} />
        </SettingField>
      </Group>

      <Group title="Agent prompt">
        <SettingToggle
          k="agentPromptBar"
          id="agent-prompt-bar"
          label="Agent prompt (Ctrl+G)"
          hint="While an agent runs in a terminal, Ctrl+G opens an editor over its last rows: write your prompt there, paste or drop images and files, and it goes to the agent as if typed in its own input."
        >
          <Switch
            id="agent-prompt-bar"
            checked={terminal?.agentPromptBar ?? true}
            onCheckedChange={(v) => patch({ agentPromptBar: v })}
            disabled={disabled}
          />
        </SettingToggle>
        <SettingToggle
          k="agentStatusBar"
          id="agent-status-bar"
          label="Status bar under the terminal"
          hint="A thin bar under a terminal running an agent: which agent, what it is doing, a draft waiting to be sent. Click it to open the agent prompt — the same as Ctrl+G. Off, nothing takes room under the terminal and Ctrl+G is the only way in."
        >
          <Switch
            id="agent-status-bar"
            checked={terminal?.agentStatusBar ?? true}
            onCheckedChange={(v) => patch({ agentStatusBar: v })}
            disabled={disabled || terminal?.agentPromptBar === false}
          />
        </SettingToggle>
        <SettingField k="agentPromptColor" label="Bubble colour" hint="Background of the prompt bubble. Empty = the theme's.">
          <ColorField
            value={terminal?.agentPromptColor ?? ''}
            onChange={(hex) => patch({ agentPromptColor: hex || undefined })}
            clearable
            placeholder="theme"
            disabled={disabled}
            aria-label="Agent prompt bubble colour"
            className="w-40"
          />
        </SettingField>
        <SettingField
          k="agentPromptOpacity"
          label={`Bubble opacity · ${promptOpacity}%`}
          hint="How much of the terminal shows through the bubble."
        >
          <div className="flex w-56 items-center gap-3">
            <input
              type="range"
              min={20}
              max={100}
              step={1}
              value={promptOpacity}
              onChange={(e) => patch({ agentPromptOpacity: Number(e.target.value) })}
              disabled={disabled}
              aria-label="Agent prompt bubble opacity"
              className="h-1.5 flex-1 cursor-pointer accent-primary"
            />
          </div>
        </SettingField>
      </Group>

      <Group title="New agent">
        <SettingField
          k="agentLaunchCommand"
          label="Runs"
          htmlFor="agent-launch-command"
          hint={
            <>
              Typed in a new terminal, then Enter — by the <em>New agent</em> shortcut (Ctrl+Shift+A by default) and the
              palette. Any command or alias: <Code>claude</Code>, <Code>cc</Code>, <Code>codex</Code>…
            </>
          }
        >
          <Input
            id="agent-launch-command"
            className="w-56 font-mono"
            value={terminal?.agentLaunchCommand ?? 'claude'}
            onChange={(e) => patch({ agentLaunchCommand: e.target.value })}
            placeholder="claude"
            disabled={disabled}
          />
        </SettingField>
      </Group>

      <Group title="Grid">
        <SettingToggle
          k="agentModeHidesTabs"
          id="agent-mode-hides-tabs"
          label="Hide the rail in agent mode"
          hint="In agent mode, the sessions rail (or the tab strip) disappears entirely — not even its collapsed icon strip — and the grid takes the whole window. Off, it stays as it is (Ctrl+B still collapses it)."
        >
          <Switch
            id="agent-mode-hides-tabs"
            checked={terminal?.agentModeHidesTabs ?? false}
            onCheckedChange={(v) => patch({ agentModeHidesTabs: v })}
            disabled={disabled}
          />
        </SettingToggle>
        <SettingToggle
          k="gridTilesInteractive"
          id="grid-tiles-interactive"
          label="Type into grid tiles"
          hint="Each tile is a working terminal: click into it to type, select or scroll, and click its header to open it full size. Off, the tiles are only watched: a click anywhere opens it, and nothing you do in the grid reaches the program inside."
        >
          <Switch
            id="grid-tiles-interactive"
            checked={terminal?.gridTilesInteractive ?? true}
            onCheckedChange={(v) => patch({ gridTilesInteractive: v })}
            disabled={disabled}
          />
        </SettingToggle>
        <SettingToggle
          k="gridTilesKeepSize"
          id="grid-tiles-keep-size"
          label="Tiles keep the session's size"
          hint="A tile shows its session at the size it has full page, scaled down, so entering or leaving the grid never resizes it. Off, each session is resized to its tile — readable, but a program that lays its text out for the width it is given (Claude Code) keeps what it drew narrow once you open it again."
        >
          <Switch
            id="grid-tiles-keep-size"
            checked={terminal?.gridTilesKeepSize ?? true}
            onCheckedChange={(v) => patch({ gridTilesKeepSize: v })}
            disabled={disabled}
          />
        </SettingToggle>
        <SettingField
          k="gridTileTextScale"
          label="Tile text size"
          hint="With the session's size kept, the whole page shrunk into a tile is too small to read. At a readable size the tile shows the part of the page around the cursor — the prompt, or the agent's input box and its latest messages — cut at the right. Whole page = everything, however small."
        >
          <div
            className={cn('w-fit', (disabled || !(terminal?.gridTilesKeepSize ?? true)) && 'pointer-events-none opacity-50')}
            aria-disabled={disabled || !(terminal?.gridTilesKeepSize ?? true)}
          >
            <Segmented<string>
              size="sm"
              value={String(resolveGridTileTextScale(terminal))}
              onChange={(v) => patch({ gridTileTextScale: Number(v) })}
              options={GRID_TILE_TEXT_SCALE_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
            />
          </div>
        </SettingField>
        <SettingField
          k="gridTileInfo"
          label="A tile's header shows"
          hint="Besides its name and its dot. Also in the grid's View menu."
        >
          <div className="flex flex-wrap gap-1.5">
            {GRID_TILE_INFO_OPTIONS.map((o) => {
              const on = tileInfo.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => toggleInfo(o.value)}
                  className={cn(
                    'h-6 rounded-full border px-2.5 text-[11px] transition-colors',
                    on ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </SettingField>
      </Group>
    </Section>
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
        'grid h-[72px] w-[120px] grid-cols-3 grid-rows-2 gap-1 rounded-md border border-border-strong bg-muted/40 p-1.5 pt-3.5',
        'relative before:absolute before:inset-x-0 before:top-0 before:h-2 before:rounded-t-md before:border-b before:border-border before:bg-muted',
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
              'group flex rounded-sm transition-colors hover:bg-primary/10',
              row === 'top' ? 'items-start' : 'items-end',
              col === 'left' ? 'justify-start' : col === 'center' ? 'justify-center' : 'justify-end'
            )}
          >
            <span
              className={cn(
                'h-2 w-6 rounded-[2px] border transition-colors',
                on ? 'border-primary bg-primary' : 'border-border-strong bg-card group-hover:border-primary/60'
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
