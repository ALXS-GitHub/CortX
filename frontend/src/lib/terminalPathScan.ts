/**
 * Finding file paths in terminal output — the pure half of `terminalLinks.ts`.
 *
 * A path used to be "a run of non-space characters holding a separator". Two
 * kinds of path fell through that (zorg #49):
 *
 * 1. **Paths with a space in them.** `C:\Users\Alexis Munch\Videos\clip.mp4`
 *    is two runs, `C:\Users\Alexis` and `Munch\Videos\clip.mp4`, and neither
 *    exists on its own. Windows puts a space in the home directory of anyone
 *    whose account carries their full name, so on that machine *every* path
 *    under the profile was dead.
 * 2. **Paths cut by a hard line break.** A program that wraps its own output
 *    (an agent's TUI, anything built on Ink) prints a long path as two rows
 *    with a real newline between them, and a ConPTY repaint does the same to a
 *    line xterm had wrapped itself. Neither row is flagged `isWrapped`, so the
 *    logical-line walk never put the halves back together.
 *
 * Both are the same question — *does the path go on past this gap?* — and
 * there is no reading of the text alone that answers it: `src/a.ts src/b.ts`
 * is two paths, `My Folder/b.ts` is one. So nothing is decided here. A path
 * that starts on a run holding a separator is offered in every length it could
 * have: the run alone, then extended over the next single space or line break,
 * and so on. The caller checks each against the disk, and the **longest one
 * that exists wins** — the same "nothing is a link until the filesystem says
 * so" rule that kept words with a slash in them from being underlined.
 *
 * What bounds the guessing, since every guess is an `exists()` call:
 * - a gap inside a line is joined only when it is exactly one space (two or
 *   more is column alignment, `ls -l` and friends);
 * - a line break is joined only when the row really looks wrapped — the text
 *   ran into the right edge, or the next word would not have fit beside it;
 * - a path tries at most `MAX_STEPS` runs, `MAX_BREAKS` line breaks and
 *   `MAX_VARIANTS` lengths, and never grows past `MAX_PATH`.
 *
 * A path is still only *started* on a run with a separator in it: `My
 * Folder/b.ts` (relative, space in its first segment) stays out of reach,
 * because nothing marks where it begins.
 *
 * Nothing here touches xterm, Tauri or the DOM, so `terminalPathScan.test.ts`
 * runs on plain Node.
 */

/** The position compilers and linters append: `:12`, `:12:34`, `:12,34`, `(12,34)`. */
const POSITION = /[:(](\d+)(?:[:,](\d+))?\)?$/;
/** Trailing punctuation that belongs to the sentence, not to the path. */
const TRAILING = /[.,;:!?'"`)\]}>]+$/;
const LEADING = /^[('"`[{<]+/;
/** A run of characters a path can be made of — what spaces and quotes cut. */
const RUN = /[^\s"'`<>|]+/g;

/** Longest candidate we bother checking (a base64 blob is not a path). */
export const MAX_PATH = 512;
/** Runs one path may be stitched from. */
const MAX_STEPS = 8;
/** Line breaks one path may cross. */
const MAX_BREAKS = 3;
/** Lengths offered for one path, i.e. `exists()` calls it may cost. */
const MAX_VARIANTS = 12;
/**
 * How far short of the right edge a row may stop and still count as wrapped.
 * A TUI wraps to its own box, not to the terminal: padding and a scrollbar
 * gutter leave a few columns blank on the right.
 */
const EDGE_SLACK = 10;

export interface ParsedPath {
  /** The path as written, without the `:line:col` suffix. */
  raw: string;
  line?: number;
  column?: number;
  /** Offset and length of the whole match (path + position) inside the text. */
  index: number;
  length: number;
}

/**
 * Split one candidate into the path and the position a compiler appended.
 * `index` is where `text` starts in whatever it was cut from.
 */
export function parseCandidate(text: string, index: number): ParsedPath | null {
  let raw = text;
  let start = index;
  const lead = LEADING.exec(raw);
  if (lead) {
    raw = raw.slice(lead[0].length);
    start += lead[0].length;
  }
  if (!raw || raw.length > MAX_PATH) return null;
  // A URL is the WebLinksAddon's job, and `--flag/x` is not a path.
  if (raw.includes('://') || raw.startsWith('-')) return null;

  // Peel one trailing punctuation mark at a time until a position suffix
  // shows up (`main.cpp(12,5):` has to lose its colon before `(12,5)` can be
  // seen) or there is nothing left to peel.
  let line: number | undefined;
  let column: number | undefined;
  let suffix = '';
  for (let guard = 0; guard < 4; guard++) {
    const pos = POSITION.exec(raw);
    if (pos) {
      line = Number(pos[1]);
      column = pos[2] === undefined ? undefined : Number(pos[2]);
      suffix = raw.slice(pos.index);
      raw = raw.slice(0, pos.index);
      break;
    }
    if (!TRAILING.test(raw.slice(-1))) break;
    raw = raw.slice(0, -1);
  }
  raw = raw.replace(TRAILING, '');

  // `C:\x` keeps its drive colon; anything else with a colon left in it is
  // not a path we can trust (`http:`, `key:value/other`).
  const afterDrive = /^[A-Za-z]:/.test(raw) ? raw.slice(2) : raw;
  if (afterDrive.includes(':')) return null;
  if (!raw || !/[\\/]/.test(raw)) return null;
  // Bare `/` or `//` — not worth a link.
  if (/^[\\/]+$/.test(raw)) return null;
  return { raw, line, column, index: start, length: raw.length + suffix.length };
}

/** A buffer cell: column and absolute row, both 0-based. */
export interface ScanCell {
  x: number;
  y: number;
}

/** One logical line of the buffer, with the cell every character came from. */
export interface ScanLine {
  text: string;
  cells: ScanCell[];
}

/** One length a path could have, located in the scanned lines. */
export interface PathSpan {
  raw: string;
  line?: number;
  column?: number;
  /** Cells the match covers, in order. A space a wrap swallowed has none. */
  cells: ScanCell[];
  /** First and last character as offsets in the scanned text, for overlaps. */
  from: number;
  to: number;
}

/** Every length one path could have, longest first. */
export interface PathCandidate {
  variants: PathSpan[];
}

interface Run {
  start: number;
  end: number;
}

/** A character of a stitched candidate; `null` is a space a wrap swallowed. */
type Glyph = { cell: ScanCell; at: number } | null;

interface Piece {
  text: string;
  glyphs: Glyph[];
  line: number;
  run: number;
  steps: number;
  breaks: number;
}

/**
 * Every path that could start in `lines`, each with all the lengths worth
 * asking the disk about. With `row`, only paths that could reach that buffer
 * row are kept — the link provider is asked one row at a time.
 */
export function pathCandidates(lines: ScanLine[], cols: number, row?: number): PathCandidate[] {
  const runs = lines.map((line) => {
    const found: Run[] = [];
    RUN.lastIndex = 0;
    for (let m = RUN.exec(line.text); m; m = RUN.exec(line.text)) {
      found.push({ start: m.index, end: m.index + m[0].length });
    }
    return found;
  });
  // Where each line starts in one running count, so spans from different
  // lines can be ordered and checked for overlap.
  const base: number[] = [];
  let offset = 0;
  for (const line of lines) {
    base.push(offset);
    offset += line.text.length + 1;
  }

  const glyphsOf = (li: number, run: Run): Glyph[] => {
    const out: Glyph[] = [];
    for (let i = run.start; i < run.end; i++) {
      const cell = lines[li].cells[i];
      out.push(cell ? { cell, at: base[li] + i } : null);
    }
    return out;
  };

  /** Where the path could go on after run `ri` of line `li`, and with what in between. */
  const nextSteps = (li: number, ri: number): { line: number; run: number; joiner: string }[] => {
    const line = lines[li];
    const run = runs[li][ri];
    const following = runs[li][ri + 1];
    if (following) {
      // One space inside a line, never more (see the header).
      return line.text.slice(run.end, following.start) === ' ' ? [{ line: li, run: ri + 1, joiner: ' ' }] : [];
    }
    // The last run of its line: the path may go on at the start of the next.
    if (li + 1 >= lines.length || !/^\s*$/.test(line.text.slice(run.end))) return [];
    const next = runs[li + 1][0];
    if (!next || !/^\s*$/.test(lines[li + 1].text.slice(0, next.start))) return [];
    const lastX = line.cells[run.end - 1]?.x ?? 0;
    const steps: { line: number; run: number; joiner: string }[] = [];
    // Cut mid-word: the row ran into the edge.
    if (lastX >= cols - 1 - EDGE_SLACK) steps.push({ line: li + 1, run: 0, joiner: '' });
    // Wrapped at a space: the next word would not have fit after it.
    if (lastX + 2 + (next.end - next.start) > cols - EDGE_SLACK) steps.push({ line: li + 1, run: 0, joiner: ' ' });
    return steps;
  };

  const candidates: PathCandidate[] = [];
  for (let li = 0; li < lines.length; li++) {
    for (let ri = 0; ri < runs[li].length; ri++) {
      const run = runs[li][ri];
      const first = lines[li].text.slice(run.start, run.end);
      if (!/[\\/]/.test(first)) continue;

      const variants: PathSpan[] = [];
      const seen = new Set<string>();
      // Breadth first: every shorter length is offered before a longer one,
      // so the cap cuts off the least likely guesses.
      const queue: Piece[] = [{ text: first, glyphs: glyphsOf(li, run), line: li, run: ri, steps: 1, breaks: 0 }];
      let budget = MAX_VARIANTS * 4;
      while (queue.length && variants.length < MAX_VARIANTS && budget-- > 0) {
        const piece = queue.shift()!;
        const span = spanOf(piece);
        if (span && !seen.has(span.raw + span.to)) {
          seen.add(span.raw + span.to);
          variants.push(span);
        }
        if (piece.steps >= MAX_STEPS) continue;
        for (const step of nextSteps(piece.line, piece.run)) {
          const crossesLine = step.line !== piece.line;
          if (crossesLine && piece.breaks >= MAX_BREAKS) continue;
          const nextRun = runs[step.line][step.run];
          const text = piece.text + step.joiner + lines[step.line].text.slice(nextRun.start, nextRun.end);
          if (text.length > MAX_PATH) continue;
          // A same-line space is a real cell; the one a wrap swallowed is not.
          const joinerGlyphs: Glyph[] = crossesLine
            ? step.joiner.split('').map(() => null)
            : glyphsOf(step.line, { start: runs[piece.line][piece.run].end, end: nextRun.start });
          queue.push({
            text,
            glyphs: [...piece.glyphs, ...joinerGlyphs, ...glyphsOf(step.line, nextRun)],
            line: step.line,
            run: step.run,
            steps: piece.steps + 1,
            breaks: piece.breaks + (crossesLine ? 1 : 0),
          });
        }
      }
      if (!variants.length) continue;
      variants.sort((a, b) => b.to - a.to || b.raw.length - a.raw.length);
      if (row !== undefined) {
        const startRow = variants[0].cells[0].y;
        const reach = Math.max(...variants.map((v) => v.cells[v.cells.length - 1].y));
        if (startRow > row || reach < row) continue;
      }
      candidates.push({ variants });
    }
  }
  return candidates;
}

function spanOf(piece: Piece): PathSpan | null {
  const parsed = parseCandidate(piece.text, 0);
  if (!parsed) return null;
  const glyphs = piece.glyphs.slice(parsed.index, parsed.index + parsed.length);
  const first = glyphs[0];
  const last = glyphs[glyphs.length - 1];
  if (!first || !last) return null;
  return {
    raw: parsed.raw,
    line: parsed.line,
    column: parsed.column,
    cells: glyphs.filter((g): g is NonNullable<Glyph> => g !== null).map((g) => g.cell),
    from: first.at,
    to: last.at,
  };
}

/** A path the disk confirmed, with what it resolved to. */
export interface FoundPath extends PathSpan {
  target: string;
}

/**
 * Ask the disk (`check` resolves a raw path to its absolute target, or null
 * when nothing is there) and keep, per candidate, the longest length that
 * exists. Where two found paths overlap — `Munch\Videos\clip.mp4` is also a
 * relative path from `C:\Users\Alexis` — the one that starts first wins: it
 * is the one that swallowed the other.
 */
export async function pickPathLinks(
  candidates: PathCandidate[],
  check: (raw: string) => Promise<string | null>
): Promise<FoundPath[]> {
  const chosen = await Promise.all(
    candidates.map(async (candidate) => {
      const targets = await Promise.all(candidate.variants.map((v) => check(v.raw)));
      const i = targets.findIndex((t) => t !== null);
      return i < 0 ? null : { ...candidate.variants[i], target: targets[i]! };
    })
  );
  const found = chosen.filter((f): f is FoundPath => f !== null).sort((a, b) => a.from - b.from || b.to - a.to);
  const kept: FoundPath[] = [];
  let end = -1;
  for (const f of found) {
    if (f.from <= end) continue;
    kept.push(f);
    end = f.to;
  }
  return kept;
}
