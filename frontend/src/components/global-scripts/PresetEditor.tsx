import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, Layers, Settings2, Pencil, MoreVertical, Star, StarOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { toast } from 'sonner';
import { SaveStatus } from './ParameterEditor';
import type { ParameterPreset, GlobalScript, UpdateGlobalScriptInput } from '@/types';

interface PresetEditorProps {
  script: GlobalScript;
}

const AUTOSAVE_DELAY = 800;

export function PresetEditor({ script }: PresetEditorProps) {
  const { updateGlobalScript } = useAppStore();

  const [presets, setPresets] = useState<ParameterPreset[]>([...script.parameterPresets]);
  const [defaultPresetId, setDefaultPresetId] = useState(script.defaultPresetId || '');
  const [showPresetForm, setShowPresetForm] = useState(false);
  const [editingPreset, setEditingPreset] = useState<ParameterPreset | null>(null);
  const [presetName, setPresetName] = useState('');
  const [presetValues, setPresetValues] = useState<Record<string, string>>({});
  const [presetEnabled, setPresetEnabled] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const params = script.parameters;

  const hasMountedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSave = useCallback(async (
    currentPresets: ParameterPreset[],
    currentDefaultPresetId: string,
  ) => {
    setSaveStatus('saving');
    try {
      const update: UpdateGlobalScriptInput = {
        parameterPresets: currentPresets,
        defaultPresetId: currentDefaultPresetId || undefined,
      };
      await updateGlobalScript(script.id, update);
      setSaveStatus('saved');
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('idle');
    }
  }, [script.id, updateGlobalScript]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setSaveStatus('idle');

    debounceRef.current = setTimeout(() => {
      doSave(presets, defaultPresetId);
    }, AUTOSAVE_DELAY);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [presets, defaultPresetId, doSave]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleAddPreset = () => {
    setEditingPreset(null);
    setPresetName('');
    const values: Record<string, string> = {};
    const enabled: Record<string, boolean> = {};
    for (const p of params) {
      values[p.name] = p.defaultValue || '';
      enabled[p.name] = p.required || !!p.defaultValue;
    }
    setPresetValues(values);
    setPresetEnabled(enabled);
    setShowPresetForm(true);
  };

  const handleEditPreset = (preset: ParameterPreset) => {
    setEditingPreset(preset);
    setPresetName(preset.name);
    const values: Record<string, string> = {};
    const enabled: Record<string, boolean> = {};
    for (const p of params) {
      values[p.name] = preset.values[p.name] || p.defaultValue || '';
      enabled[p.name] = p.name in preset.enabled
        ? (p.required || preset.enabled[p.name])
        : (p.required || !!preset.values[p.name]);
    }
    setPresetValues(values);
    setPresetEnabled(enabled);
    setShowPresetForm(true);
  };

  const handleDeletePreset = (presetId: string) => {
    setPresets(presets.filter((p) => p.id !== presetId));
    if (defaultPresetId === presetId) setDefaultPresetId('');
  };

  const handleSavePreset = () => {
    if (!presetName.trim()) {
      toast.error('Preset name is required');
      return;
    }

    if (editingPreset) {
      setPresets(
        presets.map((p) =>
          p.id === editingPreset.id
            ? { ...p, name: presetName.trim(), values: { ...presetValues }, enabled: { ...presetEnabled } }
            : p
        )
      );
    } else {
      const newPreset: ParameterPreset = {
        id: crypto.randomUUID(),
        name: presetName.trim(),
        values: { ...presetValues },
        enabled: { ...presetEnabled },
      };
      setPresets([...presets, newPreset]);
    }
    setShowPresetForm(false);
  };

  if (params.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong">
        <EmptyState
          compact
          icon={Settings2}
          title="No parameters configured"
          description="Add parameters first in the Parameters tab to create presets."
        />
      </div>
    );
  }

  /** Human summary of what a preset sets, for the row. */
  const presetSummary = (preset: ParameterPreset) => {
    const parts = params
      .filter((p) => {
        const enabled = p.name in preset.enabled ? preset.enabled[p.name] : !!preset.values[p.name];
        return p.required || enabled;
      })
      .map((p) => {
        const v = preset.values[p.name];
        if (p.paramType === 'bool') return v === 'true' ? (p.longFlag || p.shortFlag || p.name) : null;
        return v ? `${p.longFlag || p.shortFlag || p.name} ${v}` : null;
      })
      .filter(Boolean);
    return parts.join('  ');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold">Presets</h2>
          <p className="text-xs text-muted-foreground">
            Save sets of parameter values for quick reuse when running this script.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SaveStatus status={saveStatus} />
          <Button size="sm" variant={presets.length === 0 ? 'default' : 'outline'} onClick={handleAddPreset}>
            <Plus />
            Add preset
          </Button>
        </div>
      </div>

      {presets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong">
          <EmptyState
            compact
            icon={Layers}
            title="No presets yet"
            description="Create one to save a set of parameter values."
            action={
              <Button onClick={handleAddPreset}>
                <Plus />
                Add preset
              </Button>
            }
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-soft">
          {presets.map((preset) => {
            const isDefault = defaultPresetId === preset.id;
            const summary = presetSummary(preset);
            return (
              <div
                key={preset.id}
                className="group flex min-h-10 items-center gap-3 border-b border-border px-3 py-1.5 transition-colors last:border-b-0 hover:bg-accent/50"
              >
                <Layers className={cn('size-4 shrink-0', isDefault ? 'text-primary' : 'text-faint')} />
                <span className="shrink-0 text-sm font-medium">{preset.name}</span>
                {isDefault && <Badge>Default</Badge>}
                <span className="hidden min-w-0 flex-1 truncate font-mono text-[11px] text-faint md:block" title={summary}>
                  {summary}
                </span>
                <span className="flex-1 md:hidden" />
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100">
                  <Button variant="ghost" size="sm" onClick={() => handleEditPreset(preset)}>
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Preset actions">
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setDefaultPresetId(isDefault ? '' : preset.id)}>
                        {isDefault ? <StarOff /> : <Star />}
                        {isDefault ? 'Unset default' : 'Set as default'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleEditPreset(preset)}>
                        <Pencil />
                        Edit preset
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => handleDeletePreset(preset.id)}>
                        <Trash2 />
                        Delete preset
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preset form dialog */}
      <Dialog open={showPresetForm} onOpenChange={setShowPresetForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPreset ? 'Edit preset' : 'New preset'}</DialogTitle>
            <DialogDescription>
              Set the parameter values for this preset.
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-6 min-h-0 flex-1 space-y-3 overflow-y-auto px-6">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Preset name</Label>
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="e.g., Production, Debug"
              />
            </div>
            <span className="eyebrow block pt-1">Parameters</span>
            {params.map((param) => {
              const isEnabled = presetEnabled[param.name] ?? false;
              const isOptional = !param.required;

              return (
                <div
                  key={param.name}
                  className={cn(
                    'space-y-1.5 rounded-sm border p-2.5 transition-[opacity,border-color]',
                    isEnabled ? 'border-border bg-card/60' : 'border-border/60 opacity-60'
                  )}
                >
                  <div className="flex items-center gap-2">
                    {isOptional && (
                      <Checkbox
                        checked={isEnabled}
                        onCheckedChange={(checked) =>
                          setPresetEnabled((prev) => ({ ...prev, [param.name]: checked === true }))
                        }
                      />
                    )}
                    <Label className="text-xs">
                      <span className="font-medium">{param.name}</span>
                      {param.required && <span className="ml-0.5 text-destructive">*</span>}
                      {param.longFlag && (
                        <code className="ml-1.5 font-mono text-[11px] text-faint">{param.longFlag}</code>
                      )}
                    </Label>
                  </div>

                  {isEnabled && (
                    <div className={isOptional ? 'pl-6' : ''}>
                      {param.paramType === 'bool' ? (
                        <div className="flex h-8 items-center">
                          <Switch
                            checked={presetValues[param.name] === 'true'}
                            onCheckedChange={(v) =>
                              setPresetValues((prev) => ({ ...prev, [param.name]: v ? 'true' : 'false' }))
                            }
                          />
                        </div>
                      ) : param.paramType === 'enum' && param.enumValues.length > 0 ? (
                        <Select
                          value={presetValues[param.name] || ''}
                          onValueChange={(v) => setPresetValues((prev) => ({ ...prev, [param.name]: v }))}
                        >
                          <SelectTrigger size="sm" className="w-full text-xs">
                            <SelectValue placeholder="Select…" />
                          </SelectTrigger>
                          <SelectContent>
                            {param.enumValues.map((v) => (
                              <SelectItem key={v} value={v}>
                                {v}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={presetValues[param.name] || ''}
                          onChange={(e) =>
                            setPresetValues((prev) => ({ ...prev, [param.name]: e.target.value }))
                          }
                          placeholder={param.defaultValue || ''}
                          className="h-8 font-mono text-xs"
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowPresetForm(false)}>
              Cancel
            </Button>
            <Button onClick={handleSavePreset}>
              {editingPreset ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
