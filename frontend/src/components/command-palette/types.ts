import type { ReactNode } from 'react';

export type EntityCategory =
  | 'Navigation'
  | 'Apps'
  | 'Services'
  | 'Scripts'
  | 'Projects'
  | 'Tools'
  | 'Shell Config';

/**
 * A keyboard shortcut binding. `meta` matches both Meta (Cmd) and Ctrl —
 * we treat them as the same modifier for cross-platform consistency.
 */
export interface KeyBinding {
  /** e.g. "Enter", "o", "h", "," — must match KeyboardEvent.key exactly (case-insensitive for letters). */
  key: string;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface EntityAction {
  /** Stable identifier within the entity (e.g. "launch", "open-folder"). */
  id: string;
  label: string;
  icon?: ReactNode;
  /** Optional keyboard binding shown next to the action and triggerable directly. */
  shortcut?: KeyBinding;
  run: () => void | Promise<void>;
}

export interface CommandEntity {
  /** Stable identifier across rebuilds. */
  id: string;
  category: EntityCategory;
  label: string;
  subtitle?: string;
  icon?: ReactNode;
  /** Boost terms for fuzzy matching (tags, action labels, etc.). */
  keywords?: string;
  /** Ordered list of actions. First entry is the default (fired on Enter). */
  actions: EntityAction[];
}
