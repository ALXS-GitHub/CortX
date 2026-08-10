import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Utilities = the workbench section (things you *run*), as opposed to Tools
 * which is the inventory (things installed on the machine).
 *
 * One folder under `modules/` = one utility. A module ships two files:
 *   - `meta.ts`    default-exports a `UtilityMeta` (eager: needed to draw the grid)
 *   - `index.tsx`  default-exports the panel component (lazy: one chunk per utility)
 *
 * Hard rule: a module never imports `appStore`, `lib/tauri`, or another module.
 * Everything it is allowed to touch arrives through `UtilityContext`. That keeps
 * modules swappable and is the exact seam where a real plugin loader would plug
 * in later, if it ever becomes worth it.
 */

export type UtilityCategory = 'text' | 'color' | 'image' | 'media' | 'files' | 'dev';

export const UTILITY_CATEGORY_LABELS: Record<UtilityCategory, string> = {
  text: 'Text & data',
  color: 'Color',
  image: 'Image',
  media: 'Media',
  files: 'Files',
  dev: 'Dev',
};

export interface UtilityMeta {
  /** Must match the folder name under `modules/`. */
  id: string;
  name: string;
  description: string;
  category: UtilityCategory;
  icon: LucideIcon;
  /** Extra search terms (the name and description are already indexed). */
  keywords?: string[];
}

/** Namespaced key/value store so a module can remember its last settings. */
export interface UtilityState {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}

/**
 * The whole API surface a module gets. Grows deliberately: anything added here
 * becomes a contract every future module can rely on.
 */
export interface UtilityContext {
  state: UtilityState;
  copy(text: string): Promise<void>;
}

export interface UtilityPanelProps {
  meta: UtilityMeta;
  ctx: UtilityContext;
}

export type UtilityPanel = ComponentType<UtilityPanelProps>;

export interface UtilityModule {
  meta: UtilityMeta;
  Panel: UtilityPanel;
}
