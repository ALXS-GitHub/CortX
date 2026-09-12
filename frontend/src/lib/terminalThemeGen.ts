/**
 * Build a terminal theme out of an image, the way Warp does when you drop a
 * wallpaper on it.
 *
 * Pure: the caller hands over raw RGBA bytes (a `<canvas>` gives them, and
 * only the caller has a DOM), everything below is arithmetic. That is what
 * lets the hard part — "is the theme this produced actually legible" — be a
 * unit test rather than a screenshot someone has to squint at.
 *
 * ## The rule the whole file serves
 *
 * A generated theme must be readable **by construction**. This project has
 * already paid for the alternative: `aespa_wda` shipped `accent: #0c161f` on
 * `background: #713d39`, CortX paints the accent as text, and the running
 * command in every tab came out black on dark red at 2.1:1. A generator that
 * picks pretty colours off a photograph and writes them to a file would
 * produce that theme several times a day.
 *
 * So every colour that leaves here has been through `readableOn` against the
 * background it will sit on:
 *
 * | colour                 | used as            | floor |
 * |------------------------|--------------------|-------|
 * | `foreground`           | the text itself    | 7:1   |
 * | `accent`               | text *and* a fill  | 4.5:1 |
 * | the 16 terminal colours| glyphs             | 3:1   |
 *
 * `foreground` is held to AAA rather than AA because it is not one label on
 * one row, it is every character of every command and all their output.
 *
 * ## Why the palette is found in OKLab
 *
 * Median cut splits the box of colours along its longest axis, so "longest"
 * has to mean something to the eye. In RGB the green axis is worth far more
 * light than the blue one and the cut lands in the wrong place: a photograph
 * of a sunset comes back with four browns and no sky. See `color.ts` for the
 * longer version of that argument.
 */
import {
  CONTRAST,
  contrast,
  distance,
  isDarkBackground,
  luminance,
  oklchToRgb,
  parseHex,
  readableOn,
  rgbToOklch,
  toHex,
  type Rgb,
} from './color.ts';

// ---------------------------------------------------------------------------
// Quantisation
// ---------------------------------------------------------------------------

/** One colour of an image, with the share of pixels it accounts for (0-1). */
export interface Swatch {
  color: Rgb;
  weight: number;
}

/** One entry of the histogram: a colour and how many pixels wore it. */
interface Bin {
  r: number;
  g: number;
  b: number;
  count: number;
  /** OKLab coordinates, which is what the box is measured in. */
  l: number;
  a: number;
  bb: number;
}

function coords(r: number, g: number, b: number): { l: number; a: number; bb: number } {
  const { l, c, h } = rgbToOklch({ r, g, b, a: 1 });
  const rad = (h * Math.PI) / 180;
  return { l, a: c * Math.cos(rad), bb: c * Math.sin(rad) };
}

/**
 * Median cut over RGBA bytes.
 *
 * `step` skips pixels: a 4000x3000 photograph is twelve million colours and
 * the palette does not get better for looking at all of them. Every fourth
 * pixel is plenty and keeps a wallpaper import inside a frame.
 *
 * Fully transparent pixels are dropped — a PNG with a cut-out subject would
 * otherwise return "black" as its dominant colour, black being what the
 * empty corners decode to.
 *
 * ## Why a histogram, and why the *weighted* median
 *
 * The textbook cut sorts the pixels and splits the list in half. That is a
 * split by pixel count, not by colour, so a flat area gets sliced straight
 * through: an image of 800 red, 200 green and 100 blue pixels comes back as
 * "550 of something reddish, 275 of a red-blue mix, 275 of a green-blue mix"
 * — three muddy colours in the wrong proportions, and nothing downstream can
 * recover the fact that the image was three quarters red. Anything drawn
 * rather than photographed (a flat wallpaper, a screenshot, a logo) is that
 * image.
 *
 * Collapsing to a histogram first makes each *distinct* colour one entry, and
 * splitting at the point that best balances the **counts** on either side
 * keeps a run of identical pixels whole. The same image then comes back as
 * red at 73 %, green at 18 %, blue at 9 %.
 */
export function quantize(pixels: Uint8ClampedArray | number[], maxColors = 12, step = 4): Swatch[] {
  // 5 bits per channel: near-identical pixels (sensor noise, JPEG ringing)
  // collapse into one entry, and the histogram stays under 32k entries
  // whatever the image.
  const hist = new Map<number, { r: number; g: number; b: number; count: number }>();
  const stride = 4 * Math.max(1, step);
  let total = 0;
  for (let i = 0; i + 3 < pixels.length; i += stride) {
    if (pixels[i + 3] < 8) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const seen = hist.get(key);
    if (seen) {
      seen.r += r;
      seen.g += g;
      seen.b += b;
      seen.count++;
    } else {
      hist.set(key, { r, g, b, count: 1 });
    }
    total++;
  }
  if (total === 0) return [];

  const bins: Bin[] = [...hist.values()].map((e) => {
    const r = e.r / e.count;
    const g = e.g / e.count;
    const b = e.b / e.count;
    return { r, g, b, count: e.count, ...coords(r, g, b) };
  });

  let boxes: Bin[][] = [bins];
  while (boxes.length < maxColors) {
    // Split the box with the longest perceptual side; stop when none can be.
    let target = -1;
    let bestSpread = 0;
    let axis: 'l' | 'a' | 'bb' = 'l';
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (const key of ['l', 'a', 'bb'] as const) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const p of box) {
          if (p[key] < lo) lo = p[key];
          if (p[key] > hi) hi = p[key];
        }
        const spread = hi - lo;
        if (spread > bestSpread) {
          bestSpread = spread;
          target = i;
          axis = key;
        }
      }
    });
    if (target < 0 || bestSpread <= 0) break;

    const box = boxes[target];
    box.sort((x, y) => x[axis] - y[axis]);
    const boxTotal = box.reduce((n, p) => n + p.count, 0);
    // The cut that comes closest to halving the pixels, among the ones that
    // leave both sides non-empty. Balancing on counts rather than on entries
    // is what keeps a dominant flat colour in one piece.
    let cut = 1;
    let bestGap = Infinity;
    let running = 0;
    for (let i = 0; i < box.length - 1; i++) {
      running += box[i].count;
      const gap = Math.abs(running - boxTotal / 2);
      if (gap < bestGap) {
        bestGap = gap;
        cut = i + 1;
      }
    }
    boxes = [...boxes.slice(0, target), box.slice(0, cut), box.slice(cut), ...boxes.slice(target + 1)];
  }

  const means = boxes
    .filter((b) => b.length > 0)
    .map((box) => {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (const p of box) {
        r += p.r * p.count;
        g += p.g * p.count;
        b += p.b * p.count;
        n += p.count;
      }
      return { color: { r: r / n, g: g / n, b: b / n, a: 1 }, weight: n / total };
    });
  return mergeAlike(means).sort((x, y) => y.weight - x.weight);
}

/**
 * Fold together boxes that came back the same colour.
 *
 * The cut balances pixel counts, not colours, so a box holding one dominant
 * tone and a few stragglers can still be split into two means a hair apart.
 * Two entries of the same colour halve the weight the palette reports for it,
 * and every caller that ranks by weight then picks the wrong canvas.
 *
 * 0.03 in OKLab is about where two colours stop being tellable apart side by
 * side, so merging below it loses nothing a human could have used.
 */
function mergeAlike(swatches: Swatch[], threshold = 0.03): Swatch[] {
  const out: Swatch[] = [];
  for (const s of swatches) {
    const near = out.find((o) => distance(o.color, s.color) < threshold);
    if (!near) {
      out.push({ ...s });
      continue;
    }
    // Weighted mean, so the heavier of the two pulls the result its way.
    const w = near.weight + s.weight;
    near.color = {
      r: (near.color.r * near.weight + s.color.r * s.weight) / w,
      g: (near.color.g * near.weight + s.color.g * s.weight) / w,
      b: (near.color.b * near.weight + s.color.b * s.weight) / w,
      a: 1,
    };
    near.weight = w;
  }
  return out;
}

// ---------------------------------------------------------------------------
// From a palette to a theme
// ---------------------------------------------------------------------------

/** The five ways one image can become a theme. */
export type VariantKind = 'dark' | 'light' | 'vivid' | 'muted' | 'contrast';

export const VARIANTS: ReadonlyArray<{ kind: VariantKind; label: string; hint: string }> = [
  { kind: 'dark', label: 'Dark', hint: "The image's own shadows as the canvas" },
  { kind: 'light', label: 'Light', hint: 'Its lightest tone as the canvas' },
  { kind: 'vivid', label: 'Vivid', hint: 'Dark, with the boldest colour as accent' },
  { kind: 'muted', label: 'Muted', hint: 'Dark, with a quieter accent' },
  { kind: 'contrast', label: 'High contrast', hint: 'Pushed apart for legibility' },
];

/** What the generator produces: the fields a theme file carries. */
export interface ThemeDraft {
  kind: VariantKind;
  background: string;
  foreground: string;
  accent: string;
  /** 'darker' or 'lighter', derived from the background and never guessed. */
  details: 'darker' | 'lighter';
  normal: AnsiSet;
  bright: AnsiSet;
}

export interface AnsiSet {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
}

/** The hue each terminal colour is expected to sit near, in OKLCh degrees. */
const ANSI_HUES: Array<[keyof AnsiSet, number]> = [
  ['red', 29],
  ['yellow', 96],
  ['green', 142],
  ['cyan', 195],
  ['blue', 264],
  ['magenta', 328],
];

const chromaOf = (c: Rgb) => rgbToOklch(c).c;

/**
 * The contrast one terminal colour owes the background.
 *
 * Not one number for all sixteen. On a dark theme ANSI `black` is the colour
 * of de-emphasised output - a dimmed path, a comment, the `black` half of
 * every "bright black is grey" convention - and it is *meant* to sit close to
 * the canvas. Holding it to 3:1 would turn it into a mid grey and leave the
 * palette with no dim tone at all, which is a worse theme, not a safer one.
 *
 * So the colour at the background's own end of the scale is only asked to be
 * *visible* (1.6:1 normal, 2.2:1 bright, roughly the step the shipped themes
 * put between the two), and the other fourteen owe the full glyph floor.
 */
export function ansiFloor(name: keyof AnsiSet, backgroundIsDark: boolean, bright: boolean): number {
  const nearest = backgroundIsDark ? 'black' : 'white';
  if (name !== nearest) return CONTRAST.ui;
  // Which of the pair is the dimmer flips with the theme. On a dark canvas
  // the scale runs away from it, so `brightBlack` is the more visible grey.
  // On a light canvas `brightWhite` is the *whitest* white, which is the one
  // nearest the background and therefore the one allowed to be faintest.
  return backgroundIsDark ? (bright ? 2.2 : 1.6) : bright ? 1.6 : 2.2;
}

/** Shortest distance between two hues on the circle. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Pick the background.
 *
 * Weight matters as much as lightness: the canvas should be a colour the
 * image is *made of*, not the one pixel of sky in a corner. Candidates are
 * scored on how much of the image they cover and how far they are in the
 * wanted direction, then pulled towards the extreme so text has somewhere to
 * stand — a mid-grey canvas is the one case where nothing can be made
 * readable in either direction.
 */
function pickBackground(palette: Swatch[], wantDark: boolean): Rgb {
  const scored = palette.map((s) => {
    const lum = luminance(s.color);
    const direction = wantDark ? 1 - lum : lum;
    return { color: s.color, score: direction * 0.75 + s.weight * 0.25 };
  });
  scored.sort((a, b) => b.score - a.score);
  const base = scored[0]?.color ?? { r: 20, g: 20, b: 26, a: 1 };
  const { l, c, h } = rgbToOklch(base);
  // Keep the hue and most of the colour, move only how much light it gives.
  const target = wantDark ? Math.min(l, 0.28) : Math.max(l, 0.93);
  return oklchToRgb({ l: target, c: Math.min(c, wantDark ? 0.06 : 0.03), h }, 1);
}

/**
 * The text colour: the theme's own background hue, pushed to the far end.
 *
 * Not the image's lightest pixel. A photograph's brightest colour is usually
 * a saturated highlight, and a saturated foreground makes every character on
 * screen vibrate against the canvas. Tinting the *background's* hue instead
 * is what the themes that read well all do — Nord, Halcyon, Dracula.
 */
function pickForeground(background: Rgb, dark: boolean): Rgb {
  const { c, h } = rgbToOklch(background);
  const base = oklchToRgb({ l: dark ? 0.93 : 0.28, c: Math.min(c, 0.03), h }, 1);
  return readableOn(base, background, 7);
}

/** The most colourful thing in the image that can survive as text. */
function pickAccent(palette: Swatch[], background: Rgb, mood: 'vivid' | 'muted' | 'any'): Rgb {
  const ranked = [...palette]
    .map((s) => ({ ...s, chroma: chromaOf(s.color) }))
    .sort((a, b) => (mood === 'muted' ? a.chroma - b.chroma : b.chroma - a.chroma));
  // 'muted' still wants a colour, not a grey: skip the ones with no hue left.
  const pool = mood === 'muted' ? ranked.filter((s) => s.chroma > 0.04) : ranked;
  const chosen = (pool[0] ?? ranked[0])?.color ?? { r: 13, g: 148, b: 136, a: 1 };
  return readableOn(chosen, background, CONTRAST.text);
}

/**
 * The sixteen terminal colours.
 *
 * Each slot is filled from the image when the image has something near that
 * hue, and synthesised from the hue itself when it does not — a photograph of
 * a forest owes you a red, and inventing one is better than handing back two
 * greens with different names.
 *
 * Every one of them is then forced over the 3:1 line against the background.
 * That is the floor for a glyph, and it is the check that stops a theme built
 * from a dark photograph from having a `blue` nobody can see.
 */
function buildAnsi(palette: Swatch[], background: Rgb, bright: boolean): AnsiSet {
  const dark = isDarkBackground(background);
  const lightness = bright ? (dark ? 0.86 : 0.52) : dark ? 0.74 : 0.44;
  const out = {} as AnsiSet;

  for (const [name, hue] of ANSI_HUES) {
    const near = palette
      .map((s) => ({ s, oklch: rgbToOklch(s.color) }))
      .filter(({ oklch }) => oklch.c > 0.05 && hueGap(oklch.h, hue) < 40)
      .sort((a, b) => hueGap(a.oklch.h, hue) - hueGap(b.oklch.h, hue))[0];
    const chroma = near ? Math.max(near.oklch.c, 0.09) : 0.13;
    const h = near ? near.oklch.h : hue;
    const base = oklchToRgb({ l: lightness, c: chroma, h }, 1);
    out[name] = toHex(readableOn(base, background, CONTRAST.ui));
  }

  // Black and white are the ends of the theme's own scale, not hues. Each is
  // then held to its own floor: the one at the background's end only has to
  // be visible, the one at the far end owes the full glyph contrast.
  const { c, h } = rgbToOklch(background);
  const grey = (l: number) => oklchToRgb({ l, c: Math.min(c, 0.02), h }, 1);
  const black = dark ? grey(bright ? 0.55 : 0.38) : grey(bright ? 0.45 : 0.25);
  const white = dark ? grey(bright ? 1 : 0.9) : grey(bright ? 0.72 : 0.6);
  out.black = toHex(readableOn(black, background, ansiFloor('black', dark, bright)));
  out.white = toHex(readableOn(white, background, ansiFloor('white', dark, bright)));
  return out;
}

/** One variant, fully resolved and legible. */
export function synthesize(palette: Swatch[], kind: VariantKind): ThemeDraft {
  const wantDark = kind !== 'light';
  let background = pickBackground(palette, wantDark);
  if (kind === 'contrast') {
    const { c, h } = rgbToOklch(background);
    background = oklchToRgb({ l: wantDark ? 0.14 : 0.98, c: Math.min(c, 0.03), h }, 1);
  }
  const dark = isDarkBackground(background);
  const foreground = pickForeground(background, dark);
  const mood = kind === 'vivid' ? 'vivid' : kind === 'muted' ? 'muted' : 'any';
  const accent = pickAccent(palette, background, mood);
  return {
    kind,
    background: toHex(background),
    foreground: toHex(foreground),
    accent: toHex(accent),
    // Derived, never asked: this is the field that, set by hand against the
    // colours, is what makes a theme paint white text on a pale surface.
    details: dark ? 'darker' : 'lighter',
    normal: buildAnsi(palette, background, false),
    bright: buildAnsi(palette, background, true),
  };
}

/** The five candidates an import offers before anything is written to disk. */
export function variants(palette: Swatch[]): ThemeDraft[] {
  return VARIANTS.map((v) => synthesize(palette, v.kind));
}

/**
 * Build the same five from a single colour rather than an image — what
 * "create a theme" starts from when there is no wallpaper.
 *
 * The palette is the colour plus its neighbours around the hue circle, so the
 * terminal colours still have something to be drawn from and do not all come
 * back synthesised at the same chroma.
 */
export function paletteFromColor(seed: Rgb): Swatch[] {
  const { l, c, h } = rgbToOklch(seed);
  const chroma = Math.max(c, 0.1);
  const out: Swatch[] = [{ color: seed, weight: 0.4 }];
  for (const [dh, dl, w] of [
    [30, 0.12, 0.15],
    [-30, -0.12, 0.15],
    [150, 0.05, 0.1],
    [-150, -0.05, 0.1],
    [180, 0, 0.1],
  ] as const) {
    out.push({ color: oklchToRgb({ l: Math.min(0.95, Math.max(0.1, l + dl)), c: chroma, h: h + dh }, 1), weight: w });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Auditing a theme somebody else wrote
// ---------------------------------------------------------------------------

export interface ThemeWarning {
  /** Which field the editor should point at. */
  field: string;
  message: string;
  /** Below the floor for its job, as opposed to merely close to it. */
  severity: 'error' | 'warning';
}

/**
 * What the editor shows under the colours.
 *
 * This is the generator's rule turned around: rather than guaranteeing a
 * theme is legible, say precisely where an existing one is not. It is the
 * check nothing in CortX has ever run — which is how a bundled theme and a
 * shipped accent preset both ended up at 2.1:1 against their own background.
 */
export function auditTheme(theme: {
  background: string;
  foreground: string;
  accent: string;
  details?: 'darker' | 'lighter';
  normal?: Partial<AnsiSet>;
  bright?: Partial<AnsiSet>;
}): ThemeWarning[] {
  const bg = parseHex(theme.background);
  const out: ThemeWarning[] = [];
  if (!bg) return [{ field: 'background', message: 'Not a colour.', severity: 'error' }];

  const check = (field: string, hex: string | undefined, floor: number, what: string) => {
    const c = hex ? parseHex(hex) : null;
    if (!c) {
      if (hex) out.push({ field, message: 'Not a colour.', severity: 'error' });
      return;
    }
    const ratio = contrast(c, bg);
    if (ratio < floor) {
      out.push({
        field,
        message: `${ratio.toFixed(2)}:1 against the background; ${what} needs ${floor}:1.`,
        severity: ratio < floor * 0.8 ? 'error' : 'warning',
      });
    }
  };

  check('foreground', theme.foreground, CONTRAST.text, 'body text');
  // The accent is the trap: CortX paints it as text (a running command, an
  // agent's glyph, the spinner), so it is held to the text floor and not to
  // the icon one, whatever it is also used to fill.
  check('accent', theme.accent, CONTRAST.text, 'the accent (CortX paints it as text too)');
  const dark = isDarkBackground(bg);
  for (const set of ['normal', 'bright'] as const) {
    const colors = theme[set];
    if (!colors) continue;
    for (const [name, hex] of Object.entries(colors)) {
      const floor = ansiFloor(name as keyof AnsiSet, dark, set === 'bright');
      const what = floor < CONTRAST.ui ? 'a dim tone, which still has to be visible,' : 'a terminal colour';
      check(`${set}.${name}`, hex, floor, what);
    }
  }

  if (theme.details) {
    const actuallyDark = dark;
    if (actuallyDark !== (theme.details === 'darker')) {
      out.push({
        field: 'details',
        message: `The background is ${actuallyDark ? 'dark' : 'light'} but the theme says "${theme.details}". Surfaces will be lifted the wrong way.`,
        severity: 'error',
      });
    }
  }
  return out;
}
