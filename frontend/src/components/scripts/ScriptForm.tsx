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
import { Checkbox } from '@/components/ui/checkbox';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen, FileSearch } from 'lucide-react';
import type { Script, Service, CreateScriptInput, UpdateScriptInput } from '@/types';

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

// Get directory from file path
function getDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : '.';
}

// Get filename without extension
function getBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const filename = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const lastDot = filename.lastIndexOf('.');
  return lastDot > 0 ? filename.slice(0, lastDot) : filename;
}

const SCRIPT_COLORS = [
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#22c55e', // green
  '#ec4899', // pink
  '#eab308', // yellow
  '#3b82f6', // blue
  '#ef4444', // red
];

interface ScriptFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  script?: Script;
  services: Service[];
  projectPath?: string;
  onSubmit: (data: CreateScriptInput | UpdateScriptInput) => Promise<void>;
}

export function ScriptForm({ open, onOpenChange, script, services, projectPath, onSubmit }: ScriptFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [command, setCommand] = useState('');
  const [scriptPath, setScriptPath] = useState('');
  const [workingDir, setWorkingDir] = useState('.');
  const [color, setColor] = useState(SCRIPT_COLORS[0]);
  const [linkedServiceIds, setLinkedServiceIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!script;

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
      }
    } catch (error) {
      console.error('Failed to open folder dialog:', error);
    }
  };

  const handleBrowseScriptPath = async () => {
    if (!projectPath) return;

    try {
      const selected = await openDialog({
        directory: false,
        multiple: false,
        defaultPath: projectPath,
        title: 'Select Script File',
        filters: [
          {
            name: 'Scripts',
            extensions: ['sh', 'ps1', 'bat', 'cmd', 'py', 'js', 'ts', 'rb', 'pl', '*'],
          },
        ],
      });

      if (selected && typeof selected === 'string') {
        const relativePath = getRelativePath(projectPath, selected);
        setScriptPath(relativePath);

        // Auto-fill working directory if empty or default
        if (!workingDir.trim() || workingDir === '.') {
          const scriptDir = getDirectory(selected);
          const relativeDir = getRelativePath(projectPath, scriptDir);
          setWorkingDir(relativeDir);
        }

        // Auto-fill name if empty
        if (!name.trim()) {
          const baseName = getBasename(selected);
          if (baseName) {
            setName(baseName);
          }
        }
      }
    } catch (error) {
      console.error('Failed to open file dialog:', error);
    }
  };

  // Reset form when opening/closing or when script changes
  useEffect(() => {
    if (open) {
      if (script) {
        setName(script.name);
        setDescription(script.description || '');
        setCommand(script.command);
        setScriptPath(script.scriptPath || '');
        setWorkingDir(script.workingDir || '.');
        setColor(script.color || SCRIPT_COLORS[0]);
        setLinkedServiceIds(script.linkedServiceIds || []);
      } else {
        setName('');
        setDescription('');
        setCommand('');
        setScriptPath('');
        setWorkingDir('.');
        setColor(SCRIPT_COLORS[Math.floor(Math.random() * SCRIPT_COLORS.length)]);
        setLinkedServiceIds([]);
      }
      setError(null);
    }
  }, [open, script]);

  const toggleService = (serviceId: string) => {
    setLinkedServiceIds((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

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
      const data: CreateScriptInput | UpdateScriptInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        command: command.trim(),
        scriptPath: scriptPath.trim() || undefined,
        workingDir: workingDir.trim() || '.',
        color,
        linkedServiceIds,
      };
      await onSubmit(data);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Script' : 'Add New Script'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the script configuration.'
                : 'Add a script for common tasks like builds, tests, or deployments.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="script-name">Script Name *</Label>
              <Input
                id="script-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Build, Test, Deploy"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this script do?"
                rows={2}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="command">Command *</Label>
              <Input
                id="command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g., npm run build, ./deploy.sh"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="script-path">Script Path (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="script-path"
                  value={scriptPath}
                  onChange={(e) => setScriptPath(e.target.value)}
                  placeholder="e.g., scripts/deploy.sh"
                  className="flex-1"
                />
                {projectPath && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBrowseScriptPath}
                    title="Browse for script file"
                  >
                    <FileSearch className="size-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Relative path to the script file (for reference)
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="working-dir">Working Directory</Label>
              <div className="flex gap-2">
                <Input
                  id="working-dir"
                  value={workingDir}
                  onChange={(e) => setWorkingDir(e.target.value)}
                  placeholder="."
                  className="flex-1"
                />
                {projectPath && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBrowseWorkingDir}
                    title="Browse for working directory"
                  >
                    <FolderOpen className="size-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Relative to project root. Use "." for project root.
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

            {services.length > 0 && (
              <div className="grid gap-2">
                <Label>Linked Services (for reference)</Label>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {services.map((service) => (
                    <div key={service.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`service-${service.id}`}
                        checked={linkedServiceIds.includes(service.id)}
                        onCheckedChange={() => toggleService(service.id)}
                      />
                      <label htmlFor={`service-${service.id}`} className="text-sm">
                        {service.name}
                      </label>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Optional: Link related services for organization
                </p>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
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
