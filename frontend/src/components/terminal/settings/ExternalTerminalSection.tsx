/**
 * Terminal › External terminal: which program a "launch outside the app"
 * opens. Store-backed, so the Terminal window's settings panel shows the same
 * card.
 */
import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Code, SectionNote } from '@/components/settings/SettingsPrimitives';
import { Group, SelectField, SettingField } from './controls';
import { TERMINAL_PRESETS, getPlatform } from './meta';
import { useTerminalSettings } from './useTerminalSettings';
import type { TerminalPreset } from '@/types';

export function ExternalTerminalSection() {
  const { terminal, patch } = useTerminalSettings();
  const platform = getPlatform();
  const availablePresets = TERMINAL_PRESETS.filter((p) => p.platforms.includes(platform));

  // Same default as `TerminalPreset::default()` on the Rust side (ticket #39).
  const preset = terminal?.preset ?? 'cortxterminal';
  const customPath = terminal?.customPath ?? '';
  const customArgs = (terminal?.customArgs ?? []).join(' ');
  const selectedPresetInfo = TERMINAL_PRESETS.find((p) => p.value === preset);

  // The arguments are stored as a list but typed as one line: while the field
  // has the focus it shows the raw text, so the spaces being typed survive.
  const [argsText, setArgsText] = useState('');
  const [argsFocused, setArgsFocused] = useState(false);

  const handleBrowseTerminal = async () => {
    try {
      const selected = await open({
        multiple: false,
        title: 'Select the terminal executable',
        filters: [{ name: 'Executables', extensions: platform === 'windows' ? ['exe'] : ['app', ''] }],
      });
      if (selected && typeof selected === 'string') patch({ customPath: selected });
    } catch (e) {
      console.error('Failed to open file picker:', e);
    }
  };

  return (
    <Group group="external">
      <SelectField<TerminalPreset>
        k="preset"
        id="terminal-preset"
        label="Terminal application"
        hint={selectedPresetInfo?.description}
        value={preset}
        options={availablePresets.map((p) => ({ value: p.value, label: p.label }))}
        onChange={(v) => patch({ preset: v })}
        disabled={!terminal}
      />

      {preset === 'custom' && (
        <>
          <SettingField k="customPath" label="Custom terminal path" htmlFor="custom-path" hint="Path to the terminal executable." wide indent>
            <div className="flex gap-2">
              <Input
                id="custom-path"
                value={customPath}
                onChange={(e) => patch({ customPath: e.target.value })}
                placeholder={platform === 'windows' ? 'C:\\Program Files\\Terminal\\terminal.exe' : '/usr/bin/terminal'}
                className="flex-1"
              />
              <Button variant="outline" size="icon" onClick={handleBrowseTerminal} aria-label="Browse">
                <FolderOpen />
              </Button>
            </div>
          </SettingField>
          <SettingField
            k="customArgs"
            label="Custom arguments"
            htmlFor="custom-args"
            wide
            indent
            hint={
              <>
                Placeholders: <Code>{'{dir}'}</Code> (working directory), <Code>{'{command}'}</Code> (the service
                command), <Code>{'{full_command}'}</Code> (cd + command).
              </>
            }
          >
            <Input
              id="custom-args"
              value={argsFocused ? argsText : customArgs}
              onFocus={() => {
                setArgsText(customArgs);
                setArgsFocused(true);
              }}
              onBlur={() => setArgsFocused(false)}
              onChange={(e) => {
                setArgsText(e.target.value);
                patch({ customArgs: e.target.value.split(' ').filter(Boolean) });
              }}
              placeholder="-e bash -c {full_command}"
            />
          </SettingField>
        </>
      )}

      {preset === 'warp' && (
        <SectionNote>
          Warp opens in the service&apos;s working directory but cannot run the command by itself: run it there by hand,
          or use the integrated terminal.
        </SectionNote>
      )}
    </Group>
  );
}
