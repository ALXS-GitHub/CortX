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
import type { VirtualFolder, CreateFolderInput, UpdateFolderInput, FolderType } from '@/types';

const FOLDER_COLORS = [
  '#6b7280', '#3b82f6', '#22c55e', '#f97316',
  '#8b5cf6', '#ec4899', '#06b6d4', '#eab308',
];

interface FolderFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder?: VirtualFolder;
  folderType: FolderType;
  onSubmit: (data: CreateFolderInput | UpdateFolderInput) => Promise<void>;
}

export function FolderForm({ open, onOpenChange, folder, folderType, onSubmit }: FolderFormProps) {
  const [name, setName] = useState(folder?.name || '');
  const [color, setColor] = useState(folder?.color || FOLDER_COLORS[0]);
  const [orderStr, setOrderStr] = useState(folder?.order != null ? String(folder.order) : '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form state when dialog opens or folder changes
  useEffect(() => {
    if (open) {
      setName(folder?.name || '');
      setColor(folder?.color || FOLDER_COLORS[0]);
      setOrderStr(folder?.order != null ? String(folder.order) : '');
      setError(null);
    }
  }, [open, folder]);

  const isEditing = !!folder;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Folder name is required');
      return;
    }

    const order = orderStr.trim() !== '' ? parseInt(orderStr, 10) : undefined;
    if (order !== undefined && isNaN(order)) {
      setError('Order must be a number');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditing) {
        await onSubmit({ name: name.trim(), color, order } as UpdateFolderInput);
      } else {
        await onSubmit({ name: name.trim(), color, order, folderType } as CreateFolderInput);
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Folder' : 'New Folder'}</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Update the folder.' : 'Create a folder to organize your scripts.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="folder-name">Name *</Label>
              <Input
                id="folder-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., DevOps, Utils"
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                {FOLDER_COLORS.map((c) => (
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

            <div className="grid gap-2">
              <Label htmlFor="folder-order">Order</Label>
              <Input
                id="folder-order"
                type="number"
                min="0"
                value={orderStr}
                onChange={(e) => setOrderStr(e.target.value)}
                placeholder="Auto (last)"
              />
              <p className="text-xs text-muted-foreground">
                Lower numbers appear first. Leave empty for auto.
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
