import { useState } from 'react';
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
import type { Project, CreateProjectInput, UpdateProjectInput } from '@/types';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';

interface ProjectFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  onSubmit: (data: CreateProjectInput | UpdateProjectInput) => Promise<void>;
}

export function ProjectForm({ open: isOpen, onOpenChange, project, onSubmit }: ProjectFormProps) {
  const [name, setName] = useState(project?.name || '');
  const [rootPath, setRootPath] = useState(project?.rootPath || '');
  const [description, setDescription] = useState(project?.description || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!project;

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
          }
        : {
            name: name.trim(),
            rootPath: rootPath.trim(),
            description: description.trim() || undefined,
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
