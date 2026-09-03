import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen, Plus, X, Star } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Service, CreateServiceInput, UpdateServiceInput } from '@/types';

// Calculate relative path from base to target
function getRelativePath(basePath: string, targetPath: string): string {
  // Normalize paths (convert backslashes to forward slashes)
  const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedTarget = targetPath.replace(/\\/g, '/').replace(/\/$/, '');

  // If they're the same, return "."
  if (normalizedBase === normalizedTarget) {
    return '.';
  }

  // Check if target is inside base
  if (normalizedTarget.startsWith(normalizedBase + '/')) {
    return './' + normalizedTarget.slice(normalizedBase.length + 1);
  }

  // If target is not inside base, return the full path
  return targetPath;
}

interface ServiceFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service?: Service;
  projectPath?: string;
  onSubmit: (data: CreateServiceInput | UpdateServiceInput) => Promise<void>;
}

const SERVICE_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f97316', // orange
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#eab308', // yellow
  '#ef4444', // red
];

const LABEL = 'text-xs font-medium text-muted-foreground';
const MONO = 'font-mono text-[12px]';

// Helper to convert modes object to array for editing
function modesToArray(modes?: Record<string, string>): { name: string; command: string }[] {
  if (!modes) return [];
  return Object.entries(modes).map(([name, command]) => ({ name, command }));
}

// Helper to convert modes array back to object
function arrayToModes(arr: { name: string; command: string }[]): Record<string, string> | undefined {
  const filtered = arr.filter((m) => m.name.trim() && m.command.trim());
  if (filtered.length === 0) return undefined;
  return Object.fromEntries(filtered.map((m) => [m.name.trim(), m.command.trim()]));
}

// Helper to convert arg presets object to array for editing
function presetsToArray(presets?: Record<string, string>): { name: string; args: string }[] {
  if (!presets) return [];
  return Object.entries(presets).map(([name, args]) => ({ name, args }));
}

// Helper to convert arg presets array back to object
function arrayToPresets(arr: { name: string; args: string }[]): Record<string, string> | undefined {
  // Presets must have non-empty args
  const filtered = arr.filter((p) => p.name.trim() && p.args.trim());
  if (filtered.length === 0) return undefined;
  return Object.fromEntries(filtered.map((p) => [p.name.trim(), p.args.trim()]));
}

/** Star toggle used for "default mode" / "default preset". */
function DefaultStar({ isDefault, onClick, label }: { isDefault: boolean; onClick: () => void; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClick}
          aria-label={label}
          aria-pressed={isDefault}
          className={isDefault ? 'text-warning hover:text-warning' : 'text-faint'}
        >
          <Star className={cn('size-4', isDefault && 'fill-warning')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ServiceForm({ open: isOpen, onOpenChange, service, projectPath, onSubmit }: ServiceFormProps) {
  const [name, setName] = useState(service?.name || '');
  const [workingDir, setWorkingDir] = useState(service?.workingDir || '.');
  const [command, setCommand] = useState(service?.command || '');
  const [port, setPort] = useState(service?.port?.toString() || '');
  const [color, setColor] = useState(service?.color || SERVICE_COLORS[0]);
  const [modes, setModes] = useState<{ name: string; command: string }[]>(modesToArray(service?.modes));
  const [defaultMode, setDefaultMode] = useState<string | undefined>(service?.defaultMode);
  // Arguments state
  const [extraArgs, setExtraArgs] = useState(service?.extraArgs || '');
  const [argPresets, setArgPresets] = useState<{ name: string; args: string }[]>(presetsToArray(service?.argPresets));
  const [defaultArgPreset, setDefaultArgPreset] = useState<string | undefined>(service?.defaultArgPreset);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!service;

  // Reset form state when dialog opens or service changes
  useEffect(() => {
    if (isOpen) {
      setName(service?.name || '');
      setWorkingDir(service?.workingDir || '.');
      setCommand(service?.command || '');
      setPort(service?.port?.toString() || '');
      setColor(service?.color || SERVICE_COLORS[Math.floor(Math.random() * SERVICE_COLORS.length)]);
      setModes(modesToArray(service?.modes));
      setDefaultMode(service?.defaultMode);
      setExtraArgs(service?.extraArgs || '');
      setArgPresets(presetsToArray(service?.argPresets));
      setDefaultArgPreset(service?.defaultArgPreset);
      setError(null);
    }
  }, [isOpen, service]);

  const handleBrowseWorkingDir = async () => {
    if (!projectPath) return;

    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: projectPath,
        title: 'Select Working Directory',
      });

      if (selected && typeof selected === 'string') {
        const relativePath = getRelativePath(projectPath, selected);
        setWorkingDir(relativePath);

        // Auto-fill name if empty
        if (!name.trim() && relativePath !== '.') {
          // Use the last part of the path as the name
          const pathParts = relativePath.replace(/^\.\//, '').split('/');
          const folderName = pathParts[pathParts.length - 1];
          if (folderName) {
            setName(folderName);
          }
        }
      }
    } catch (error) {
      console.error('Failed to open folder dialog:', error);
    }
  };

  // Check if a valid default mode is set (mode exists and has a command)
  const hasValidDefaultMode = (() => {
    if (!defaultMode) return false;
    const mode = modes.find(m => m.name.trim() === defaultMode);
    return !!(mode && mode.command.trim());
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Service name is required');
      return;
    }

    // Command is only required if no default mode is set
    if (!hasValidDefaultMode && !command.trim()) {
      setError('Default command is required (or set a mode as default)');
      return;
    }

    setIsSubmitting(true);
    try {
      // Validate defaultMode exists in modes if set
      const modesObj = arrayToModes(modes);
      const validDefaultMode = defaultMode && modesObj && modesObj[defaultMode] ? defaultMode : undefined;

      // Validate defaultArgPreset exists in argPresets if set
      const argPresetsObj = arrayToPresets(argPresets);
      const validDefaultArgPreset = defaultArgPreset && argPresetsObj && argPresetsObj[defaultArgPreset] ? defaultArgPreset : undefined;

      const data: CreateServiceInput | UpdateServiceInput = {
        name: name.trim(),
        workingDir: workingDir.trim() || '.',
        command: command.trim() || '', // Can be empty if defaultMode is set
        modes: modesObj,
        defaultMode: validDefaultMode,
        extraArgs: extraArgs.trim() || undefined,
        argPresets: argPresetsObj,
        defaultArgPreset: validDefaultArgPreset,
        color,
        port: port ? parseInt(port, 10) : undefined,
      };
      await onSubmit(data);
      onOpenChange(false);
      // Reset form
      if (!isEditing) {
        setName('');
        setWorkingDir('.');
        setCommand('');
        setPort('');
        setModes([]);
        setDefaultMode(undefined);
        setExtraArgs('');
        setArgPresets([]);
        setDefaultArgPreset(undefined);
        setColor(SERVICE_COLORS[Math.floor(Math.random() * SERVICE_COLORS.length)]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const addMode = () => {
    setModes([...modes, { name: '', command: '' }]);
  };

  const updateMode = (index: number, field: 'name' | 'command', value: string) => {
    const newModes = [...modes];
    newModes[index] = { ...newModes[index], [field]: value };
    setModes(newModes);
  };

  const removeMode = (index: number) => {
    const removedMode = modes[index];
    setModes(modes.filter((_, i) => i !== index));
    // Clear defaultMode if we removed it
    if (removedMode && removedMode.name.trim() === defaultMode) {
      setDefaultMode(undefined);
    }
  };

  // Arg preset management
  const addArgPreset = () => {
    setArgPresets([...argPresets, { name: '', args: '' }]);
  };

  const updateArgPreset = (index: number, field: 'name' | 'args', value: string) => {
    const newPresets = [...argPresets];
    newPresets[index] = { ...newPresets[index], [field]: value };
    setArgPresets(newPresets);
  };

  const removeArgPreset = (index: number) => {
    const removedPreset = argPresets[index];
    setArgPresets(argPresets.filter((_, i) => i !== index));
    // Clear defaultArgPreset if we removed it
    if (removedPreset && removedPreset.name.trim() === defaultArgPreset) {
      setDefaultArgPreset(undefined);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit service' : 'Add new service'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the service configuration.'
                : 'Add a new service to this project (e.g., frontend, backend, database).'}
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 min-h-0 flex-1 space-y-5 overflow-y-auto px-6">
            {/* Identity */}
            <div className="space-y-4">
              <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="service-name" className={LABEL}>Service name *</Label>
                  <Input
                    id="service-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Frontend, Backend, API"
                  />
                </div>
                <div className="grid gap-2">
                  <Label className={LABEL}>Color</Label>
                  <div className="flex h-9 items-center gap-1.5">
                    {SERVICE_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        aria-pressed={color === c}
                        className={cn(
                          'size-5 rounded-full transition-transform hover:scale-110',
                          color === c && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                        )}
                        style={{ backgroundColor: c }}
                        onClick={() => setColor(c)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="working-dir" className={LABEL}>Working directory</Label>
                <div className="flex gap-2">
                  <Input
                    id="working-dir"
                    value={workingDir}
                    onChange={(e) => setWorkingDir(e.target.value)}
                    placeholder="Relative path from project root (e.g., ./frontend)"
                    className={cn('flex-1', MONO)}
                  />
                  {projectPath && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={handleBrowseWorkingDir}
                      aria-label="Browse"
                    >
                      <FolderOpen />
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave as "." to use the project root directory
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="command" className={LABEL}>
                  Default command {hasValidDefaultMode ? '(using mode)' : '*'}
                </Label>
                <Input
                  id="command"
                  value={hasValidDefaultMode ? `Using "${defaultMode}" mode` : command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="e.g., npm run dev, cargo run"
                  disabled={hasValidDefaultMode}
                  className={MONO}
                />
                <p className="text-xs text-muted-foreground">
                  {hasValidDefaultMode
                    ? `The "${defaultMode}" mode command will be used as default`
                    : 'The command used when starting without a specific mode'}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="port" className={LABEL}>Port (optional)</Label>
                <Input
                  id="port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="e.g., 3000"
                  className={cn('w-40', MONO)}
                />
                <p className="text-xs text-muted-foreground">
                  The port this service runs on (for reference)
                </p>
              </div>
            </div>

            {/* Modes section */}
            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <span className="eyebrow">Modes (optional)</span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={addMode}
                >
                  <Plus />
                  Add mode
                </Button>
              </div>
              {modes.length > 0 ? (
                <div className="space-y-2">
                  {modes.map((mode, index) => {
                    const isDefault = mode.name.trim() === defaultMode;
                    return (
                      <div key={index} className="flex items-start gap-2">
                        <Input
                          value={mode.name}
                          onChange={(e) => updateMode(index, 'name', e.target.value)}
                          placeholder="Mode name (e.g., dev)"
                          className={cn('w-28 shrink-0', MONO)}
                        />
                        <Input
                          value={mode.command}
                          onChange={(e) => updateMode(index, 'command', e.target.value)}
                          placeholder="Command for this mode"
                          className={cn('flex-1', MONO)}
                        />
                        <DefaultStar
                          isDefault={isDefault}
                          label={isDefault ? 'Remove as default' : 'Set as default mode'}
                          onClick={() => {
                            const modeName = mode.name.trim();
                            if (modeName) {
                              setDefaultMode(isDefault ? undefined : modeName);
                            }
                          }}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeMode(index)}
                          aria-label="Remove mode"
                          className="text-faint hover:text-destructive"
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Add modes like "dev", "prod", or "test" to run the service with different commands
                </p>
              )}
            </div>

            {/* Arguments section */}
            <div className="space-y-4 border-t border-border pt-4">
              <span className="eyebrow">Arguments</span>
              <div className="grid gap-2">
                <Label htmlFor="extra-args" className={LABEL}>Extra arguments (optional)</Label>
                <Input
                  id="extra-args"
                  value={extraArgs}
                  onChange={(e) => setExtraArgs(e.target.value)}
                  placeholder="e.g., --verbose --debug"
                  className={MONO}
                />
                <p className="text-xs text-muted-foreground">
                  Static arguments always appended to the command
                </p>
              </div>

              {/* Arg presets */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className={LABEL}>Argument presets (optional)</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={addArgPreset}
                  >
                    <Plus />
                    Add preset
                  </Button>
                </div>
                {argPresets.length > 0 ? (
                  <div className="space-y-2">
                    {argPresets.map((preset, index) => {
                      const isDefault = preset.name.trim() === defaultArgPreset;
                      return (
                        <div key={index} className="flex items-start gap-2">
                          <Input
                            value={preset.name}
                            onChange={(e) => updateArgPreset(index, 'name', e.target.value)}
                            placeholder="Preset name"
                            className={cn('w-28 shrink-0', MONO)}
                          />
                          <Input
                            value={preset.args}
                            onChange={(e) => updateArgPreset(index, 'args', e.target.value)}
                            placeholder="Arguments (e.g., --config demo.toml)"
                            className={cn('flex-1', MONO)}
                          />
                          <DefaultStar
                            isDefault={isDefault}
                            label={isDefault ? 'Remove as default' : 'Set as default preset'}
                            onClick={() => {
                              const presetName = preset.name.trim();
                              if (presetName && preset.args.trim()) {
                                setDefaultArgPreset(isDefault ? undefined : presetName);
                              }
                            }}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeArgPreset(index)}
                            aria-label="Remove preset"
                            className="text-faint hover:text-destructive"
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Add presets like "demo", "stress-test" to run with different argument sets
                  </p>
                )}
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditing ? 'Save changes' : 'Add service'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
