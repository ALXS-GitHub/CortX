import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Chip } from '@/components/ui/Chip';
import { Segmented, type SegOption } from '@/components/ui/Segmented';
import { BetaBadge } from '@/components/ui/BetaBadge';
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
import {
  FolderOpen,
  Save,
  Search,
  Loader2,
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
import { TERMINAL_SECTION_KEYWORDS } from '@/components/terminal/settings/meta';
import { ColorField } from '@/components/ui/ColorField';
import { TerminalSettingsSections } from '@/components/terminal/settings/TerminalSettingsPanel';
import { Section, Field, Code } from '@/components/settings/SettingsPrimitives';
import type { AppSettings, AgentsSettings, ExportSummary, ImportOptions, ShimStatus } from '@/types';

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
type SettingsTab = 'general' | 'appearance' | 'terminal' | 'scripts' | 'agents';

const SETTINGS_TABS: SegOption<SettingsTab>[] = [
  { value: 'general', label: 'General' },
  { value: 'appearance', label: 'Appearance' },
  { value: 'terminal', label: 'Terminal', badge: <BetaBadge /> },
  { value: 'scripts', label: 'Scripts' },
  { value: 'agents', label: 'Agents', badge: <BetaBadge /> },
];

const SETTINGS_TAB_KEY = 'cortx-settings-tab';

const SECTION_KEYWORDS: [SettingsTab, string][] = [
  ['appearance', 'appearance style halcyon classic theme light dark system accent colour color corners radius font'],
  // The terminal cards carry their own keywords (they are shared with the
  // Terminal window's settings panel), so the search banner reuses them.
  ...Object.values(TERMINAL_SECTION_KEYWORDS).map((kw) => ['terminal', kw] as [SettingsTab, string]),
  ['general', 'default behavior launch method integrated external clipboard services'],
  ['general', 'command palette global hotkey shortcut'],
  ['general', 'tags labels colours manage projects'],
  ['general', 'statuses project status manage'],
  ['general', 'shell aliases init profile cortx init shims path'],
  ['general', 'toolbox documentation url'],
  ['scripts', 'script command templates extensions interpreter run scripts'],
  ['agents', 'agents claude code codex sessions directory recent days'],
  ['general', 'data management export import backup git repository shims path'],
];

function readSavedTab(): SettingsTab {
  try {
    const v = sessionStorage.getItem(SETTINGS_TAB_KEY);
    return SETTINGS_TABS.some((t) => t.value === v) ? (v as SettingsTab) : 'general';
  } catch {
    return 'general';
  }
}

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

export function Settings() {
  const { settings, loadSettings, updateSettings, exportScriptsConfig, previewImport, importScriptsConfig, backupToGit } = useAppStore();

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
  const [hasChanges, setHasChangesState] = useState(false);
  // Every edit bumps the version: the live-apply effect debounces on it.
  const [editVersion, setEditVersion] = useState(0);
  const setHasChanges = (value: boolean) => {
    setHasChangesState(value);
    if (value) setEditVersion((n) => n + 1);
  };
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [activeTab, setActiveTab] = useState<SettingsTab>(readSavedTab);
  const [query, setQuery] = useState('');
  // Hydrate from the store only when its content actually changed (the
  // store object is replaced on every reload, our own saves included).
  const lastHydratedRef = useRef<string | null>(null);


  useEffect(() => {
    if (!settings) loadSettings();
  }, [settings, loadSettings]);

  useEffect(() => {
    if (settings) {
      const json = JSON.stringify(settings);
      if (lastHydratedRef.current === json) return;
      lastHydratedRef.current = json;
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
      // Every terminal setting is owned by the cards in
      // components/terminal/settings/, which write to the store themselves
      // (the same cards run in the Terminal window). This page must therefore
      // hand the terminal block back untouched.
      terminal: { ...settings.terminal },
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

  // Live apply: edits flag `hasChanges`; 400 ms after the last one the
  // settings are written, with no Save button and without touching the
  // local state (the hydration guard above ignores our own echo).
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  useEffect(() => {
    if (!hasChanges) return;
    const timer = window.setTimeout(() => {
      setSaveState('saving');
      void handleSaveRef.current().then(() => {
        setSaveState('saved');
        window.setTimeout(() => setSaveState((v) => (v === 'saved' ? 'idle' : v)), 1500);
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [hasChanges, editVersion]);

  // Only the very first load shows the placeholder: a reload (our own save
  // echoed by the file watcher) must not unmount the page, or the scroll
  // position and any half-typed field would be lost.
  if (!settings) {
    return (
      <Screen title="Settings" subtitle="Configure your CortX preferences" narrow>
        <p className="py-10 text-center text-sm text-muted-foreground">Loading settings...</p>
      </Screen>
    );
  }


  const saveActions = (
    <span className="inline-flex h-8 items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      {saveState === 'saving' || hasChanges ? (
        <>
          <Loader2 className="size-3.5 animate-spin" />
          Saving…
        </>
      ) : saveState === 'saved' ? (
        <>
          <Save className="size-3.5 text-success" />
          Saved
        </>
      ) : (
        <span className="text-faint">Changes apply instantly</span>
      )}
    </span>
  );

  // Tabs, or every matching section when searching.
  const q = query.trim().toLowerCase();
  const visible = (tab: SettingsTab, keywords: string) =>
    q ? keywords.toLowerCase().includes(q) || tab.includes(q) : activeTab === tab;
  const selectTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    try {
      sessionStorage.setItem(SETTINGS_TAB_KEY, tab);
    } catch {
      // sessionStorage unavailable: the tab just isn't remembered
    }
  };
  const toolbar = (
    <div className="flex w-full flex-wrap items-center gap-3">
      <Segmented<SettingsTab> value={activeTab} onChange={selectTab} options={SETTINGS_TABS} size="sm" />
      <div className="relative ml-auto w-full sm:w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search settings…"
          className="pl-9"
          aria-label="Search settings"
        />
      </div>
    </div>
  );

  return (
    <Screen title="Settings" subtitle="Configure your CortX preferences" narrow actions={saveActions} toolbar={toolbar}>
      <div className="settings-sections space-y-5">
        {q && !SECTION_KEYWORDS.some(([tab, kw]) => visible(tab, kw)) && (
          <p className="py-10 text-center text-sm text-muted-foreground">No setting matches “{query}”.</p>
        )}
        {/* Appearance */}
        {visible('appearance', 'appearance style halcyon classic theme light dark system accent colour color corners radius font') && (
          <>
          <AppearanceSection
            theme={theme}
            onThemeChange={(value) => {
              setTheme(value);
              setHasChanges(true);
            }}
          />
          </>
        )}

        {/* Terminal — every card lives in components/terminal/settings/ and is
            bound straight to settings.terminal, so the Terminal window's own
            panel (Ctrl+, there) shows the very same controls (DEV-13 #8). */}
        {(q || activeTab === 'terminal') && <TerminalSettingsSections query={q} empty={null} />}

        {/* Defaults */}
        {visible('general', 'default behavior launch method integrated external clipboard services') && (
          <>
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
          </>
        )}

        {/* Command palette */}
        {visible('general', 'command palette global hotkey shortcut') && (
          <>
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
          </>
        )}

        {/* Tags */}
        {visible('general', 'tags labels colours manage projects') && (
          <>
          <TagsSection onManage={() => setShowTagManager(true)} />
          </>
        )}

        {/* Statuses */}
        {visible('general', 'statuses project status manage') && (
          <>
          <StatusesSection onManage={() => setShowStatusManager(true)} />
          </>
        )}

        {/* Shell aliases init */}
        {visible('general', 'shell aliases init profile cortx init shims path') && (
          <>
          <ShellSetupCard />
          </>
        )}

        {/* Toolbox base URL */}
        {visible('general', 'toolbox documentation url') && (
          <>
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
          </>
        )}

        {/* Script command templates */}
        {visible('scripts', 'script command templates extensions interpreter run scripts') && (
          <>
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
          </>
        )}

        {/* Agents (beta) */}
        {visible('agents', 'agents claude code codex sessions directory recent days') && (
          <>
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
          </>
        )}

        {/* Data management: import / export / git backup / shims */}
        {visible('general', 'data management export import backup git repository shims path') && (
          <>
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
          </>
        )}

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
            {/* CortX's own picker, not `<input type="color">`: that one opens
                Windows' colour dialog, which knows nothing of the app's theme
                and drops the user out of the window to pick a colour for it.
                The trigger keeps the round pip of the presets beside it. */}
            <ColorField
              value={accent ?? ''}
              onChange={(hex) => setStyle({ accent: hex || undefined })}
              swatches={ACCENT_PRESETS.map((p) => p.value)}
              aria-label="Custom accent colour"
              trigger={
                <button
                  type="button"
                  title="Custom colour"
                  aria-label="Custom accent colour"
                  className={cn(
                    'relative grid size-7 cursor-pointer place-items-center rounded-full border border-dashed border-border-strong',
                    isCustom && 'border-solid ring-2 ring-offset-2 ring-offset-card'
                  )}
                  style={
                    isCustom && accent
                      ? ({ backgroundColor: accent, '--tw-ring-color': accent } as CSSProperties)
                      : undefined
                  }
                >
                  {isCustom && accent ? (
                    <Check className="size-3.5" style={{ color: accentForeground(accent) }} />
                  ) : (
                    <Palette className="size-3.5 text-faint" />
                  )}
                </button>
              }
            />
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
