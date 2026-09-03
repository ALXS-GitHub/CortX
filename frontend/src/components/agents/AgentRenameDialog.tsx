import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAppStore } from '@/stores/appStore';
import type { AgentSession } from '@/types';

interface AgentRenameDialogProps {
  session: AgentSession | null;
  onOpenChange: (open: boolean) => void;
}

/** Sets `annotations.customName` (empty restores the provider's own title). */
export function AgentRenameDialog({ session, onOpenChange }: AgentRenameDialogProps) {
  // Remount per session so the field starts from the current name.
  return (
    <Dialog open={!!session} onOpenChange={onOpenChange}>
      {session && <RenameForm key={session.id} session={session} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function RenameForm({ session, onDone }: { session: AgentSession; onDone: () => void }) {
  const updateAgentAnnotations = useAppStore((s) => s.updateAgentAnnotations);
  const [name, setName] = useState(session.annotations.customName ?? session.title);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const trimmed = name.trim();
      await updateAgentAnnotations(session.id, {
        ...session.annotations,
        customName: trimmed || undefined,
        updatedAt: new Date().toISOString(),
      });
      toast.success(trimmed ? 'Session renamed' : 'Custom name cleared');
      onDone();
    } catch (e) {
      toast.error('Failed to rename session', { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Rename session</DialogTitle>
        <DialogDescription>Only changes the name shown in CortX. Leave empty to use the provider's title.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="agent-rename" className="text-xs font-medium text-muted-foreground">Name</Label>
        <Input
          id="agent-rename"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
        />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={saving}>Cancel</Button>
        <Button onClick={() => void save()} disabled={saving}>Save</Button>
      </DialogFooter>
    </DialogContent>
  );
}
