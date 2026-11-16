import { useEffect } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Download } from 'lucide-react';
import { useUpdateStore } from '@/stores/updateStore';
import { UpdateProgress } from '@/components/settings/UpdatesSection';

/** Checks for an update once at startup and offers it in a dialog. The Settings' Updates card does the same on demand. */
export function UpdateChecker() {
  const { update, phase, error, dialogOpen, setDialogOpen, checkForUpdate, install } = useUpdateStore();

  useEffect(() => {
    // A small delay so the check does not compete with the first render.
    const timer = setTimeout(() => void checkForUpdate({ openDialog: true }), 2000);
    return () => clearTimeout(timer);
  }, [checkForUpdate]);

  if (!update) return null;
  const busy = phase === 'downloading' || phase === 'installing';

  return (
    <AlertDialog open={dialogOpen} onOpenChange={(open) => !busy && setDialogOpen(open)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Download className="size-5 text-primary" />
            Update available
            <Badge variant="default" className="font-mono">v{update.version}</Badge>
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>A new version of CortX is ready to install.</p>
              {update.body && (
                <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-card/60 p-3 text-sm">
                  <span className="eyebrow mb-1 block">Release notes</span>
                  <p className="whitespace-pre-wrap text-foreground/90">{update.body}</p>
                </div>
              )}
              <UpdateProgress />
              {phase === 'error' && error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Later</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              // Keep the dialog open: it shows the progress, or the error.
              e.preventDefault();
              void install();
            }}
          >
            {busy ? 'Installing…' : phase === 'error' ? 'Try again' : 'Update now'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
