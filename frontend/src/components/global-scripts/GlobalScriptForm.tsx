import { useState, useEffect, useRef } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FileSearch, X } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import type { GlobalScript, CreateGlobalScriptInput, UpdateGlobalScriptInput } from '@/types';

const SCRIPT_COLORS = [
  '#8b5cf6', '#06b6d4', '#f97316', '#22c55e',
  '#ec4899', '#eab308', '#3b82f6', '#ef4444',
];

interface GlobalScriptFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  script?: GlobalScript;
  onSubmit: (data: CreateGlobalScriptInput | UpdateGlobalScriptInput) => Promise<void>;
}

export function GlobalScriptForm({ open, onOpenChange, script, onSubmit }: GlobalScriptFormProps) {
  const { tagDefinitions } = useAppStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [command, setCommand] = useState('');
  const [scriptPath, setScriptPath] = useState('');
  const [workingDir, setWorkingDir] = useState('');
  const [color, setColor] = useState(SCRIPT_COLORS[0]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const isEditing = !!script;

  const handleBrowseScriptPath = async () => {
    try {
      const selected = await openDialog({
        directory: false,
        multiple: false,
        title: 'Select Script File',
        filters: [
          {
            name: 'Scripts',
            extensions: ['sh', 'ps1', 'bat', 'cmd', 'py', 'js', 'ts', 'rb', 'pl', '*'],
          },
        ],
      });
      if (selected && typeof selected === 'string') {
        setScriptPath(selected);
        if (!name.trim()) {
          const normalized = selected.replace(/\\/g, '/');
          const lastSlash = normalized.lastIndexOf('/');
          const filename = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
          const lastDot = filename.lastIndexOf('.');
          setName(lastDot > 0 ? filename.slice(0, lastDot) : filename);
        }
        if (!workingDir.trim()) {
          const normalized = selected.replace(/\\/g, '/');
          const lastSlash = normalized.lastIndexOf('/');
          setWorkingDir(lastSlash >= 0 ? normalized.slice(0, lastSlash) : '.');
        }
      }
    } catch (error) {
      console.error('Failed to open file dialog:', error);
    }
  };

  useEffect(() => {
    if (open) {
      if (script) {
        setName(script.name);
        setDescription(script.description || '');
        setCommand(script.command);
        setScriptPath(script.scriptPath || '');
        setWorkingDir(script.workingDir || '');
        setColor(script.color || SCRIPT_COLORS[0]);
        setTags([...script.tags]);
      } else {
        setName('');
        setDescription('');
        setCommand('');
        setScriptPath('');
        setWorkingDir('');
        setColor(SCRIPT_COLORS[Math.floor(Math.random() * SCRIPT_COLORS.length)]);
        setTags([]);
      }
      setTagInput('');
      setShowTagSuggestions(false);
      setError(null);
    }
  }, [open, script]);

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed && !tags.some((t) => t.toLowerCase() === trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput('');
    setShowTagSuggestions(false);
    tagInputRef.current?.focus();
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (tagInput.trim()) {
        addTag(tagInput);
      }
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  };

  const tagSuggestions = tagInput.trim()
    ? tagDefinitions.filter(
        (d) =>
          d.name.toLowerCase().includes(tagInput.toLowerCase()) &&
          !tags.some((t) => t.toLowerCase() === d.name.toLowerCase())
      )
    : tagDefinitions.filter(
        (d) => !tags.some((t) => t.toLowerCase() === d.name.toLowerCase())
      );

  const getTagDef = (tag: string) =>
    tagDefinitions.find((d) => d.name.toLowerCase() === tag.toLowerCase());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Script name is required');
      return;
    }
    if (!command.trim()) {
      setError('Command is required');
      return;
    }
    setIsSubmitting(true);
    try {
      const data: CreateGlobalScriptInput | UpdateGlobalScriptInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        command: command.trim(),
        scriptPath: scriptPath.trim() || undefined,
        workingDir: workingDir.trim() || undefined,
        color,
        tags: tags.length > 0 ? tags : undefined,
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
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden flex-1">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{isEditing ? 'Edit Script' : 'Add New Global Script'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the script configuration.'
                : 'Add a global script for common tasks, automation, or CLI tools.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 overflow-y-auto flex-1 px-1">
            <div className="grid gap-2">
              <Label htmlFor="gs-name">Name *</Label>
              <Input
                id="gs-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Docker Cleanup, Deploy Staging"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="gs-description">Description</Label>
              <Textarea
                id="gs-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this script do?"
                rows={2}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="gs-command">Command *</Label>
              <Input
                id="gs-command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g., python {{SCRIPT_FILE}} --verbose"
              />
              {scriptPath && command.includes('{{SCRIPT_FILE}}') && (
                <p className="text-xs text-muted-foreground">
                  <code className="bg-muted px-1 rounded">{'{{SCRIPT_FILE}}'}</code> will be replaced with the script file path at runtime.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="gs-script-path">Script File (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="gs-script-path"
                  value={scriptPath}
                  onChange={(e) => setScriptPath(e.target.value)}
                  placeholder="Path to script file"
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={handleBrowseScriptPath} title="Browse">
                  <FileSearch className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use <code className="bg-muted px-1 rounded">{'{{SCRIPT_FILE}}'}</code> in the command to reference this path.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="gs-tags">Tags</Label>
              <div className="relative">
                <div className="flex flex-wrap gap-1 items-center border rounded-md px-2 py-1.5 min-h-[36px] focus-within:ring-1 focus-within:ring-ring">
                  {tags.map((tag) => {
                    const def = getTagDef(tag);
                    return (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="text-xs gap-1 pr-1"
                        style={
                          def?.color
                            ? {
                                borderColor: def.color,
                                color: def.color,
                                backgroundColor: `${def.color}10`,
                              }
                            : undefined
                        }
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          className="hover:bg-muted rounded-sm p-0.5"
                        >
                          <X className="size-2.5" />
                        </button>
                      </Badge>
                    );
                  })}
                  <input
                    ref={tagInputRef}
                    id="gs-tags"
                    value={tagInput}
                    onChange={(e) => {
                      setTagInput(e.target.value);
                      setShowTagSuggestions(true);
                    }}
                    onFocus={() => setShowTagSuggestions(true)}
                    onBlur={() => {
                      // Delay to allow click on suggestion
                      setTimeout(() => setShowTagSuggestions(false), 150);
                    }}
                    onKeyDown={handleTagInputKeyDown}
                    placeholder={tags.length === 0 ? 'Type to add tags...' : ''}
                    className="flex-1 min-w-[80px] bg-transparent outline-none text-sm"
                  />
                </div>
                {showTagSuggestions && tagSuggestions.length > 0 && (
                  <div className="absolute z-10 top-full mt-1 w-full bg-popover border rounded-md shadow-md max-h-32 overflow-y-auto">
                    {tagSuggestions.map((def) => (
                      <button
                        key={def.name}
                        type="button"
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-muted text-left"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addTag(def.name);
                        }}
                      >
                        {def.color && (
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: def.color }}
                          />
                        )}
                        {def.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Press Enter or comma to add a tag. Type to see suggestions.
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                {SCRIPT_COLORS.map((c) => (
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

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="flex-shrink-0 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Script'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
