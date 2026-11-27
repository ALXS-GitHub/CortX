/**
 * The Settings screen (ticket #64): a list of pages on the left, the selected
 * page on the right (`SettingsLayout`), and a search across every page.
 *
 * Two kinds of settings live here:
 *
 * - **App settings** (General, Appearance, Library, Shell & aliases, the
 *   agent sources, Data) are held in local state below and written 400 ms
 *   after the last edit, with no Save button.
 * - **Terminal settings** (Terminal's pages, Notifications, the rest of
 *   Agents) are owned by the cards in `components/terminal/settings/`, which
 *   write `settings.terminal` themselves — the same cards run in the Terminal
 *   window's own panel. This screen hands the terminal block back untouched.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  Download,
  FolderOpen,
  Globe,
  Library,
  Loader2,
  MonitorCog,
  Moon,
  Palette,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sun,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Chip } from '@/components/ui/Chip';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Segmented } from '@/components/ui/Segmented';
import { ColorField } from '@/components/ui/ColorField';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TagDefinitionManager } from '@/components/global-scripts/TagDefinitionManager';
import { StatusDefinitionManager } from '@/components/settings/StatusDefinitionManager';
import { HotkeyInput } from '@/components/settings/HotkeyInput';
import { UpdatesSection, UPDATES_SECTION_KEYWORDS } from '@/components/settings/UpdatesSection';
import { SettingsLayout } from '@/components/settings/SettingsLayout';
import {
  Code,
  Section,
  SectionBody,
  SettingRow,
} from '@/components/settings/SettingsPrimitives';
import { readStoredPage, resolvePage, storePage, type SettingsPageDef, SETTINGS_PAGE_KEY } from '@/components/settings/settingsNav';
import { TerminalPageAction, TerminalSettingsPage } from '@/components/terminal/settings/TerminalSettingsPanel';
import { agentTerminalSections, notificationsPage, terminalSubPages } from '@/components/terminal/settings/terminalPages';
import { generateShellInit, setGlobalHotkey as setGlobalHotkeyApi, getShimStatus, syncShims, installShimPath } from '@/lib/tauri';
import { useThemeStore, applyThemeMode, accentForeground, DEFAULT_COLORS, type ThemeMode } from '@/lib/theme';
import { ACCENT_PRESETS as ZINC_ACCENTS, NEUTRALS as ZINC_NEUTRALS, type NeutralId } from '@zinc/ui/theme';
import { cn } from '@/lib/utils';
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

const DEFAULT_COMMAND_TEMPLATES: Record<string, string> = {
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
};

const PAGE_KEY = SETTINGS_PAGE_KEY;

// ============================================================================
// The pages
// ============================================================================

const GENERAL_PAGE: SettingsPageDef = {
  id: 'general',
  title: 'General',
  description: 'The command palette hotkey, updates and the toolbox documentation.',
  icon: SlidersHorizontal,
  sections: [
    { id: 'hotkey', title: 'Command palette', keywords: 'global hotkey shortcut palette' },
    { id: 'updates', title: 'Updates', keywords: UPDATES_SECTION_KEYWORDS },
    { id: 'toolbox', title: 'Toolbox documentation', keywords: 'toolbox documentation docs base url link' },
  ],
};

const APPEARANCE_PAGE: SettingsPageDef = {
  id: 'appearance',
  title: 'Appearance',
  description: 'The colours of CortX, built from a mode, an accent and a neutral.',
  icon: Palette,
  sections: [{ id: 'appearance', title: 'Colours', keywords: 'theme mode light dark system accent colour color neutral grey' }],
};

const LIBRARY_PAGE: SettingsPageDef = {
  id: 'library',
  title: 'Library',
  description: 'Tags and statuses shared by projects, scripts and tools, and how imported scripts run.',
  icon: Library,
  sections: [
    { id: 'tags', title: 'Tags', keywords: 'tags labels colours manage' },
    { id: 'statuses', title: 'Statuses', keywords: 'statuses status manage projects tools' },
    { id: 'templates', title: 'Script command templates', keywords: 'script command templates extension interpreter run' },
  ],
};

const SHELL_PAGE: SettingsPageDef = {
  id: 'shell',
  title: 'Shell & aliases',
  description: 'Load your CortX aliases in a shell, or make them callable from anywhere.',
  icon: Terminal,
  sections: [
    { id: 'shell-init', title: 'Shell profile', keywords: 'shell aliases init profile cortx init powershell bash zsh fish' },
    { id: 'shims', title: 'Alias shims', keywords: 'shims path launcher callable anywhere agents' },
  ],
};

const DATA_PAGE: SettingsPageDef = {
  id: 'data',
  title: 'Data',
  description: 'Export, import or back up your whole CortX configuration.',
  icon: Database,
  sections: [
    { id: 'export-import', title: 'Export and import', keywords: 'export import json file' },
    { id: 'backup', title: 'Git backup', keywords: 'backup git repository commit' },
  ],
};

function buildPages(): SettingsPageDef[] {
  return [
    GENERAL_PAGE,
    APPEARANCE_PAGE,
    LIBRARY_PAGE,
    SHELL_PAGE,
    {
      id: 'agents',
      title: 'Agents',
      description: 'Where CortX reads Claude Code and Codex sessions from, and how agents show in the terminal.',
      icon: Bot,
      beta: true,
      sections: [
        { id: 'agent-sources', title: 'Sources', keywords: 'claude code codex sessions directory config home recent days running threshold' },
        ...agentTerminalSections(),
      ],
    },
    notificationsPage(Bell),
    ...terminalSubPages(),
    DATA_PAGE,
  ];
}

/** Parse a numeric field, falling back to `fallback` and clamping to [min, max]. */
const clampInt = (raw: string, fallback: number, min: number, max: number): number => {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

async function pickFolder(title: string): Promise<string | null> {
  try {
    const selected = await open({ directory: true, multiple: false, title });
    return selected && typeof selected === 'string' ? selected : null;
  } catch (e) {
    console.error('Failed to open folder picker:', e);
    return null;
  }
}

/** A path input with a browse button, full width. */
function PathInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  pickerTitle,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  pickerTitle: string;
}) {
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1"
        disabled={disabled}
      />
      <Button
        variant="outline"
        size="icon"
        aria-label="Browse"
        title="Browse"
        disabled={disabled}
        onClick={async () => {
          const picked = await pickFolder(pickerTitle);
          if (picked) onChange(picked);
        }}
      >
        <FolderOpen />
      </Button>
    </div>
  );
}

// ============================================================================
// The screen
// ============================================================================

export function Settings() {
  const { settings, loadSettings, updateSettings, exportScriptsConfig, previewImport, importScriptsConfig, backupToGit } = useAppStore();
  const pages = useMemo(buildPages, []);

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
  const [theme, setTheme] = useState<ThemeMode>('system');
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
  const [selectedPage, setSelectedPage] = useState(() => resolvePage(pages, readStoredPage(PAGE_KEY))?.id ?? 'general');
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
        toast.success('Shim folder added to PATH. Restart your terminals and agents once to pick it up.');
      } else if (outcome.status === 'alreadyPresent') {
        toast.info('The shim folder is already on your PATH.');
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
      toast.success('Configuration exported');
    } catch (error) {
      toast.error(`Failed to export: ${error}`);
    }
  };

  const handleImport = async () => {
    try {
      const selected = await open({
        multiple: false,
        title: 'Import a CortX configuration',
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
      <Screen title="Settings" narrow>
        <p className="py-10 text-center text-sm text-muted-foreground">Loading settings…</p>
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

  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setHasChanges(true);
    };

  const renderPage = (id: string) => {
    switch (id) {
      case 'general':
        return (
          <>
            <Section id="hotkey" title="Command palette">
              <SettingRow
                label="Global hotkey"
                hint={
                  <>
                    Opens the palette from anywhere. Inside the app, <kbd className="kbd">Ctrl+K</kbd> always works.
                    Backspace while recording disables it; on macOS the system may ask for Accessibility access.
                  </>
                }
                wide
              >
                <HotkeyInput value={globalHotkey} defaultCombo={DEFAULT_GLOBAL_HOTKEY} onChange={edit(setGlobalHotkey)} />
              </SettingRow>
            </Section>
            <UpdatesSection id="updates" />
            <Section id="toolbox" title="Toolbox documentation">
              <SettingRow
                label="Base URL"
                htmlFor="toolbox-base-url"
                hint="A tool's toolbox URL starting with “/” is resolved against it. Full URLs (https://…) are used as they are."
                wide
              >
                <Input
                  id="toolbox-base-url"
                  value={toolboxBaseUrl}
                  onChange={(e) => edit(setToolboxBaseUrl)(e.target.value)}
                  placeholder="https://docs.example.com"
                />
              </SettingRow>
            </Section>
          </>
        );
      case 'appearance':
        return <AppearanceSection theme={theme} onThemeChange={edit(setTheme)} />;
      case 'library':
        return (
          <>
            <TagsSection onManage={() => setShowTagManager(true)} />
            <StatusesSection onManage={() => setShowStatusManager(true)} />
            <Section
              id="templates"
              title="Script command templates"
              description={
                <>
                  The command used when a script is imported, by file extension. <Code>{'{{SCRIPT_FILE}}'}</Code> stands
                  for the script path.
                </>
              }
              action={
                <Button variant="ghost" size="xs" onClick={() => edit(setCommandTemplates)({ ...DEFAULT_COMMAND_TEMPLATES })}>
                  <RotateCcw />
                  Reset defaults
                </Button>
              }
            >
              {Object.entries(commandTemplates)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([ext, template]) => (
                  <div key={ext} className="flex items-center gap-3 px-4 py-2">
                    <label htmlFor={`template-${ext}`} className="w-14 shrink-0 truncate font-mono text-xs text-muted-foreground">
                      .{ext}
                    </label>
                    <Input
                      id={`template-${ext}`}
                      value={template}
                      onChange={(e) => edit(setCommandTemplates)({ ...commandTemplates, [ext]: e.target.value })}
                      placeholder={`Command for .${ext} files`}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove the .${ext} template`}
                      title="Remove"
                      className="text-faint hover:text-destructive"
                      onClick={() => {
                        const next = { ...commandTemplates };
                        delete next[ext];
                        edit(setCommandTemplates)(next);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              <div className="flex items-center gap-3 px-4 py-2">
                <Input
                  value={newExtension}
                  onChange={(e) => setNewExtension(e.target.value.replace(/^\./, '').replace(/\s/g, ''))}
                  placeholder="ext"
                  aria-label="New extension"
                  className="w-14 shrink-0 px-2"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!newExtension || newExtension in commandTemplates}
                  onClick={() => {
                    if (newExtension && !(newExtension in commandTemplates)) {
                      edit(setCommandTemplates)({ ...commandTemplates, [newExtension]: '{{SCRIPT_FILE}}' });
                      setNewExtension('');
                    }
                  }}
                >
                  <Plus />
                  Add extension
                </Button>
              </div>
            </Section>
          </>
        );
      case 'shell':
        return (
          <>
            <ShellSetupSection />
            <Section
              id="shims"
              title="Alias shims"
              description="A shim is a real launcher file, so an alias works from any process (agents, scheduled tasks, non-interactive shells), not only from shells that load cortx init. Turn it on per alias with “Callable from anywhere”."
            >
              <SettingRow
                label="Shim directory"
                htmlFor="shim-dir"
                hint="Empty = the platform default. Shims are re-synced when it changes."
                wide
              >
                <PathInput
                  id="shim-dir"
                  value={shimDir}
                  onChange={edit(setShimDir)}
                  placeholder={shimStatus?.dir || 'Default: %LOCALAPPDATA%\\CortX\\bin'}
                  pickerTitle="Select the shim directory"
                />
              </SettingRow>
              <SettingRow
                label={
                  <span className="inline-flex items-center gap-2">
                    On your PATH
                    {shimStatus?.onPath ? (
                      <Badge variant="success">
                        <Check /> Yes
                      </Badge>
                    ) : (
                      <Badge variant="warning">No</Badge>
                    )}
                  </span>
                }
                hint={
                  shimStatus?.onPath
                    ? `${shimStatus.count} shimmed alias${shimStatus.count === 1 ? '' : 'es'}. Turning a shim on or off is instant.`
                    : 'Needed once. After adding it, restart your terminals and agents; turning a shim on or off is then instant.'
                }
              >
                <Button variant="outline" size="sm" onClick={handleInstallShimPath} disabled={isInstallingPath || !!shimStatus?.onPath}>
                  <Globe />
                  {isInstallingPath ? 'Adding…' : 'Add to PATH'}
                </Button>
              </SettingRow>
            </Section>
          </>
        );
      case 'agents':
        return (
          <>
            <Section
              id="agent-sources"
              title="Sources"
              description="Where CortX reads Claude Code and Codex sessions from. Nothing is written to these folders."
            >
              <SettingRow
                label="Claude Code"
                htmlFor="agents-claude-enabled"
                hint="Transcripts and live sessions from its config directory."
              >
                <Switch id="agents-claude-enabled" checked={agentsClaudeEnabled} onCheckedChange={edit(setAgentsClaudeEnabled)} />
              </SettingRow>
              <SettingRow label="Config directory" htmlFor="agents-claude-dir" wide indent disabled={!agentsClaudeEnabled}>
                <PathInput
                  id="agents-claude-dir"
                  value={agentsClaudeDir}
                  onChange={edit(setAgentsClaudeDir)}
                  placeholder="~/.claude (default)"
                  disabled={!agentsClaudeEnabled}
                  pickerTitle="Select the Claude Code config directory (~/.claude)"
                />
              </SettingRow>
              <SettingRow label="Codex" htmlFor="agents-codex-enabled" hint="Threads from the Codex home (state database and rollouts).">
                <Switch id="agents-codex-enabled" checked={agentsCodexEnabled} onCheckedChange={edit(setAgentsCodexEnabled)} />
              </SettingRow>
              <SettingRow label="Codex home" htmlFor="agents-codex-home" wide indent disabled={!agentsCodexEnabled}>
                <PathInput
                  id="agents-codex-home"
                  value={agentsCodexHome}
                  onChange={edit(setAgentsCodexHome)}
                  placeholder="~/.codex (default)"
                  disabled={!agentsCodexEnabled}
                  pickerTitle="Select the Codex home directory (~/.codex)"
                />
              </SettingRow>
              <SettingRow
                label="Running threshold"
                htmlFor="agents-codex-live"
                hint="Codex has no live registry: a thread updated within this window shows as running."
                indent
                disabled={!agentsCodexEnabled}
              >
                <Input
                  id="agents-codex-live"
                  type="number"
                  min={1}
                  max={1440}
                  value={agentsCodexLiveMinutes}
                  onChange={(e) => edit(setAgentsCodexLiveMinutes)(e.target.value)}
                  className="w-24 tabular-nums"
                  disabled={!agentsCodexEnabled}
                />
                <span className="w-6 text-xs text-muted-foreground">min</span>
              </SettingRow>
              <SettingRow
                label="Finished sessions shown"
                htmlFor="agents-recent-days"
                hint="From the last days. Running and waiting sessions are always listed; “Show all” in the Agents filters overrides it."
              >
                <Input
                  id="agents-recent-days"
                  type="number"
                  min={1}
                  max={3650}
                  value={agentsRecentDays}
                  onChange={(e) => edit(setAgentsRecentDays)(e.target.value)}
                  className="w-24 tabular-nums"
                />
                <span className="w-6 text-xs text-muted-foreground">days</span>
              </SettingRow>
            </Section>
            <TerminalSettingsPage page="agents" />
          </>
        );
      case 'data':
        return (
          <>
            <Section id="export-import" title="Export and import">
              <SettingRow
                label="Export"
                hint="Projects, scripts, tools, apps, shell config, tags, statuses and settings, in one JSON file."
              >
                <Button variant="outline" size="sm" onClick={handleExport}>
                  <Download />
                  Export
                </Button>
              </SettingRow>
              <SettingRow label="Import" hint="Pick what to bring in from an export file. Items that already exist are kept.">
                <Button variant="outline" size="sm" onClick={handleImport}>
                  <Upload />
                  Import…
                </Button>
              </SettingRow>
            </Section>
            <Section id="backup" title="Git backup">
              <SettingRow
                label="Repository"
                htmlFor="backup-repo-path"
                hint="An existing git repository with a remote configured."
                wide
              >
                <PathInput
                  id="backup-repo-path"
                  value={backupRepoPath}
                  onChange={edit(setBackupRepoPath)}
                  placeholder="Path to a local git repository"
                  pickerTitle="Select the backup git repository"
                />
              </SettingRow>
              <SettingRow label="Back up now" hint="Copies your CortX data files into the repository and commits them.">
                <Button variant="outline" size="sm" onClick={handleBackup} disabled={isBackingUp || !settings.backupRepoPath}>
                  <Upload />
                  {isBackingUp ? 'Backing up…' : 'Back up now'}
                </Button>
              </SettingRow>
            </Section>
          </>
        );
      default:
        return <TerminalSettingsPage page={id} />;
    }
  };

  const titleOf = (id: string) => pages.find((p) => p.id === id)?.title ?? '';

  return (
    <Screen title="Settings" actions={saveActions} fill>
      <SettingsLayout
        pages={pages}
        selected={selectedPage}
        onSelect={(id) => {
          setSelectedPage(id);
          storePage(PAGE_KEY, id);
        }}
        query={query}
        onQueryChange={setQuery}
        renderPage={renderPage}
        renderPageAction={(id) => <TerminalPageAction page={id} title={titleOf(id)} />}
      />

      <TagDefinitionManager open={showTagManager} onOpenChange={setShowTagManager} />
      <StatusDefinitionManager open={showStatusManager} onOpenChange={setShowStatusManager} />

      {/* Import preview dialog */}
      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          if (!isImporting) {
            setImportDialogOpen(open);
            if (!open) {
              setImportJson(null);
              setImportSummary(null);
            }
          }
        }}
      >
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
            <Button
              variant="ghost"
              onClick={() => {
                setImportDialogOpen(false);
                setImportJson(null);
                setImportSummary(null);
              }}
              disabled={isImporting}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmImport} disabled={isImporting || !Object.values(importOptions).some(Boolean)}>
              {isImporting ? 'Importing…' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Screen>
  );
}

// ============================================================================
// Appearance — the three Zinc seeds. The mode is saved in the app settings
// (the CLI reads it, and it can follow the OS); accent and neutral are
// per-machine and apply instantly through the theme store.
// ============================================================================

const THEME_MODE_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: MonitorCog },
];

const ACCENT_NAMES: Record<string, string> = {
  jaune: 'Yellow',
  teal: 'Teal',
  bleu: 'Blue',
  violet: 'Violet',
  vert: 'Green',
  rose: 'Pink',
  graphite: 'Graphite',
};

const NEUTRAL_NAMES: Record<string, string> = {
  pur: 'Pure',
  ardoise: 'Slate',
  chaud: 'Warm',
  teinte: 'Tinted',
};

function AppearanceSection({ theme, onThemeChange }: { theme: ThemeMode; onThemeChange: (value: ThemeMode) => void }) {
  const { accent, neutral, setColors, reset } = useThemeStore();
  const dark = document.documentElement.classList.contains('dark');
  const presetId = 'preset' in accent ? accent.preset : null;
  const customHex = 'color' in accent ? accent.color : null;
  const isDefault =
    neutral === DEFAULT_COLORS.neutral && presetId !== null && 'preset' in DEFAULT_COLORS.accent && presetId === DEFAULT_COLORS.accent.preset;

  return (
    <Section
      id="appearance"
      title="Colours"
      action={
        <Button variant="ghost" size="xs" onClick={reset} disabled={isDefault}>
          <RotateCcw />
          Reset
        </Button>
      }
    >
      <SettingRow label="Mode" hint="“System” follows the OS.">
        <Segmented size="sm" value={theme} onChange={onThemeChange} options={THEME_MODE_OPTIONS} />
      </SettingRow>

      <SettingRow label="Accent" hint="The colour of the main actions and of what is active. Any colour works." wide>
        <div className="flex flex-wrap items-center gap-2">
          {ZINC_ACCENTS.map((p) => {
            const active = presetId === p.id;
            const color = dark ? p.dark : p.light;
            return (
              <button
                key={p.id}
                type="button"
                title={ACCENT_NAMES[p.id] ?? p.name}
                aria-label={ACCENT_NAMES[p.id] ?? p.name}
                aria-pressed={active}
                onClick={() => setColors({ accent: { preset: p.id } })}
                className={cn(
                  'grid size-7 place-items-center rounded-full border border-border transition-shadow',
                  active && 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                )}
                style={{ backgroundColor: color }}
              >
                {active && <Check className="size-3.5" style={{ color: accentForeground(color) }} />}
              </button>
            );
          })}
          <span className="mx-1 h-5 w-px bg-border" />
          {/* CortX's own picker, not `<input type="color">`: that one opens
              Windows' colour dialog, which knows nothing of the app's theme. */}
          <ColorField
            value={customHex ?? ''}
            onChange={(hex) => {
              if (/^#[0-9a-fA-F]{6}$/.test(hex)) setColors({ accent: { color: hex.toLowerCase() } });
            }}
            swatches={ZINC_ACCENTS.map((p) => (dark ? p.dark : p.light))}
            aria-label="Custom accent colour"
            trigger={
              <button
                type="button"
                title="Custom colour"
                aria-label="Custom accent colour"
                className={cn(
                  'grid size-7 cursor-pointer place-items-center rounded-full border border-dashed border-border-strong',
                  customHex && 'border-solid ring-2 ring-ring ring-offset-2 ring-offset-background'
                )}
                style={customHex ? { backgroundColor: customHex } : undefined}
              >
                {customHex ? (
                  <Check className="size-3.5" style={{ color: accentForeground(customHex) }} />
                ) : (
                  <Palette className="size-3.5 text-faint" />
                )}
              </button>
            }
          />
          {customHex && <span className="font-mono text-xs text-faint">{customHex}</span>}
        </div>
      </SettingRow>

      <SettingRow label="Neutral" hint="The temperature of the greys: backgrounds, borders and text.">
        <Segmented<NeutralId>
          size="sm"
          value={neutral}
          onChange={(value) => setColors({ neutral: value })}
          options={ZINC_NEUTRALS.map((n) => ({ value: n.id, label: NEUTRAL_NAMES[n.id] ?? n.name }))}
        />
      </SettingRow>
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
      id="tags"
      title="Tags"
      description="Shared by scripts, tools and projects, each with its colour and place in the order."
      action={
        <Button variant="outline" size="sm" onClick={onManage}>
          Manage tags
        </Button>
      }
    >
      <SectionBody>
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
      </SectionBody>
    </Section>
  );
}

function StatusesSection({ onManage }: { onManage: () => void }) {
  const { statusDefinitions } = useAppStore();
  const sorted = [...statusDefinitions].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
  return (
    <Section
      id="statuses"
      title="Statuses"
      description="Shared by tools, scripts, projects, apps and aliases, each with its colour and place in the order."
      action={
        <Button variant="outline" size="sm" onClick={onManage}>
          Manage statuses
        </Button>
      }
    >
      <SectionBody>
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
      </SectionBody>
    </Section>
  );
}

// ============================================================================
// Shell profile (cortx init)
// ============================================================================

const SHELL_INIT_LINES: { shell: string; label: string; profileLine: string; profileFile: string }[] = [
  {
    shell: 'powershell',
    label: 'PowerShell',
    profileLine: 'cortx init powershell | Out-String | Invoke-Expression',
    profileFile: '$PROFILE',
  },
  { shell: 'bash', label: 'Bash', profileLine: 'eval "$(cortx init bash)"', profileFile: '~/.bashrc' },
  { shell: 'zsh', label: 'Zsh', profileLine: 'eval "$(cortx init zsh)"', profileFile: '~/.zshrc' },
  { shell: 'fish', label: 'Fish', profileLine: 'cortx init fish | source', profileFile: '~/.config/fish/config.fish' },
];

function ShellSetupSection() {
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
      id="shell-init"
      title="Shell profile"
      description={`One line in your shell profile loads every CortX alias (${aliases.length} alias${aliases.length === 1 ? '' : 'es'} today).`}
    >
      <SettingRow label="Shell">
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
      </SettingRow>
      <SettingRow label={<>Add to {selected.profileFile}</>} wide>
        <div className="flex items-center gap-2">
          <code className="flex-1 select-all overflow-x-auto whitespace-nowrap rounded-sm border border-border bg-surface-sunken px-3 py-1.5 font-mono text-xs">
            {selected.profileLine}
          </code>
          <Button variant="outline" size="icon" className="shrink-0" onClick={handleCopyLine} aria-label="Copy the line" title="Copy">
            {copiedLine ? <Check className="text-st-done" /> : <Copy />}
          </Button>
        </div>
      </SettingRow>
      <SettingRow label="Generated script" hint="What that line runs, for the shell above." wide={showPreview && !!previewOutput}>
        <Button variant="ghost" size="sm" onClick={handleTogglePreview} disabled={isGenerating}>
          {showPreview ? <ChevronUp /> : <ChevronDown />}
          {isGenerating ? 'Generating…' : showPreview ? 'Hide' : 'Show'}
        </Button>
        {showPreview && previewOutput && (
          <pre className="mt-2.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-sm border border-border bg-surface-sunken p-3 font-mono text-[11px] text-muted-foreground">
            {previewOutput}
          </pre>
        )}
      </SettingRow>
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
  const countLabel = count !== undefined ? (extra ? `${count} ${label.toLowerCase()}, ${extra}` : `${count}`) : undefined;

  return (
    <div className={cn('flex items-center gap-3', disabled && 'opacity-50')}>
      <Checkbox id={`import-${id}`} checked={checked && !disabled} disabled={disabled} onCheckedChange={onCheckedChange} />
      <label htmlFor={`import-${id}`} className="flex-1 cursor-pointer select-none text-sm">
        {label}
        {countLabel && <span className="ml-1 text-muted-foreground">({countLabel})</span>}
        {subtitle && <span className="ml-1 text-xs text-muted-foreground">({subtitle})</span>}
      </label>
    </div>
  );
}

