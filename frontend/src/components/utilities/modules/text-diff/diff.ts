export type Granularity = 'line' | 'word' | 'char';

export interface DiffOptions {
  granularity: Granularity;
  ignoreCase: boolean;
  /** Collapse runs of whitespace before comparing (and ignore leading/trailing). */
  ignoreWhitespace: boolean;
  /** Drop lines that are empty once trimmed. */
  ignoreBlankLines: boolean;
  sideBySide: boolean;
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  granularity: 'line',
  ignoreCase: false,
  ignoreWhitespace: false,
  ignoreBlankLines: false,
  sideBySide: true,
};

export type SegmentType = 'equal' | 'insert' | 'delete';

export interface Segment {
  type: SegmentType;
  value: string;
}

/**
 * Above this edit distance the diff stops being useful (and Myers' memory grows
 * with D²), so we bail out to a plain "everything replaced" result rather than
 * freezing the window.
 */
const MAX_EDIT_DISTANCE = 3000;

export function tokenize(text: string, granularity: Granularity): string[] {
  if (!text) return [];
  switch (granularity) {
    case 'line':
      return text.split('\n');
    case 'word':
      // Keep the separators as their own tokens so whitespace survives the
      // round-trip and the rebuilt text matches the input exactly.
      return text.match(/\s+|[^\s]+/g) ?? [];
    case 'char':
      return Array.from(text);
  }
}

function normalize(token: string, options: DiffOptions): string {
  let value = token;
  if (options.ignoreWhitespace) value = value.replace(/\s+/g, ' ').trim();
  if (options.ignoreCase) value = value.toLowerCase();
  return value;
}

/**
 * Myers' greedy diff. Returns the edit script as equal/insert/delete runs.
 * `a` is the left text, `b` the right one.
 */
function myers(a: string[], b: string[], eq: (x: string, y: string) => boolean): Segment[] {
  const n = a.length;
  const m = b.length;

  if (n === 0) return b.map((value) => ({ type: 'insert' as const, value }));
  if (m === 0) return a.map((value) => ({ type: 'delete' as const, value }));

  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max;
  const size = 2 * max + 1;
  const v = new Int32Array(size);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());

    for (let k = -d; k <= d; k += 2) {
      const index = offset + k;
      if (index < 0 || index >= size) continue;

      let x: number;
      if (k === -d || (k !== d && v[index - 1] < v[index + 1])) {
        x = v[index + 1]; // move down: insertion from b
      } else {
        x = v[index - 1] + 1; // move right: deletion from a
      }
      let y = x - k;

      while (x < n && y < m && eq(a[x], b[y])) {
        x++;
        y++;
      }

      v[index] = x;

      if (x >= n && y >= m) return backtrack(trace, a, b, d, offset, size);
    }
  }

  // Too different to diff cheaply: report it as a wholesale replacement.
  return [
    ...a.map((value) => ({ type: 'delete' as const, value })),
    ...b.map((value) => ({ type: 'insert' as const, value })),
  ];
}

function backtrack(
  trace: Int32Array[],
  a: string[],
  b: string[],
  d: number,
  offset: number,
  size: number,
): Segment[] {
  const script: Segment[] = [];
  let x = a.length;
  let y = b.length;

  for (let depth = d; depth > 0; depth--) {
    const v = trace[depth];
    const k = x - y;
    const index = offset + k;

    const goDown =
      k === -depth || (k !== depth && index - 1 >= 0 && index + 1 < size && v[index - 1] < v[index + 1]);
    const prevK = goDown ? k + 1 : k - 1;
    const prevIndex = offset + prevK;
    const prevX = v[prevIndex];
    const prevY = prevX - prevK;

    // Everything above the previous point on this path was a match.
    while (x > prevX && y > prevY) {
      script.push({ type: 'equal', value: a[x - 1] });
      x--;
      y--;
    }

    if (goDown) {
      script.push({ type: 'insert', value: b[y - 1] });
      y--;
    } else {
      script.push({ type: 'delete', value: a[x - 1] });
      x--;
    }
  }

  while (x > 0 && y > 0) {
    script.push({ type: 'equal', value: a[x - 1] });
    x--;
    y--;
  }
  while (x > 0) {
    script.push({ type: 'delete', value: a[--x] });
  }
  while (y > 0) {
    script.push({ type: 'insert', value: b[--y] });
  }

  return script.reverse();
}

export interface DiffResult {
  segments: Segment[];
  added: number;
  removed: number;
}

export function diff(left: string, right: string, options: DiffOptions): DiffResult {
  let a = tokenize(left, options.granularity);
  let b = tokenize(right, options.granularity);

  if (options.ignoreBlankLines && options.granularity === 'line') {
    a = a.filter((line) => line.trim().length > 0);
    b = b.filter((line) => line.trim().length > 0);
  }

  const eq = (x: string, y: string) => normalize(x, options) === normalize(y, options);
  const segments = myers(a, b, eq);

  return {
    segments,
    added: segments.filter((s) => s.type === 'insert').length,
    removed: segments.filter((s) => s.type === 'delete').length,
  };
}

export interface DiffRow {
  left?: string;
  right?: string;
  type: SegmentType | 'replace';
}

/**
 * Pair deletions with the insertions that follow them so a modified line shows
 * old and new on the same row instead of as two unrelated stripes.
 */
export function toRows(segments: Segment[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;

  while (i < segments.length) {
    const segment = segments[i];

    if (segment.type === 'equal') {
      rows.push({ left: segment.value, right: segment.value, type: 'equal' });
      i++;
      continue;
    }

    const deletions: string[] = [];
    const insertions: string[] = [];
    while (i < segments.length && segments[i].type === 'delete') deletions.push(segments[i++].value);
    while (i < segments.length && segments[i].type === 'insert') insertions.push(segments[i++].value);

    const height = Math.max(deletions.length, insertions.length);
    for (let row = 0; row < height; row++) {
      const left = deletions[row];
      const right = insertions[row];
      rows.push({
        left,
        right,
        type: left !== undefined && right !== undefined ? 'replace' : left !== undefined ? 'delete' : 'insert',
      });
    }
  }

  return rows;
}
