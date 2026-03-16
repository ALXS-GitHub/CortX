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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { FolderOpen, Save, Info, Download, Upload, Plus, Trash2, RotateCcw, Tags, Copy, Check, TerminalSquare, ChevronDown, ChevronUp, CircleDot, GitBranch } from 'lucide-react';
import { toast } from 'sonner';
import { TagDefinitionManager } from '@/components/global-scripts/TagDefinitionManager';
import { StatusDefinitionManager } from '@/components/settings/StatusDefinitionManager';
import { generateShellInit } from '@/lib/tauri';
import type { AppSettings, TerminalPreset, ExportSummary, ImportOptions } from '@/types';

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
  const { settings, loadSettings, updateSettings, isLoadingSettings, exportScriptsConfig, previewImport, importScriptsConfig, backupToGit } = useAppStore();
  const platform = getPlatform();

  const [showTagManager, setShowTagManager] = useState(false);
  const [showStatusManager, setShowStatusManager] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importJson, setImportJson] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ExportSummary | null>(null);
  const [importOptions, setImportOptions] = useState<ImportOptions>({
    projects: true,
    scripts: true,
    tools: true,
    apps: true,
    shellConfig: true,
    tagsAndStatuses: true,
    settings: true,
  });
  const [isImporting, setIsImporting] = useState(false);
  const [terminalPreset, setTerminalPreset] = useState<TerminalPreset>('windowsterminal');
  const [customPath, setCustomPath] = useState('');
  const [customArgs, setCustomArgs] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [launchMethod, setLaunchMethod] = useState<'clipboard' | 'external' | 'integrated'>('integrated');
  const [toolboxBaseUrl, setToolboxBaseUrl] = useState('');
  const [backupRepoPath, setBackupRepoPath] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);
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
      setToolboxBaseUrl(settings.toolboxBaseUrl ?? '');
      setBackupRepoPath(settings.backupRepoPath ?? '');
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
      a.download = 'cortx-export.json';
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
        title: 'Import CortX Config',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (selected && typeof selected === 'string') {
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        const json = await readTextFile(selected);
        const summary = await previewImport(json);
        setImportJson(json);
        setImportSummary(summary);
        setImportOptions({
          projects: summary.projectsCount > 0,
          scripts: summary.scriptsCount > 0 || summary.groupsCount > 0,
          tools: summary.toolsCount > 0,
          apps: summary.appsCount > 0,
          shellConfig: summary.aliasesCount > 0,
          tagsAndStatuses: summary.tagDefinitionsCount > 0 || summary.statusDefinitionsCount > 0,
          settings: summary.hasSettings,
        });
        setImportDialogOpen(true);
      }
    } catch (error) {
      toast.error(`Failed to read import file: ${error}`);
    }
  };

  const handleConfirmImport = async () => {
    if (!importJson) return;
    setIsImporting(true);
    try {
      const result = await importScriptsConfig(importJson, importOptions);
      const parts: string[] = [];
      if (result.projectsAdded > 0) parts.push(`${result.projectsAdded} projects`);
      if (result.scriptsAdded > 0) parts.push(`${result.scriptsAdded} scripts`);
      if (result.groupsAdded > 0) parts.push(`${result.groupsAdded} groups`);
      if (result.toolsAdded > 0) parts.push(`${result.toolsAdded} tools`);
      if (result.appsAdded > 0) parts.push(`${result.appsAdded} apps`);
      if (result.aliasesAdded > 0) parts.push(`${result.aliasesAdded} shell config`);
      if (result.tagDefinitionsAdded > 0) parts.push(`${result.tagDefinitionsAdded} tags`);
      if (result.statusDefinitionsAdded > 0) parts.push(`${result.statusDefinitionsAdded} statuses`);
      if (result.settingsImported) parts.push('settings');
      toast.success(parts.length > 0 ? `Imported: ${parts.join(', ')}` : 'Nothing new to import (all items already exist)');
      setImportDialogOpen(false);
      setImportJson(null);
      setImportSummary(null);
      // Reload settings in case they were imported
      if (result.settingsImported) loadSettings();
    } catch (error) {
      toast.error(`Failed to import: ${error}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleBackup = async () => {
    setIsBackingUp(true);
    try {
      const message = await backupToGit();
      toast.success(message);
    } catch (error) {
      toast.error(`Backup failed: ${error}`);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleBrowseBackupRepo = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Backup Git Repository',
      });
      if (selected && typeof selected === 'string') {
        setBackupRepoPath(selected);
        setHasChanges(true);
      }
    } catch (e) {
      console.error('Failed to open folder picker:', e);
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
      toolboxBaseUrl,
      backupRepoPath: backupRepoPath || undefined,
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
    <>
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

      {/* Tags */}
      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
          <CardDescription>
            Manage tag definitions shared across scripts, tools, and projects. Tags can have custom colors and display order.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setShowTagManager(true)}>
            <Tags className="size-4 mr-2" />
            Manage Tags
          </Button>
        </CardContent>
      </Card>

      {/* Statuses */}
      <Card>
        <CardHeader>
          <CardTitle>Statuses</CardTitle>
          <CardDescription>
            Manage status definitions shared across tools, scripts, projects, apps, and aliases. Statuses can have custom colors and display order.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setShowStatusManager(true)}>
            <CircleDot className="size-4 mr-2" />
            Manage Statuses
          </Button>
        </CardContent>
      </Card>

      {/* Shell Aliases Init */}
      <ShellSetupCard />

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

      {/* Toolbox Base URL */}
      <Card>
        <CardHeader>
          <CardTitle>Toolbox Documentation</CardTitle>
          <CardDescription>
            Set a base URL for your toolbox documentation site. When a tool's toolbox URL starts with "/", it will be appended to this base URL.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="toolbox-base-url">Base URL</Label>
            <Input
              id="toolbox-base-url"
              value={toolboxBaseUrl}
              onChange={(e) => {
                setToolboxBaseUrl(e.target.value);
                setHasChanges(true);
              }}
              placeholder="e.g., https://docs.example.com"
            />
            <p className="text-xs text-muted-foreground">
              Tool URLs starting with "/" will be resolved relative to this base URL. Full URLs (https://...) are used as-is.
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

      <Separator />

      {/* Data Management: Import / Export / Git Backup */}
      <Card>
        <CardHeader>
          <CardTitle>Data Management</CardTitle>
          <CardDescription>
            Export, import, or back up your full CortX configuration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Import / Export */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Import / Export</Label>
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
          </div>

          <Separator />

          {/* Git Backup */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <GitBranch className="size-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Git Backup</Label>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="backup-repo-path" className="text-xs text-muted-foreground">Repository Path</Label>
              <div className="flex gap-2">
                <Input
                  id="backup-repo-path"
                  value={backupRepoPath}
                  onChange={(e) => {
                    setBackupRepoPath(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder="Path to a local git repo"
                  className="flex-1"
                />
                <Button variant="outline" onClick={handleBrowseBackupRepo}>
                  <FolderOpen className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Must be an existing git repo with a remote configured. Save settings before backing up.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleBackup}
              disabled={isBackingUp || !settings?.backupRepoPath}
            >
              <Upload className="size-4 mr-2" />
              {isBackingUp ? 'Backing up...' : 'Backup Now'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tag Definition Manager Dialog */}
      <TagDefinitionManager
        open={showTagManager}
        onOpenChange={setShowTagManager}
      />

      {/* Status Definition Manager Dialog */}
      <StatusDefinitionManager
        open={showStatusManager}
        onOpenChange={setShowStatusManager}
      />

      {/* Import Preview Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={(open) => {
        if (!isImporting) {
          setImportDialogOpen(open);
          if (!open) { setImportJson(null); setImportSummary(null); }
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import CortX Config</DialogTitle>
            {importSummary && (
              <DialogDescription>
                Version {importSummary.version} &middot; Exported {new Date(importSummary.exportedAt).toLocaleDateString()}
              </DialogDescription>
            )}
          </DialogHeader>
          {importSummary && (
            <div className="space-y-3 py-2">
              <ImportCheckboxRow
                id="projects"
                label="Projects"
                count={importSummary.projectsCount}
                checked={importOptions.projects}
                disabled={importSummary.projectsCount === 0}
                onCheckedChange={(v) => setImportOptions((o) => ({ ...o, projects: !!v }))}
              />
              <ImportCheckboxRow
                id="scripts"
                label="Scripts"
                count={importSummary.scriptsCount}
                extra={importSummary.groupsCount > 0 ? `${importSummary.groupsCount} groups` : undefined}
                checked={importOptions.scripts}
                disabled={importSummary.scriptsCount === 0 && importSummary.groupsCount === 0}
                onCheckedChange={(v) => setImportOptions((o) => ({ ...o, scripts: !!v }))}
              />
              <ImportCheckboxRow
                id="tools"
                label="Tools"
                count={importSummary.toolsCount}
                checked={importOptions.tools}
                disabled={importSummary.toolsCount === 0}
                onCheckedChange={(v) => setImportOptions((o) => ({ ...o, tools: !!v }))}
              />
              <ImportCheckboxRow
                id="apps"
                label="Apps"
                count={importSummary.appsCount}
                checked={importOptions.apps}
                disabled={importSummary.appsCount === 0}
                onCheckedChange={(v) => setImportOptions((o) => ({ ...o, apps: !!v }))}
              />
              <ImportCheckboxRow
                id="shellConfig"
                label="Shell Config"
                count={importSummary.aliasesCount}
                checked={importOptions.shellConfig}
                disabled={importSummary.aliasesCount === 0}
                onCheckedChange={(v) => setImportOptions((o) => ({ ...o, shellConfig: !!v }))}
              />
              <ImportCheckboxRow
                id="tagsAndStatuses"
                label="Tags & Statuses"
                count={importSummary.tagDefinitionsCount}
                extra={importSummary.statusDefinitionsCount > 0 ? `${importSummary.statusDefinitionsCount} statuses` : undefined}
                checked={importOptions.tagsAndStatuses}
                disabled={importSummary.tagDefinitionsCount === 0 && importSummary.statusDefinitionsCount === 0}
                onCheckedChange={(v) => setImportOptions((o) => ({ ...o, tagsAndStatuses: !!v }))}
              />
              <ImportCheckboxRow
                id="settings"
                label="Settings"
                subtitle="replaces current"
                checked={importOptions.settings}
                disabled={!importSummary.hasSettings}
                onCheckedChange={(v) => setImportOptions((o) => ({ ...o, settings: !!v }))}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportDialogOpen(false); setImportJson(null); setImportSummary(null); }} disabled={isImporting}>
              Cancel
            </Button>
            <Button onClick={handleConfirmImport} disabled={isImporting || !Object.values(importOptions).some(Boolean)}>
              {isImporting ? 'Importing...' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

    {/* Save Bar — sticky at bottom of scroll container (MainContent) */}
    <div className="sticky bottom-4 z-10 px-6">
      <div className="max-w-2xl">
        <div className="rounded-lg border bg-background/95 backdrop-blur shadow-lg px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {hasChanges ? 'You have unsaved changes' : 'Settings saved'}
          </p>
          <Button onClick={handleSave} disabled={!hasChanges} size="sm">
            <Save className="size-4 mr-2" />
            Save Settings
          </Button>
        </div>
      </div>
    </div>
    </>
  );
}

// ============================================================================
// Shell Setup Card (cortx init)
// ============================================================================

const SHELL_INIT_LINES: { shell: string; label: string; profileLine: string; profileFile: string }[] = [
  {
    shell: 'powershell',
    label: 'PowerShell',
    profileLine: 'cortx init powershell | Out-String | Invoke-Expression',
    profileFile: '$PROFILE',
  },
  {
    shell: 'bash',
    label: 'Bash',
    profileLine: 'eval "$(cortx init bash)"',
    profileFile: '~/.bashrc',
  },
  {
    shell: 'zsh',
    label: 'Zsh',
    profileLine: 'eval "$(cortx init zsh)"',
    profileFile: '~/.zshrc',
  },
  {
    shell: 'fish',
    label: 'Fish',
    profileLine: 'cortx init fish | source',
    profileFile: '~/.config/fish/config.fish',
  },
];

function ShellSetupCard() {
  const { aliases } = useAppStore();
  const [selectedShell, setSelectedShell] = useState('powershell');
  const [copiedLine, setCopiedLine] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewOutput, setPreviewOutput] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const selected = SHELL_INIT_LINES.find((s) => s.shell === selectedShell) ?? SHELL_INIT_LINES[0];

  const handleCopyLine = async () => {
    try {
      await navigator.clipboard.writeText(selected.profileLine);
      setCopiedLine(true);
      setTimeout(() => setCopiedLine(false), 2000);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleTogglePreview = async () => {
    if (showPreview) {
      setShowPreview(false);
      return;
    }
    setIsGenerating(true);
    try {
      const output = await generateShellInit(selectedShell);
      setPreviewOutput(output);
      setShowPreview(true);
    } catch (e) {
      toast.error('Failed to generate preview', { description: String(e) });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TerminalSquare className="size-5 text-muted-foreground" />
          <div>
            <CardTitle>Shell Aliases Setup</CardTitle>
            <CardDescription>
              Add this line to your shell profile to enable all CortX aliases ({aliases.length} alias{aliases.length !== 1 ? 'es' : ''})
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Shell selector */}
        <div className="flex gap-1">
          {SHELL_INIT_LINES.map((s) => (
            <Button
              key={s.shell}
              variant={selectedShell === s.shell ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setSelectedShell(s.shell);
                setShowPreview(false);
                setPreviewOutput(null);
              }}
            >
              {s.label}
            </Button>
          ))}
        </div>

        {/* Profile line to copy */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Add to <code className="bg-muted px-1 rounded">{selected.profileFile}</code>
          </Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-muted px-3 py-2 rounded-md text-sm font-mono select-all">
              {selected.profileLine}
            </code>
            <Button variant="outline" size="icon" className="shrink-0" onClick={handleCopyLine}>
              {copiedLine ? (
                <Check className="size-4 text-green-500" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Preview toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={handleTogglePreview}
          disabled={isGenerating}
        >
          {showPreview ? <ChevronUp className="size-4 mr-1" /> : <ChevronDown className="size-4 mr-1" />}
          {isGenerating ? 'Generating...' : showPreview ? 'Hide generated script' : 'Preview generated script'}
        </Button>

        {showPreview && previewOutput && (
          <pre className="bg-muted p-4 rounded-md text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
            {previewOutput}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Import Checkbox Row
// ============================================================================

function ImportCheckboxRow({
  id,
  label,
  count,
  extra,
  subtitle,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  count?: number;
  extra?: string;
  subtitle?: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const countLabel = count !== undefined
    ? extra ? `${count} ${label.toLowerCase()}, ${extra}` : `${count}`
    : undefined;

  return (
    <div className={`flex items-center gap-3 ${disabled ? 'opacity-40' : ''}`}>
      <Checkbox
        id={`import-${id}`}
        checked={checked && !disabled}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
      <label htmlFor={`import-${id}`} className="flex-1 text-sm cursor-pointer select-none">
        {label}
        {countLabel && <span className="text-muted-foreground ml-1">({countLabel})</span>}
        {subtitle && <span className="text-muted-foreground ml-1 text-xs">({subtitle})</span>}
      </label>
    </div>
  );
}
