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
import type { GridTileInfo, TerminalConfig } from '@/types';
import { AgentPhaseDot } from '../TerminalStatusGlyph';
import { DEFAULT_AGENT_COLORS, type AgentColorKey } from '../agentColors';
import { GRID_TILE_INFO_OPTIONS, resolveGridTileInfo } from '../gridTileInfo';
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
  const tileInfo = resolveGridTileInfo(terminal);
  const toggleInfo = (value: GridTileInfo) => {
    const next = tileInfo.includes(value) ? tileInfo.filter((v) => v !== value) : [...tileInfo, value];
    patch({ gridTileInfo: GRID_TILE_INFO_OPTIONS.map((o) => o.value).filter((v) => next.includes(v)) });
  };

  return (
    <Section
      title="Agents"
      icon={Bot}
      action={<ResetCard card="agents" title="Agents" />}
      description="How CortX shows the agents (Claude Code, Codex) running in its terminals. It only watches what they write on their own — their session files and their output — and never sends them anything."
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
