import { useEffect } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatDuration } from '@/lib/terminalNames';
import { confirmQuit, describeTerminalLocation, useCloseConfirmStore, type RunningCommand } from './actions';

/**
 * "Something is still running" prompt (DEV-13). Warp asks before a close
 * takes a busy terminal down and says what it is about to kill; this is the
 * same, driven by the shell integration's `phase === 'running'`, so an idle
 * tab still closes on the first click without a dialog.
 *
 * One instance per window is enough — every close funnels through
 * `useCloseConfirmStore`. Mount it wherever the window always renders
 * something (the sessions rail / tab strip, the dock).
 */

/** Payload of the backend's `app-quit-confirm` (see `RunningTerminal` in Rust). */
interface RunningTerminalPayload {
  terminalId: string;
  command?: string | null;
  startedAt?: number | null;
}

/** `for 3m 05s`, when we know when the command started. */
function elapsedLabel(startedAt: number | null, now: number): string | null {
  if (!startedAt) return null;
  const ms = now - startedAt;
  if (ms < 1000) return null;
  return `for ${formatDuration(ms)}`;
}

function RunningList({ running, now }: { running: RunningCommand[]; now: number }) {
  return (
    <ul className="mt-3 max-h-52 space-y-1.5 overflow-y-auto rounded-[var(--rad-sm)] border border-border bg-muted/40 p-2">
      {running.map((item) => {
        const elapsed = elapsedLabel(item.startedAt, now);
        return (
          <li key={item.terminalId} className="min-w-0 leading-tight">
            <p className="truncate font-mono text-[11.5px] text-foreground">
              {item.command || '(unnamed command)'}
            </p>
            <p className="truncate text-[10.5px] text-faint">
              {item.where}
              {elapsed ? ` · running ${elapsed}` : ''}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function CloseConfirmDialog({ handleAppQuit = false }: { handleAppQuit?: boolean }) {
  const request = useCloseConfirmStore((s) => s.request);
  const answer = useCloseConfirmStore((s) => s.answer);

  // The backend asks before the quit path kills anything, and waits for the
  // answer on `app-quit-decision` (it gives up and quits after a while, so a
  // window that never mounted this dialog cannot lock the app open).
  useEffect(() => {
    if (!handleAppQuit) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<RunningTerminalPayload[]>('app-quit-confirm', (event) => {
      const running: RunningCommand[] = (event.payload ?? []).map((item) => ({
        terminalId: item.terminalId,
        where: describeTerminalLocation(item.terminalId),
        command: item.command ?? null,
        startedAt: item.startedAt ?? null,
      }));
      void confirmQuit(running).then((ok) => {
        void emit('app-quit-decision', ok);
      });
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handleAppQuit]);

  const count = request?.running.length ?? 0;

  return (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && answer(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-warning/15 text-warning">
            <AlertTriangle />
          </AlertDialogMedia>
          <AlertDialogTitle>{request?.question ?? 'Close this terminal?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {count === 1 ? 'A command is still running' : `${count} commands are still running`}
            {request?.quitting
              ? ' — quitting CortX stops them.'
              : ' — closing kills it and everything it started.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {request && <RunningList running={request.running} now={request.askedAt} />}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>Keep running</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => answer(true)}>
            {request?.quitting ? 'Quit anyway' : 'Close anyway'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
