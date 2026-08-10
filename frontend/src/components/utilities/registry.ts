import { lazy, type LazyExoticComponent } from 'react';

import type { UtilityMeta, UtilityPanel } from './types';

/**
 * Auto-discovery: dropping a folder under `modules/` is all it takes to add a
 * utility — nothing to register here, in `App.tsx`, or in the sidebar.
 *
 * `meta.ts` is eager (a few bytes, needed to render the grid), `index.tsx` is
 * lazy so each utility is its own chunk: a utility you never open costs nothing
 * at startup and adds nothing to the main bundle.
 */

const metaModules = import.meta.glob<{ default: UtilityMeta }>('./modules/*/meta.ts', {
  eager: true,
});
const panelModules = import.meta.glob<{ default: UtilityPanel }>('./modules/*/index.tsx');

export interface RegisteredUtility {
  meta: UtilityMeta;
  Panel: LazyExoticComponent<UtilityPanel>;
}

/** `./modules/id-generator/meta.ts` -> `id-generator` */
function folderOf(path: string): string {
  return path.split('/')[2] ?? '';
}

function build(): RegisteredUtility[] {
  const utilities: RegisteredUtility[] = [];

  for (const [metaPath, mod] of Object.entries(metaModules)) {
    const folder = folderOf(metaPath);
    const meta = mod.default;

    if (!meta) {
      console.warn(`[utilities] ${metaPath} has no default export, skipping`);
      continue;
    }
    if (meta.id !== folder) {
      // Ids are used for state namespacing and command palette entries, so a
      // mismatch would silently break persistence on rename.
      console.warn(`[utilities] id "${meta.id}" does not match folder "${folder}"`);
    }

    const loadPanel = panelModules[`./modules/${folder}/index.tsx`];
    if (!loadPanel) {
      console.warn(`[utilities] ${folder} has a meta.ts but no index.tsx, skipping`);
      continue;
    }

    utilities.push({ meta, Panel: lazy(loadPanel) });
  }

  return utilities.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
}

export const UTILITIES: RegisteredUtility[] = build();

export function getUtility(id: string): RegisteredUtility | undefined {
  return UTILITIES.find((u) => u.meta.id === id);
}
