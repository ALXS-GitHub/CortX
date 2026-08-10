/**
 * Colour maths shared by the colour utilities. Pure functions, no React, no
 * host API — the one kind of thing modules are allowed to share, alongside the
 * UI primitives.
 *
 * Everything round-trips through sRGB. Perceptual work (lightening, palette
 * scales, mixing) goes through Oklch, which keeps hue and chroma stable where
 * HSL visibly drifts.
 */

export interface Rgb {
  r: number; // 0-255
  g: number;
  b: number;
  a: number; // 0-1
}

export interface Hsl {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export interface Oklch {
  l: number; // 0-1
  c: number; // 0-~0.4
  h: number; // 0-360
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

// ---------------------------------------------------------------- parsing ---

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  transparent: '#00000000',
};

/** Accepts hex, rgb(), hsl(), oklch() and a handful of names. */
export function parseColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;

  const named = NAMED[value];
  if (named) return parseColor(named);

  const hex = value.startsWith('#') ? value.slice(1) : /^[0-9a-f]{3,8}$/.test(value) ? value : null;
  if (hex) return parseHex(hex);

  const numbers = value.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];

  if (value.startsWith('rgb') && numbers.length >= 3) {
    return {
      r: clamp(numbers[0], 0, 255),
      g: clamp(numbers[1], 0, 255),
      b: clamp(numbers[2], 0, 255),
      a: numbers.length > 3 ? clamp(numbers[3] > 1 ? numbers[3] / 100 : numbers[3], 0, 1) : 1,
    };
  }

  if (value.startsWith('hsl') && numbers.length >= 3) {
    const rgb = hslToRgb({ h: numbers[0], s: clamp(numbers[1], 0, 100), l: clamp(numbers[2], 0, 100) });
    return { ...rgb, a: numbers.length > 3 ? clamp(numbers[3] > 1 ? numbers[3] / 100 : numbers[3], 0, 1) : 1 };
  }

  if (value.startsWith('oklch') && numbers.length >= 3) {
    // `oklch(62% 0.2 240)` and `oklch(0.62 0.2 240)` are both common.
    const l = numbers[0] > 1 ? numbers[0] / 100 : numbers[0];
    const rgb = oklchToRgb({ l: clamp(l, 0, 1), c: Math.max(0, numbers[1]), h: numbers[2] });
    return { ...rgb, a: numbers.length > 3 ? clamp(numbers[3] > 1 ? numbers[3] / 100 : numbers[3], 0, 1) : 1 };
  }

  return null;
}

function parseHex(hex: string): Rgb | null {
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
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

// ------------------------------------------------------------- conversions ---

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l: l * 100 };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;

  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: Hsl): Omit<Rgb, 'a'> {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = ln - c / 2;

  const [r, g, b] =
    hp < 1 ? [c, x, 0] :
    hp < 2 ? [x, c, 0] :
    hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] :
    hp < 5 ? [x, 0, c] :
             [c, 0, x];

  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h = (h * 60 + 360) % 360;
  }

  return { h, s: (max === 0 ? 0 : delta / max) * 100, v: max * 100 };
}

const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const fromLinear = (channel: number) => {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return clamp(c * 255, 0, 255);
};

export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return {
    l: okL,
    c: Math.hypot(okA, okB),
    h: (Math.atan2(okB, okA) * (180 / Math.PI) + 360) % 360,
  };
}

export function oklchToRgb({ l, c, h }: Oklch): Omit<Rgb, 'a'> {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);

  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: fromLinear(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    g: fromLinear(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    b: fromLinear(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  };
}

// -------------------------------------------------------------- formatting ---

const hex2 = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');

export function formatHex(rgb: Rgb, withAlpha = false): string {
  const base = `#${hex2(rgb.r)}${hex2(rgb.g)}${hex2(rgb.b)}`;
  return withAlpha && rgb.a < 1 ? `${base}${hex2(rgb.a * 255)}` : base;
}

export function formatRgb(rgb: Rgb): string {
  const base = `${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}`;
  return rgb.a < 1 ? `rgba(${base}, ${round(rgb.a, 2)})` : `rgb(${base})`;
}

export function formatHsl(rgb: Rgb): string {
  const { h, s, l } = rgbToHsl(rgb);
  const base = `${round(h)}, ${round(s)}%, ${round(l)}%`;
  return rgb.a < 1 ? `hsla(${base}, ${round(rgb.a, 2)})` : `hsl(${base})`;
}

export function formatHsv(rgb: Rgb): string {
  const { h, s, v } = rgbToHsv(rgb);
  return `hsv(${round(h)}, ${round(s)}%, ${round(v)}%)`;
}

export function formatOklch(rgb: Rgb): string {
  const { l, c, h } = rgbToOklch(rgb);
  const base = `${round(l * 100, 1)}% ${round(c, 3)} ${round(h, 1)}`;
  return rgb.a < 1 ? `oklch(${base} / ${round(rgb.a, 2)})` : `oklch(${base})`;
}

export function formatCss(rgb: Rgb): string {
  return rgb.a < 1 ? formatRgb(rgb) : formatHex(rgb);
}

// ------------------------------------------------------------- readability ---

/** WCAG 2.1 relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function wcagRating(ratio: number): string {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA large';
  return 'Fail';
}

/** Black or white, whichever reads better on the given colour. */
export function readableTextOn(rgb: Rgb): Rgb {
  const black: Rgb = { r: 0, g: 0, b: 0, a: 1 };
  const white: Rgb = { r: 255, g: 255, b: 255, a: 1 };
  return contrastRatio(rgb, black) >= contrastRatio(rgb, white) ? black : white;
}

// --------------------------------------------------------------- transforms ---

export function withLightness(rgb: Rgb, lightness: number): Rgb {
  const { c, h } = rgbToOklch(rgb);
  return { ...oklchToRgb({ l: clamp(lightness, 0, 1), c, h }), a: rgb.a };
}

export function rotateHue(rgb: Rgb, degrees: number): Rgb {
  const { l, c, h } = rgbToOklch(rgb);
  return { ...oklchToRgb({ l, c, h: (h + degrees + 360) % 360 }), a: rgb.a };
}

export function withChroma(rgb: Rgb, chroma: number): Rgb {
  const { l, h } = rgbToOklch(rgb);
  return { ...oklchToRgb({ l, c: Math.max(0, chroma), h }), a: rgb.a };
}

export function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = clamp(amount, 0, 1);
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

/**
 * Tailwind-style 50→950 ramp built in Oklch so every step keeps the source hue
 * instead of sliding towards grey the way an HSL ramp does.
 */
export const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

export function buildScale(rgb: Rgb): { step: number; color: Rgb }[] {
  const { c, h } = rgbToOklch(rgb);
  // Lightness targets roughly matching Tailwind's ramp.
  const lightnessByStep: Record<number, number> = {
    50: 0.97, 100: 0.94, 200: 0.88, 300: 0.8, 400: 0.71, 500: 0.62,
    600: 0.55, 700: 0.47, 800: 0.4, 900: 0.34, 950: 0.24,
  };

  return SCALE_STEPS.map((step) => {
    const l = lightnessByStep[step];
    // Chroma tapers at both ends, otherwise the lightest and darkest steps
    // clip out of sRGB and come back muddy.
    const taper = 1 - Math.abs(l - 0.62) / 0.62;
    return {
      step,
      color: { ...oklchToRgb({ l, c: c * (0.35 + 0.65 * Math.max(0, taper)), h }), a: 1 },
    };
  });
}
