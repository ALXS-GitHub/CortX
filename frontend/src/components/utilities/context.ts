import { useMemo } from 'react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { toast } from 'sonner';

import type { UtilityContext, UtilityState } from './types';

const STATE_PREFIX = 'cortx:utility';

/**
 * Per-module persisted settings. Deliberately localStorage and not the Rust
 * storage layer: these are UI preferences (last format picked, last length),
 * they are worthless on another machine and must not end up in the synced data
 * dir. Keys are namespaced by module id so two modules can't collide.
 */
function makeState(moduleId: string): UtilityState {
  const keyFor = (key: string) => `${STATE_PREFIX}:${moduleId}:${key}`;

  return {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = localStorage.getItem(keyFor(key));
        return raw === null ? fallback : (JSON.parse(raw) as T);
      } catch {
        return fallback;
      }
    },
    set(key: string, value: unknown) {
      try {
        localStorage.setItem(keyFor(key), JSON.stringify(value));
      } catch {
        // Quota or private mode: losing a UI preference is not worth surfacing.
      }
    },
  };
}

export function useUtilityContext(moduleId: string): UtilityContext {
  return useMemo<UtilityContext>(
    () => ({
      state: makeState(moduleId),
      async copy(text: string) {
        try {
          await writeText(text);
          toast.success('Copied to clipboard');
        } catch {
          toast.error('Could not copy to clipboard');
        }
      },
    }),
    [moduleId],
  );
}
