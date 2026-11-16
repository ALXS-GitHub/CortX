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

/**
 * How big a grid tile shows its session's text, in percent of full size
 * (`terminal.gridTileTextScale`). With "Tiles keep the session's size" the
 * whole page shrunk into a tile ends up at a quarter of its size, unreadable;
 * at a legible scale the tile shows the part of the page around the cursor
 * instead. 0 = the whole page, however small.
 */
export const GRID_TILE_TEXT_SCALE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'Whole page' },
  { value: 45, label: 'Small' },
  { value: 60, label: 'Readable' },
  { value: 80, label: 'Large' },
];

export const DEFAULT_GRID_TILE_TEXT_SCALE = 60;

export function resolveGridTileTextScale(cfg: Partial<TerminalConfig> | null | undefined): number {
  const raw = cfg?.gridTileTextScale;
  return typeof raw === 'number' && raw >= 0 && raw <= 100 ? raw : DEFAULT_GRID_TILE_TEXT_SCALE;
}
