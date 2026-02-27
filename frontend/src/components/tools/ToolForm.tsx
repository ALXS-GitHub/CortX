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
import { Plus, Trash2, FolderSearch } from 'lucide-react';
import type { Tool, VirtualFolder, CreateToolInput, UpdateToolInput, ToolConfigPath } from '@/types';

const TOOL_COLORS = [
  '#8b5cf6', '#06b6d4', '#f97316', '#22c55e',
  '#ec4899', '#eab308', '#3b82f6', '#ef4444',
];

const DEFAULT_CATEGORIES = [
  'CLI Tool', 'Terminal', 'Shell', 'Prompt', 'Editor/IDE',
  'Window Manager', 'Font', 'Theme', 'Desktop/Ricing',
  'DevOps', 'Language/Runtime', 'Browser', 'Utility',
];

const DEFAULT_STATUSES = ['Active', 'Inactive', 'To Test', 'Archived', 'Replaced'];

interface ToolFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tool?: Tool;
  tools: Tool[];
  folders: VirtualFolder[];
  onSubmit: (data: CreateToolInput | UpdateToolInput) => Promise<void>;
}

export function ToolForm({ open, onOpenChange, tool, tools, folders, onSubmit }: ToolFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('Active');
  const [replacedBy, setReplacedBy] = useState('');
  const [tags, setTags] = useState('');
  const [installMethod, setInstallMethod] = useState('');
  const [installLocation, setInstallLocation] = useState('');
  const [version, setVersion] = useState('');
  const [homepage, setHomepage] = useState('');
  const [configPaths, setConfigPaths] = useState<ToolConfigPath[]>([]);
  const [toolboxUrl, setToolboxUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [folderId, setFolderId] = useState('');
  const [color, setColor] = useState(TOOL_COLORS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!tool;
  const toolFolders = folders.filter(f => f.folderType === 'tool');

  // Gather existing categories from all tools for suggestions
  const existingCategories = Array.from(
    new Set([
      ...DEFAULT_CATEGORIES,
      ...tools.map(t => t.category).filter(Boolean) as string[],
    ])
  );

  // Gather existing statuses
  const existingStatuses = Array.from(
    new Set([
      ...DEFAULT_STATUSES,
      ...tools.map(t => t.status).filter(Boolean),
    ])
  );

  useEffect(() => {
    if (open) {
      if (tool) {
        setName(tool.name);
        setDescription(tool.description || '');
        setCategory(tool.category || '');
        setStatus(tool.status || 'Active');
        setReplacedBy(tool.replacedBy || '');
        setTags(tool.tags.join(', '));
        setInstallMethod(tool.installMethod || '');
        setInstallLocation(tool.installLocation || '');
        setVersion(tool.version || '');
        setHomepage(tool.homepage || '');
        setConfigPaths(tool.configPaths.map(cp => ({ ...cp })));
        setToolboxUrl(tool.toolboxUrl || '');
        setNotes(tool.notes || '');
        setFolderId(tool.folderId || '');
        setColor(tool.color || TOOL_COLORS[0]);
      } else {
        setName('');
        setDescription('');
        setCategory('');
        setStatus('Active');
        setReplacedBy('');
        setTags('');
        setInstallMethod('');
        setInstallLocation('');
        setVersion('');
        setHomepage('');
        setConfigPaths([]);
        setToolboxUrl('');
        setNotes('');
        setFolderId('');
        setColor(TOOL_COLORS[Math.floor(Math.random() * TOOL_COLORS.length)]);
      }
      setError(null);
    }
  }, [open, tool]);

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
      const parsedTags = tags.split(',').map(t => t.trim()).filter(Boolean);
      const validConfigs = configPaths.filter(cp => cp.path.trim());

      const data: CreateToolInput | UpdateToolInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        tags: parsedTags.length > 0 ? parsedTags : undefined,
        status: status || 'Active',
        replacedBy: replacedBy.trim() || undefined,
        installMethod: installMethod.trim() || undefined,
        installLocation: installLocation.trim() || undefined,
        version: version.trim() || undefined,
        homepage: homepage.trim() || undefined,
        configPaths: validConfigs.length > 0 ? validConfigs : undefined,
        toolboxUrl: toolboxUrl.trim() || undefined,
        notes: notes.trim() || undefined,
        folderId: folderId || undefined,
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

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="tool-category">Category</Label>
                  <ComboboxInput
                    id="tool-category"
                    value={category}
                    onChange={setCategory}
                    options={existingCategories}
                    placeholder="e.g., CLI Tool, Terminal"
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
                <Label htmlFor="tool-tags">Tags</Label>
                <Input
                  id="tool-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="cli, prompt, rust (comma-separated)"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {toolFolders.length > 0 && (
                  <div className="grid gap-2">
                    <Label>Folder</Label>
                    <Select value={folderId || '__none__'} onValueChange={(v) => setFolderId(v === '__none__' ? '' : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="No folder" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No folder</SelectItem>
                        {toolFolders.map((f) => (
                          <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

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
