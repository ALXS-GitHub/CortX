/**
 * Canvas-based image processing shared by the image utilities.
 *
 * Deliberately not a wrapper around ImageMagick: doing it in the webview means
 * these tools work on a fresh machine with nothing installed, which is the
 * whole point of replacing online converters. External CLIs stay for the jobs
 * a canvas genuinely cannot do (PDF, video, archives).
 */

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export const IMAGE_MIME: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export const IMAGE_FORMAT_LABELS: Record<ImageFormat, string> = {
  png: 'PNG (lossless, keeps transparency)',
  jpeg: 'JPEG (smallest, no transparency)',
  webp: 'WebP (small, keeps transparency)',
};

/** Extensions the pickers accept — decoding is wider than encoding. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'ico'];

export const IMAGE_FILTERS = [{ name: 'Images', extensions: IMAGE_EXTENSIONS }];

export type FitMode = 'contain' | 'cover' | 'stretch';

export const FIT_LABELS: Record<FitMode, string> = {
  contain: 'Contain (fit inside, may letterbox)',
  cover: 'Cover (fill, crops the overflow)',
  stretch: 'Stretch (ignores the aspect ratio)',
};

export function bytesToBlob(bytes: Uint8Array, type?: string): Blob {
  // Copy into a standalone buffer: the source view may be a window onto a
  // larger (or shared) buffer, which Blob would otherwise take whole.
  return new Blob([bytes.slice().buffer], type ? { type } : undefined);
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function loadBitmap(bytes: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(bytesToBlob(bytes));
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Target size from the requested dimensions. A missing side is derived from
 * the other so "width 800, keep ratio" needs no second input.
 */
export function resolveSize(
  source: Size,
  requested: { width?: number; height?: number; percent?: number },
  keepRatio: boolean,
): Size {
  if (requested.percent && requested.percent > 0) {
    const scale = requested.percent / 100;
    return {
      width: Math.max(1, Math.round(source.width * scale)),
      height: Math.max(1, Math.round(source.height * scale)),
    };
  }

  const { width, height } = requested;
  const ratio = source.width / source.height;

  if (width && height) {
    return keepRatio
      ? // Fit the box without distorting: the tighter constraint wins.
        width / height > ratio
        ? { width: Math.round(height * ratio), height }
        : { width, height: Math.round(width / ratio) }
      : { width, height };
  }
  if (width) return { width, height: Math.max(1, Math.round(width / ratio)) };
  if (height) return { width: Math.max(1, Math.round(height * ratio)), height };

  return { width: source.width, height: source.height };
}

export interface RenderOptions {
  width: number;
  height: number;
  fit?: FitMode;
  /** CSS colour painted behind the image; matters when flattening to JPEG. */
  background?: string;
  format: ImageFormat;
  /** 0-1, ignored for PNG. */
  quality?: number;
  /** Fraction of the smaller side left empty around the image, 0-0.45. */
  padding?: number;
  smoothing?: boolean;
}

export async function renderBitmap(bitmap: ImageBitmap, options: RenderOptions): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(options.width));
  canvas.height = Math.max(1, Math.round(options.height));

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');

  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.imageSmoothingEnabled = options.smoothing ?? true;
  context.imageSmoothingQuality = 'high';

  const pad = Math.min(0.45, Math.max(0, options.padding ?? 0));
  const boxX = canvas.width * pad;
  const boxY = canvas.height * pad;
  const boxWidth = canvas.width - boxX * 2;
  const boxHeight = canvas.height - boxY * 2;

  const fit = options.fit ?? 'stretch';

  if (fit === 'stretch') {
    context.drawImage(bitmap, boxX, boxY, boxWidth, boxHeight);
  } else {
    const scale =
      fit === 'contain'
        ? Math.min(boxWidth / bitmap.width, boxHeight / bitmap.height)
        : Math.max(boxWidth / bitmap.width, boxHeight / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    context.drawImage(
      bitmap,
      boxX + (boxWidth - drawWidth) / 2,
      boxY + (boxHeight - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
  }

  return canvasToBlob(canvas, options.format, options.quality);
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: ImageFormat,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`This webview cannot encode ${format.toUpperCase()}`));
      },
      IMAGE_MIME[format],
      format === 'png' ? undefined : quality,
    );
  });
}

/**
 * Encode repeatedly, walking quality down until the result fits the budget.
 * Binary search rather than a linear sweep: ~7 encodes instead of ~20.
 */
export async function encodeToTargetSize(
  bitmap: ImageBitmap,
  options: Omit<RenderOptions, 'quality'>,
  maxBytes: number,
): Promise<{ blob: Blob; quality: number }> {
  let low = 0.05;
  let high = 0.98;
  let best: { blob: Blob; quality: number } | null = null;

  for (let i = 0; i < 7; i++) {
    const quality = (low + high) / 2;
    const blob = await renderBitmap(bitmap, { ...options, quality });

    if (blob.size <= maxBytes) {
      best = { blob, quality };
      low = quality; // Room to spare — try better quality.
    } else {
      high = quality;
    }
  }

  // Nothing fit: hand back the smallest attempt rather than failing outright.
  return best ?? { blob: await renderBitmap(bitmap, { ...options, quality: 0.05 }), quality: 0.05 };
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} kB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}
