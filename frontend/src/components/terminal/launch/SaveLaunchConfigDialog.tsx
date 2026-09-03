import { useEffect, useState } from 'react';
import { toast } from 'sonner';
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
import { saveLaunchConfig } from '@/lib/tauri';
import { captureLaunchConfig } from '@/lib/launchConfigs';
import { describeLaunchConfig } from './useLaunchConfigs';

/**
 * Tiny dialog of the Terminal window: name the current tabs and save them as
 * a launch configuration (working directories only, no command).
 */
export function SaveLaunchConfigDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const config = captureLaunchConfig(trimmed);
      if (config.tabs.length === 0) {
        toast.error('No terminal to save in this scope');
        return;
      }
      await saveLaunchConfig(config);
      toast.success(`Saved "${trimmed}"`, { description: describeLaunchConfig(config) });
      onOpenChange(false);
    } catch (e) {
      toast.error('Failed to save the launch configuration', { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Save as launch configuration</DialogTitle>
          <DialogDescription>
            The tabs and splits of this window, with their directories. Commands are not recorded — add them later in Settings.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          <Label htmlFor="launch-save-name">Name</Label>
          <Input id="launch-save-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Full stack dev" autoFocus />
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
