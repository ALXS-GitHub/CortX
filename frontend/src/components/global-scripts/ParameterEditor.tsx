import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Plus, Trash2, Wand2, Loader2, Check, ChevronDown, ChevronRight, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
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

/** "Saving… / Saved" indicator shared with the preset editor. */
export function SaveStatus({ status }: { status: 'idle' | 'saving' | 'saved' }) {
  if (status === 'idle') return <span className="text-xs text-muted-foreground" />;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {status === 'saving' ? (
        <>
          <Loader2 className="size-3 animate-spin" />
          Saving…
        </>
      ) : (
        <>
          <Check className="size-3 text-st-done" />
          Saved
        </>
      )}
    </span>
  );
}

function NargsBadge({ nargs }: { nargs?: string }) {
  if (!nargs) return null;
  return <Badge variant="info">{nargs === '+' ? 'multi' : `${nargs} values`}</Badge>;
}

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

  const fieldLabel = 'text-xs font-medium text-muted-foreground';
  const fieldInput = 'h-8 text-xs';

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold">Parameters</h2>
          <p className="text-xs text-muted-foreground">
            {params.length === 0 ? 'No parameter configured' : `${params.length} parameter${params.length !== 1 ? 's' : ''}`}
            {' · '}changes are saved automatically
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SaveStatus status={saveStatus} />
          <Button variant="outline" size="sm" onClick={handleDetect} disabled={isDetecting}>
            {isDetecting ? <Loader2 className="animate-spin" /> : <Wand2 />}
            Import from --help
          </Button>
          <Button size="sm" variant={params.length === 0 ? 'default' : 'outline'} onClick={handleAddParam}>
            <Plus />
            Add parameter
          </Button>
        </div>
      </div>

      {/* Parameters list */}
      {params.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong">
          <EmptyState
            compact
            icon={Settings2}
            title="No parameters configured"
            description="Add parameters manually or import them from the script's --help output."
            action={
              <>
                <Button variant="outline" onClick={handleDetect} disabled={isDetecting}>
                  {isDetecting ? <Loader2 className="animate-spin" /> : <Wand2 />}
                  Import from --help
                </Button>
                <Button onClick={handleAddParam}>
                  <Plus />
                  Add parameter
                </Button>
              </>
            }
          />
        </div>
      ) : (
        <div className="space-y-2">
          {params.map((param, index) => {
            const isExpanded = expandedParams.has(index);
            const flagSummary = [param.shortFlag, param.longFlag].filter(Boolean).join(', ');
            const typeBadge = PARAM_TYPES.find((t) => t.value === param.paramType)?.label || param.paramType;

            return (
              <Card key={index} size="sm" className={cn('group py-0', isExpanded && 'border-accent-border')}>
                <Collapsible open={isExpanded} onOpenChange={() => {
                  setExpandedParams((prev) => {
                    const next = new Set(prev);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  });
                }}>
                  <div className="flex items-center gap-1 px-3 py-2">
                    <CollapsibleTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                      {isExpanded ? (
                        <ChevronDown className="size-4 shrink-0 text-faint" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-faint" />
                      )}
                      <span className="truncate font-mono text-[13px] font-medium">
                        {param.name || <span className="italic text-muted-foreground">unnamed</span>}
                      </span>
                      <Badge variant="secondary">{typeBadge}</Badge>
                      <NargsBadge nargs={param.nargs} />
                      {flagSummary && (
                        <code className="truncate font-mono text-[11px] text-faint">{flagSummary}</code>
                      )}
                      {param.required && (
                        <span className="shrink-0 text-[11px] font-medium text-destructive">required</span>
                      )}
                    </CollapsibleTrigger>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => handleRemoveParam(index)}
                      aria-label="Remove parameter"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <CollapsibleContent>
                    <div className="border-t border-border px-4 pb-4 pt-3">
                      <div className="grid grid-cols-2 gap-3">
                        {/* Name */}
                        <div className="space-y-1">
                          <Label className={fieldLabel}>Name</Label>
                          <Input
                            value={param.name}
                            onChange={(e) => handleUpdateParam(index, 'name', e.target.value)}
                            placeholder="param_name"
                            className={cn(fieldInput, 'font-mono')}
                          />
                        </div>
                        {/* Type */}
                        <div className="space-y-1">
                          <Label className={fieldLabel}>Type</Label>
                          <Select
                            value={param.paramType}
                            onValueChange={(v) => handleUpdateParam(index, 'paramType', v)}
                          >
                            <SelectTrigger size="sm" className="w-full text-xs">
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
                          <Label className={fieldLabel}>Short flag</Label>
                          <Input
                            value={param.shortFlag || ''}
                            onChange={(e) => handleUpdateParam(index, 'shortFlag', e.target.value || undefined)}
                            placeholder="-f"
                            className={cn(fieldInput, 'font-mono')}
                          />
                        </div>
                        {/* Long flag */}
                        <div className="space-y-1">
                          <Label className={fieldLabel}>Long flag</Label>
                          <Input
                            value={param.longFlag || ''}
                            onChange={(e) => handleUpdateParam(index, 'longFlag', e.target.value || undefined)}
                            placeholder="--flag"
                            className={cn(fieldInput, 'font-mono')}
                          />
                        </div>
                        {/* Description */}
                        <div className="col-span-2 space-y-1">
                          <Label className={fieldLabel}>Description</Label>
                          <Input
                            value={param.description || ''}
                            onChange={(e) => handleUpdateParam(index, 'description', e.target.value || undefined)}
                            placeholder="What this parameter does"
                            className={fieldInput}
                          />
                        </div>
                        {/* Default value */}
                        <div className="space-y-1">
                          <Label className={fieldLabel}>Default value</Label>
                          <Input
                            value={param.defaultValue || ''}
                            onChange={(e) => handleUpdateParam(index, 'defaultValue', e.target.value || undefined)}
                            placeholder="default"
                            className={cn(fieldInput, 'font-mono')}
                          />
                        </div>
                        {/* Required */}
                        <div className="space-y-1">
                          <Label className={fieldLabel}>Required</Label>
                          <div className="flex h-8 items-center">
                            <Switch
                              checked={param.required}
                              onCheckedChange={(v) => handleUpdateParam(index, 'required', v)}
                            />
                          </div>
                        </div>
                        {/* Nargs */}
                        <div className="space-y-1">
                          <Label className={fieldLabel}>Expected values</Label>
                          <Input
                            value={param.nargs || ''}
                            onChange={(e) => handleUpdateParam(index, 'nargs', e.target.value || undefined)}
                            placeholder="1"
                            className={cn(fieldInput, 'font-mono')}
                          />
                          <p className="text-[11px] text-faint">Number or + for variadic</p>
                        </div>
                        {/* Enum values */}
                        {param.paramType === 'enum' && (
                          <div className="col-span-2 space-y-1">
                            <Label className={fieldLabel}>Enum values (comma-separated)</Label>
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
                              className={cn(fieldInput, 'font-mono')}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detect preview dialog */}
      <Dialog open={showDetectPreview} onOpenChange={setShowDetectPreview}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Detected parameters</DialogTitle>
            <DialogDescription>
              Found {detectedParams.length} parameter(s) from --help output.
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
            <div className="overflow-hidden rounded-lg border border-border bg-card/60">
              {detectedParams.map((p, i) => (
                <div key={i} className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0">
                  <code className="shrink-0 font-mono text-[12px]">
                    {p.shortFlag && `${p.shortFlag}, `}
                    {p.longFlag || p.name}
                  </code>
                  <Badge variant="secondary">{p.paramType}</Badge>
                  <NargsBadge nargs={p.nargs} />
                  {p.description && (
                    <span className="truncate text-xs text-muted-foreground">{p.description}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDetectPreview(false)}>
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
