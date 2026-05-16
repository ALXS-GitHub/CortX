import type { ReactNode } from 'react';

export type CommandCategory =
  | 'Navigation'
  | 'Apps'
  | 'Services'
  | 'Scripts'
  | 'Projects'
  | 'Tools';

export interface CommandAction {
  /** Stable key — used for cmdk identity. */
  id: string;
  category: CommandCategory;
  /** Primary label shown in the row, e.g. "Launch WezTerm". */
  label: string;
  /** Secondary breadcrumb, e.g. "App" or "Project › Service". */
  subtitle?: string;
  /** Lucide icon (or any node) shown on the left. */
  icon?: ReactNode;
  /** Comma-separated keywords boosted in cmdk's fuzzy match. */
  keywords?: string;
  /** Side-effect: navigate, start, stop, open, etc. */
  run: () => void | Promise<void>;
}
