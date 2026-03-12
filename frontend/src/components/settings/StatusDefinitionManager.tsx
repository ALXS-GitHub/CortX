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
import type { StatusDefinition } from '@/types';

const STATUS_COLORS = [
  '#22c55e', '#eab308', '#f97316', '#6b7280',
  '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444',
];

interface StatusDefinitionManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StatusDefinitionManager({ open, onOpenChange }: StatusDefinitionManagerProps) {
  const { statusDefinitions, deleteStatusDefinition } = useAppStore();

  const [showForm, setShowForm] = useState(false);
  const [formStatus, setFormStatus] = useState<StatusDefinition | null>(null);
  const [deletingStatus, setDeletingStatus] = useState<StatusDefinition | null>(null);

  const handleClose = () => {
    setShowForm(false);
    setFormStatus(null);
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!deletingStatus) return;
    try {
      await deleteStatusDefinition(deletingStatus.name);
      toast.success(`Status "${deletingStatus.name}" deleted`);
    } catch (e) {
      toast.error('Failed to delete status', { description: String(e) });
    }
    setDeletingStatus(null);
  };

  const sorted = [...statusDefinitions].sort(
    (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity)
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Statuses</DialogTitle>
            <DialogDescription>
              Create and edit status definitions. Statuses can be applied to tools, scripts, projects, apps, and aliases.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-[50vh] overflow-y-auto py-2">
            {sorted.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No statuses defined yet.</p>
            ) : (
              sorted.map((status) => (
                <div
                  key={status.name}
                  className="flex items-center justify-between px-3 py-2 border rounded-md"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="text-xs"
                      style={
                        status.color
                          ? {
                              borderColor: status.color,
                              color: status.color,
                              backgroundColor: `${status.color}15`,
                            }
                          : undefined
                      }
                    >
                      {status.name}
                    </Badge>
                    {status.order != null && (
                      <span className="text-xs text-muted-foreground">#{status.order}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => {
                        setFormStatus(status);
                        setShowForm(true);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      onClick={() => setDeletingStatus(status)}
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
                setFormStatus(null);
                setShowForm(true);
              }}
            >
              New Status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StatusForm
        open={showForm}
        onOpenChange={(o) => {
          setShowForm(o);
          if (!o) setFormStatus(null);
        }}
        status={formStatus}
      />

      <AlertDialog open={!!deletingStatus} onOpenChange={(o) => !o && setDeletingStatus(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Status</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the status &quot;{deletingStatus?.name}&quot;? This will remove the definition but won&apos;t clear it from existing items.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
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

interface StatusFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status?: StatusDefinition | null;
}

function StatusForm({ open, onOpenChange, status }: StatusFormProps) {
  const { createStatusDefinition, updateStatusDefinition } = useAppStore();

  const [name, setName] = useState('');
  const [color, setColor] = useState(STATUS_COLORS[0]);
  const [orderStr, setOrderStr] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!status;

  useEffect(() => {
    if (open) {
      setName(status?.name || '');
      setColor(status?.color || STATUS_COLORS[0]);
      setOrderStr(status?.order != null ? String(status.order) : '');
      setError(null);
    }
  }, [open, status]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError('Status name is required');
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
        await updateStatusDefinition(status!.name, { name: trimmed, color, order });
        toast.success('Status updated');
      } else {
        await createStatusDefinition({ name: trimmed, color, order });
        toast.success('Status created');
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
            <DialogTitle>{isEditing ? 'Edit Status' : 'New Status'}</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Update the status definition.' : 'Create a status to track item lifecycle.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="status-name">Name *</Label>
              <Input
                id="status-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Active, WIP, Deprecated"
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                {STATUS_COLORS.map((c) => (
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
              <Label htmlFor="status-order">Order</Label>
              <Input
                id="status-order"
                type="number"
                min="0"
                value={orderStr}
                onChange={(e) => setOrderStr(e.target.value)}
                placeholder="Auto (last)"
              />
              <p className="text-xs text-muted-foreground">
                Lower numbers appear first.
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
