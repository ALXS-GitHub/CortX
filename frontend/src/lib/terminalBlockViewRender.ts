/**
 * Buffer rows → HTML, for the block layout (CORT-57, `terminalBlockView.ts`).
 *
 * The block layout shows every finished block as text in the page instead of
 * on xterm's canvas. That text has to be *the same text* — same columns, same
 * colours, same attributes — or the moment a block stops being live and turns
 * into page text would visibly jump. So this module reads the very cells xterm
 * holds (`IBufferLine.getCell`) and applies xterm's own rules to them:
 *
 * - **Colours**: palette indices resolve against the terminal theme (0–15,
 *   `extendedAnsi`, then the standard 6×6×6 cube and grey ramp), truecolour
 *   is used as is, `drawBoldTextInBrightColors` lifts bold 0–7 to 8–15,
 *   inverse swaps the pair, dim is the colour at 50 %, invisible is
 *   transparent, and `minimumContrastRatio` is enforced with xterm's own
 *   step-by-10 % search.
 * - **Columns**: one cell is `cellWidth` px exactly. The page font's natural
 *   advance is corrected with `letter-spacing` on the row (see the view), and
 *   a glyph whose advance differs from the grid's anyway — a wide CJK cell, an
 *   emoji, a Nerd Font icon from a fallback font — gets a box of its own,
 *   `width` × cells, so nothing after it drifts.
 *
 * Every run carries `data-c`, the column it starts at, which is how a DOM
 * selection is mapped back to buffer cells for copying (`columnAt`).
 *
 * Pure apart from the `fits` probe it is handed: no DOM, no xterm instance —
 * it takes the narrow slice of `IBufferLine` / `IBufferCell` it needs, which
 * is what lets it run under `node --test`.
 */

/** The slice of xterm's `IBufferCell` this module reads. */
export interface CellLike {
  getWidth(): number;
  getChars(): string;
  getFgColorMode(): number;
  getBgColorMode(): number;
  getFgColor(): number;
  getBgColor(): number;
  isBold(): number;
  isItalic(): number;
  isDim(): number;
  isUnderline(): number;
  isInverse(): number;
  isInvisible(): number;
  isStrikethrough(): number;
  isOverline(): number;
  isFgDefault(): boolean;
  isBgDefault(): boolean;
  isFgPalette(): boolean;
  isBgPalette(): boolean;
  isFgRGB(): boolean;
  isBgRGB(): boolean;
}

/** The slice of xterm's `IBufferLine` this module reads. */
export interface LineLike {
  readonly length: number;
  readonly isWrapped: boolean;
  getCell(x: number, cell?: CellLike): CellLike | undefined;
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

/** The theme fields the palette is built from (a subset of xterm's `ITheme`). */
export interface ThemeLike {
  foreground?: string;
  background?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
  extendedAnsi?: string[];
}

export type Rgb = [number, number, number];

export interface RenderPalette {
  /** Default foreground. */
  fg: Rgb;
  /**
   * What is really behind the text: the theme background, or — when that is
   * transparent (the Terminal window) — the colour the caller resolved for the
   * surface the text sits on. Used for inverse video and for the contrast
   * ratio, never painted as a run background by itself.
   */
  bg: Rgb;
  /** 256 entries. */
  ansi: Rgb[];
  boldBright: boolean;
  /** xterm's `minimumContrastRatio`; 1 = leave colours alone. */
  minContrast: number;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const XTERM_DEFAULT_ANSI = [
  '#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf',
  '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec',
];

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` / `rgba()` → rgb (alpha dropped). */
export function parseColor(input: string | undefined | null): Rgb | null {
  if (!input) return null;
  const s = input.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return [r, g, b];
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) {
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])].map((n) => Math.max(0, Math.min(255, Math.round(n)))) as Rgb;
  return null;
}

/** Alpha of a colour string; 1 when it has none. */
export function colorAlpha(input: string | undefined | null): number {
  if (!input) return 1;
  const s = input.trim();
  const hex = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(s);
  if (hex) return parseInt(hex[1], 16) / 255;
  const rgba = /^rgba\([^)]*[, /]\s*([\d.]+)\s*\)$/i.exec(s);
  if (rgba) return Number(rgba[1]);
  return 1;
}

/** The xterm 256-colour palette for `theme`. */
export function buildAnsi(theme: ThemeLike): Rgb[] {
  const named = [
    theme.black, theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan, theme.white,
    theme.brightBlack, theme.brightRed, theme.brightGreen, theme.brightYellow,
    theme.brightBlue, theme.brightMagenta, theme.brightCyan, theme.brightWhite,
  ];
  const out: Rgb[] = [];
  for (let i = 0; i < 16; i++) out.push(parseColor(named[i]) ?? (parseColor(XTERM_DEFAULT_ANSI[i]) as Rgb));
  const levels = [0, 95, 135, 175, 215, 255];
  for (let i = 0; i < 216; i++) {
    out.push([levels[Math.floor(i / 36) % 6], levels[Math.floor(i / 6) % 6], levels[i % 6]]);
  }
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    out.push([v, v, v]);
  }
  theme.extendedAnsi?.forEach((c, i) => {
    const rgb = parseColor(c);
    if (rgb && 16 + i < 256) out[16 + i] = rgb;
  });
  return out;
}

export function buildPalette(
  theme: ThemeLike,
  opts: { surface: Rgb; boldBright?: boolean; minContrast?: number }
): RenderPalette {
  const bgOpaque = colorAlpha(theme.background) > 0.5 ? parseColor(theme.background) : null;
  return {
    fg: parseColor(theme.foreground) ?? [229, 229, 229],
    bg: bgOpaque ?? opts.surface,
    ansi: buildAnsi(theme),
    boldBright: opts.boldBright ?? true,
    minContrast: Math.max(1, opts.minContrast ?? 1),
  };
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function reduce(bg: Rgb, fg: Rgb, ratio: number): Rgb {
  let p = 0;
  let out = fg;
  while (contrast(out, bg) < ratio && p < 1) {
    p = Math.min(1, p + 0.1);
    out = [Math.round(fg[0] * (1 - p)), Math.round(fg[1] * (1 - p)), Math.round(fg[2] * (1 - p))];
  }
  return out;
}

function increase(bg: Rgb, fg: Rgb, ratio: number): Rgb {
  let p = 0;
  let out = fg;
  while (contrast(out, bg) < ratio && p < 1) {
    p = Math.min(1, p + 0.1);
    out = fg.map((c) => Math.round(c + (255 - c) * p)) as Rgb;
  }
  return out;
}

/** xterm's `ensureContrastRatio`: `fg` moved away from `bg` until `ratio`. */
export function ensureContrast(bg: Rgb, fg: Rgb, ratio: number): Rgb {
  if (ratio <= 1 || contrast(bg, fg) >= ratio) return fg;
  const darker = luminance(fg) < luminance(bg);
  const first = darker ? reduce(bg, fg, ratio) : increase(bg, fg, ratio);
  if (contrast(first, bg) >= ratio) return first;
  const second = darker ? increase(bg, fg, ratio) : reduce(bg, fg, ratio);
  return contrast(first, bg) >= contrast(second, bg) ? first : second;
}

const hex = (rgb: Rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
const rgba = (rgb: Rgb, a: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

// ---------------------------------------------------------------------------
// Cell attributes
// ---------------------------------------------------------------------------

const F_BOLD = 1;
const F_ITALIC = 2;
const F_DIM = 4;
const F_UNDERLINE = 8;
const F_INVERSE = 16;
const F_INVISIBLE = 32;
const F_STRIKE = 64;
const F_OVERLINE = 128;

/** 0 default, 1 palette, 2 rgb. */
function fgMode(cell: CellLike): number {
  return cell.isFgDefault() ? 0 : cell.isFgPalette() ? 1 : 2;
}

function bgMode(cell: CellLike): number {
  return cell.isBgDefault() ? 0 : cell.isBgPalette() ? 1 : 2;
}

function flagsOf(cell: CellLike): number {
  return (
    (cell.isBold() ? F_BOLD : 0) |
    (cell.isItalic() ? F_ITALIC : 0) |
    (cell.isDim() ? F_DIM : 0) |
    (cell.isUnderline() ? F_UNDERLINE : 0) |
    (cell.isInverse() ? F_INVERSE : 0) |
    (cell.isInvisible() ? F_INVISIBLE : 0) |
    (cell.isStrikethrough() ? F_STRIKE : 0) |
    (cell.isOverline() ? F_OVERLINE : 0)
  );
}

/** Does this cell show anything (so a row cannot be cut before it)? */
export function cellVisible(cell: CellLike): boolean {
  const ch = cell.getChars();
  if (ch !== '' && ch !== ' ') return true;
  if (!cell.isBgDefault()) return true;
  return !!(cell.isInverse() || cell.isUnderline() || cell.isStrikethrough() || cell.isOverline());
}

/** Number of columns up to and including the last visible cell. */
export function usedColumns(line: LineLike, cell: CellLike): number {
  for (let x = line.length - 1; x >= 0; x--) {
    const c = line.getCell(x, cell);
    if (c && cellVisible(c)) return x + 1 + (c.getWidth() === 2 ? 1 : 0);
  }
  return 0;
}

export function lineIsBlank(line: LineLike | undefined, cell: CellLike): boolean {
  if (!line) return true;
  // Cheap first: most blank rows have no text at all, and most rows with text
  // are settled by it without walking the cells.
  if (line.translateToString(true).length > 0) return false;
  return usedColumns(line, cell) === 0;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface RowContext {
  palette: RenderPalette;
  /** Width of one grid cell, px. */
  cellWidth: number;
  /** Scratch cell reused for every read (xterm's `getNullCell()`). */
  cell: CellLike;
  /**
   * Does `ch` advance exactly one cell in the page font (after the row's
   * letter-spacing correction)? ASCII is never asked.
   */
  fits(ch: string): boolean;
  /** Style string per attribute key; reset whenever the palette changes. */
  styles: Map<string, string>;
}

function escapeHtml(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 38) out += '&amp;';
    else if (c === 60) out += '&lt;';
    else if (c === 62) out += '&gt;';
    else out += s[i];
  }
  return out;
}

function resolve(mode: number, value: number, palette: RenderPalette): Rgb | null {
  if (mode === 0) return null;
  if (mode === 1) return palette.ansi[value & 255] ?? null;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** The inline style of one attribute combination ('' = the defaults). */
export function styleFor(
  fm: number,
  fv: number,
  bm: number,
  bv: number,
  flags: number,
  palette: RenderPalette
): string {
  // Bold-as-bright, exactly where xterm does it: palette 0–7 only.
  if (palette.boldBright && flags & F_BOLD && fm === 1 && fv < 8) fv += 8;
  let fg = resolve(fm, fv, palette);
  let bg = resolve(bm, bv, palette);
  if (flags & F_INVERSE) {
    const f = fg ?? palette.fg;
    const b = bg ?? palette.bg;
    fg = b;
    bg = f;
  }
  const parts: string[] = [];
  if (flags & F_INVISIBLE) {
    parts.push('color:transparent');
  } else {
    let color = fg ?? palette.fg;
    if (palette.minContrast > 1) color = ensureContrast(bg ?? palette.bg, color, palette.minContrast);
    if (flags & F_DIM) parts.push(`color:${rgba(color, 0.5)}`);
    else if (fg || color !== palette.fg) parts.push(`color:${hex(color)}`);
  }
  if (bg) parts.push(`background:${hex(bg)}`);
  if (flags & F_BOLD) parts.push('font-weight:var(--cortx-bv-bold,700)');
  if (flags & F_ITALIC) parts.push('font-style:italic');
  const deco: string[] = [];
  if (flags & F_UNDERLINE) deco.push('underline');
  if (flags & F_STRIKE) deco.push('line-through');
  if (flags & F_OVERLINE) deco.push('overline');
  if (deco.length) parts.push(`text-decoration:${deco.join(' ')}`);
  return parts.join(';');
}

/**
 * Box drawing, block elements and the Powerline separators: xterm draws these
 * itself (`customGlyphs`) so they fill the whole cell and join up across
 * rows. A font glyph does not reach the top and bottom of a tall line box, so
 * on the page they get a box of their own that the view stretches to the cell
 * (`.b`, `--cortx-bv-box-*`).
 */
export function isBoxChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x2500 && c <= 0x259f) || (c >= 0xe0b0 && c <= 0xe0bf) || (c >= 0x1fb00 && c <= 0x1fbaf);
}

/** Characters whose advance never needs checking. */
function isAscii(ch: string): boolean {
  if (ch.length !== 1) return false;
  const c = ch.charCodeAt(0);
  return c >= 0x20 && c < 0x7f;
}

/**
 * Inner HTML of one row: runs of `<span data-c>` up to the last visible cell.
 * `limit` caps the columns read (the grid width; a line can be longer after a
 * shrink before xterm reflows it).
 */
export function renderRow(line: LineLike | undefined, ctx: RowContext, limit = Infinity): string {
  if (!line) return '';
  const { cell, palette, styles } = ctx;
  const end = Math.min(usedColumns(line, cell), limit);
  if (end === 0) return '';
  let html = '';
  // The run being built: plain text, or box-drawing glyphs (stretched as one
  // piece, so a line of `─` has no seams).
  let runKey = '';
  let runStyle = '';
  let runText = '';
  let runCol = 0;
  let runCells = 0;
  let runBox = false;
  const flush = () => {
    if (!runText) return;
    if (runBox) {
      const size = `width:${runCells * ctx.cellWidth}px`;
      html += `<span data-c="${runCol}" class="b" style="${runStyle ? `${runStyle};${size}` : size}">${escapeHtml(runText)}</span>`;
    } else {
      html += runStyle
        ? `<span data-c="${runCol}" style="${runStyle}">${escapeHtml(runText)}</span>`
        : `<span data-c="${runCol}">${escapeHtml(runText)}</span>`;
    }
    runText = '';
    runCells = 0;
  };
  for (let x = 0; x < end; x++) {
    const c = line.getCell(x, cell);
    if (!c) break;
    const width = c.getWidth();
    // The second half of a wide glyph: the first half already spans it.
    if (width === 0) continue;
    const chars = c.getChars() || ' ';
    const fm = fgMode(c);
    const bm = bgMode(c);
    const fv = c.getFgColor();
    const bv = c.getBgColor();
    const flags = flagsOf(c);
    const key = `${fm}.${fv}.${bm}.${bv}.${flags}`;
    let style = styles.get(key);
    if (style === undefined) {
      style = styleFor(fm, fv, bm, bv, flags, palette);
      styles.set(key, style);
    }
    const ascii = isAscii(chars);
    const box = width === 1 && !ascii && isBoxChar(chars);
    if (width === 1 && (box || ascii || ctx.fits(chars))) {
      if (key !== runKey || box !== runBox || !runText) {
        flush();
        runKey = key;
        runStyle = style;
        runCol = x;
        runBox = box;
      }
      runText += chars;
      runCells++;
      continue;
    }
    // A boxed glyph: exactly `width` cells, whatever its own advance.
    flush();
    runKey = '';
    const size = `width:${width * ctx.cellWidth}px`;
    html += `<span data-c="${x}" class="w" style="${style ? `${style};${size}` : size}">${escapeHtml(chars)}</span>`;
  }
  flush();
  return html;
}

// ---------------------------------------------------------------------------
// DOM selection → buffer columns
// ---------------------------------------------------------------------------

/**
 * The buffer column a DOM position (`node`, `offset`) falls on, given the run
 * element it is in. Runs hold one column per *code point* (wide glyphs are
 * boxed on their own), so the offset is counted in code points.
 */
export function columnInRun(runStart: number, text: string, offset: number): number {
  let col = runStart;
  for (let i = 0; i < offset && i < text.length; i++) {
    const code = text.charCodeAt(i);
    // A surrogate pair is one code point, one column.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) i++;
    col++;
  }
  return col;
}

/** Buffer text between two cells, wrapped rows joined, like xterm's copy. */
export function textBetween(
  getLine: (y: number) => LineLike | undefined,
  from: { line: number; col: number },
  to: { line: number; col: number }
): string {
  if (to.line < from.line || (to.line === from.line && to.col < from.col)) [from, to] = [to, from];
  let out = '';
  for (let y = from.line; y <= to.line; y++) {
    const line = getLine(y);
    if (!line) break;
    const start = y === from.line ? from.col : 0;
    const end = y === to.line ? to.col : line.length;
    const next = y < to.line ? getLine(y + 1) : undefined;
    const joined = !!next?.isWrapped;
    // A wrapped row keeps its trailing spaces: they are part of the line.
    out += line.translateToString(!joined, start, end);
    if (y < to.line && !joined) out += '\n';
  }
  return out;
}
