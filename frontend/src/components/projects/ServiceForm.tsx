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
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';
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

export function ServiceForm({ open: isOpen, onOpenChange, service, projectPath, onSubmit }: ServiceFormProps) {
  const [name, setName] = useState(service?.name || '');
  const [workingDir, setWorkingDir] = useState(service?.workingDir || '.');
  const [command, setCommand] = useState(service?.command || '');
  const [port, setPort] = useState(service?.port?.toString() || '');
  const [color, setColor] = useState(service?.color || SERVICE_COLORS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!service;

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Service name is required');
      return;
    }

    if (!command.trim()) {
      setError('Start command is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const data: CreateServiceInput | UpdateServiceInput = {
        name: name.trim(),
        workingDir: workingDir.trim() || '.',
        command: command.trim(),
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
        setColor(SERVICE_COLORS[Math.floor(Math.random() * SERVICE_COLORS.length)]);
      }
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
            <DialogTitle>{isEditing ? 'Edit Service' : 'Add New Service'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the service configuration.'
                : 'Add a new service to this project (e.g., frontend, backend, database).'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="service-name">Service Name *</Label>
              <Input
                id="service-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Frontend, Backend, API"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="working-dir">Working Directory</Label>
              <div className="flex gap-2">
                <Input
                  id="working-dir"
                  value={workingDir}
                  onChange={(e) => setWorkingDir(e.target.value)}
                  placeholder="Relative path from project root (e.g., ./frontend)"
                  className="flex-1"
                />
                {projectPath && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBrowseWorkingDir}
                  >
                    <FolderOpen className="size-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Leave as "." to use the project root directory
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="command">Start Command *</Label>
              <Input
                id="command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g., npm run dev, cargo run"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="port">Port (optional)</Label>
              <Input
                id="port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="e.g., 3000"
              />
              <p className="text-xs text-muted-foreground">
                The port this service runs on (for reference)
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                {SERVICE_COLORS.map((c) => (
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
              {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Service'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
