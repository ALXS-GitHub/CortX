/**
 * How the grid view (ticket #55) lays its tiles out. Pure, **no imports**, so
 * `gridLayout.test.ts` runs it on plain Node like `sectionOrder.ts`.
 *
 * The grid fills the content area without scrolling as long as the tiles stay
 * readable: it tries every column count and keeps the one whose tiles come
 * closest to the shape of a terminal (`TILE_ASPECT`, wider than tall) at the
 * largest size — two tiles side by side on a wide window, stacked on a tall
 * one, a 3 × 2 for six on a laptop screen. A tile never gets smaller than
 * `MIN_TILE_WIDTH` × `MIN_TILE_HEIGHT`: past that the grid scrolls instead,
 * because a tile nobody can read is not an overview.
 */

/** Width over height of the tile the grid aims for (a terminal is wide). */
export const TILE_ASPECT = 1.6;
/** Rows never get shorter than this; the grid scrolls past it. */
export const MIN_TILE_HEIGHT = 180;
/** Nor columns narrower than this (about 30 columns of text at 13 px). */
export const MIN_TILE_WIDTH = 260;

export interface GridShape {
  columns: number;
  rows: number;
}

/**
 * Columns and rows for `count` tiles in a `width` × `height` box (px, gaps
 * included — they are small next to a tile and the same for every choice).
 * Zero tiles, or a box with no size yet, still answer one column.
 */
export function gridShape(count: number, width: number, height: number): GridShape {
  if (count <= 0) return { columns: 1, rows: 0 };
  if (!(width > 0) || !(height > 0)) {
    const columns = Math.ceil(Math.sqrt(count));
    return { columns, rows: Math.ceil(count / columns) };
  }
  let best: GridShape | null = null;
  let bestArea = -1;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const cellH = height / rows;
    const cellW = width / columns;
    if (cellH < MIN_TILE_HEIGHT || (cellW < MIN_TILE_WIDTH && columns > 1)) continue;
    // The largest tile of the target shape that fits in the cell.
    const tileW = Math.min(cellW, cellH * TILE_ASPECT);
    const area = tileW * (tileW / TILE_ASPECT);
    // Strictly larger only: on a tie the fewer columns win (fuller rows).
    if (area > bestArea + 0.5) {
      best = { columns, rows };
      bestArea = area;
    }
  }
  if (best) return best;
  // Too many to fit at a readable size: as many columns as stay readable
  // side by side, and the rows scroll.
  const columns = Math.max(1, Math.min(count, Math.floor(width / MIN_TILE_WIDTH)));
  return { columns, rows: Math.ceil(count / columns) };
}

// ---------------------------------------------------------------------------
// Which tiles, in which order (the grid's View menu)
// ---------------------------------------------------------------------------

/** What `arrangeGrid` needs to know about one tab. */
export interface GridTabFacts<T> {
  tab: T;
  /** Section key and name (the tab's project, or "No project"). */
  groupKey: string;
  groupName: string;
  /** Position in the rail, the default order. */
  railIndex: number;
  /** Null for a tab no agent runs in. */
  phase: 'working' | 'needs-you' | 'done' | 'idle' | 'unknown' | null;
  /** Epoch ms of the agent's last transcript entry, 0 when unknown. */
  lastActivity: number;
}

export interface GridArrangeOptions {
  sort: 'rail' | 'attention' | 'recent';
  agentsOnly: boolean;
  hideIdle: boolean;
  groupByProject: boolean;
}

export interface GridGroup<T> {
  key: string;
  /** Null when the grid is not grouped. */
  name: string | null;
  tabs: T[];
}

const ATTENTION_RANK: Record<string, number> = { 'needs-you': 0, done: 1, working: 2, idle: 3, unknown: 4 };

/**
 * Filter, sort and (optionally) group the tiles. Groups keep the order in
 * which their first tab comes in the rail, so "by project" reads like the
 * rail's sections.
 */
export function arrangeGrid<T>(facts: readonly GridTabFacts<T>[], options: GridArrangeOptions): GridGroup<T>[] {
  const kept = facts.filter((f) => {
    if (options.agentsOnly && f.phase === null) return false;
    if (options.hideIdle && f.phase === 'idle') return false;
    return true;
  });
  const rank = (f: GridTabFacts<T>) => (f.phase === null ? 5 : ATTENTION_RANK[f.phase]);
  const sorted = kept.slice().sort((a, b) => {
    if (options.sort === 'attention') return rank(a) - rank(b) || a.railIndex - b.railIndex;
    if (options.sort === 'recent') return b.lastActivity - a.lastActivity || a.railIndex - b.railIndex;
    return a.railIndex - b.railIndex;
  });
  if (!options.groupByProject) return sorted.length ? [{ key: 'all', name: null, tabs: sorted.map((f) => f.tab) }] : [];
  const firstIndex = new Map<string, number>();
  for (const f of kept) firstIndex.set(f.groupKey, Math.min(firstIndex.get(f.groupKey) ?? Infinity, f.railIndex));
  const groups = new Map<string, GridGroup<T>>();
  for (const f of sorted) {
    const g = groups.get(f.groupKey) ?? { key: f.groupKey, name: f.groupName, tabs: [] };
    g.tabs.push(f.tab);
    groups.set(f.groupKey, g);
  }
  return [...groups.values()].sort((a, b) => (firstIndex.get(a.key) ?? 0) - (firstIndex.get(b.key) ?? 0));
}
