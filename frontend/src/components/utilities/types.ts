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

export interface PickOptions {
  title?: string;
  multiple?: boolean;
  /** e.g. `[{ name: 'Images', extensions: ['png', 'jpg'] }]` */
  filters?: { name: string; extensions: string[] }[];
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Streamed as the process writes, for long-running conversions. */
  onLog?: (line: string, stream: 'stdout' | 'stderr') => void;
  cwd?: string;
}

/** Filesystem access, funnelled so no module ever imports a Tauri plugin. */
export interface UtilityFiles {
  pick(options?: PickOptions): Promise<string[]>;
  pickDirectory(title?: string): Promise<string | null>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  readDir(path: string): Promise<{ name: string; isDirectory: boolean }[]>;
  reveal(path: string): Promise<void>;
  tempDir(): Promise<string>;
  dirname(path: string): Promise<string>;
  basename(path: string): Promise<string>;
  extname(path: string): Promise<string>;
  join(...parts: string[]): Promise<string>;
}

/**
 * The whole API surface a module gets. Grows deliberately: anything added here
 * becomes a contract every future module can rely on.
 */
export interface UtilityContext {
  state: UtilityState;
  copy(text: string): Promise<void>;
  files: UtilityFiles;
  /** Run an external CLI (ffmpeg, ghostscript…). Never a shell string. */
  run(program: string, args: string[], options?: RunOptions): Promise<RunResult>;
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
