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
import { Badge } from '@/components/ui/badge';
import { Pencil, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAppStore } from '@/stores/appStore';
import { toast } from 'sonner';
import type { TagDefinition } from '@/types';

const TAG_COLORS = [
  '#6b7280', '#3b82f6', '#22c55e', '#f97316',
  '#8b5cf6', '#ec4899', '#06b6d4', '#eab308',
];

interface TagDefinitionManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingTag?: TagDefinition | null;
}

export function TagDefinitionManager({ open, onOpenChange, editingTag }: TagDefinitionManagerProps) {
  const { tagDefinitions, deleteTagDefinition } = useAppStore();

  const [showForm, setShowForm] = useState(false);
  const [formTag, setFormTag] = useState<TagDefinition | null>(null);
  const [deletingTag, setDeletingTag] = useState<TagDefinition | null>(null);

  // If editingTag is provided when opening, go straight to the form
  useEffect(() => {
    if (open && editingTag) {
      setFormTag(editingTag);
      setShowForm(true);
    }
  }, [open, editingTag]);

  const handleClose = () => {
    setShowForm(false);
    setFormTag(null);
    onOpenChange(false);
  };

  const handleDeleteTag = async () => {
    if (!deletingTag) return;
    try {
      await deleteTagDefinition(deletingTag.name);
      toast.success(`Tag "${deletingTag.name}" deleted`);
    } catch (e) {
      toast.error('Failed to delete tag', { description: String(e) });
    }
    setDeletingTag(null);
  };

  const sortedTags = [...tagDefinitions].sort(
    (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity)
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Tags</DialogTitle>
            <DialogDescription>
              Create and edit tag definitions. Tags can be applied to scripts, groups, and tools.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-[50vh] overflow-y-auto py-2">
            {sortedTags.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No tags defined yet.</p>
            ) : (
              sortedTags.map((tag) => (
                <div
                  key={tag.name}
                  className="flex items-center justify-between px-3 py-2 border rounded-md"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="text-xs"
                      style={
                        tag.color
                          ? {
                              borderColor: tag.color,
                              color: tag.color,
                              backgroundColor: `${tag.color}10`,
                            }
                          : undefined
                      }
                    >
                      {tag.name}
                    </Badge>
                    {tag.order != null && (
                      <span className="text-xs text-muted-foreground">#{tag.order}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => {
                        setFormTag(tag);
                        setShowForm(true);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      onClick={() => setDeletingTag(tag)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
            <Button
              onClick={() => {
                setFormTag(null);
                setShowForm(true);
              }}
            >
              New Tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tag Form Dialog */}
      <TagForm
        open={showForm}
        onOpenChange={(o) => {
          setShowForm(o);
          if (!o) setFormTag(null);
        }}
        tag={formTag}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingTag} onOpenChange={(o) => !o && setDeletingTag(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tag</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the tag "{deletingTag?.name}"? This will remove the tag definition but won't remove it from existing scripts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTag}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ---- Inner form for creating / editing a single tag definition ---- */

interface TagFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tag?: TagDefinition | null;
}

function TagForm({ open, onOpenChange, tag }: TagFormProps) {
  const { createTagDefinition, updateTagDefinition } = useAppStore();

  const [name, setName] = useState('');
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [orderStr, setOrderStr] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!tag;

  useEffect(() => {
    if (open) {
      setName(tag?.name || '');
      setColor(tag?.color || TAG_COLORS[0]);
      setOrderStr(tag?.order != null ? String(tag.order) : '');
      setError(null);
    }
  }, [open, tag]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim().toLowerCase();
    if (!trimmed) {
      setError('Tag name is required');
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
        await updateTagDefinition(tag!.name, { name: trimmed, color, order });
        toast.success('Tag updated');
      } else {
        await createTagDefinition({ name: trimmed, color, order });
        toast.success('Tag created');
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
            <DialogTitle>{isEditing ? 'Edit Tag' : 'New Tag'}</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Update the tag definition.' : 'Create a tag to organize your items.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="tag-name">Name *</Label>
              <Input
                id="tag-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., devops, utils"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Tag names are lowercased automatically.
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                {TAG_COLORS.map((c) => (
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
              <Label htmlFor="tag-order">Order</Label>
              <Input
                id="tag-order"
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
