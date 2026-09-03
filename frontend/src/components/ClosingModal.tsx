import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

export function ClosingModal() {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await listen<boolean>('app-closing', () => {
        setIsClosing(true);
      });
    };

    setup();

    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <Dialog open={isClosing}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader className="items-center pr-0 text-center">
          <span className="mb-1 grid size-12 place-items-center rounded-2xl bg-accent text-primary">
            <Loader2 className="size-6 animate-spin" />
          </span>
          <DialogTitle>Closing CortX</DialogTitle>
          <DialogDescription>
            Stopping running processes…
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
