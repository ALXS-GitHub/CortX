/**
 * Colour maths, in one pure module.
 *
 * Three groups of callers need the same arithmetic and must not each grow
 * their own copy:
 *
 * - the colour picker (`components/ui/ColorField.tsx`) converts between what
 *   a human drags (hue, saturation, value, alpha) and what a theme file
 *   stores (a hex string);
 * - the theme editor warns when a pair of colours cannot be read, which is
 *   WCAG contrast, which is relative luminance;
 * - the palette generator reads an image and has to *choose* colours, which
 *   is the one job plain RGB is bad at — distances and lightness edits belong
 *   in a perceptual space (OKLab).
 *
 * Pure on purpose: no DOM, no `getComputedStyle`, so the whole thing is
 * testable on plain Node like `terminalInputHit.ts` next to it.
 *
 * ## Why OKLab and not HSL
 *
 * HSL's "lightness" is not lightness: `hsl(60 100% 50%)` (yellow) and
 * `hsl(240 100% 50%)` (blue) claim the same 50 % and differ by a factor of
 * twenty in the light they actually emit. Every operation that means
 * "same colour, brighter" — which is what the generator does to make an
 * accent readable — has to happen somewhere the number means what it says.
 */

// ---------------------------------------------------------------------------
// Types and parsing
// ---------------------------------------------------------------------------

/** Channels are 0-255, alpha 0-1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Hue 0-360, saturation and value 0-1, alpha 0-1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
  a: number;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const clamp01 = (x: number) => clamp(x, 0, 1);
const byte = (x: number) => clamp(Math.round(x), 0, 255);

/**
 * Parse `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, with or without the hash.
 *
 * Returns null rather than a fallback colour: a field that silently turns
 * what you typed into black is worse than one that says it is not a colour
 * yet, and only the caller knows which of the two it wants.
 */
export function parseHex(input: string): Rgb | null {
  const hex = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  const expand = (c: string) => parseInt(c + c, 16);
  if (hex.length === 3 || hex.length === 4) {
    return {
      r: expand(hex[0]),
      g: expand(hex[1]),
      b: expand(hex[2]),
      a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
  }
  return null;
}

/**
 * `#rrggbb`, or `#rrggbbaa` when the colour is not fully opaque.
 *
 * The alpha is dropped when it is 1 because that is what a theme file should
 * carry: `#ffffffff` round-trips fine but reads as a mistake next to the
 * six-digit colours around it.
 */
export function toHex({ r, g, b, a }: Rgb): string {
  const h = (x: number) => byte(x).toString(16).padStart(2, '0');
  const base = `#${h(r)}${h(g)}${h(b)}`;
  return a >= 1 ? base : `${base}${h(clamp01(a) * 255)}`;
}

// ---------------------------------------------------------------------------
// RGB <-> HSV, the picker's own pair of coordinates
// ---------------------------------------------------------------------------

export function rgbToHsv({ r, g, b, a }: Rgb): Hsv {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a };
}

export function hsvToRgb({ h, s, v, a }: Hsv): Rgb {
  const H = ((h % 360) + 360) % 360;
  const S = clamp01(s);
  const V = clamp01(v);
  const c = V * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = V - c;
  const parts =
    H < 60
      ? [c, x, 0]
      : H < 120
        ? [x, c, 0]
        : H < 180
          ? [0, c, x]
          : H < 240
            ? [0, x, c]
            : H < 300
              ? [x, 0, c]
              : [c, 0, x];
  return {
    r: byte((parts[0] + m) * 255),
    g: byte((parts[1] + m) * 255),
    b: byte((parts[2] + m) * 255),
    a: clamp01(a),
  };
}

// ---------------------------------------------------------------------------
// Contrast (WCAG 2.1)
// ---------------------------------------------------------------------------

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);

/** WCAG relative luminance, 0 (black) to 1 (white). Alpha is ignored. */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r / 255) + 0.7152 * toLinear(g / 255) + 0.0722 * toLinear(b / 255);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrast(a: Rgb, b: Rgb): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Flatten a translucent colour onto an opaque one, the way the screen does. */
export function over(top: Rgb, bottom: Rgb): Rgb {
  const a = clamp01(top.a);
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

/**
 * The contrast a theme needs, by what the colour is used for.
 *
 * `text` is WCAG AA for body text and is what the second line of a tab, a
 * prompt and every label in a pane are. `ui` is AA for a glyph or a border —
 * an icon carries its meaning in its shape, so it is allowed less.
 */
export const CONTRAST: { readonly text: number; readonly ui: number } = { text: 4.5, ui: 3 };

// ---------------------------------------------------------------------------
// OKLab / OKLCh
// ---------------------------------------------------------------------------

/** Lightness 0-1, chroma from 0, hue in degrees. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const R = toLinear(r / 255);
  const G = toLinear(g / 255);
  const B = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(Bb, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, Bb), h: hue < 0 ? hue + 360 : hue };
}

/**
 * Back to sRGB, clipped to the gamut.
 *
 * Clipping per channel desaturates a colour that does not fit rather than
 * rejecting it, which is what every caller here wants: the generator asks for
 * "this hue, this bright" and would rather be given the closest thing sRGB
 * can show than nothing at all.
 */
export function oklchToRgb({ l, c, h }: Oklch, a = 1): Rgb {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: byte(fromLinear(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_) * 255),
    g: byte(fromLinear(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_) * 255),
    b: byte(fromLinear(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_) * 255),
    a: clamp01(a),
  };
}

/** Perceptual distance between two colours (OKLab), for "are these the same". */
export function distance(a: Rgb, b: Rgb): number {
  const x = rgbToOklch(a);
  const y = rgbToOklch(b);
  const ax = x.c * Math.cos((x.h * Math.PI) / 180);
  const ay = x.c * Math.sin((x.h * Math.PI) / 180);
  const bx = y.c * Math.cos((y.h * Math.PI) / 180);
  const by = y.c * Math.sin((y.h * Math.PI) / 180);
  return Math.hypot(x.l - y.l, ax - bx, ay - by);
}

/**
 * The nearest colour to `colour` that reads on `background`, found by moving
 * its **lightness** only — the hue and the chroma are the theme author's, and
 * a fix that changes them hands back a different colour.
 *
 * Returns the colour untouched when it already passes, which is the common
 * case and the reason this is safe to apply everywhere: on the themes CortX
 * ships (Dracula, Nord, Halcyon, Light Modern) it is a no-op.
 *
 * The direction is away from the background: lighter on a dark one, darker on
 * a light one. When neither direction can reach the target — a mid-grey
 * background, where both ends of the scale are close — the best ratio found
 * is returned rather than a failure, because a caller painting a glyph has to
 * paint something.
 */
export function readableOn(colour: Rgb, background: Rgb, target = CONTRAST.text): Rgb {
  if (contrast(colour, background) >= target) return colour;
  const { l, c, h } = rgbToOklch(colour);
  const up = luminance(background) < 0.18;
  let best = colour;
  let bestRatio = contrast(colour, background);
  for (let step = 1; step <= 100; step++) {
    const next = clamp01(l + ((up ? step : -step) / 100));
    const candidate = oklchToRgb({ l: next, c, h }, colour.a);
    const ratio = contrast(candidate, background);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
    if (ratio >= target) return candidate;
    if (next <= 0 || next >= 1) break;
  }
  // Neither direction reached it: the far end of the scale is the last resort.
  const other = oklchToRgb({ l: up ? 0 : 1, c, h }, colour.a);
  return contrast(other, background) > bestRatio ? other : best;
}

/**
 * Is this theme a dark one?
 *
 * The honest answer is "look at the background", and that is the whole
 * function. A theme file *declares* its side with `details: darker|lighter`,
 * and nothing has ever checked the declaration against the colours — which is
 * how a theme ends up claiming `lighter` while painting white text.
 *
 * The threshold is relative luminance 0.18, sRGB mid-grey. Note it is not
 * 0.5: luminance is linear light, and the colour a human calls "half way"
 * sits near a fifth of the light of white.
 */
export function isDarkBackground(background: Rgb): boolean {
  return luminance(background) < 0.18;
}
