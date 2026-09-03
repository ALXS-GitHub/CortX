import { useState, useEffect, useRef, useMemo } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ComboboxInput } from '@/components/ui/combobox-input';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Plus, Trash2, FolderSearch } from 'lucide-react';
import { TagBadge } from '@/components/ui/TagBadge';
import { cn } from '@/lib/utils';
import type { Tool, TagDefinition, StatusDefinition, CreateToolInput, UpdateToolInput, ToolConfigPath } from '@/types';

const TOOL_COLORS = [
  '#8b5cf6', '#06b6d4', '#f97316', '#22c55e',
  '#ec4899', '#eab308', '#3b82f6', '#ef4444',
];

const labelClass = 'text-xs font-medium text-muted-foreground';
const hintClass = 'text-xs text-faint';

interface ToolFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tool?: Tool;
  tools: Tool[];
  tagDefinitions: TagDefinition[];
  statusDefinitions?: StatusDefinition[];
  onSubmit: (data: CreateToolInput | UpdateToolInput) => Promise<void>;
}

export function ToolForm({ open, onOpenChange, tool, tools, tagDefinitions, statusDefinitions = [], onSubmit }: ToolFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('');
  const [replacedBy, setReplacedBy] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [installMethod, setInstallMethod] = useState('');
  const [installLocation, setInstallLocation] = useState('');
  const [version, setVersion] = useState('');
  const [homepage, setHomepage] = useState('');
  const [configPaths, setConfigPaths] = useState<ToolConfigPath[]>([]);
  const [toolboxUrl, setToolboxUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [color, setColor] = useState(TOOL_COLORS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const isEditing = !!tool;

  // Gather existing statuses from definitions + tools
  const existingStatuses = Array.from(
    new Set([
      ...statusDefinitions.map(d => d.name),
      ...tools.map(t => t.status).filter(Boolean) as string[],
    ])
  );

  // All known tag names for autocomplete (from definitions + existing tools)
  const allKnownTags = useMemo(() => {
    const set = new Set<string>();
    for (const td of tagDefinitions) set.add(td.name);
    for (const t of tools) {
      for (const tag of t.tags) set.add(tag);
    }
    return Array.from(set).sort();
  }, [tagDefinitions, tools]);

  // Filtered suggestions based on current input
  const tagSuggestions = useMemo(() => {
    if (!tagInput.trim()) return allKnownTags.filter((t) => !tags.includes(t));
    const q = tagInput.toLowerCase();
    return allKnownTags.filter(
      (t) => t.toLowerCase().includes(q) && !tags.includes(t)
    );
  }, [tagInput, allKnownTags, tags]);

  useEffect(() => {
    if (open) {
      if (tool) {
        setName(tool.name);
        setDescription(tool.description || '');
        setStatus(tool.status || '');
        setReplacedBy(tool.replacedBy || '');
        setTags([...tool.tags]);
        setTagInput('');
        setInstallMethod(tool.installMethod || '');
        setInstallLocation(tool.installLocation || '');
        setVersion(tool.version || '');
        setHomepage(tool.homepage || '');
        setConfigPaths(tool.configPaths.map(cp => ({ ...cp })));
        setToolboxUrl(tool.toolboxUrl || '');
        setNotes(tool.notes || '');
        setColor(tool.color || TOOL_COLORS[0]);
      } else {
        setName('');
        setDescription('');
        setStatus('');
        setReplacedBy('');
        setTags([]);
        setTagInput('');
        setInstallMethod('');
        setInstallLocation('');
        setVersion('');
        setHomepage('');
        setConfigPaths([]);
        setToolboxUrl('');
        setNotes('');
        setColor(TOOL_COLORS[Math.floor(Math.random() * TOOL_COLORS.length)]);
      }
      setError(null);
      setShowTagSuggestions(false);
    }
  }, [open, tool]);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        tagInputRef.current &&
        !tagInputRef.current.contains(e.target as Node)
      ) {
        setShowTagSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput('');
    setShowTagSuggestions(false);
    tagInputRef.current?.focus();
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (tagInput.trim()) {
        addTag(tagInput);
      }
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    } else if (e.key === 'Escape') {
      setShowTagSuggestions(false);
    }
  };

  const handleBrowseInstallLocation = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: 'Select Install Location' });
      if (selected && typeof selected === 'string') {
        setInstallLocation(selected);
      }
    } catch (e) {
      console.error('Failed to open dialog:', e);
    }
  };

  const addConfigPath = () => {
    setConfigPaths([...configPaths, { label: '', path: '', isDirectory: false }]);
  };

  const removeConfigPath = (index: number) => {
    setConfigPaths(configPaths.filter((_, i) => i !== index));
  };

  const updateConfigPath = (index: number, field: keyof ToolConfigPath, value: string | boolean) => {
    setConfigPaths(configPaths.map((cp, i) => i === index ? { ...cp, [field]: value } : cp));
  };

  const browseConfigPath = async (index: number) => {
    try {
      const isDir = configPaths[index].isDirectory;
      const selected = await openDialog({
        directory: isDir,
        multiple: false,
        title: isDir ? 'Select Config Directory' : 'Select Config File',
      });
      if (selected && typeof selected === 'string') {
        updateConfigPath(index, 'path', selected);
      }
    } catch (e) {
      console.error('Failed to open dialog:', e);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Tool name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const validConfigs = configPaths.filter(cp => cp.path.trim());

      const data: CreateToolInput | UpdateToolInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        // Sent even when empty: an empty status is how the backend is told to clear it.
        status: status.trim(),
        replacedBy: replacedBy.trim() || undefined,
        installMethod: installMethod.trim() || undefined,
        installLocation: installLocation.trim() || undefined,
        version: version.trim() || undefined,
        homepage: homepage.trim() || undefined,
        configPaths: validConfigs.length > 0 ? validConfigs : undefined,
        toolboxUrl: toolboxUrl.trim() || undefined,
        notes: notes.trim() || undefined,
        color,
      };
      await onSubmit(data);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit tool' : 'Add tool'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the tool configuration.'
                : 'Register a tool, CLI utility, or any dev environment component.'}
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
            <div className="space-y-5">
              {/* Main */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="tool-name" className={labelClass}>Name *</Label>
                  <Input
                    id="tool-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., starship, wezterm, fzf"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="tool-description" className={labelClass}>Description</Label>
                  <Textarea
                    id="tool-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is this tool?"
                    rows={2}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="tool-status" className={labelClass}>Status</Label>
                    <ComboboxInput
                      id="tool-status"
                      value={status}
                      onChange={setStatus}
                      options={existingStatuses}
                      placeholder="e.g., Active, To Test"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className={labelClass}>Color</Label>
                    <div className="flex h-9 items-center gap-2">
                      {TOOL_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          title={c}
                          aria-pressed={color === c}
                          className={cn(
                            'size-6 rounded-full transition-[transform,box-shadow] hover:scale-110',
                            color === c && 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                          )}
                          style={{ backgroundColor: c }}
                          onClick={() => setColor(c)}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {status.toLowerCase() === 'replaced' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="tool-replaced-by" className={labelClass}>Replaced by</Label>
                    <Select value={replacedBy || '__none__'} onValueChange={(v) => setReplacedBy(v === '__none__' ? '' : v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select replacement tool" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {tools.filter(t => t.id !== tool?.id).map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className={labelClass}>Tags</Label>
                  <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-sm border border-input bg-[var(--bg-input)] px-2 py-1.5 shadow-soft transition-[border-color,box-shadow] focus-within:border-accent-border focus-within:ring-2 focus-within:ring-ring/40">
                    {tags.map((tag) => (
                      <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} onRemove={() => removeTag(tag)} />
                    ))}
                    <div className="relative min-w-[120px] flex-1">
                      <input
                        ref={tagInputRef}
                        type="text"
                        value={tagInput}
                        onChange={(e) => {
                          setTagInput(e.target.value);
                          setShowTagSuggestions(true);
                        }}
                        onFocus={() => setShowTagSuggestions(true)}
                        onKeyDown={handleTagInputKeyDown}
                        placeholder={tags.length === 0 ? 'Add tags…' : ''}
                        className="w-full border-none bg-transparent py-0.5 text-sm outline-none placeholder:text-faint"
                      />
                      {showTagSuggestions && tagSuggestions.length > 0 && (
                        <div
                          ref={suggestionsRef}
                          className="glass-strong absolute left-0 top-full z-50 mt-1.5 max-h-48 w-56 overflow-y-auto rounded-sm border border-border-strong p-1 shadow-pop"
                        >
                          {tagSuggestions.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              className="flex w-full items-center gap-2 rounded-[calc(var(--radius-sm)-2px)] px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                addTag(suggestion);
                              }}
                            >
                              <TagBadge tag={suggestion} tagDefinitions={tagDefinitions} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <p className={hintClass}>Type and press Enter to add a tag, or pick a suggestion.</p>
                </div>
              </div>

              {/* Installation */}
              <div className="space-y-4 border-t border-border pt-4">
                <span className="eyebrow">Installation</span>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="tool-install-method" className={labelClass}>Install method</Label>
                    <Input
                      id="tool-install-method"
                      value={installMethod}
                      onChange={(e) => setInstallMethod(e.target.value)}
                      placeholder="e.g., scoop, cargo, winget"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tool-version" className={labelClass}>Version</Label>
                    <Input
                      id="tool-version"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      placeholder="e.g., 1.16.0"
                      className="font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="tool-install-location" className={labelClass}>Install location</Label>
                  <div className="flex gap-2">
                    <Input
                      id="tool-install-location"
                      value={installLocation}
                      onChange={(e) => setInstallLocation(e.target.value)}
                      placeholder="Path to installation directory"
                      className="flex-1 font-mono"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={handleBrowseInstallLocation} title="Browse" aria-label="Browse">
                      <FolderSearch />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="tool-homepage" className={labelClass}>Homepage URL</Label>
                  <Input
                    id="tool-homepage"
                    value={homepage}
                    onChange={(e) => setHomepage(e.target.value)}
                    placeholder="https://…"
                  />
                </div>
              </div>

              {/* Configuration paths */}
              <div className="space-y-3 border-t border-border pt-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="eyebrow">Configuration paths</span>
                  <Button type="button" variant="outline" size="xs" onClick={addConfigPath}>
                    <Plus />
                    Add config
                  </Button>
                </div>
                {configPaths.length > 0 ? (
                  <div className="space-y-2">
                    {configPaths.map((cp, index) => (
                      <div key={index} className="flex items-start gap-2 rounded-lg border border-border bg-card/50 p-3">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-3">
                            <Input
                              value={cp.label}
                              onChange={(e) => updateConfigPath(index, 'label', e.target.value)}
                              placeholder="Label (e.g., Main config)"
                              className="flex-1"
                            />
                            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                              <Checkbox
                                checked={cp.isDirectory}
                                onCheckedChange={(v) => updateConfigPath(index, 'isDirectory', v === true)}
                              />
                              Directory
                            </label>
                          </div>
                          <div className="flex gap-2">
                            <Input
                              value={cp.path}
                              onChange={(e) => updateConfigPath(index, 'path', e.target.value)}
                              placeholder="Path to config file or directory"
                              className="flex-1 font-mono"
                            />
                            <Button type="button" variant="outline" size="icon" onClick={() => browseConfigPath(index)} title="Browse" aria-label="Browse">
                              <FolderSearch />
                            </Button>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 text-destructive hover:text-destructive"
                          onClick={() => removeConfigPath(index)}
                          title="Remove"
                          aria-label="Remove config path"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={hintClass}>No configuration paths yet.</p>
                )}
              </div>

              {/* Documentation */}
              <div className="space-y-4 border-t border-border pt-4">
                <span className="eyebrow">Documentation</span>
                <div className="space-y-1.5">
                  <Label htmlFor="tool-toolbox-url" className={labelClass}>Toolbox URL</Label>
                  <Input
                    id="tool-toolbox-url"
                    value={toolboxUrl}
                    onChange={(e) => setToolboxUrl(e.target.value)}
                    placeholder="https://toolbox.example.com/tools/…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tool-notes" className={labelClass}>Notes</Label>
                  <Textarea
                    id="tool-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any additional notes about this tool…"
                    rows={3}
                  />
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : isEditing ? 'Save changes' : 'Add tool'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
