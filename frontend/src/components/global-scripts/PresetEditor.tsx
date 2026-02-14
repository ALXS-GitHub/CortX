import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, Loader2, Check } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { toast } from 'sonner';
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
      <div className="text-center py-8 text-muted-foreground">
        <p>No parameters configured.</p>
        <p className="text-sm mt-1">Add parameters first in the Parameters tab to create presets.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Save sets of parameter values for quick reuse when running this script.
        </p>
        <div className="flex items-center gap-3">
          {/* Auto-save status indicator */}
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            {saveStatus === 'saving' && (
              <>
                <Loader2 className="size-3 animate-spin" />
                Saving...
              </>
            )}
            {saveStatus === 'saved' && (
              <>
                <Check className="size-3 text-green-500" />
                Saved
              </>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleAddPreset}>
            <Plus className="size-4 mr-1.5" />
            Add Preset
          </Button>
        </div>
      </div>

      {presets.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No presets yet. Create one to save a set of parameter values.
        </div>
      ) : (
        <div className="space-y-2">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="flex items-center justify-between px-3 py-2 border rounded-md text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{preset.name}</span>
                {defaultPresetId === preset.id && (
                  <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                    default
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setDefaultPresetId(defaultPresetId === preset.id ? '' : preset.id);
                  }}
                >
                  {defaultPresetId === preset.id ? 'Unset default' : 'Set as default'}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleEditPreset(preset)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeletePreset(preset.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preset form dialog */}
      <Dialog open={showPresetForm} onOpenChange={setShowPresetForm}>
        <DialogContent className="sm:max-w-md max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPreset ? 'Edit Preset' : 'New Preset'}</DialogTitle>
            <DialogDescription>
              Set the parameter values for this preset.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Preset name</Label>
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="e.g., Production, Debug"
                className="h-8 text-sm"
              />
            </div>
            {params.map((param) => {
              const isEnabled = presetEnabled[param.name] ?? false;
              const isOptional = !param.required;

              return (
                <div
                  key={param.name}
                  className={`space-y-1 rounded-md border p-2.5 transition-colors ${
                    isEnabled ? 'border-border' : 'border-border/50 opacity-50'
                  }`}
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
                      {param.required && <span className="text-destructive ml-0.5">*</span>}
                      {param.longFlag && (
                        <code className="text-muted-foreground ml-1.5 font-mono">{param.longFlag}</code>
                      )}
                    </Label>
                  </div>

                  {isEnabled && (
                    <div className={isOptional ? 'pl-6' : ''}>
                      {param.paramType === 'bool' ? (
                        <div className="flex items-center h-8">
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
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select..." />
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
                          className="h-8 text-xs font-mono"
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPresetForm(false)}>
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
