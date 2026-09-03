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
import { TagBadge } from '@/components/ui/TagBadge';
import { ComboboxInput } from '@/components/ui/combobox-input';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FileSearch } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  const { tagDefinitions, statusDefinitions } = useAppStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [command, setCommand] = useState('');
  const [scriptPath, setScriptPath] = useState('');
  const [workingDir, setWorkingDir] = useState('');
  const [status, setStatus] = useState('');
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
        setStatus(script.status || '');
        setColor(script.color || SCRIPT_COLORS[0]);
        setTags([...script.tags]);
      } else {
        setName('');
        setDescription('');
        setCommand('');
        setScriptPath('');
        setWorkingDir('');
        setStatus('');
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
        // Sent even when empty: an empty status is how the backend is told to clear it.
        status: status.trim(),
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
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit script' : 'Add script'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the script configuration.'
                : 'Add a global script for common tasks, automation, or CLI tools.'}
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6">
            <div className="space-y-2">
              <Label htmlFor="gs-name">Name *</Label>
              <Input
                id="gs-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Docker Cleanup, Deploy Staging"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gs-description">Description</Label>
              <Textarea
                id="gs-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this script do?"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gs-command">Command *</Label>
              <Input
                id="gs-command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g., python {{SCRIPT_FILE}} --verbose"
                className="font-mono text-[12px]"
              />
              {scriptPath && command.includes('{{SCRIPT_FILE}}') && (
                <p className="text-xs text-muted-foreground">
                  <code className="rounded-xs bg-muted px-1 font-mono">{'{{SCRIPT_FILE}}'}</code> will be replaced with the script file path at runtime.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="gs-script-path">Script file (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="gs-script-path"
                  value={scriptPath}
                  onChange={(e) => setScriptPath(e.target.value)}
                  placeholder="Path to script file"
                  className="flex-1 font-mono text-[12px]"
                />
                <Button type="button" variant="outline" size="icon" onClick={handleBrowseScriptPath} title="Browse" aria-label="Browse for script file">
                  <FileSearch />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use <code className="rounded-xs bg-muted px-1 font-mono">{'{{SCRIPT_FILE}}'}</code> in the command to reference this path.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="gs-tags">Tags</Label>
              <div className="relative">
                <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-sm border border-input bg-[var(--bg-input)] px-2 py-1.5 shadow-soft transition-[border-color,box-shadow] focus-within:border-accent-border focus-within:ring-2 focus-within:ring-ring/40">
                  {tags.map((tag) => (
                    <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} onRemove={() => removeTag(tag)} />
                  ))}
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
                    placeholder={tags.length === 0 ? 'Type to add tags…' : ''}
                    className="min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
                  />
                </div>
                {showTagSuggestions && tagSuggestions.length > 0 && (
                  <div className="glass-strong absolute top-full z-10 mt-1 max-h-36 w-full overflow-y-auto rounded-lg border border-border-strong p-1.5 shadow-pop">
                    {tagSuggestions.map((def) => (
                      <button
                        key={def.name}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-[calc(var(--radius-sm)-2px)] px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addTag(def.name);
                        }}
                      >
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: def.color || 'var(--text-faint)' }}
                        />
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

            <div className="space-y-2">
              <Label htmlFor="gs-status">Status</Label>
              <ComboboxInput
                id="gs-status"
                value={status}
                onChange={setStatus}
                options={statusDefinitions.map((d) => d.name)}
                placeholder="e.g., Active, Archived"
              />
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                {SCRIPT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Use colour ${c}`}
                    aria-pressed={color === c}
                    className={cn(
                      'size-6 rounded-full transition-[box-shadow,transform] hover:scale-110',
                      color === c && 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                    )}
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : isEditing ? 'Save changes' : 'Add script'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
