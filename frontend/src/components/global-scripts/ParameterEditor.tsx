import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Plus, Trash2, Wand2, Loader2, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { toast } from 'sonner';
import type { ScriptParameter, ScriptParamType, GlobalScript, UpdateGlobalScriptInput } from '@/types';

interface ParameterEditorProps {
  script: GlobalScript;
}

const PARAM_TYPES: { value: ScriptParamType; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'bool', label: 'Boolean' },
  { value: 'number', label: 'Number' },
  { value: 'enum', label: 'Enum' },
  { value: 'path', label: 'Path' },
];

function emptyParam(): ScriptParameter {
  return {
    name: '',
    paramType: 'string',
    required: false,
    enumValues: [],
  };
}

const AUTOSAVE_DELAY = 800;

export function ParameterEditor({ script }: ParameterEditorProps) {
  const { updateGlobalScript, autoDetectScriptParams } = useAppStore();

  const [params, setParams] = useState<ScriptParameter[]>([...script.parameters]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [showDetectPreview, setShowDetectPreview] = useState(false);
  const [detectedParams, setDetectedParams] = useState<ScriptParameter[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [expandedParams, setExpandedParams] = useState<Set<number>>(new Set());

  const hasMountedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSave = useCallback(async (currentParams: ScriptParameter[]) => {
    const hasEmptyName = currentParams.some((p) => !p.name.trim());
    if (hasEmptyName) return;

    const names = currentParams.map((p) => p.name.trim());
    const hasDupes = names.some((n, i) => names.indexOf(n) !== i);
    if (hasDupes) return;

    setSaveStatus('saving');
    try {
      const update: UpdateGlobalScriptInput = {
        parameters: currentParams.map((p) => ({ ...p, name: p.name.trim() })),
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
      doSave(params);
    }, AUTOSAVE_DELAY);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [params, doSave]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleAddParam = () => {
    setParams([...params, emptyParam()]);
  };

  const handleRemoveParam = (index: number) => {
    setParams(params.filter((_, i) => i !== index));
  };

  const handleUpdateParam = (index: number, field: keyof ScriptParameter, value: unknown) => {
    setParams(params.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  const handleDetect = async () => {
    setIsDetecting(true);
    try {
      const detected = await autoDetectScriptParams(script.command, script.scriptPath);
      if (detected.length === 0) {
        toast.info('No parameters detected from --help output');
        return;
      }
      setDetectedParams(detected);
      setShowDetectPreview(true);
    } catch (e) {
      toast.error('Failed to detect parameters', { description: String(e) });
    } finally {
      setIsDetecting(false);
    }
  };

  const handleApplyDetected = () => {
    const existingNames = new Set(params.map((p) => p.name));
    const newParams = detectedParams.filter((p) => !existingNames.has(p.name));
    setParams([...params, ...newParams]);
    setShowDetectPreview(false);
    setDetectedParams([]);
    toast.success(`Added ${newParams.length} parameter(s)`);
  };

  const handleReplaceWithDetected = () => {
    setParams([...detectedParams]);
    setShowDetectPreview(false);
    setDetectedParams([]);
    toast.success(`Replaced with ${detectedParams.length} parameter(s)`);
  };

  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleAddParam}>
            <Plus className="size-4 mr-1.5" />
            Add Parameter
          </Button>
          <Button variant="outline" size="sm" onClick={handleDetect} disabled={isDetecting}>
            {isDetecting ? (
              <Loader2 className="size-4 mr-1.5 animate-spin" />
            ) : (
              <Wand2 className="size-4 mr-1.5" />
            )}
            Import from --help
          </Button>
        </div>
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
      </div>

      {/* Parameters list */}
      {params.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>No parameters configured.</p>
          <p className="text-sm mt-1">Add parameters manually or import from --help.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {params.map((param, index) => {
            const isExpanded = expandedParams.has(index);
            const flagSummary = [param.shortFlag, param.longFlag].filter(Boolean).join(', ');
            const typeBadge = PARAM_TYPES.find((t) => t.value === param.paramType)?.label || param.paramType;

            return (
              <Card key={index}>
                <Collapsible open={isExpanded} onOpenChange={() => {
                  setExpandedParams((prev) => {
                    const next = new Set(prev);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  });
                }}>
                  <div className="flex items-center px-3 py-2">
                    <CollapsibleTrigger className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                      {isExpanded ? (
                        <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="font-mono text-sm font-medium truncate">
                        {param.name || <span className="text-muted-foreground italic">unnamed</span>}
                      </span>
                      <span className="text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">{typeBadge}</span>
                      {param.nargs && (
                        <span className="text-xs bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded shrink-0">
                          {param.nargs === '+' ? 'multi' : `${param.nargs} values`}
                        </span>
                      )}
                      {flagSummary && (
                        <code className="text-xs text-muted-foreground font-mono truncate">{flagSummary}</code>
                      )}
                      {param.required && (
                        <span className="text-xs text-destructive shrink-0">required</span>
                      )}
                    </CollapsibleTrigger>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleRemoveParam(index)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <CollapsibleContent>
                    <CardContent className="px-4 pb-4 pt-1">
                      <div className="grid grid-cols-2 gap-3">
                        {/* Name */}
                        <div className="space-y-1">
                          <Label className="text-xs">Name</Label>
                          <Input
                            value={param.name}
                            onChange={(e) => handleUpdateParam(index, 'name', e.target.value)}
                            placeholder="param_name"
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                        {/* Type */}
                        <div className="space-y-1">
                          <Label className="text-xs">Type</Label>
                          <Select
                            value={param.paramType}
                            onValueChange={(v) => handleUpdateParam(index, 'paramType', v)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PARAM_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {/* Short flag */}
                        <div className="space-y-1">
                          <Label className="text-xs">Short flag</Label>
                          <Input
                            value={param.shortFlag || ''}
                            onChange={(e) => handleUpdateParam(index, 'shortFlag', e.target.value || undefined)}
                            placeholder="-f"
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                        {/* Long flag */}
                        <div className="space-y-1">
                          <Label className="text-xs">Long flag</Label>
                          <Input
                            value={param.longFlag || ''}
                            onChange={(e) => handleUpdateParam(index, 'longFlag', e.target.value || undefined)}
                            placeholder="--flag"
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                        {/* Description */}
                        <div className="space-y-1 col-span-2">
                          <Label className="text-xs">Description</Label>
                          <Input
                            value={param.description || ''}
                            onChange={(e) => handleUpdateParam(index, 'description', e.target.value || undefined)}
                            placeholder="What this parameter does"
                            className="h-8 text-xs"
                          />
                        </div>
                        {/* Default value */}
                        <div className="space-y-1">
                          <Label className="text-xs">Default value</Label>
                          <Input
                            value={param.defaultValue || ''}
                            onChange={(e) => handleUpdateParam(index, 'defaultValue', e.target.value || undefined)}
                            placeholder="default"
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                        {/* Required */}
                        <div className="space-y-1">
                          <Label className="text-xs">Required</Label>
                          <div className="flex items-center h-8">
                            <Switch
                              checked={param.required}
                              onCheckedChange={(v) => handleUpdateParam(index, 'required', v)}
                            />
                          </div>
                        </div>
                        {/* Nargs */}
                        <div className="space-y-1">
                          <Label className="text-xs">Expected values</Label>
                          <Input
                            value={param.nargs || ''}
                            onChange={(e) => handleUpdateParam(index, 'nargs', e.target.value || undefined)}
                            placeholder="1"
                            className="h-8 text-xs font-mono"
                          />
                          <p className="text-[10px] text-muted-foreground">Number or + for variadic</p>
                        </div>
                        {/* Enum values */}
                        {param.paramType === 'enum' && (
                          <div className="space-y-1 col-span-2">
                            <Label className="text-xs">Enum values (comma-separated)</Label>
                            <Input
                              value={param.enumValues.join(', ')}
                              onChange={(e) =>
                                handleUpdateParam(
                                  index,
                                  'enumValues',
                                  e.target.value
                                    .split(',')
                                    .map((v) => v.trim())
                                    .filter(Boolean)
                                )
                              }
                              placeholder="value1, value2, value3"
                              className="h-8 text-xs font-mono"
                            />
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detect preview dialog */}
      <Dialog open={showDetectPreview} onOpenChange={setShowDetectPreview}>
        <DialogContent className="sm:max-w-lg max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detected Parameters</DialogTitle>
            <DialogDescription>
              Found {detectedParams.length} parameter(s) from --help output.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {detectedParams.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-sm border rounded-md px-3 py-2">
                <code className="font-mono text-xs">
                  {p.shortFlag && `${p.shortFlag}, `}
                  {p.longFlag || p.name}
                </code>
                <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.paramType}</span>
                {p.nargs && (
                  <span className="text-xs bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded">
                    {p.nargs === '+' ? 'multi' : `${p.nargs} values`}
                  </span>
                )}
                {p.description && (
                  <span className="text-muted-foreground text-xs truncate">{p.description}</span>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetectPreview(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={handleApplyDetected}>
              Merge (add new)
            </Button>
            <Button onClick={handleReplaceWithDetected}>
              Replace all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
