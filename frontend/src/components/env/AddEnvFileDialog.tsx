import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { open } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';
import { FolderOpen } from 'lucide-react';

interface AddEnvFileDialogProps {
  projectId: string;
  projectPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddEnvFileDialog({
  projectId,
  projectPath,
  open: isOpen,
  onOpenChange,
}: AddEnvFileDialogProps) {
  const [path, setPath] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { addEnvFile } = useAppStore();

  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        defaultPath: projectPath,
        filters: [
          {
            name: 'Environment Files',
            extensions: ['env', '*'],
          },
        ],
      });

      if (selected && typeof selected === 'string') {
        setPath(selected);
      }
    } catch (error) {
      console.error('Failed to open file dialog:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!path.trim()) {
      toast.error('Please select a file');
      return;
    }

    setIsSubmitting(true);
    try {
      await addEnvFile(projectId, { path: path.trim() });
      toast.success('Environment file added');
      setPath('');
      onOpenChange(false);
    } catch (error) {
      toast.error(`Failed to add file: ${error}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setPath('');
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add environment file</DialogTitle>
          <DialogDescription>
            Manually add an .env file to track. The file will be parsed and its
            variables displayed.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="contents">
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="path" className="text-xs font-medium text-muted-foreground">File path</Label>
              <div className="flex gap-2">
                <Input
                  id="path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/path/to/.env"
                  className="flex-1 font-mono text-[12px]"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBrowse}
                >
                  <FolderOpen />
                  Browse
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Select an .env file from anywhere on your system
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !path.trim()}>
              {isSubmitting ? 'Adding...' : 'Add file'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
