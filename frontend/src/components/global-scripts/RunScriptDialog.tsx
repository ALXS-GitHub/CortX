import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FolderOpen, Play } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '@/stores/appStore';
import { toast } from 'sonner';
import type { GlobalScript } from '@/types';

const STORAGE_PREFIX = 'cortx-run:';

interface SavedRunState {
  workingDir: string;
  paramValues: Record<string, string>;
  paramEnabled: Record<string, boolean>;
  extraArgs: string;
  presetId: string;
}

function loadRunState(scriptId: string): SavedRunState | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + scriptId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveRunState(scriptId: string, state: SavedRunState) {
  try {
    localStorage.setItem(STORAGE_PREFIX + scriptId, JSON.stringify(state));
  } catch {
    // ignore
  }
}

interface RunScriptDialogProps {
  script: GlobalScript | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RunScriptDialog({ script, open: isOpen, onOpenChange }: RunScriptDialogProps) {
  const { runGlobalScript } = useAppStore();

  const [workingDir, setWorkingDir] = useState('');
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [paramEnabled, setParamEnabled] = useState<Record<string, boolean>>({});
  const [extraArgs, setExtraArgs] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);

  // Restore form state when dialog opens
  useEffect(() => {
    if (!isOpen || !script) return;

    const saved = loadRunState(script.id);

    // Build fresh defaults from script definition
    const freshValues: Record<string, string> = {};
    const freshEnabled: Record<string, boolean> = {};
    for (const param of script.parameters) {
      freshValues[param.name] = param.defaultValue || '';
      freshEnabled[param.name] = param.required || !!param.defaultValue;
    }

    if (saved) {
      // Restore saved state, but merge with current param definitions
      // (handles added/removed params since last run)
      setWorkingDir(saved.workingDir || '');
      setExtraArgs(saved.extraArgs || '');
      setSelectedPresetId(saved.presetId || script.defaultPresetId || '');

      const mergedValues: Record<string, string> = { ...freshValues };
      const mergedEnabled: Record<string, boolean> = { ...freshEnabled };
      for (const param of script.parameters) {
        if (param.name in saved.paramValues) {
          mergedValues[param.name] = saved.paramValues[param.name];
        }
        if (param.name in saved.paramEnabled) {
          // Required params stay enabled regardless of saved state
          mergedEnabled[param.name] = param.required || saved.paramEnabled[param.name];
        }
      }
      setParamValues(mergedValues);
      setParamEnabled(mergedEnabled);
    } else {
      // First run — use defaults
      setWorkingDir('');
      setExtraArgs('');
      setSelectedPresetId(script.defaultPresetId || '');

      // Apply default preset if available
      if (script.defaultPresetId) {
        const preset = script.parameterPresets.find((p) => p.id === script.defaultPresetId);
        if (preset) {
          const hasEnabledState = preset.enabled && Object.keys(preset.enabled).length > 0;
          for (const [key, value] of Object.entries(preset.values)) {
            freshValues[key] = value;
          }
          for (const param of script.parameters) {
            if (hasEnabledState && param.name in preset.enabled) {
              freshEnabled[param.name] = param.required || preset.enabled[param.name];
            } else if (param.name in preset.values) {
              freshEnabled[param.name] = true;
            }
          }
        }
      }

      setParamValues(freshValues);
      setParamEnabled(freshEnabled);
    }
  }, [isOpen, script]);

  // Apply preset when changed
  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (!script) return;

    if (presetId === '__none__') {
      const defaults: Record<string, string> = {};
      const enabled: Record<string, boolean> = {};
      for (const param of script.parameters) {
        defaults[param.name] = param.defaultValue || '';
        enabled[param.name] = param.required || !!param.defaultValue;
      }
      setParamValues(defaults);
      setParamEnabled(enabled);
      return;
    }

    const preset = script.parameterPresets.find((p) => p.id === presetId);
    if (preset) {
      setParamValues((prev) => ({ ...prev, ...preset.values }));
      // Apply preset enabled state if available, otherwise enable all preset params
      const hasEnabledState = preset.enabled && Object.keys(preset.enabled).length > 0;
      setParamEnabled((prev) => {
        const next = { ...prev };
        for (const param of script.parameters) {
          if (hasEnabledState && param.name in preset.enabled) {
            next[param.name] = param.required || preset.enabled[param.name];
          } else if (param.name in preset.values) {
            next[param.name] = true;
          }
        }
        return next;
      });
    }
  };

  const handleToggleParam = (paramName: string, enabled: boolean) => {
    setParamEnabled((prev) => ({ ...prev, [paramName]: enabled }));
  };

  const handleBrowseDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select working directory',
      });
      if (selected && typeof selected === 'string') {
        setWorkingDir(selected);
      }
    } catch {
      // ignore
    }
  };

  const handleRun = async () => {
    if (!script) return;

    if (!workingDir.trim()) {
      toast.error('Working directory is required');
      return;
    }

    setIsRunning(true);
    try {
      // Only send enabled params
      const activeParams: Record<string, string> = {};
      if (script.parameters.length > 0) {
        for (const param of script.parameters) {
          if (paramEnabled[param.name]) {
            activeParams[param.name] = paramValues[param.name] || '';
          }
        }
      }

      const hasParams = Object.keys(activeParams).length > 0;
      await runGlobalScript(
        script.id,
        workingDir.trim(),
        hasParams ? activeParams : undefined,
        extraArgs.trim() || undefined
      );

      // Persist full run state for next time
      saveRunState(script.id, {
        workingDir: workingDir.trim(),
        paramValues,
        paramEnabled,
        extraArgs,
        presetId: selectedPresetId,
      });

      onOpenChange(false);
    } catch (e) {
      toast.error('Failed to run script', { description: String(e) });
    } finally {
      setIsRunning(false);
    }
  };

  if (!script) return null;

  // Build preview command
  const buildPreviewCommand = () => {
    let cmd = script.scriptPath
      ? script.command.replace('{{SCRIPT_FILE}}', script.scriptPath)
      : script.command;

    for (const param of script.parameters) {
      if (!paramEnabled[param.name]) continue;
      const value = paramValues[param.name];
      if (!value && param.paramType !== 'bool') continue;

      if (param.paramType === 'bool') {
        if (value === 'true') {
          const flag = param.longFlag || param.shortFlag;
          if (flag) cmd += ` ${flag}`;
        }
      } else {
        const flag = param.longFlag || param.shortFlag;
        if (flag) {
          cmd += ` ${flag} ${value}`;
        } else {
          cmd += ` ${value}`;
        }
      }
    }

    if (extraArgs.trim()) {
      cmd += ` ${extraArgs.trim()}`;
    }

    return cmd;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="size-4" />
            Run: {script.name}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="mt-1">
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono break-all">
                {buildPreviewCommand()}
              </code>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Working Directory */}
          <div className="space-y-1.5">
            <Label>Working directory</Label>
            <div className="flex gap-2">
              <Input
                value={workingDir}
                onChange={(e) => setWorkingDir(e.target.value)}
                placeholder="Select a directory..."
                className="font-mono text-xs"
              />
              <Button variant="outline" size="icon" onClick={handleBrowseDir} title="Browse">
                <FolderOpen className="size-4" />
              </Button>
            </div>
          </div>

          {/* Parameters */}
          {script.parameters.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Parameters</Label>
                {script.parameterPresets.length > 0 && (
                  <Select value={selectedPresetId} onValueChange={handlePresetChange}>
                    <SelectTrigger className="w-[160px] h-7 text-xs">
                      <SelectValue placeholder="Select preset..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No preset</SelectItem>
                      {script.parameterPresets.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                {script.parameters.map((param) => {
                  const isEnabled = paramEnabled[param.name] ?? false;
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
                              handleToggleParam(param.name, checked === true)
                            }
                          />
                        )}
                        <Label className="text-xs flex-1">
                          <span className="font-medium">{param.name}</span>
                          {param.required && <span className="text-destructive ml-0.5">*</span>}
                          {param.longFlag && (
                            <code className="text-muted-foreground ml-1.5 font-mono">{param.longFlag}</code>
                          )}
                          {param.description && (
                            <span className="text-muted-foreground ml-1.5 font-normal">
                              — {param.description}
                            </span>
                          )}
                        </Label>
                      </div>

                      {isEnabled && (
                        <div className={isOptional ? 'pl-6' : ''}>
                          {param.paramType === 'bool' ? (
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={paramValues[param.name] === 'true'}
                                onCheckedChange={(checked) =>
                                  setParamValues((prev) => ({
                                    ...prev,
                                    [param.name]: checked ? 'true' : 'false',
                                  }))
                                }
                              />
                              <span className="text-xs text-muted-foreground">
                                {paramValues[param.name] === 'true' ? 'enabled' : 'disabled'}
                              </span>
                            </div>
                          ) : param.paramType === 'enum' && param.enumValues.length > 0 ? (
                            <Select
                              value={paramValues[param.name] || ''}
                              onValueChange={(v) =>
                                setParamValues((prev) => ({ ...prev, [param.name]: v }))
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
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
                              value={paramValues[param.name] || ''}
                              onChange={(e) =>
                                setParamValues((prev) => ({
                                  ...prev,
                                  [param.name]: e.target.value,
                                }))
                              }
                              placeholder={param.defaultValue || `Enter ${param.name}...`}
                              className="h-8 text-xs font-mono"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Extra Arguments */}
          <div className="space-y-1.5">
            <Label>Extra arguments</Label>
            <Textarea
              value={extraArgs}
              onChange={(e) => setExtraArgs(e.target.value)}
              placeholder="Additional arguments appended to the command..."
              className="font-mono text-xs resize-none"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleRun} disabled={isRunning || !workingDir.trim()}>
            <Play className="size-4 mr-1.5" />
            {isRunning ? 'Starting...' : 'Run'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
