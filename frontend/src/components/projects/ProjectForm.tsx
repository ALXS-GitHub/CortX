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
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/stores/appStore';
import type { Project, CreateProjectInput, UpdateProjectInput } from '@/types';
import { open } from '@tauri-apps/plugin-dialog';
import { ComboboxInput } from '@/components/ui/combobox-input';
import { FolderOpen, X } from 'lucide-react';

interface ProjectFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  onSubmit: (data: CreateProjectInput | UpdateProjectInput) => Promise<void>;
}

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

  const getTagDef = (tag: string) =>
    tagDefinitions.find((d) => d.name.toLowerCase() === tag.toLowerCase());

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
            status: status.trim() || undefined,
            toolboxUrl: toolboxUrl.trim() || undefined,
          }
        : {
            name: name.trim(),
            rootPath: rootPath.trim(),
            description: description.trim() || undefined,
            tags,
            status: status.trim() || undefined,
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
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Project' : 'Add New Project'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update your project details below.'
                : 'Add a new project to your dashboard.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Project Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Awesome Project"
              />
            </div>

            {!isEditing && (
              <div className="grid gap-2">
                <Label htmlFor="path">Project Path *</Label>
                <div className="flex gap-2">
                  <Input
                    id="path"
                    value={rootPath}
                    onChange={(e) => setRootPath(e.target.value)}
                    placeholder="C:\Projects\my-project"
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" onClick={handleBrowse}>
                    <FolderOpen className="size-4" />
                  </Button>
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A brief description of your project..."
                rows={3}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="proj-status">Status</Label>
              <ComboboxInput
                id="proj-status"
                value={status}
                onChange={setStatus}
                options={statusDefinitions.map((d) => d.name)}
                placeholder="e.g., Active, In Progress"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="proj-toolbox-url">Toolbox URL</Label>
              <Input
                id="proj-toolbox-url"
                value={toolboxUrl}
                onChange={(e) => setToolboxUrl(e.target.value)}
                placeholder="https://toolbox.example.com/projects/..."
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="proj-tags">Tags</Label>
              <div className="relative">
                <div className="flex flex-wrap gap-1 items-center border rounded-md px-2 py-1.5 min-h-[36px] focus-within:ring-1 focus-within:ring-ring">
                  {tags.map((tag) => {
                    const def = getTagDef(tag);
                    return (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="text-xs gap-1 py-0"
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
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
