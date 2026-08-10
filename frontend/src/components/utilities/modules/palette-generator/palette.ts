import {
  buildScale,
  formatHex,
  oklchToRgb,
  rgbToOklch,
  withChroma,
  withLightness,
  type Rgb,
} from '../../lib/color';

export type Scheme =
  | 'complementary'
  | 'analogous'
  | 'triadic'
  | 'tetradic'
  | 'split-complementary'
  | 'monochromatic'
  | 'shades';

export const SCHEME_LABELS: Record<Scheme, string> = {
  complementary: 'Complementary',
  analogous: 'Analogous',
  triadic: 'Triadic',
  tetradic: 'Tetradic',
  'split-complementary': 'Split complementary',
  monochromatic: 'Monochromatic',
  shades: 'Shades (light → dark)',
};

export type ExportFormat = 'css' | 'tailwind' | 'json' | 'list';

export const EXPORT_LABELS: Record<ExportFormat, string> = {
  css: 'CSS variables',
  tailwind: 'Tailwind theme',
  json: 'JSON',
  list: 'Plain list',
};

/**
 * Hue offsets that define each classic scheme. `count` colours are taken by
 * cycling through the offsets, so asking for more than the scheme defines
 * keeps extending it evenly instead of repeating.
 */
const SCHEME_OFFSETS: Record<Exclude<Scheme, 'monochromatic' | 'shades'>, number[]> = {
  complementary: [0, 180],
  analogous: [0, -30, 30, -60, 60],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
  'split-complementary': [0, 150, 210],
};

export function buildPalette(base: Rgb, scheme: Scheme, count: number): Rgb[] {
  const size = Math.max(1, count);
  const { l, c, h } = rgbToOklch(base);

  if (scheme === 'monochromatic') {
    // Vary chroma at constant lightness: same colour, different intensity.
    return Array.from({ length: size }, (_, i) => {
      const factor = size === 1 ? 1 : 0.25 + (0.95 - 0.25) * (i / (size - 1));
      return withChroma(base, c * factor);
    });
  }

  if (scheme === 'shades') {
    return Array.from({ length: size }, (_, i) => {
      const lightness = size === 1 ? l : 0.92 - (0.92 - 0.22) * (i / (size - 1));
      return withLightness(base, lightness);
    });
  }

  const offsets = SCHEME_OFFSETS[scheme];
  return Array.from({ length: size }, (_, i) => {
    const offset = offsets[i % offsets.length];
    // Past the first cycle, nudge lightness so repeats stay distinguishable.
    const cycle = Math.floor(i / offsets.length);
    const lightness = Math.min(0.92, Math.max(0.2, l + cycle * 0.12 * (cycle % 2 === 0 ? 1 : -1)));
    return { ...oklchToRgb({ l: lightness, c, h: (h + offset + 360) % 360 }), a: 1 };
  });
}

// ------------------------------------------------------- image extraction ---

interface Bucket {
  pixels: Rgb[];
  range: number;
  channel: 'r' | 'g' | 'b';
}

function describe(pixels: Rgb[]): Bucket {
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;

  for (const p of pixels) {
    if (p.r < minR) minR = p.r;
    if (p.r > maxR) maxR = p.r;
    if (p.g < minG) minG = p.g;
    if (p.g > maxG) maxG = p.g;
    if (p.b < minB) minB = p.b;
    if (p.b > maxB) maxB = p.b;
  }

  const ranges = { r: maxR - minR, g: maxG - minG, b: maxB - minB };
  const channel = (Object.keys(ranges) as ('r' | 'g' | 'b')[]).reduce((best, key) =>
    ranges[key] > ranges[best] ? key : best,
  );

  return { pixels, range: ranges[channel], channel };
}

function average(pixels: Rgb[]): Rgb {
  const total = pixels.reduce(
    (acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }),
    { r: 0, g: 0, b: 0 },
  );
  const n = pixels.length || 1;
  return { r: total.r / n, g: total.g / n, b: total.b / n, a: 1 };
}

/**
 * Median cut: repeatedly split the widest-spread bucket at its median along its
 * widest channel. Deterministic and fast, unlike k-means it never needs a seed
 * or an iteration budget — which matters when the result must be reproducible.
 */
export function extractPalette(pixels: Rgb[], count: number): Rgb[] {
  if (pixels.length === 0) return [];

  let buckets: Bucket[] = [describe(pixels)];

  while (buckets.length < count) {
    // Split the bucket that spans the most colour, not just the biggest one.
    let targetIndex = -1;
    let widest = -1;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].pixels.length > 1 && buckets[i].range > widest) {
        widest = buckets[i].range;
        targetIndex = i;
      }
    }
    if (targetIndex === -1) break;

    const target = buckets[targetIndex];
    const sorted = target.pixels.slice().sort((a, b) => a[target.channel] - b[target.channel]);
    const middle = Math.floor(sorted.length / 2);

    buckets = [
      ...buckets.slice(0, targetIndex),
      describe(sorted.slice(0, middle)),
      describe(sorted.slice(middle)),
      ...buckets.slice(targetIndex + 1),
    ];
  }

  return buckets
    .map((bucket) => ({ color: average(bucket.pixels), weight: bucket.pixels.length }))
    .sort((a, b) => b.weight - a.weight)
    .map((entry) => entry.color);
}

/** Downscale to keep extraction fast, then read every remaining pixel. */
export async function pixelsFromImage(source: Blob, maxSize = 160): Promise<Rgb[]> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable');

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const { data } = context.getImageData(0, 0, width, height);
  const pixels: Rgb[] = [];

  for (let i = 0; i < data.length; i += 4) {
    // Near-transparent pixels carry no usable colour.
    if (data[i + 3] < 125) continue;
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2], a: 1 });
  }

  return pixels;
}

// -------------------------------------------------------------- exporting ---

export function exportPalette(colors: Rgb[], format: ExportFormat, name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'palette';
  const hexes = colors.map((color) => formatHex(color));

  switch (format) {
    case 'css':
      return `:root {\n${hexes.map((hex, i) => `  --${slug}-${(i + 1) * 100}: ${hex};`).join('\n')}\n}`;
    case 'tailwind':
      return `colors: {\n  ${slug}: {\n${hexes
        .map((hex, i) => `    ${(i + 1) * 100}: '${hex}',`)
        .join('\n')}\n  },\n}`;
    case 'json':
      return JSON.stringify(
        Object.fromEntries(hexes.map((hex, i) => [`${slug}-${(i + 1) * 100}`, hex])),
        null,
        2,
      );
    case 'list':
      return hexes.join('\n');
  }
}

export function exportScale(base: Rgb, name: string, format: ExportFormat): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'palette';
  const scale = buildScale(base);

  switch (format) {
    case 'css':
      return `:root {\n${scale.map(({ step, color }) => `  --${slug}-${step}: ${formatHex(color)};`).join('\n')}\n}`;
    case 'tailwind':
      return `colors: {\n  ${slug}: {\n${scale
        .map(({ step, color }) => `    ${step}: '${formatHex(color)}',`)
        .join('\n')}\n  },\n}`;
    case 'json':
      return JSON.stringify(
        Object.fromEntries(scale.map(({ step, color }) => [step, formatHex(color)])),
        null,
        2,
      );
    case 'list':
      return scale.map(({ step, color }) => `${step}: ${formatHex(color)}`).join('\n');
  }
}
