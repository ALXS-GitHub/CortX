import { useState, useEffect, type CSSProperties, type ReactNode } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Chip } from '@/components/ui/Chip';
import { Segmented } from '@/components/ui/Segmented';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';
import { BetaBadge } from '@/components/agents/BetaBadge';
import {
  FolderOpen,
  Save,
  Info,
  Download,
  Upload,
  Plus,
  Trash2,
  RotateCcw,
  Tags,
  Copy,
  Check,
  TerminalSquare,
  ChevronDown,
  ChevronUp,
  CircleDot,
  GitBranch,
  Globe,
  Bot,
  Sun,
  Moon,
  MonitorCog,
  Square,
  Squircle,
  Circle,
  Palette,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { TagDefinitionManager } from '@/components/global-scripts/TagDefinitionManager';
import { StatusDefinitionManager } from '@/components/settings/StatusDefinitionManager';
import { generateShellInit, setGlobalHotkey as setGlobalHotkeyApi, getShimStatus, syncShims, installShimPath } from '@/lib/tauri';
import { HotkeyInput } from '@/components/settings/HotkeyInput';
import {
  useThemeStore,
  applyThemeMode,
  accentForeground,
  ACCENT_PRESETS,
  RADIUS_PRESETS,
  FONT_PRESETS,
  SKIN_PRESETS,
  type FontChoice,
  type Skin,
  type ThemeMode,
} from '@/lib/theme';
import type { AppSettings, AgentsSettings, TerminalPreset, ExportSummary, ImportOptions, ShimStatus } from '@/types';

const DEFAULT_GLOBAL_HOTKEY = 'CmdOrCtrl+Shift+Space';

// Mirrors the Rust defaults (AgentsSettings::default()).
const DEFAULT_AGENTS_SETTINGS: AgentsSettings = {
  claudeConfigDir: undefined,
  codexHome: undefined,
  claudeEnabled: true,
  codexEnabled: true,
  codexLiveThresholdMinutes: 5,
  recentDays: 7,
};

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

const THEME_MODE_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: MonitorCog },
];

const RADIUS_ICONS = { Square, Soft: Squircle, Round: Circle } as const;

/** Parse a numeric field, falling back to `fallback` and clamping to [min, max]. */
const clampInt = (raw: string, fallback: number, min: number, max: number): number => {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

// Detect current platform
const getPlatform = (): 'windows' | 'macos' | 'linux' => {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac')) return 'macos';
  return 'linux';
};

// ============================================================================
// Small layout helpers (local to the settings page)
// ============================================================================

/** One settings section: a card with a title, a description and optional header action. */
function Section({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: typeof Sun;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {Icon && <Icon className="size-4 text-faint" />}
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      {children && <CardContent className={cn('space-y-4', className)}>{children}</CardContent>}
    </Card>
  );
}

/** Label + control + hint. */
function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Inline code snippet inside a hint. */
function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-xs bg-muted px-1 py-px font-mono text-[11px] text-foreground">{children}</code>;
}

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
  const [integratedShell, setIntegratedShell] = useState('');
  const [shellIntegration, setShellIntegration] = useState(true);
  const [notifyOnLongCommand, setNotifyOnLongCommand] = useState(true);
  const [longCommandSeconds, setLongCommandSeconds] = useState(10);
  const [tabsPlacement, setTabsPlacement] = useState<'sidebar' | 'top'>('sidebar');
  const [terminalFontFamily, setTerminalFontFamily] = useState('');
  const [terminalFontSize, setTerminalFontSize] = useState(12);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [launchMethod, setLaunchMethod] = useState<'clipboard' | 'external' | 'integrated'>('integrated');
  const [toolboxBaseUrl, setToolboxBaseUrl] = useState('');
  const [backupRepoPath, setBackupRepoPath] = useState('');
  const [globalHotkey, setGlobalHotkey] = useState<string>(DEFAULT_GLOBAL_HOTKEY);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [shimDir, setShimDir] = useState('');
  const [shimStatus, setShimStatus] = useState<ShimStatus | null>(null);
  const [isInstallingPath, setIsInstallingPath] = useState(false);
  const [commandTemplates, setCommandTemplates] = useState<Record<string, string>>({});
  // Agents (beta)
  const [agentsClaudeDir, setAgentsClaudeDir] = useState('');
  const [agentsCodexHome, setAgentsCodexHome] = useState('');
  const [agentsClaudeEnabled, setAgentsClaudeEnabled] = useState(true);
  const [agentsCodexEnabled, setAgentsCodexEnabled] = useState(true);
  const [agentsCodexLiveMinutes, setAgentsCodexLiveMinutes] = useState('5');
  const [agentsRecentDays, setAgentsRecentDays] = useState('7');
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
      setIntegratedShell(settings.terminal.integratedShell ?? '');
      setShellIntegration(settings.terminal.shellIntegration ?? true);
      setNotifyOnLongCommand(settings.terminal.notifyOnLongCommand ?? true);
      setLongCommandSeconds(settings.terminal.longCommandSeconds ?? 10);
      setTabsPlacement(settings.terminal.tabsPlacement ?? 'sidebar');
      setTerminalFontFamily(settings.terminal.fontFamily ?? '');
      setTerminalFontSize(settings.terminal.fontSize ?? 12);
      setTheme(settings.appearance.theme);
      setLaunchMethod(settings.defaults.launchMethod);
      setToolboxBaseUrl(settings.toolboxBaseUrl ?? '');
      setBackupRepoPath(settings.backupRepoPath ?? '');
      setGlobalHotkey(settings.globalHotkey ?? DEFAULT_GLOBAL_HOTKEY);
      setShimDir(settings.shimDir ?? '');
      setCommandTemplates(settings.scriptsConfig.commandTemplates ?? {});
      const agents = settings.agents ?? DEFAULT_AGENTS_SETTINGS;
      setAgentsClaudeDir(agents.claudeConfigDir ?? '');
      setAgentsCodexHome(agents.codexHome ?? '');
      setAgentsClaudeEnabled(agents.claudeEnabled);
      setAgentsCodexEnabled(agents.codexEnabled);
      setAgentsCodexLiveMinutes(String(agents.codexLiveThresholdMinutes));
      setAgentsRecentDays(String(agents.recentDays));
      setHasChanges(false);
    }
  }, [settings]);

  // Refresh shim status (directory, on-PATH, shimmed alias count).
  const refreshShimStatus = async () => {
    try {
      setShimStatus(await getShimStatus());
    } catch (e) {
      console.error('Failed to load shim status:', e);
    }
  };

  useEffect(() => {
    refreshShimStatus();
  }, []);

  const handleInstallShimPath = async () => {
    setIsInstallingPath(true);
    try {
      const outcome = await installShimPath();
      if (outcome.status === 'added') {
        toast.success('Shim folder added to PATH. Restart your terminals/agents once to pick it up.');
      } else if (outcome.status === 'alreadyPresent') {
        toast.info('Shim folder is already on your PATH.');
      } else {
        toast.message('Add this line to your shell profile:', { description: outcome.instruction });
      }
      await refreshShimStatus();
    } catch (e) {
      toast.error(`Failed to add to PATH: ${e}`);
    } finally {
      setIsInstallingPath(false);
    }
  };

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
          scripts: summary.scriptsCount > 0,
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

  const handleBrowseAgentsDir = async (target: 'claude' | 'codex') => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: target === 'claude' ? 'Select the Claude Code config directory (~/.claude)' : 'Select the Codex home directory (~/.codex)',
      });
      if (selected && typeof selected === 'string') {
        if (target === 'claude') setAgentsClaudeDir(selected);
        else setAgentsCodexHome(selected);
        setHasChanges(true);
      }
    } catch (e) {
      console.error('Failed to open folder picker:', e);
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
        integratedShell: integratedShell.trim() || undefined,
        shellIntegration,
        notifyOnLongCommand,
        longCommandSeconds: Math.max(1, Math.round(longCommandSeconds) || 10),
        tabsPlacement,
        fontFamily: terminalFontFamily.trim() || undefined,
        fontSize: Math.min(32, Math.max(8, Math.round(terminalFontSize) || 12)),
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
      globalHotkey: globalHotkey || undefined,
      shimDir: shimDir.trim() || undefined,
      agents: {
        claudeConfigDir: agentsClaudeDir.trim() || undefined,
        codexHome: agentsCodexHome.trim() || undefined,
        claudeEnabled: agentsClaudeEnabled,
        codexEnabled: agentsCodexEnabled,
        codexLiveThresholdMinutes: clampInt(agentsCodexLiveMinutes, DEFAULT_AGENTS_SETTINGS.codexLiveThresholdMinutes, 1, 1440),
        recentDays: clampInt(agentsRecentDays, DEFAULT_AGENTS_SETTINGS.recentDays, 1, 3650),
      },
    };

    try {
      await updateSettings(newSettings);
      // Shim dir may have moved → reconcile launchers and refresh status.
      try {
        await syncShims();
        await refreshShimStatus();
      } catch (err) {
        console.error('Shim sync after settings save failed:', err);
      }
      // Re-register the OS-level hotkey so the change takes effect immediately.
      try {
        await setGlobalHotkeyApi(globalHotkey ?? '');
      } catch (err) {
        toast.error(`Hotkey saved but registration failed: ${err}`);
      }
      setHasChanges(false);
      toast.success('Settings saved');

      // Apply theme
      applyThemeMode(theme);
    } catch (error) {
      toast.error(`Failed to save settings: ${error}`);
    }
  };

  if (isLoadingSettings || !settings) {
    return (
      <Screen title="Settings" subtitle="Configure your CortX preferences" narrow>
        <p className="py-10 text-center text-sm text-muted-foreground">Loading settings...</p>
      </Screen>
    );
  }

  const selectedPresetInfo = TERMINAL_PRESETS.find((p) => p.value === terminalPreset);

  const saveActions = (
    <>
      {hasChanges && (
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
          <span className="size-1.5 rounded-full bg-warning" />
          Unsaved changes
        </span>
      )}
      <Button size="sm" onClick={handleSave} disabled={!hasChanges}>
        <Save />
        Save
      </Button>
    </>
  );

  return (
    <Screen title="Settings" subtitle="Configure your CortX preferences" narrow actions={saveActions}>
      <div className="space-y-5">
        {/* Appearance */}
        <AppearanceSection
          theme={theme}
          onThemeChange={(value) => {
            setTheme(value);
            setHasChanges(true);
          }}
        />

        {/* Terminal */}
        <Section
          title="Terminal"
          icon={TerminalSquare}
          description="External terminal application used when launching services outside the app."
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
          </Field>

          {terminalPreset === 'custom' && (
            <>
              <Separator />

              <Field label="Custom terminal path" htmlFor="custom-path" hint="Path to your terminal executable">
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
                  value={customArgs}
                  onChange={(e) => {
                    setCustomArgs(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder="e.g., -e bash -c {full_command}"
                  className="font-mono text-[12px]"
                />
              </Field>
            </>
          )}

          {terminalPreset === 'warp' && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">Note about Warp</p>
              <p>
                Warp will open in the service's working directory, but cannot automatically execute
                commands. You'll need to run the command manually or use the integrated terminal for
                automatic execution.
              </p>
            </div>
          )}
        </Section>

        {/* Integrated terminal */}
        <Section
          title="Integrated terminal"
          description='The terminal panel runs every service, script and shell tab in a real PTY. Configure the shell used by the "New terminal" button.'
        >
          <Field
            label="Shell"
            htmlFor="integrated-shell"
            hint={
              <>
                Command line of the shell to launch, e.g. <Code>pwsh -NoLogo</Code>, <Code>nu</Code> or{' '}
                <Code>/bin/zsh -l</Code>. Leave empty to auto-detect. Applies to newly opened tabs.
              </>
            }
          >
            <Input
              id="integrated-shell"
              value={integratedShell}
              onChange={(e) => {
                setIntegratedShell(e.target.value);
                setHasChanges(true);
              }}
              placeholder={
                navigator.userAgent.includes('Windows')
                  ? 'Auto (pwsh -NoLogo, falls back to powershell)'
                  : 'Auto ($SHELL)'
              }
              className="font-mono text-[12px]"
            />
          </Field>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="shell-integration">Shell integration</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                <Code>cortx init</Code> makes the shell report its directory, running command and exit codes
                (OSC 7 / OSC 133) — only inside CortX terminals. Powers the live tab titles, the
                running spinner and the command history.
              </p>
            </div>
            <Switch
              id="shell-integration"
              checked={shellIntegration}
              onCheckedChange={(v) => { setShellIntegration(v); setHasChanges(true); }}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="notify-long-command">Notify when a long command finishes</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Toast in the app, and an OS notification when CortX is in the background, for commands
                that end in a tab you are not looking at.
              </p>
            </div>
            <Switch
              id="notify-long-command"
              checked={notifyOnLongCommand}
              onCheckedChange={(v) => { setNotifyOnLongCommand(v); setHasChanges(true); }}
              disabled={!shellIntegration}
            />
          </div>

          <Field
            label={<span className="text-xs text-muted-foreground">Minimum duration (seconds)</span>}
            htmlFor="long-command-seconds"
          >
            <Input
              id="long-command-seconds"
              type="number"
              min={1}
              max={3600}
              value={longCommandSeconds}
              onChange={(e) => { setLongCommandSeconds(Number(e.target.value)); setHasChanges(true); }}
              className="w-28 font-mono text-[12px]"
              disabled={!shellIntegration || !notifyOnLongCommand}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field
              label="Font"
              htmlFor="terminal-font"
              hint="Any installed font (e.g. Hack NF, JetBrains Mono, Cascadia Code). Nerd Font variants render prompt glyphs. Applies to every terminal, dock and window."
            >
              <Input
                id="terminal-font"
                value={terminalFontFamily}
                onChange={(e) => { setTerminalFontFamily(e.target.value); setHasChanges(true); }}
                placeholder="Default monospace stack"
                className="font-mono text-[12px]"
                list="terminal-font-suggestions"
              />
              <datalist id="terminal-font-suggestions">
                <option value="Hack NF" />
                <option value="Hack NFM" />
                <option value="JetBrains Mono" />
                <option value="Cascadia Code" />
                <option value="Cascadia Mono" />
                <option value="Consolas" />
              </datalist>
            </Field>
            <Field label="Size" htmlFor="terminal-font-size">
              <Input
                id="terminal-font-size"
                type="number"
                min={8}
                max={32}
                value={terminalFontSize}
                onChange={(e) => { setTerminalFontSize(Number(e.target.value)); setHasChanges(true); }}
                className="w-24 font-mono text-[12px]"
              />
            </Field>
          </div>

          <Field
            label="Terminal window · tabs"
            htmlFor="tabs-placement"
            hint="Where the list of terminals lives in the Terminal window: a sessions rail on the left, or a tab strip above the panes. One or the other, never both."
          >
            <Select
              value={tabsPlacement}
              onValueChange={(v: 'sidebar' | 'top') => { setTabsPlacement(v); setHasChanges(true); }}
            >
              <SelectTrigger id="tabs-placement" className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sidebar">Sessions rail (left)</SelectItem>
                <SelectItem value="top">Tab strip (top)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Section>

        {/* Defaults */}
        <Section title="Default behavior" description="Set default behaviors for launching services.">
          <Field label="Default launch method" htmlFor="launch-method" hint="The default method used when starting services">
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
                <SelectItem value="integrated">Integrated terminal</SelectItem>
                <SelectItem value="external">External terminal</SelectItem>
                <SelectItem value="clipboard">Copy to clipboard</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Section>

        {/* Command palette */}
        <Section
          title="Command palette"
          description={
            <>
              Open the command palette from anywhere using a system-wide hotkey. Inside the app,{' '}
              <kbd className="kbd">Cmd/Ctrl+K</kbd> always works regardless of this setting.
            </>
          }
        >
          <Field
            label="Global hotkey"
            hint="Click the field, press your desired combo. Esc to cancel, Backspace to clear (disables). On macOS, the OS may prompt for Accessibility permission the first time."
          >
            <HotkeyInput
              value={globalHotkey}
              defaultCombo={DEFAULT_GLOBAL_HOTKEY}
              onChange={(combo) => {
                setGlobalHotkey(combo);
                setHasChanges(true);
              }}
            />
          </Field>
        </Section>

        {/* Tags */}
        <TagsSection onManage={() => setShowTagManager(true)} />

        {/* Statuses */}
        <StatusesSection onManage={() => setShowStatusManager(true)} />

        {/* Shell aliases init */}
        <ShellSetupCard />

        {/* Toolbox base URL */}
        <Section
          title="Toolbox documentation"
          description='Set a base URL for your toolbox documentation site. When a tool&apos;s toolbox URL starts with "/", it will be appended to this base URL.'
        >
          <Field
            label="Base URL"
            htmlFor="toolbox-base-url"
            hint='Tool URLs starting with "/" will be resolved relative to this base URL. Full URLs (https://...) are used as-is.'
          >
            <Input
              id="toolbox-base-url"
              value={toolboxBaseUrl}
              onChange={(e) => {
                setToolboxBaseUrl(e.target.value);
                setHasChanges(true);
              }}
              placeholder="e.g., https://docs.example.com"
              className="font-mono text-[12px]"
            />
          </Field>
        </Section>

        {/* Script command templates */}
        <Section
          title="Script command templates"
          description={
            <>
              Configure the default command used when importing scripts by file extension. Use{' '}
              <Code>{'{{SCRIPT_FILE}}'}</Code> as a placeholder for the script path.
            </>
          }
          className="space-y-2"
        >
          {Object.entries(commandTemplates)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([ext, template]) => (
              <div key={ext} className="grid grid-cols-[4rem_1fr_auto] items-center gap-2">
                <span className="truncate font-mono text-[12px] text-muted-foreground">.{ext}</span>
                <Input
                  value={template}
                  onChange={(e) => {
                    setCommandTemplates((prev) => ({ ...prev, [ext]: e.target.value }));
                    setHasChanges(true);
                  }}
                  className="h-8 font-mono text-[12px]"
                  placeholder={`Command for .${ext} files`}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove .${ext} template`}
                  className="text-faint hover:text-destructive"
                  onClick={() => {
                    setCommandTemplates((prev) => {
                      const next = { ...prev };
                      delete next[ext];
                      return next;
                    });
                    setHasChanges(true);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}

          <div className="flex items-center gap-2 pt-2">
            <Input
              value={newExtension}
              onChange={(e) => setNewExtension(e.target.value.replace(/^\./, '').replace(/\s/g, ''))}
              placeholder="ext"
              className="h-8 w-16 font-mono text-[12px]"
            />
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
              <Plus />
              Add extension
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
              <RotateCcw />
              Reset defaults
            </Button>
          </div>
        </Section>

        {/* Agents (beta) */}
        <Section
          title={
            <>
              Agents <BetaBadge />
            </>
          }
          icon={Bot}
          description="Where CortX reads Claude Code and Codex sessions from. Nothing is written to these folders."
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="agents-claude-enabled">Claude Code</Label>
              <p className="mt-1 text-xs text-muted-foreground">Transcripts and live sessions from the config directory</p>
            </div>
            <Switch
              id="agents-claude-enabled"
              checked={agentsClaudeEnabled}
              onCheckedChange={(v) => { setAgentsClaudeEnabled(v); setHasChanges(true); }}
            />
          </div>
          <Field label={<span className="text-xs text-muted-foreground">Claude config directory</span>} htmlFor="agents-claude-dir">
            <div className="flex gap-2">
              <Input
                id="agents-claude-dir"
                value={agentsClaudeDir}
                onChange={(e) => { setAgentsClaudeDir(e.target.value); setHasChanges(true); }}
                placeholder="~/.claude (default)"
                className="flex-1 font-mono text-[12px]"
                disabled={!agentsClaudeEnabled}
              />
              <Button variant="outline" size="icon" onClick={() => handleBrowseAgentsDir('claude')} disabled={!agentsClaudeEnabled} aria-label="Browse">
                <FolderOpen />
              </Button>
            </div>
          </Field>

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="agents-codex-enabled">Codex</Label>
              <p className="mt-1 text-xs text-muted-foreground">Threads from the Codex home (state database and rollouts)</p>
            </div>
            <Switch
              id="agents-codex-enabled"
              checked={agentsCodexEnabled}
              onCheckedChange={(v) => { setAgentsCodexEnabled(v); setHasChanges(true); }}
            />
          </div>
          <Field label={<span className="text-xs text-muted-foreground">Codex home</span>} htmlFor="agents-codex-home">
            <div className="flex gap-2">
              <Input
                id="agents-codex-home"
                value={agentsCodexHome}
                onChange={(e) => { setAgentsCodexHome(e.target.value); setHasChanges(true); }}
                placeholder="~/.codex (default)"
                className="flex-1 font-mono text-[12px]"
                disabled={!agentsCodexEnabled}
              />
              <Button variant="outline" size="icon" onClick={() => handleBrowseAgentsDir('codex')} disabled={!agentsCodexEnabled} aria-label="Browse">
                <FolderOpen />
              </Button>
            </div>
          </Field>
          <Field
            label={<span className="text-xs text-muted-foreground">Codex "running" threshold (minutes)</span>}
            htmlFor="agents-codex-live"
            hint={
              <span className="inline-flex items-center gap-1">
                <Info className="size-3" />
                Codex has no live registry: a thread updated within this window is shown as running.
              </span>
            }
          >
            <Input
              id="agents-codex-live"
              type="number"
              min={1}
              max={1440}
              value={agentsCodexLiveMinutes}
              onChange={(e) => { setAgentsCodexLiveMinutes(e.target.value); setHasChanges(true); }}
              className="w-32 font-mono text-[12px]"
              disabled={!agentsCodexEnabled}
            />
          </Field>

          <Separator />

          <Field
            label={<span className="text-xs text-muted-foreground">Show finished sessions from the last (days)</span>}
            htmlFor="agents-recent-days"
            hint='Running and waiting sessions are always listed. "Show all" in the Agents filters overrides this.'
          >
            <Input
              id="agents-recent-days"
              type="number"
              min={1}
              max={3650}
              value={agentsRecentDays}
              onChange={(e) => { setAgentsRecentDays(e.target.value); setHasChanges(true); }}
              className="w-32 font-mono text-[12px]"
            />
          </Field>
        </Section>

        {/* Data management: import / export / git backup / shims */}
        <Section title="Data management" description="Export, import, or back up your full CortX configuration." className="space-y-5">
          {/* Import / export */}
          <div className="space-y-2">
            <span className="eyebrow">Import / export</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExport}>
                <Download />
                Export
              </Button>
              <Button variant="outline" onClick={handleImport}>
                <Upload />
                Import
              </Button>
            </div>
          </div>

          <Separator />

          {/* Git backup */}
          <div className="space-y-3">
            <span className="eyebrow inline-flex items-center gap-1.5">
              <GitBranch className="size-3.5" />
              Git backup
            </span>
            <Field
              label={<span className="text-xs text-muted-foreground">Repository path</span>}
              htmlFor="backup-repo-path"
              hint="Must be an existing git repo with a remote configured. Save settings before backing up."
            >
              <div className="flex gap-2">
                <Input
                  id="backup-repo-path"
                  value={backupRepoPath}
                  onChange={(e) => {
                    setBackupRepoPath(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder="Path to a local git repo"
                  className="flex-1 font-mono text-[12px]"
                />
                <Button variant="outline" size="icon" onClick={handleBrowseBackupRepo} aria-label="Browse">
                  <FolderOpen />
                </Button>
              </div>
            </Field>
            <Button
              variant="outline"
              onClick={handleBackup}
              disabled={isBackingUp || !settings?.backupRepoPath}
            >
              <Upload />
              {isBackingUp ? 'Backing up...' : 'Backup now'}
            </Button>
          </div>

          <Separator />

          {/* Alias shims */}
          <div className="space-y-3">
            <span className="eyebrow inline-flex items-center gap-1.5">
              <Globe className="size-3.5" />
              Alias shims
            </span>
            <p className="text-xs text-muted-foreground">
              A shim is a real launcher file so an alias becomes callable from <strong>any</strong> process
              — AI agents, scheduled tasks, non-interactive shells — not just terminals that load{' '}
              <Code>cortx init</Code>. Enable per alias via the
              “Callable from anywhere” switch. The shim folder must be on your PATH (one-time).
            </p>

            <Field
              label={<span className="text-xs text-muted-foreground">Shim directory</span>}
              htmlFor="shim-dir"
              hint="Leave empty to use the platform default. Save settings to apply (shims are re-synced automatically)."
            >
              <div className="flex gap-2">
                <Input
                  id="shim-dir"
                  value={shimDir}
                  onChange={(e) => {
                    setShimDir(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder={shimStatus?.dir || 'Default: %LOCALAPPDATA%\\CortX\\bin'}
                  className="flex-1 font-mono text-[12px]"
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Browse"
                  onClick={async () => {
                    try {
                      const selected = await open({ directory: true, multiple: false, title: 'Select Shim Directory' });
                      if (selected && typeof selected === 'string') {
                        setShimDir(selected);
                        setHasChanges(true);
                      }
                    } catch (e) {
                      console.error('Failed to open folder picker:', e);
                    }
                  }}
                >
                  <FolderOpen />
                </Button>
              </div>
            </Field>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Status</span>
              {shimStatus?.onPath ? (
                <Badge variant="success">
                  <Check /> On PATH
                </Badge>
              ) : (
                <Badge variant="warning">Not on PATH</Badge>
              )}
              <span className="text-faint">·</span>
              <span className="text-muted-foreground">{shimStatus?.count ?? 0} shimmed alias{(shimStatus?.count ?? 0) === 1 ? '' : 'es'}</span>
            </div>

            <Button
              variant="outline"
              onClick={handleInstallShimPath}
              disabled={isInstallingPath || !!shimStatus?.onPath}
            >
              <Globe />
              {isInstallingPath ? 'Adding…' : shimStatus?.onPath ? 'Already on PATH' : 'Add to PATH'}
            </Button>
            {!shimStatus?.onPath && (
              <p className="text-xs text-muted-foreground">
                After adding, restart your terminals/agents once. Then enabling or disabling a shim is instant — no restart needed.
              </p>
            )}
          </div>
        </Section>
      </div>

      {/* Tag definition manager dialog */}
      <TagDefinitionManager
        open={showTagManager}
        onOpenChange={setShowTagManager}
      />

      {/* Status definition manager dialog */}
      <StatusDefinitionManager
        open={showStatusManager}
        onOpenChange={setShowStatusManager}
      />

      {/* Import preview dialog */}
      <Dialog open={importDialogOpen} onOpenChange={(open) => {
        if (!isImporting) {
          setImportDialogOpen(open);
          if (!open) { setImportJson(null); setImportSummary(null); }
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import CortX config</DialogTitle>
            {importSummary && (
              <DialogDescription>
                Version {importSummary.version} &middot; Exported {new Date(importSummary.exportedAt).toLocaleDateString()}
              </DialogDescription>
            )}
          </DialogHeader>
          {importSummary && (
            <div className="space-y-3">
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
                checked={importOptions.scripts}
                disabled={importSummary.scriptsCount === 0}
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
                label="Shell config"
                count={importSummary.aliasesCount}
                checked={importOptions.shellConfig}
                disabled={importSummary.aliasesCount === 0}
                onCheckedChange={(v) => setImportOptions((o) => ({ ...o, shellConfig: !!v }))}
              />
              <ImportCheckboxRow
                id="tagsAndStatuses"
                label="Tags & statuses"
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
            <Button variant="ghost" onClick={() => { setImportDialogOpen(false); setImportJson(null); setImportSummary(null); }} disabled={isImporting}>
              Cancel
            </Button>
            <Button onClick={handleConfirmImport} disabled={isImporting || !Object.values(importOptions).some(Boolean)}>
              {isImporting ? 'Importing...' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Screen>
  );
}

// ============================================================================
// Appearance (mode is saved in the app settings; accent / radius / font are
// per-machine and applied instantly through the theme store)
// ============================================================================

function AppearanceSection({
  theme,
  onThemeChange,
}: {
  theme: 'light' | 'dark' | 'system';
  onThemeChange: (value: 'light' | 'dark' | 'system') => void;
}) {
  const { skin, accent, radius, font, setStyle, reset } = useThemeStore();
  const isPreset = !!accent && ACCENT_PRESETS.some((p) => p.value.toLowerCase() === accent.toLowerCase());
  const isCustom = !!accent && !isPreset;
  const radiusName = RADIUS_PRESETS.find((r) => r.value === radius)?.name ?? 'Soft';
  const isDefaultStyle = !accent && radius === 1 && font === 'halcyon';
  const isClassic = skin === 'classic';
  const skinPreset = SKIN_PRESETS.find((p) => p.value === skin) ?? SKIN_PRESETS[0];

  return (
    <Section
      title="Appearance"
      icon={Palette}
      description="Customize the look and feel of the application."
      className="space-y-5"
    >
      <Field label="Style" hint={skinPreset.description}>
        <Segmented<Skin>
          value={skin}
          onChange={(value) => setStyle({ skin: value })}
          options={SKIN_PRESETS.map((p) => ({ value: p.value, label: p.name, title: p.description }))}
        />
      </Field>

      <Field label="Theme" hint="Saved with the settings. “System” follows the OS.">
        <Segmented
          value={theme}
          onChange={onThemeChange}
          options={THEME_MODE_OPTIONS}
        />
      </Field>

      <Separator />

      <div className="space-y-5">
        <Field label="Accent colour" hint={isClassic ? 'Theme default is black in light mode and white in dark mode.' : undefined}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              title="Theme default"
              aria-label="Theme default"
              aria-pressed={!accent}
              onClick={() => setStyle({ accent: undefined })}
              className={cn(
                'grid size-7 place-items-center rounded-full border border-border-strong text-background transition-[transform,box-shadow] hover:scale-110',
                !accent && 'ring-2 ring-ring ring-offset-2 ring-offset-card'
              )}
              style={{ backgroundColor: 'var(--theme-primary)' }}
            >
              {!accent && <Check className="size-3.5" />}
            </button>
            <span className="mx-1 h-5 w-px bg-border" />
            {ACCENT_PRESETS.map((preset) => {
              const active = !!accent && preset.value.toLowerCase() === accent.toLowerCase();
              return (
                <button
                  key={preset.value}
                  type="button"
                  title={preset.name}
                  aria-label={preset.name}
                  aria-pressed={active}
                  onClick={() => setStyle({ accent: preset.value })}
                  className={cn(
                    'grid size-7 place-items-center rounded-full transition-[transform,box-shadow] hover:scale-110',
                    active && 'ring-2 ring-offset-2 ring-offset-card'
                  )}
                  style={{ backgroundColor: preset.value, '--tw-ring-color': preset.value } as CSSProperties}
                >
                  {active && <Check className="size-3.5" style={{ color: accentForeground(preset.value) }} />}
                </button>
              );
            })}
            <span className="mx-1 h-5 w-px bg-border" />
            <label
              className={cn(
                'relative grid size-7 cursor-pointer place-items-center rounded-full border border-dashed border-border-strong',
                isCustom && 'border-solid ring-2 ring-offset-2 ring-offset-card'
              )}
              style={
                isCustom && accent
                  ? ({ backgroundColor: accent, '--tw-ring-color': accent } as CSSProperties)
                  : undefined
              }
              title="Custom colour"
            >
              {isCustom && accent ? (
                <Check className="size-3.5" style={{ color: accentForeground(accent) }} />
              ) : (
                <Palette className="size-3.5 text-faint" />
              )}
              <input
                type="color"
                value={accent ?? '#0d9488'}
                onChange={(e) => setStyle({ accent: e.target.value })}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
                aria-label="Custom accent colour"
              />
            </label>
            <span className="font-mono text-[11px] text-faint">{accent ? accent.toLowerCase() : 'theme default'}</span>
            <Button variant="ghost" size="sm" onClick={reset} disabled={isDefaultStyle} className="ml-auto">
              <RotateCcw />
              Reset
            </Button>
          </div>
        </Field>

        <div className={cn('grid gap-5 sm:grid-cols-2', isClassic && 'pointer-events-none opacity-50')} aria-disabled={isClassic}>
          <Field label="Corners">
            <Segmented
              value={radiusName}
              onChange={(name) => {
                const preset = RADIUS_PRESETS.find((r) => r.name === name);
                if (preset) setStyle({ radius: preset.value });
              }}
              options={RADIUS_PRESETS.map((r) => ({ value: r.name, label: r.name, icon: RADIUS_ICONS[r.name] }))}
            />
          </Field>
      </div>

      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Font">
          <Segmented<FontChoice>
            value={font}
            onChange={(value) => setStyle({ font: value })}
            options={FONT_PRESETS.map((f) => ({ value: f.value, label: f.name }))}
          />
        </Field>
      </div>

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Info className="size-3" />
        {isClassic
          ? 'Corners are fixed in the Classic style. Accent and font apply instantly on this machine — no need to save.'
          : 'Accent, corners and font apply instantly on this machine — no need to save.'}
      </p>
    </Section>
  );
}

// ============================================================================
// Tags / statuses (definitions live in dialogs; the card shows a preview)
// ============================================================================

function TagsSection({ onManage }: { onManage: () => void }) {
  const { tagDefinitions } = useAppStore();
  const sorted = [...tagDefinitions].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
  return (
    <Section
      title="Tags"
      icon={Tags}
      description="Tag definitions shared across scripts, tools, and projects. Tags can have custom colors and display order."
      action={
        <Button variant="outline" size="sm" onClick={onManage}>
          <Tags />
          Manage tags
        </Button>
      }
    >
      {sorted.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {sorted.map((def) => (
            <Chip key={def.name} color={def.color} neutral={!def.color} dot={false}>
              {def.name}
            </Chip>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No tags defined yet.</p>
      )}
    </Section>
  );
}

function StatusesSection({ onManage }: { onManage: () => void }) {
  const { statusDefinitions } = useAppStore();
  const sorted = [...statusDefinitions].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
  return (
    <Section
      title="Statuses"
      icon={CircleDot}
      description="Status definitions shared across tools, scripts, projects, apps, and aliases. Statuses can have custom colors and display order."
      action={
        <Button variant="outline" size="sm" onClick={onManage}>
          <CircleDot />
          Manage statuses
        </Button>
      }
    >
      {sorted.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {sorted.map((def) => (
            <Chip key={def.name} color={def.color} neutral={!def.color}>
              {def.name}
            </Chip>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No statuses defined yet.</p>
      )}
    </Section>
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
    <Section
      title="Shell aliases setup"
      icon={TerminalSquare}
      description={
        <>
          Add this line to your shell profile to enable all CortX aliases{' '}
          <Badge variant="secondary">
            {aliases.length} alias{aliases.length !== 1 ? 'es' : ''}
          </Badge>
        </>
      }
    >
      {/* Shell selector */}
      <Segmented
        size="sm"
        value={selectedShell}
        onChange={(shell) => {
          setSelectedShell(shell);
          setShowPreview(false);
          setPreviewOutput(null);
        }}
        options={SHELL_INIT_LINES.map((s) => ({ value: s.shell, label: s.label }))}
      />

      {/* Profile line to copy */}
      <Field label={<span className="text-xs text-muted-foreground">Add to <Code>{selected.profileFile}</Code></span>}>
        <div className="flex items-center gap-2">
          <code className="flex-1 select-all overflow-x-auto whitespace-nowrap rounded-sm border border-border bg-muted/50 px-3 py-2 font-mono text-[12px]">
            {selected.profileLine}
          </code>
          <Button variant="outline" size="icon" className="shrink-0" onClick={handleCopyLine} aria-label="Copy line">
            {copiedLine ? <Check className="text-st-done" /> : <Copy />}
          </Button>
        </div>
      </Field>

      {/* Preview toggle */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleTogglePreview}
        disabled={isGenerating}
      >
        {showPreview ? <ChevronUp /> : <ChevronDown />}
        {isGenerating ? 'Generating...' : showPreview ? 'Hide generated script' : 'Preview generated script'}
      </Button>

      {showPreview && previewOutput && (
        <pre className="max-h-48 overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/50 p-4 font-mono text-[11px] text-muted-foreground">
          {previewOutput}
        </pre>
      )}
    </Section>
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
    <div className={cn('flex items-center gap-3', disabled && 'opacity-40')}>
      <Checkbox
        id={`import-${id}`}
        checked={checked && !disabled}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
      <label htmlFor={`import-${id}`} className="flex-1 cursor-pointer select-none text-sm">
        {label}
        {countLabel && <span className="ml-1 text-muted-foreground">({countLabel})</span>}
        {subtitle && <span className="ml-1 text-xs text-muted-foreground">({subtitle})</span>}
      </label>
    </div>
  );
}
