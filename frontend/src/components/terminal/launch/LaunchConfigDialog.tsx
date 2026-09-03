import { useEffect, useState, type ReactNode } from 'react';
import { Columns2, Plus, Rows2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAppStore } from '@/stores/appStore';
import { launchConfigToYaml, saveLaunchConfig, saveLaunchConfigYaml } from '@/lib/tauri';
import { launchIdFromName } from '@/lib/launchConfigs';
import { cn } from '@/lib/utils';
import { isLaunchSplit, type LaunchConfig, type LaunchNode, type LaunchSplitDirection, type LaunchTab } from '@/types';

// ---------------------------------------------------------------------------
// Form model: single-level tabs (one terminal, or one split of terminals)
// ---------------------------------------------------------------------------

interface FormTerminal {
  key: string;
  cwd: string;
  command: string;
}

interface FormTab {
  key: string;
  title: string;
  direction: LaunchSplitDirection;
  terminals: FormTerminal[];
}

interface FormState {
  name: string;
  projectId: string | undefined;
  window: LaunchConfig['window'];
  tabs: FormTab[];
}

let keyCounter = 0;
const nextKey = () => `k${++keyCounter}`;

const newTerminal = (cwd = '.', command = ''): FormTerminal => ({ key: nextKey(), cwd, command });
const newTab = (): FormTab => ({ key: nextKey(), title: '', direction: 'horizontal', terminals: [newTerminal()] });

const emptyForm = (): FormState => ({ name: '', projectId: undefined, window: 'terminal', tabs: [newTab()] });

/**
 * A config fits the form when every tab is a leaf or a one-level split of
 * leaves. Nested splits can only be edited as YAML.
 */
function formFromConfig(config: LaunchConfig): FormState | null {
  const tabs: FormTab[] = [];
  for (const tab of config.tabs) {
    const node = tab.layout;
    if (isLaunchSplit(node)) {
      if (node.children.some(isLaunchSplit)) return null;
      tabs.push({
        key: nextKey(),
        title: tab.title ?? '',
        direction: node.split,
        terminals: node.children.map((c) => (isLaunchSplit(c) ? newTerminal() : newTerminal(c.cwd ?? '.', c.command ?? ''))),
      });
    } else {
      tabs.push({ key: nextKey(), title: tab.title ?? '', direction: 'horizontal', terminals: [newTerminal(node.cwd ?? '.', node.command ?? '')] });
    }
  }
  return { name: config.name, projectId: config.projectId, window: config.window, tabs: tabs.length > 0 ? tabs : [newTab()] };
}

function configFromForm(form: FormState, id: string): LaunchConfig {
  const leaf = (t: FormTerminal): LaunchNode => {
    const cwd = t.cwd.trim();
    const command = t.command.trim();
    return { ...(cwd ? { cwd } : {}), ...(command ? { command } : {}) };
  };
  const tabs: LaunchTab[] = form.tabs.map((tab) => {
    const title = tab.title.trim();
    const layout: LaunchNode =
      tab.terminals.length === 1 ? leaf(tab.terminals[0]) : { split: tab.direction, children: tab.terminals.map(leaf) };
    return { ...(title ? { title } : {}), layout };
  });
  return { id, name: form.name.trim(), projectId: form.projectId, window: form.window, tabs };
}

const GLOBAL_VALUE = '_global';

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export interface LaunchConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` creates a new configuration. */
  config: LaunchConfig | null;
  /** The configuration as Rust wrote it back. */
  onSaved: (config: LaunchConfig) => void;
}

/**
 * Create / edit a launch configuration. Two tabs: a form (name, project,
 * target, one-level tab editor) and the raw YAML. Once the YAML is edited by
 * hand it becomes the source of truth until saved.
 */
export function LaunchConfigDialog({ open, onOpenChange, config, onSaved }: LaunchConfigDialogProps) {
  const projects = useAppStore((s) => s.projects);
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formSupported, setFormSupported] = useState(true);
  const [yamlText, setYamlText] = useState('');
  const [yamlDirty, setYamlDirty] = useState(false);
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setYamlDirty(false);
    setYamlError(null);
    setYamlText('');
    if (!config) {
      setForm(emptyForm());
      setFormSupported(true);
      setMode('form');
      return;
    }
    const parsed = formFromConfig(config);
    if (parsed) {
      setForm(parsed);
      setFormSupported(true);
      setMode('form');
    } else {
      setForm({ name: config.name, projectId: config.projectId, window: config.window, tabs: [newTab()] });
      setFormSupported(false);
      setMode('yaml');
      launchConfigToYaml(config).then(setYamlText).catch((e) => setYamlError(String(e)));
    }
  }, [open, config]);

  const currentId = () => config?.id ?? launchIdFromName(form.name.trim() || 'session');

  const switchMode = async (next: 'form' | 'yaml') => {
    if (next === mode) return;
    if (next === 'yaml' && !yamlDirty) {
      try {
        setYamlText(await launchConfigToYaml(configFromForm(form, currentId())));
        setYamlError(null);
      } catch (e) {
        setYamlError(String(e));
      }
    }
    setMode(next);
  };

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const updateTab = (key: string, patch: Partial<FormTab>) =>
    setForm((f) => ({ ...f, tabs: f.tabs.map((t) => (t.key === key ? { ...t, ...patch } : t)) }));
  const updateTerminal = (tabKey: string, termKey: string, patch: Partial<FormTerminal>) =>
    updateTabTerminals(tabKey, (terminals) => terminals.map((t) => (t.key === termKey ? { ...t, ...patch } : t)));
  const updateTabTerminals = (tabKey: string, fn: (terminals: FormTerminal[]) => FormTerminal[]) =>
    setForm((f) => ({ ...f, tabs: f.tabs.map((t) => (t.key === tabKey ? { ...t, terminals: fn(t.terminals) } : t)) }));

  const nameOk = form.name.trim().length > 0;
  const canSave = !saving && (mode === 'yaml' ? yamlText.trim().length > 0 : nameOk && form.tabs.length > 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      let saved: LaunchConfig;
      if (mode === 'yaml') {
        try {
          saved = await saveLaunchConfigYaml(config?.id ?? null, yamlText);
        } catch (e) {
          setYamlError(String(e));
          return;
        }
      } else {
        saved = await saveLaunchConfig(configFromForm(form, currentId()));
      }
      toast.success(config ? 'Launch configuration saved' : 'Launch configuration created');
      onSaved(saved);
      onOpenChange(false);
    } catch (e) {
      toast.error('Failed to save the launch configuration', { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{config ? 'Edit launch configuration' : 'New launch configuration'}</DialogTitle>
          <DialogDescription>
            A set of terminals opened together in a project — tabs and splits — with an optional command typed in each.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => void switchMode(v as 'form' | 'yaml')} className="min-h-0 flex-1">
          <div className="flex items-center gap-3">
            <TabsList>
              <TabsTrigger value="form" disabled={yamlDirty || !formSupported} className="flex-none px-4">
                Form
              </TabsTrigger>
              <TabsTrigger value="yaml" className="flex-none px-4">
                YAML
              </TabsTrigger>
            </TabsList>
            {yamlDirty && <span className="text-xs text-muted-foreground">YAML edited by hand — the form is disabled until saved.</span>}
            {!formSupported && !yamlDirty && (
              <span className="text-xs text-muted-foreground">This layout has nested splits; edit it as YAML.</span>
            )}
          </div>

          <TabsContent value="form" className="min-h-0 overflow-y-auto pr-1">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_180px_150px]">
                <div className="grid gap-2">
                  <Label htmlFor="launch-name">Name</Label>
                  <Input
                    id="launch-name"
                    value={form.name}
                    onChange={(e) => update({ name: e.target.value })}
                    placeholder="e.g. Full stack dev"
                    autoFocus
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="launch-project">Project</Label>
                  <Select
                    value={form.projectId ?? GLOBAL_VALUE}
                    onValueChange={(v) => update({ projectId: v === GLOBAL_VALUE ? undefined : v })}
                  >
                    <SelectTrigger id="launch-project" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={GLOBAL_VALUE}>Global</SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="launch-window">Opens in</Label>
                  <Select value={form.window} onValueChange={(v: LaunchConfig['window']) => update({ window: v })}>
                    <SelectTrigger id="launch-window" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="terminal">Terminal window</SelectItem>
                      <SelectItem value="dock">Dock</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Directories are relative to the project root (<code className="font-mono">.</code> = root); absolute paths work too.
                Commands are typed into the shell once its prompt is up.
              </p>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Tabs</span>
                  <Button variant="outline" size="xs" onClick={() => update({ tabs: [...form.tabs, newTab()] })}>
                    <Plus />
                    Add tab
                  </Button>
                </div>
                {form.tabs.map((tab, index) => (
                  <TabEditor
                    key={tab.key}
                    tab={tab}
                    index={index}
                    canRemove={form.tabs.length > 1}
                    onChange={(patch) => updateTab(tab.key, patch)}
                    onRemove={() => update({ tabs: form.tabs.filter((t) => t.key !== tab.key) })}
                    onTerminalChange={(termKey, patch) => updateTerminal(tab.key, termKey, patch)}
                    onAddTerminal={() => updateTabTerminals(tab.key, (ts) => [...ts, newTerminal()])}
                    onRemoveTerminal={(termKey) => updateTabTerminals(tab.key, (ts) => ts.filter((t) => t.key !== termKey))}
                  />
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="yaml" className="min-h-0 overflow-y-auto pr-1">
            <div className="space-y-2">
              <Textarea
                value={yamlText}
                onChange={(e) => {
                  setYamlText(e.target.value);
                  setYamlDirty(true);
                  setYamlError(null);
                }}
                spellCheck={false}
                aria-invalid={yamlError ? true : undefined}
                className="min-h-[320px] font-mono text-[12px] leading-relaxed"
              />
              {yamlError ? (
                <p className="whitespace-pre-wrap font-mono text-[11px] text-destructive">{yamlError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Validated on save. A tab's <code className="font-mono">layout</code> is either a terminal (<code className="font-mono">cwd</code>,{' '}
                  <code className="font-mono">command</code>) or a <code className="font-mono">split</code> with <code className="font-mono">children</code>.
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={!canSave}>
            {saving ? 'Saving…' : config ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// One tab of the form
// ---------------------------------------------------------------------------

function TabEditor({
  tab,
  index,
  canRemove,
  onChange,
  onRemove,
  onTerminalChange,
  onAddTerminal,
  onRemoveTerminal,
}: {
  tab: FormTab;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<FormTab>) => void;
  onRemove: () => void;
  onTerminalChange: (termKey: string, patch: Partial<FormTerminal>) => void;
  onAddTerminal: () => void;
  onRemoveTerminal: (termKey: string) => void;
}) {
  const multi = tab.terminals.length > 1;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-xs text-faint">Tab {index + 1}</span>
        <Input
          value={tab.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Title (optional — defaults to the terminal name)"
          className="h-8 flex-1 text-[13px]"
        />
        {multi && (
          <div className="flex items-center rounded-sm border border-border p-0.5">
            <DirectionButton
              label="Side by side"
              active={tab.direction === 'horizontal'}
              onClick={() => onChange({ direction: 'horizontal' })}
            >
              <Columns2 className="size-3.5" />
            </DirectionButton>
            <DirectionButton label="Stacked" active={tab.direction === 'vertical'} onClick={() => onChange({ direction: 'vertical' })}>
              <Rows2 className="size-3.5" />
            </DirectionButton>
          </div>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onRemove} disabled={!canRemove} aria-label="Remove tab" className="hover:text-destructive">
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove tab</TooltipContent>
        </Tooltip>
      </div>

      <div className="space-y-1.5 pl-12">
        {tab.terminals.map((t) => (
          <div key={t.key} className="flex items-center gap-2">
            <Input
              value={t.cwd}
              onChange={(e) => onTerminalChange(t.key, { cwd: e.target.value })}
              placeholder="."
              aria-label="Working directory"
              className="h-8 w-[38%] font-mono text-[12px]"
            />
            <Input
              value={t.command}
              onChange={(e) => onTerminalChange(t.key, { command: e.target.value })}
              placeholder="Command (optional), e.g. bun dev"
              aria-label="Command"
              className="h-8 flex-1 font-mono text-[12px]"
            />
            <button
              type="button"
              onClick={() => onRemoveTerminal(t.key)}
              disabled={!multi}
              aria-label="Remove terminal"
              className="grid size-7 shrink-0 place-items-center rounded-[6px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        <Button variant="ghost" size="xs" onClick={onAddTerminal} className="-ml-2">
          <Plus />
          Add a terminal to this tab
        </Button>
      </div>
    </div>
  );
}

function DirectionButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          aria-label={label}
          className={cn(
            'grid size-6 place-items-center rounded-[6px] transition-colors',
            active ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
