/**
 * External terminal application: which program a "launch outside the app"
 * opens. Extracted from `views/Settings.tsx` (DEV-13 #8) so the Terminal
 * window's settings panel shows the same card, backed by the same store.
 */
import { useState } from 'react';
import { FolderOpen, Info, TerminalSquare } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Code, Field, Section } from '@/components/settings/SettingsPrimitives';
import { TERMINAL_PRESETS, getPlatform } from './meta';
import { useTerminalSettings } from './useTerminalSettings';
import type { TerminalPreset } from '@/types';

export function ExternalTerminalSection() {
  const { terminal, patch } = useTerminalSettings();
  const platform = getPlatform();
  const availablePresets = TERMINAL_PRESETS.filter((p) => p.platforms.includes(platform));

  // Same default as `TerminalPreset::default()` on the Rust side (ticket
  // #39). `windowsterminal` used to be hard-coded here, which showed a preset
  // the platform list does not contain — so an empty select — on macOS and
  // Linux.
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
        title: 'Select Terminal Executable',
        filters: [
          {
            name: 'Executables',
            extensions: platform === 'windows' ? ['exe'] : ['app', ''],
          },
        ],
      });
      if (selected && typeof selected === 'string') patch({ customPath: selected });
    } catch (e) {
      console.error('Failed to open file picker:', e);
    }
  };

  return (
    <Section
      title="External terminal"
      icon={TerminalSquare}
      description="Which program a service opens in when it is launched outside CortX. Everything else on this page is about the terminal CortX runs itself."
    >
      <Field
        label="Terminal application"
        htmlFor="terminal-preset"
        hint={
          selectedPresetInfo && (
            <span className="inline-flex items-center gap-1">
              <Info className="size-3" />
              {selectedPresetInfo.description}
            </span>
          )
        }
      >
        <Select value={preset} onValueChange={(value: TerminalPreset) => patch({ preset: value })} disabled={!terminal}>
          <SelectTrigger id="terminal-preset">
            <SelectValue placeholder="Select terminal" />
          </SelectTrigger>
          <SelectContent>
            {availablePresets.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {preset === 'custom' && (
        <>
          <Separator />

          <Field label="Custom terminal path" htmlFor="custom-path" hint="Path to your terminal executable">
            <div className="flex gap-2">
              <Input
                id="custom-path"
                value={customPath}
                onChange={(e) => patch({ customPath: e.target.value })}
                placeholder={
                  platform === 'windows' ? 'e.g., C:\\Program Files\\Terminal\\terminal.exe' : '/usr/bin/terminal'
                }
                className="flex-1 font-mono text-[12px]"
              />
              <Button variant="outline" size="icon" onClick={handleBrowseTerminal} aria-label="Browse">
                <FolderOpen />
              </Button>
            </div>
          </Field>

          <Field
            label="Custom arguments"
            htmlFor="custom-args"
            hint={
              <>
                Arguments passed to the terminal. Placeholders: <Code>{'{dir}'}</Code> (working directory),{' '}
                <Code>{'{command}'}</Code> (service command), <Code>{'{full_command}'}</Code> (cd + command)
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
              placeholder="e.g., -e bash -c {full_command}"
              className="font-mono text-[12px]"
            />
          </Field>
        </>
      )}

      {preset === 'warp' && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Note about Warp</p>
          <p>
            Warp will open in the service's working directory, but cannot automatically execute commands. You'll need to
            run the command manually or use the integrated terminal for automatic execution.
          </p>
        </div>
      )}
    </Section>
  );
}
