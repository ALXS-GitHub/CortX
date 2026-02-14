import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, Save, Info, Download, Upload, Plus, Trash2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { AppSettings, TerminalPreset } from '@/types';

// Terminal preset labels and descriptions
const TERMINAL_PRESETS: {
  value: TerminalPreset;
  label: string;
  description: string;
  platforms: ('windows' | 'macos' | 'linux')[];
}[] = [
  {
    value: 'windowsterminal',
    label: 'Windows Terminal',
    description: 'Modern Windows terminal with tabs and profiles',
    platforms: ['windows'],
  },
  {
    value: 'powershell',
    label: 'PowerShell',
    description: 'Windows PowerShell terminal',
    platforms: ['windows'],
  },
  {
    value: 'cmd',
    label: 'Command Prompt',
    description: 'Classic Windows command prompt (cmd.exe)',
    platforms: ['windows'],
  },
  {
    value: 'warp',
    label: 'Warp',
    description: 'Modern terminal with AI features (opens in working directory)',
    platforms: ['windows', 'macos'],
  },
  {
    value: 'macterminal',
    label: 'Terminal.app',
    description: 'Default macOS terminal',
    platforms: ['macos'],
  },
  {
    value: 'iterm2',
    label: 'iTerm2',
    description: 'Popular macOS terminal replacement',
    platforms: ['macos'],
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'Specify your own terminal executable and arguments',
    platforms: ['windows', 'macos', 'linux'],
  },
];

// Detect current platform
const getPlatform = (): 'windows' | 'macos' | 'linux' => {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac')) return 'macos';
  return 'linux';
};

export function Settings() {
  const { settings, loadSettings, updateSettings, isLoadingSettings, exportScriptsConfig, importScriptsConfig } = useAppStore();
  const platform = getPlatform();

  const [terminalPreset, setTerminalPreset] = useState<TerminalPreset>('windowsterminal');
  const [customPath, setCustomPath] = useState('');
  const [customArgs, setCustomArgs] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [launchMethod, setLaunchMethod] = useState<'clipboard' | 'external' | 'integrated'>('integrated');
  const [commandTemplates, setCommandTemplates] = useState<Record<string, string>>({});
  const [newExtension, setNewExtension] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  // Filter presets for current platform
  const availablePresets = TERMINAL_PRESETS.filter((p) => p.platforms.includes(platform));

  useEffect(() => {
    if (!settings) loadSettings();
  }, [settings, loadSettings]);

  useEffect(() => {
    if (settings) {
      setTerminalPreset(settings.terminal.preset);
      setCustomPath(settings.terminal.customPath);
      setCustomArgs(settings.terminal.customArgs.join(' '));
      setTheme(settings.appearance.theme);
      setLaunchMethod(settings.defaults.launchMethod);
      setCommandTemplates(settings.scriptsConfig.commandTemplates ?? {});
      setHasChanges(false);
    }
  }, [settings]);

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
      if (selected && typeof selected === 'string') {
        setCustomPath(selected);
        setHasChanges(true);
      }
    } catch (e) {
      console.error('Failed to open file picker:', e);
    }
  };

  const handleExport = async () => {
    try {
      const json = await exportScriptsConfig();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cortx-scripts-export.json';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Scripts config exported');
    } catch (error) {
      toast.error(`Failed to export: ${error}`);
    }
  };

  const handleImport = async () => {
    try {
      const selected = await open({
        multiple: false,
        title: 'Import Scripts Config',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (selected && typeof selected === 'string') {
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        const json = await readTextFile(selected);
        const result = await importScriptsConfig(json);
        toast.success(`Imported: ${result.scriptsAdded} scripts, ${result.foldersAdded} folders, ${result.groupsAdded} groups`);
      }
    } catch (error) {
      toast.error(`Failed to import: ${error}`);
    }
  };

  const handleSave = async () => {
    if (!settings) return;

    const newSettings: AppSettings = {
      terminal: {
        preset: terminalPreset,
        customPath: customPath,
        customArgs: customArgs.split(' ').filter(Boolean),
      },
      appearance: {
        theme,
      },
      defaults: {
        launchMethod,
      },
      scriptsConfig: {
        ...settings.scriptsConfig,
        commandTemplates,
      },
    };

    try {
      await updateSettings(newSettings);
      setHasChanges(false);
      toast.success('Settings saved');

      // Apply theme
      applyTheme(theme);
    } catch (error) {
      toast.error(`Failed to save settings: ${error}`);
    }
  };

  const applyTheme = (theme: 'light' | 'dark' | 'system') => {
    const root = document.documentElement;
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }
  };

  if (isLoadingSettings || !settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    );
  }

  const selectedPresetInfo = TERMINAL_PRESETS.find((p) => p.value === terminalPreset);

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Configure your Cortx preferences
        </p>
      </div>

      {/* Terminal Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Terminal Configuration</CardTitle>
          <CardDescription>
            Configure the external terminal application to use when launching services
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="terminal-preset">Terminal Application</Label>
            <Select
              value={terminalPreset}
              onValueChange={(value: TerminalPreset) => {
                setTerminalPreset(value);
                setHasChanges(true);
              }}
            >
              <SelectTrigger id="terminal-preset">
                <SelectValue placeholder="Select terminal" />
              </SelectTrigger>
              <SelectContent>
                {availablePresets.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPresetInfo && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="size-3" />
                {selectedPresetInfo.description}
              </p>
            )}
          </div>

          {terminalPreset === 'custom' && (
            <>
              <Separator />

              <div className="grid gap-2">
                <Label htmlFor="custom-path">Custom Terminal Path</Label>
                <div className="flex gap-2">
                  <Input
                    id="custom-path"
                    value={customPath}
                    onChange={(e) => {
                      setCustomPath(e.target.value);
                      setHasChanges(true);
                    }}
                    placeholder={
                      platform === 'windows'
                        ? 'e.g., C:\\Program Files\\Terminal\\terminal.exe'
                        : '/usr/bin/terminal'
                    }
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={handleBrowseTerminal}>
                    <FolderOpen className="size-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Path to your terminal executable
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="custom-args">Custom Arguments</Label>
                <Input
                  id="custom-args"
                  value={customArgs}
                  onChange={(e) => {
                    setCustomArgs(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder="e.g., -e bash -c {full_command}"
                />
                <p className="text-xs text-muted-foreground">
                  Arguments passed to the terminal. Placeholders: <code className="bg-muted px-1 rounded">{'{dir}'}</code> (working directory), <code className="bg-muted px-1 rounded">{'{command}'}</code> (service command), <code className="bg-muted px-1 rounded">{'{full_command}'}</code> (cd + command)
                </p>
              </div>
            </>
          )}

          {terminalPreset === 'warp' && (
            <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              <p className="font-medium mb-1">Note about Warp:</p>
              <p>
                Warp will open in the service's working directory, but cannot automatically execute
                commands. You'll need to run the command manually or use the integrated terminal for
                automatic execution.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Customize the look and feel of the application
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="theme">Theme</Label>
            <Select
              value={theme}
              onValueChange={(value: 'light' | 'dark' | 'system') => {
                setTheme(value);
                setHasChanges(true);
              }}
            >
              <SelectTrigger id="theme">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Defaults */}
      <Card>
        <CardHeader>
          <CardTitle>Default Behavior</CardTitle>
          <CardDescription>
            Set default behaviors for launching services
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="launch-method">Default Launch Method</Label>
            <Select
              value={launchMethod}
              onValueChange={(value: 'clipboard' | 'external' | 'integrated') => {
                setLaunchMethod(value);
                setHasChanges(true);
              }}
            >
              <SelectTrigger id="launch-method">
                <SelectValue placeholder="Select launch method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="integrated">Integrated Terminal</SelectItem>
                <SelectItem value="external">External Terminal</SelectItem>
                <SelectItem value="clipboard">Copy to Clipboard</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The default method used when starting services
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Script Command Templates */}
      <Card>
        <CardHeader>
          <CardTitle>Script Command Templates</CardTitle>
          <CardDescription>
            Configure the default command used when importing scripts by file extension.
            Use <code className="bg-muted px-1 rounded text-xs">{'{{SCRIPT_FILE}}'}</code> as a placeholder for the script path.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(commandTemplates)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([ext, template]) => (
              <div key={ext} className="flex items-center gap-2">
                <div className="w-16 shrink-0">
                  <span className="text-sm font-mono text-muted-foreground">.{ext}</span>
                </div>
                <Input
                  value={template}
                  onChange={(e) => {
                    setCommandTemplates((prev) => ({ ...prev, [ext]: e.target.value }));
                    setHasChanges(true);
                  }}
                  className="flex-1 font-mono text-sm"
                  placeholder={`Command for .${ext} files`}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 size-8"
                  onClick={() => {
                    setCommandTemplates((prev) => {
                      const next = { ...prev };
                      delete next[ext];
                      return next;
                    });
                    setHasChanges(true);
                  }}
                >
                  <Trash2 className="size-3.5 text-muted-foreground" />
                </Button>
              </div>
            ))}

          <div className="flex items-center gap-2 pt-1">
            <div className="w-16 shrink-0">
              <Input
                value={newExtension}
                onChange={(e) => setNewExtension(e.target.value.replace(/^\./, '').replace(/\s/g, ''))}
                placeholder="ext"
                className="font-mono text-sm h-8"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!newExtension || newExtension in commandTemplates}
              onClick={() => {
                if (newExtension && !(newExtension in commandTemplates)) {
                  setCommandTemplates((prev) => ({ ...prev, [newExtension]: `{{SCRIPT_FILE}}` }));
                  setNewExtension('');
                  setHasChanges(true);
                }
              }}
            >
              <Plus className="size-3.5 mr-1" />
              Add Extension
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCommandTemplates({
                  py: 'python {{SCRIPT_FILE}}',
                  ps1: 'powershell -ExecutionPolicy Bypass -File {{SCRIPT_FILE}}',
                  bat: '{{SCRIPT_FILE}}',
                  cmd: '{{SCRIPT_FILE}}',
                  sh: 'bash {{SCRIPT_FILE}}',
                  bash: 'bash {{SCRIPT_FILE}}',
                  js: 'node {{SCRIPT_FILE}}',
                  ts: 'npx tsx {{SCRIPT_FILE}}',
                  rb: 'ruby {{SCRIPT_FILE}}',
                  pl: 'perl {{SCRIPT_FILE}}',
                });
                setHasChanges(true);
              }}
            >
              <RotateCcw className="size-3.5 mr-1" />
              Reset Defaults
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!hasChanges}>
          <Save className="size-4 mr-2" />
          Save Settings
        </Button>
      </div>

      <Separator />

      {/* Import / Export */}
      <Card>
        <CardHeader>
          <CardTitle>Import / Export</CardTitle>
          <CardDescription>
            Export or import your global scripts, folders, and groups configuration
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExport}>
              <Download className="size-4 mr-2" />
              Export
            </Button>
            <Button variant="outline" onClick={handleImport}>
              <Upload className="size-4 mr-2" />
              Import
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
