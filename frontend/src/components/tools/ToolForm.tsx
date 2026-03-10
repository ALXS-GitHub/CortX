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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ComboboxInput } from '@/components/ui/combobox-input';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Plus, Trash2, FolderSearch, X } from 'lucide-react';
import { TagBadge } from '@/components/ui/TagBadge';
import type { Tool, TagDefinition, CreateToolInput, UpdateToolInput, ToolConfigPath } from '@/types';

const TOOL_COLORS = [
  '#8b5cf6', '#06b6d4', '#f97316', '#22c55e',
  '#ec4899', '#eab308', '#3b82f6', '#ef4444',
];

const DEFAULT_STATUSES = ['Active', 'Inactive', 'To Test', 'Archived', 'Replaced'];

interface ToolFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tool?: Tool;
  tools: Tool[];
  tagDefinitions: TagDefinition[];
  onSubmit: (data: CreateToolInput | UpdateToolInput) => Promise<void>;
}

export function ToolForm({ open, onOpenChange, tool, tools, tagDefinitions, onSubmit }: ToolFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('Active');
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

  // Gather existing statuses
  const existingStatuses = Array.from(
    new Set([
      ...DEFAULT_STATUSES,
      ...tools.map(t => t.status).filter(Boolean),
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
        setStatus(tool.status || 'Active');
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
        setStatus('Active');
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
        status: status || 'Active',
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
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden flex-1">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{isEditing ? 'Edit Tool' : 'Add New Tool'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the tool configuration.'
                : 'Register a tool, CLI utility, or any dev environment component.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 overflow-y-auto flex-1 px-1">
            {/* Main Section */}
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="tool-name">Name *</Label>
                <Input
                  id="tool-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., starship, wezterm, fzf"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="tool-description">Description</Label>
                <Textarea
                  id="tool-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this tool?"
                  rows={2}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="tool-status">Status</Label>
                <ComboboxInput
                  id="tool-status"
                  value={status}
                  onChange={setStatus}
                  options={existingStatuses}
                  placeholder="e.g., Active, To Test"
                />
              </div>

              {status.toLowerCase() === 'replaced' && (
                <div className="grid gap-2">
                  <Label htmlFor="tool-replaced-by">Replaced By</Label>
                  <Select value={replacedBy || '__none__'} onValueChange={(v) => setReplacedBy(v === '__none__' ? '' : v)}>
                    <SelectTrigger>
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

              <div className="grid gap-2">
                <Label>Tags</Label>
                <div className="flex flex-wrap gap-1.5 p-2 border rounded-md min-h-[38px] focus-within:ring-2 focus-within:ring-ring">
                  {tags.map((tag) => (
                    <span key={tag} className="flex items-center gap-1">
                      <TagBadge tag={tag} tagDefinitions={tagDefinitions} />
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => removeTag(tag)}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  <div className="relative flex-1 min-w-[120px]">
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
                      placeholder={tags.length === 0 ? 'Add tags...' : ''}
                      className="w-full bg-transparent border-none outline-none text-sm py-0.5"
                    />
                    {showTagSuggestions && tagSuggestions.length > 0 && (
                      <div
                        ref={suggestionsRef}
                        className="absolute top-full left-0 z-50 mt-1 w-56 max-h-48 overflow-y-auto bg-popover border rounded-md shadow-md"
                      >
                        {tagSuggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-muted text-left cursor-pointer"
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
                <p className="text-xs text-muted-foreground">
                  Type and press Enter to add a tag, or select from suggestions
                </p>
              </div>

              <div className="grid gap-2">
                <Label>Color</Label>
                <div className="flex gap-2 items-center h-9">
                  {TOOL_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`size-6 rounded-full transition-all ${
                        color === c ? 'ring-2 ring-offset-2 ring-primary' : ''
                      }`}
                      style={{ backgroundColor: c }}
                      onClick={() => setColor(c)}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Installation Section */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-3">Installation</h4>
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="tool-install-method">Install Method</Label>
                    <Input
                      id="tool-install-method"
                      value={installMethod}
                      onChange={(e) => setInstallMethod(e.target.value)}
                      placeholder="e.g., scoop, cargo, winget"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="tool-version">Version</Label>
                    <Input
                      id="tool-version"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      placeholder="e.g., 1.16.0"
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="tool-install-location">Install Location</Label>
                  <div className="flex gap-2">
                    <Input
                      id="tool-install-location"
                      value={installLocation}
                      onChange={(e) => setInstallLocation(e.target.value)}
                      placeholder="Path to installation directory"
                      className="flex-1"
                    />
                    <Button type="button" variant="outline" onClick={handleBrowseInstallLocation} title="Browse">
                      <FolderSearch className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="tool-homepage">Homepage URL</Label>
                  <Input
                    id="tool-homepage"
                    value={homepage}
                    onChange={(e) => setHomepage(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>
            </div>

            {/* Configuration Section */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium">Configuration Paths</h4>
                <Button type="button" variant="outline" size="sm" onClick={addConfigPath}>
                  <Plus className="size-3.5 mr-1.5" />
                  Add Config
                </Button>
              </div>
              {configPaths.length > 0 ? (
                <div className="space-y-3">
                  {configPaths.map((cp, index) => (
                    <div key={index} className="flex items-start gap-2 p-3 border rounded-md">
                      <div className="flex-1 grid gap-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            value={cp.label}
                            onChange={(e) => updateConfigPath(index, 'label', e.target.value)}
                            placeholder="Label (e.g., Main config)"
                            className="text-sm"
                          />
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                              <input
                                type="checkbox"
                                checked={cp.isDirectory}
                                onChange={(e) => updateConfigPath(index, 'isDirectory', e.target.checked)}
                                className="rounded"
                              />
                              Directory
                            </label>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            value={cp.path}
                            onChange={(e) => updateConfigPath(index, 'path', e.target.value)}
                            placeholder="Path to config file or directory"
                            className="flex-1 text-sm font-mono"
                          />
                          <Button type="button" variant="outline" size="sm" onClick={() => browseConfigPath(index)} title="Browse">
                            <FolderSearch className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive shrink-0"
                        onClick={() => removeConfigPath(index)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No configuration paths added yet.</p>
              )}
            </div>

            {/* Documentation Section */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-3">Documentation</h4>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="tool-toolbox-url">Toolbox URL</Label>
                  <Input
                    id="tool-toolbox-url"
                    value={toolboxUrl}
                    onChange={(e) => setToolboxUrl(e.target.value)}
                    placeholder="https://toolbox.example.com/tools/..."
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="tool-notes">Notes</Label>
                  <Textarea
                    id="tool-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any additional notes about this tool..."
                    rows={3}
                  />
                </div>
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="flex-shrink-0 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Tool'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
