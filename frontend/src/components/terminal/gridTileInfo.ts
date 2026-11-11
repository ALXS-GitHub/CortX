import type { GridTileInfo, TerminalConfig } from '@/types';

/**
 * What a grid tile's header can show besides its name and its dot
 * (`terminal.gridTileInfo`). The default stays light — the project (in
 * Global) and what the agent is doing — and the rest is one click away in the
 * grid's View menu, never on screen by default.
 */
export const GRID_TILE_INFO_OPTIONS: ReadonlyArray<{ value: GridTileInfo; label: string }> = [
  { value: 'project', label: 'Project' },
  { value: 'activity', label: 'What it is doing' },
  { value: 'branch', label: 'Git branch' },
  { value: 'model', label: 'Model' },
  { value: 'lastPrompt', label: 'Your last prompt' },
  { value: 'lastReply', label: 'Its last reply' },
];

export const DEFAULT_GRID_TILE_INFO: readonly GridTileInfo[] = ['project', 'activity'];

const KNOWN = new Set(GRID_TILE_INFO_OPTIONS.map((o) => o.value));

export function resolveGridTileInfo(cfg: Partial<TerminalConfig> | null | undefined): GridTileInfo[] {
  const list = cfg?.gridTileInfo;
  if (!Array.isArray(list)) return [...DEFAULT_GRID_TILE_INFO];
  return list.filter((v): v is GridTileInfo => KNOWN.has(v));
}
