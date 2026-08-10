import { useCallback, useRef, useState } from 'react';

import type { UtilityContext } from './types';

const STATE_KEY = 'options';

/**
 * Every panel has the same shape of settings state: defaults, a patch-style
 * updater, a reset, and persistence between visits. Doing it once here is what
 * makes rule R1 (everything configurable, everything defaulted) cheap enough
 * that no module is tempted to skip it.
 *
 * `update` returns the merged options so a caller can act on them immediately
 * without waiting for the next render.
 */
export function usePanelOptions<T extends object>(ctx: UtilityContext, defaults: T) {
  const [options, setOptions] = useState<T>(() => ({
    ...defaults,
    ...ctx.state.get<Partial<T>>(STATE_KEY, {}),
  }));

  // Mirrors `options` so `update` never reads a stale value when several
  // patches land in the same tick. Only ever written by `set` below, which is
  // the single path through which options change.
  const latest = useRef(options);

  const set = useCallback(
    (next: T) => {
      latest.current = next;
      setOptions(next);
      ctx.state.set(STATE_KEY, next);
      return next;
    },
    [ctx.state],
  );

  const update = useCallback((patch: Partial<T>) => set({ ...latest.current, ...patch }), [set]);

  const reset = useCallback(() => set(defaults), [set, defaults]);

  return { options, set, update, reset };
}
