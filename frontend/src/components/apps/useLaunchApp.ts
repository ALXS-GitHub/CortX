/**
 * Launch handler shared by the three app list shapes (never navigates to the
 * row underneath).
 *
 * In its own module rather than in `AppCard.tsx`: a file that exports both
 * components and a hook cannot be hot-replaced on its own — every edit to the
 * card remounts whatever imports the hook, and the state of the list goes with
 * it. `AliasCard`'s glyph table was moved out for the same reason.
 */
import type { MouseEvent } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import type { App } from '@/types';

export function useLaunchApp(app: App) {
  const { launchApp } = useAppStore();
  return async (e?: MouseEvent) => {
    e?.stopPropagation();
    try {
      await launchApp(app.id);
      toast.success(`Launched ${app.name}`);
    } catch (err) {
      toast.error('Failed to launch app', { description: String(err) });
    }
  };
}
