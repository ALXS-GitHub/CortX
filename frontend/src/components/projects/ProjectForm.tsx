import { useState, useRef, useEffect } from 'react';
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
import { TagBadge } from '@/components/ui/TagBadge';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/stores/appStore';
import type { Project, CreateProjectInput, UpdateProjectInput } from '@/types';
import { open } from '@tauri-apps/plugin-dialog';
import { ComboboxInput } from '@/components/ui/combobox-input';
import { FolderOpen } from 'lucide-react';

interface ProjectFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  onSubmit: (data: CreateProjectInput | UpdateProjectInput) => Promise<void>;
}

const LABEL = 'text-xs font-medium text-muted-foreground';

export function ProjectForm({ open: isOpen, onOpenChange, project, onSubmit }: ProjectFormProps) {
  const { tagDefinitions, statusDefinitions } = useAppStore();

  const [name, setName] = useState(project?.name || '');
  const [rootPath, setRootPath] = useState(project?.rootPath || '');
  const [description, setDescription] = useState(project?.description || '');
  const [status, setStatus] = useState(project?.status || '');
  const [toolboxUrl, setToolboxUrl] = useState(project?.toolboxUrl || '');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const isEditing = !!project;

  useEffect(() => {
    if (isOpen) {
      setName(project?.name || '');
      setRootPath(project?.rootPath || '');
      setDescription(project?.description || '');
      setStatus(project?.status || '');
      setToolboxUrl(project?.toolboxUrl || '');
      setTags(project?.tags || []);
      setTagInput('');
      setShowTagSuggestions(false);
      setError(null);
    }
  }, [isOpen, project]);

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

  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Project Directory',
      });
      if (selected && typeof selected === 'string') {
        setRootPath(selected);
        // Auto-fill name from folder name if empty
        if (!name) {
          const folderName = selected.split(/[/\\]/).pop();
          if (folderName) {
            setName(folderName);
          }
        }
      }
    } catch (e) {
      console.error('Failed to open directory picker:', e);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Project name is required');
      return;
    }

    if (!isEditing && !rootPath.trim()) {
      setError('Project path is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const data: CreateProjectInput | UpdateProjectInput = isEditing
        ? {
            name: name.trim(),
            description: description.trim() || undefined,
            tags,
            // Sent even when empty: an empty status is how the backend is told to clear it.
            status: status.trim(),
            toolboxUrl: toolboxUrl.trim() || undefined,
          }
        : {
            name: name.trim(),
            rootPath: rootPath.trim(),
            description: description.trim() || undefined,
            tags,
            // Sent even when empty: an empty status is how the backend is told to clear it.
            status: status.trim(),
            toolboxUrl: toolboxUrl.trim() || undefined,
          };
      await onSubmit(data);
      onOpenChange(false);
      // Reset form
      setName('');
      setRootPath('');
      setDescription('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit project' : 'Add new project'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update your project details below.'
                : 'Add a new project to your dashboard.'}
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6">
            <div className="grid gap-2">
              <Label htmlFor="name" className={LABEL}>Project name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Awesome Project"
              />
            </div>

            {!isEditing && (
              <div className="grid gap-2">
                <Label htmlFor="path" className={LABEL}>Project path *</Label>
                <div className="flex gap-2">
                  <Input
                    id="path"
                    value={rootPath}
                    onChange={(e) => setRootPath(e.target.value)}
                    placeholder="C:\Projects\my-project"
                    className="flex-1 font-mono text-[12px]"
                  />
                  <Button type="button" variant="outline" size="icon" onClick={handleBrowse} aria-label="Browse">
                    <FolderOpen />
                  </Button>
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="description" className={LABEL}>Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A brief description of your project..."
                rows={3}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="proj-status" className={LABEL}>Status</Label>
                <ComboboxInput
                  id="proj-status"
                  value={status}
                  onChange={setStatus}
                  options={statusDefinitions.map((d) => d.name)}
                  placeholder="e.g., Active, In Progress"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="proj-toolbox-url" className={LABEL}>Toolbox URL</Label>
                <Input
                  id="proj-toolbox-url"
                  value={toolboxUrl}
                  onChange={(e) => setToolboxUrl(e.target.value)}
                  placeholder="https://toolbox.example.com/…"
                  className="font-mono text-[12px]"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="proj-tags" className={LABEL}>Tags</Label>
              <div className="relative">
                <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-sm border border-input bg-[var(--bg-input)] px-2 py-1.5 shadow-soft transition-[border-color,box-shadow] focus-within:border-accent-border focus-within:ring-2 focus-within:ring-ring/40">
                  {tags.map((tag) => (
                    <TagBadge
                      key={tag}
                      tag={tag}
                      tagDefinitions={tagDefinitions}
                      onRemove={() => removeTag(tag)}
                    />
                  ))}
                  <input
                    ref={tagInputRef}
                    id="proj-tags"
                    value={tagInput}
                    onChange={(e) => {
                      setTagInput(e.target.value);
                      setShowTagSuggestions(true);
                    }}
                    onFocus={() => setShowTagSuggestions(true)}
                    onBlur={() => {
                      setTimeout(() => setShowTagSuggestions(false), 150);
                    }}
                    onKeyDown={handleTagInputKeyDown}
                    placeholder={tags.length === 0 ? 'Type to add tags...' : ''}
                    className="min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
                  />
                </div>
                {showTagSuggestions && tagSuggestions.length > 0 && (
                  <div className="glass-strong absolute top-full z-10 mt-1 max-h-32 w-full overflow-y-auto rounded-sm border border-border-strong p-1 shadow-pop">
                    {tagSuggestions.map((def) => (
                      <button
                        key={def.name}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-sm hover:bg-accent"
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
              {isSubmitting ? 'Saving...' : isEditing ? 'Save changes' : 'Add project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
