/**
 * Agents (agent mode): what "New agent" runs, the GUI agent view, the agent
 * prompt, the grid and the dot colours. Store-backed like the other terminal
 * pages — mounted in the Settings screen (under the agent sources) and in the
 * Terminal window's panel. The agent *notifications* moved to the
 * Notifications page (ticket #64), so every notification lives in one place.
 *
 * Everything here is observation and presentation: CortX reads what the
 * agents write on their own (their live registry, their transcripts, the
 * terminal's output) and never sends them anything — except, for "New agent",
 * the command you chose, typed as you would type it.
 */
import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ColorField } from '@/components/ui/ColorField';
import { Segmented } from '@/components/ui/Segmented';
import { CONTROL_WIDTH, Code, SectionNote } from '@/components/settings/SettingsPrimitives';
import { cn } from '@/lib/utils';
import type {
  AgentPermissionMode,
  AgentViewBackground,
  AgentViewFont,
  AgentViewLineHeight,
  AgentViewWidth,
  GridTileInfo,
  TerminalConfig,
} from '@/types';
import { AgentPhaseDot } from '../TerminalStatusGlyph';
import { DEFAULT_AGENT_COLORS, type AgentColorKey } from '../agentColors';
import {
  GRID_TILE_INFO_OPTIONS,
  GRID_TILE_TEXT_SCALE_OPTIONS,
  resolveGridTileInfo,
  resolveGridTileTextScale,
} from '../gridTileInfo';
import type { AgentPhase } from '../agentPhase';
import { Group, SelectField, SettingField, SliderField, SwitchField } from './controls';
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
  { key: 'done', field: 'agentColorDone', phase: 'done', label: 'Done, not seen', hint: 'Solid once its turn ended, until you look at it.' },
  { key: 'idle', field: 'agentColorIdle', phase: 'idle', label: 'Idle', hint: 'A ring: finished, seen, waiting for your next prompt.' },
];

/** Disables a `Segmented`, which has no `disabled` of its own. */
function Dimmed({ off, children }: { off: boolean; children: ReactNode }) {
  return (
    <div className={cn(off && 'pointer-events-none opacity-50')} aria-disabled={off || undefined}>
      {children}
    </div>
  );
}

export function AgentSettingsSection() {
  const { terminal, patch } = useTerminalSettings();
  const off = !terminal;
  const tileInfo = resolveGridTileInfo(terminal);
  const keepSize = terminal?.gridTilesKeepSize ?? true;
  const promptBar = terminal?.agentPromptBar ?? true;
  const toggleInfo = (value: GridTileInfo, on: boolean) => {
    const next = on ? [...tileInfo, value] : tileInfo.filter((v) => v !== value);
    patch({ gridTileInfo: GRID_TILE_INFO_OPTIONS.map((o) => o.value).filter((v) => next.includes(v)) });
  };

  return (
    <>
      <Group group="agentNew">
        <SettingField k="agentDefaultMode" label="Opens in" hint="The mode of a pane opened by New agent.">
          <Dimmed off={off}>
            <Segmented<'tui' | 'gui'>
              size="sm"
              value={terminal?.agentDefaultMode ?? 'tui'}
              onChange={(v) => patch({ agentDefaultMode: v })}
              options={[
                { value: 'tui', label: 'Terminal (TUI)' },
                { value: 'gui', label: 'GUI' },
              ]}
            />
          </Dimmed>
        </SettingField>
        <SettingField
          k="agentLaunchCommand"
          label="TUI mode runs"
          htmlFor="agent-launch-command"
          hint={
            <>
              Typed in a new terminal, then Enter. Any command or alias: <Code>claude</Code>, <Code>cc</Code>,{' '}
              <Code>codex</Code>…
            </>
          }
        >
          <Input
            id="agent-launch-command"
            className={CONTROL_WIDTH}
            value={terminal?.agentLaunchCommand ?? 'claude'}
            onChange={(e) => patch({ agentLaunchCommand: e.target.value })}
            placeholder="claude"
            disabled={off}
          />
        </SettingField>
        <SettingField
          k="agentGuiCommand"
          label="GUI mode runs"
          htmlFor="agent-gui-command"
          hint={
            <>
              CortX adds the stream-json flags (and <Code>--resume</Code>). Not run by your shell: use{' '}
              <Code>claude</Code>, or an alias shim such as <Code>cc</Code> (Shell &amp; aliases).
            </>
          }
        >
          <Input
            id="agent-gui-command"
            className={CONTROL_WIDTH}
            value={terminal?.agentGuiCommand ?? 'claude'}
            onChange={(e) => patch({ agentGuiCommand: e.target.value })}
            placeholder="claude"
            disabled={off}
          />
        </SettingField>
        <SelectField<AgentPermissionMode | 'command'>
          k="agentGuiPermissionMode"
          id="agent-gui-permission-mode"
          label="GUI agents start in"
          hint="“As the command says” passes nothing, so a shim carrying --dangerously-skip-permissions keeps it. One session can change it from the view's options."
          value={terminal?.agentGuiPermissionMode ?? 'command'}
          options={[
            { value: 'command', label: 'As the command says' },
            { value: 'default', label: 'Ask' },
            { value: 'acceptEdits', label: 'Accept edits' },
            { value: 'plan', label: 'Plan' },
            { value: 'bypassPermissions', label: 'Bypass permissions' },
          ]}
          onChange={(v) => patch({ agentGuiPermissionMode: v === 'command' ? undefined : v })}
          disabled={off}
        />
      </Group>

      <Group group="agentView">
        <SettingField k="agentViewBackground" label="Background" hint="The terminal's (theme colour, wallpaper, opacity) or the app's.">
          <Dimmed off={off}>
            <Segmented<AgentViewBackground>
              size="sm"
              value={terminal?.agentViewBackground ?? 'terminal'}
              onChange={(v) => patch({ agentViewBackground: v })}
              options={[
                { value: 'terminal', label: 'Terminal' },
                { value: 'app', label: 'App' },
              ]}
            />
          </Dimmed>
        </SettingField>
        <SettingField k="agentViewFont" label="Font" hint="The interface font, or the terminal's.">
          <Dimmed off={off}>
            <Segmented<AgentViewFont>
              size="sm"
              value={terminal?.agentViewFont ?? 'interface'}
              onChange={(v) => patch({ agentViewFont: v })}
              options={[
                { value: 'interface', label: 'Interface' },
                { value: 'terminal', label: 'Terminal' },
              ]}
            />
          </Dimmed>
        </SettingField>
        <SelectField<string>
          k="agentViewTextSize"
          id="agent-view-text-size"
          label="Text size"
          hint="Size of the messages."
          value={String(terminal?.agentViewTextSize ?? 14)}
          options={[12, 13, 14, 15, 16, 18].map((n) => ({ value: String(n), label: `${n} px${n === 14 ? ' (default)' : ''}` }))}
          onChange={(v) => patch({ agentViewTextSize: Number(v) })}
          disabled={off}
        />
        <SettingField k="agentViewWidth" label="Width" hint="How wide the conversation runs in the pane.">
          <Dimmed off={off}>
            <Segmented<AgentViewWidth>
              size="sm"
              value={terminal?.agentViewWidth ?? 'wide'}
              onChange={(v) => patch({ agentViewWidth: v })}
              options={[
                { value: 'narrow', label: 'Narrow' },
                { value: 'wide', label: 'Wide' },
                { value: 'full', label: 'Full' },
              ]}
            />
          </Dimmed>
        </SettingField>
        <SettingField k="agentViewLineHeight" label="Line spacing">
          <Dimmed off={off}>
            <Segmented<AgentViewLineHeight>
              size="sm"
              value={terminal?.agentViewLineHeight ?? 'normal'}
              onChange={(v) => patch({ agentViewLineHeight: v })}
              options={[
                { value: 'compact', label: 'Compact' },
                { value: 'normal', label: 'Normal' },
                { value: 'relaxed', label: 'Relaxed' },
              ]}
            />
          </Dimmed>
        </SettingField>
        <SectionNote>
          Switch a pane between the TUI and the GUI with its button or Ctrl+Shift+M. Zoom one conversation with Ctrl + =
          / − / 0 or Ctrl + wheel.
        </SectionNote>
      </Group>

      <Group group="agentPrompt">
        <SwitchField
          k="agentPromptBar"
          id="agent-prompt-bar"
          label="Agent prompt (Ctrl+G)"
          hint="An editor over the agent's last rows: write your prompt there, paste or drop images and files, and it goes to the agent as if typed."
          checked={promptBar}
          onChange={(v) => patch({ agentPromptBar: v })}
          disabled={off}
        />
        <SwitchField
          k="agentStatusBar"
          id="agent-status-bar"
          label="Status bar under the terminal"
          hint="Which agent, what it is doing, a draft waiting to be sent. Click it to open the agent prompt."
          checked={terminal?.agentStatusBar ?? true}
          onChange={(v) => patch({ agentStatusBar: v })}
          disabled={off || !promptBar}
          indent
        />
        <SettingField k="agentPromptColor" label="Bubble colour" hint="Empty = the theme's." indent disabled={!promptBar}>
          <ColorField
            value={terminal?.agentPromptColor ?? ''}
            onChange={(hex) => patch({ agentPromptColor: hex || undefined })}
            clearable
            placeholder="Theme"
            disabled={off || !promptBar}
            aria-label="Agent prompt bubble colour"
            className={CONTROL_WIDTH}
          />
        </SettingField>
        <SliderField
          k="agentPromptOpacity"
          id="agent-prompt-opacity"
          label="Bubble opacity"
          hint="How much of the terminal shows through."
          value={terminal?.agentPromptOpacity ?? 95}
          min={20}
          max={100}
          unit="%"
          onChange={(v) => patch({ agentPromptOpacity: v })}
          disabled={off || !promptBar}
        />
      </Group>

      <Group group="grid">
        <SwitchField
          k="agentModeHidesTabs"
          id="agent-mode-hides-tabs"
          label="Hide the rail in agent mode"
          hint="The sessions rail (or the tab strip) disappears entirely and the grid takes the whole window."
          checked={terminal?.agentModeHidesTabs ?? false}
          onChange={(v) => patch({ agentModeHidesTabs: v })}
          disabled={off}
        />
        <SwitchField
          k="gridTilesInteractive"
          id="grid-tiles-interactive"
          label="Type into grid tiles"
          hint="Each tile is a working terminal; click its header to open it full size. Off, the tiles are only watched and a click opens one."
          checked={terminal?.gridTilesInteractive ?? true}
          onChange={(v) => patch({ gridTilesInteractive: v })}
          disabled={off}
        />
        <SwitchField
          k="gridTilesKeepSize"
          id="grid-tiles-keep-size"
          label="Tiles keep the session's size"
          hint="A tile shows its session at full size, scaled down, so the grid never resizes it. Off, each session is resized to its tile, and Claude Code keeps what it drew narrow."
          checked={keepSize}
          onChange={(v) => patch({ gridTilesKeepSize: v })}
          disabled={off}
        />
        <SelectField<string>
          k="gridTileTextScale"
          id="grid-tile-text-scale"
          label="Tile text size"
          hint="At a readable size a tile shows the part of the page around the cursor. Whole page = everything, however small."
          value={String(resolveGridTileTextScale(terminal))}
          options={GRID_TILE_TEXT_SCALE_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
          onChange={(v) => patch({ gridTileTextScale: Number(v) })}
          disabled={off || !keepSize}
          indent
        />
        <SettingField k="gridTileInfo" label="A tile's header shows" hint="Besides its name and its dot. Also in the grid's View menu." wide>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {GRID_TILE_INFO_OPTIONS.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm" htmlFor={`grid-tile-info-${o.value}`}>
                <Checkbox
                  id={`grid-tile-info-${o.value}`}
                  checked={tileInfo.includes(o.value)}
                  onCheckedChange={(v) => toggleInfo(o.value, v === true)}
                  disabled={off}
                />
                {o.label}
              </label>
            ))}
          </div>
        </SettingField>
      </Group>

      <Group group="agentColors">
        {COLORS.map((c) => (
          <SettingField key={c.key} k={c.field} label={c.label} hint={c.hint}>
            <AgentPhaseDot phase={c.phase} size={9} />
            <ColorField
              value={terminal?.[c.field] ?? ''}
              onChange={(hex) => patch({ [c.field]: hex || undefined } as Partial<TerminalConfig>)}
              clearable
              placeholder={DEFAULT_AGENT_COLORS[c.key]}
              swatches={Object.values(DEFAULT_AGENT_COLORS)}
              disabled={off}
              aria-label={`${c.label} colour`}
              className={CONTROL_WIDTH}
            />
          </SettingField>
        ))}
      </Group>
    </>
  );
}
