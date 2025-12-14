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
import { FolderOpen, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { AppSettings } from '@/types';

export function Settings() {
  const { settings, loadSettings, updateSettings, isLoadingSettings } = useAppStore();

  const [terminalPath, setTerminalPath] = useState('');
  const [terminalArgs, setTerminalArgs] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [launchMethod, setLaunchMethod] = useState<'clipboard' | 'external' | 'integrated'>('integrated');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (!settings) {
      loadSettings();
    }
  }, [settings, loadSettings]);

  useEffect(() => {
    if (settings) {
      setTerminalPath(settings.terminal.executablePath);
      setTerminalArgs(settings.terminal.arguments.join(' '));
      setTheme(settings.appearance.theme);
      setLaunchMethod(settings.defaults.launchMethod);
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
            extensions: ['exe', 'app', ''],
          },
        ],
      });
      if (selected && typeof selected === 'string') {
        setTerminalPath(selected);
        setHasChanges(true);
      }
    } catch (e) {
      console.error('Failed to open file picker:', e);
    }
  };

  const handleSave = async () => {
    if (!settings) return;

    const newSettings: AppSettings = {
      terminal: {
        executablePath: terminalPath,
        arguments: terminalArgs.split(' ').filter(Boolean),
      },
      appearance: {
        theme,
      },
      defaults: {
        launchMethod,
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

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Configure your Local App Launcher preferences
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
            <Label htmlFor="terminal-path">Terminal Executable</Label>
            <div className="flex gap-2">
              <Input
                id="terminal-path"
                value={terminalPath}
                onChange={(e) => {
                  setTerminalPath(e.target.value);
                  setHasChanges(true);
                }}
                placeholder="e.g., C:\Windows\System32\cmd.exe"
                className="flex-1"
              />
              <Button variant="outline" onClick={handleBrowseTerminal}>
                <FolderOpen className="size-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Path to your preferred terminal application
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="terminal-args">Terminal Arguments</Label>
            <Input
              id="terminal-args"
              value={terminalArgs}
              onChange={(e) => {
                setTerminalArgs(e.target.value);
                setHasChanges(true);
              }}
              placeholder="e.g., -NoExit -Command"
            />
            <p className="text-xs text-muted-foreground">
              Arguments passed to the terminal before the command (space-separated)
            </p>
          </div>

          <Separator />

          <div className="text-sm text-muted-foreground">
            <p className="font-medium mb-2">Common configurations:</p>
            <ul className="space-y-1 ml-4 list-disc">
              <li>PowerShell: <code className="bg-muted px-1 rounded">-NoExit -Command</code></li>
              <li>Windows Terminal: <code className="bg-muted px-1 rounded">-d . cmd /k</code></li>
              <li>cmd.exe: <code className="bg-muted px-1 rounded">/k</code></li>
            </ul>
          </div>
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

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!hasChanges}>
          <Save className="size-4 mr-2" />
          Save Settings
        </Button>
      </div>
    </div>
  );
}
