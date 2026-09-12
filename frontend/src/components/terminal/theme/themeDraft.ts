/**
 * The shape the theme studio edits, and the two conversions around it.
 *
 * A `TerminalTheme` is what the yaml holds and the backend validates; a
 * `Draft` is what a form can hold while it is being filled in — every colour
 * a plain string (including an empty one, which a half-typed hex is), the
 * wallpaper carrying both the path that will be saved and a URL that can be
 * shown before anything is written, and `details` remembering whether the
 * user took it over from the derivation.
 *
 * Keeping the two apart is what lets the form stay editable: a draft is never
 * rejected, it is only ever *audited* (`auditTheme`), and the conversion back
 * happens once, on Save.
 */
import { readFile } from '@tauri-apps/plugin-fs';
import { isDarkBackground, parseHex } from '@/lib/color';
import type { AnsiSet, ThemeDraft as Generated } from '@/lib/terminalThemeGen';
import type { TerminalTheme, TerminalThemeImageFit } from '@/types';

export interface DraftImage {
  /**
   * What gets written to the theme. An absolute path is a picture the user
   * just chose and the backend will copy into the themes folder; a bare file
   * name is one already there.
   */
  path: string;
  /** Something an `<img>` can show right now (a data or blob URL). */
  url: string;
  opacity: number;
  blur: number;
  fit: TerminalThemeImageFit;
}

export interface Draft {
  /** The file stem being edited; null while creating. */
  key: string | null;
  name: string;
  background: string;
  foreground: string;
  accent: string;
  details: 'darker' | 'lighter';
  /**
   * `details` follows the background unless the user says otherwise.
   *
   * It is the field that decides whether surfaces are lifted towards white by
   * 6 % or by 45 %, and a theme that declares the wrong one paints pale cards
   * under light text. Deriving it by default is the whole fix; the override
   * stays because a theme with a mid-tone canvas is a real, if rare, judgment
   * call — and the audit shouts when the two disagree.
   */
  detailsAuto: boolean;
  /** CortX extensions; empty string means "not set". */
  cursor: string;
  selection: string;
  image: DraftImage | null;
  normal: AnsiSet;
  bright: AnsiSet;
}

const DEFAULT_NORMAL: AnsiSet = {
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#bac2de',
};

const DEFAULT_BRIGHT: AnsiSet = {
  black: '#585b70',
  red: '#f5a3bc',
  green: '#bdf2b9',
  yellow: '#fbecc6',
  blue: '#a6c8fb',
  magenta: '#f8d4ee',
  cyan: '#aeeae0',
  white: '#d6dcec',
};

export function blankDraft(): Draft {
  return {
    key: null,
    name: '',
    background: '#101418',
    foreground: '#e6e9ef',
    accent: '#89b4fa',
    details: 'darker',
    detailsAuto: true,
    cursor: '',
    selection: '',
    image: null,
    normal: { ...DEFAULT_NORMAL },
    bright: { ...DEFAULT_BRIGHT },
  };
}

/**
 * Load an existing theme into the form.
 *
 * `copy` is what "duplicate and edit" needs: the key is dropped so Save makes
 * a new file rather than overwriting a bundled theme, and the wallpaper keeps
 * its bare name — the backend resolves it against the themes folder, so the
 * copy points at the same picture without a second one being written.
 */
export function draftFromTheme(theme: TerminalTheme, imageUrl: string | null, copy = false): Draft {
  const img = theme.background_image;
  return {
    key: copy ? null : theme.key,
    name: copy ? `${theme.name} copy` : theme.name,
    background: theme.background,
    foreground: theme.foreground,
    accent: theme.accent,
    details: theme.details,
    // An existing file states its own side; do not silently rewrite it on
    // open. The audit points it out instead if it is wrong.
    detailsAuto: false,
    cursor: theme.cortx?.cursor ?? '',
    selection: theme.cortx?.selection ?? '',
    image:
      img && imageUrl
        ? {
            path: img.path,
            url: imageUrl,
            opacity: img.opacity ?? 30,
            blur: theme.cortx?.blur ?? 0,
            fit: theme.cortx?.imageFit ?? 'cover',
          }
        : null,
    normal: { ...DEFAULT_NORMAL, ...theme.terminal_colors?.normal },
    bright: { ...DEFAULT_BRIGHT, ...theme.terminal_colors?.bright },
  };
}

/** Fold a generated variant into the draft, keeping the name and wallpaper. */
export function applyGenerated(draft: Draft, gen: Generated): Draft {
  return {
    ...draft,
    background: gen.background,
    foreground: gen.foreground,
    accent: gen.accent,
    details: gen.details,
    detailsAuto: true,
    normal: { ...gen.normal },
    bright: { ...gen.bright },
  };
}

/** `details` as it will be saved: derived from the canvas unless overridden. */
export function resolvedDetails(draft: Draft): 'darker' | 'lighter' {
  if (!draft.detailsAuto) return draft.details;
  const bg = parseHex(draft.background);
  if (!bg) return draft.details;
  return isDarkBackground(bg) ? 'darker' : 'lighter';
}

/**
 * Back to what the backend takes.
 *
 * An empty `cortx` block is sent as `null` rather than as an object of
 * undefineds: the Rust side skips empty extensions when it serialises, and a
 * theme that never asked for a cursor override should not grow a `cortx:` key
 * in its file the first time it is opened in the studio.
 */
export function draftToTheme(draft: Draft): TerminalTheme {
  const cortx = {
    cursor: draft.cursor.trim() || undefined,
    selection: draft.selection.trim() || undefined,
    blur: draft.image && draft.image.blur > 0 ? draft.image.blur : undefined,
    imageFit: draft.image ? draft.image.fit : undefined,
  };
  const hasCortx = Object.values(cortx).some((v) => v !== undefined);
  return {
    key: draft.key ?? '',
    name: draft.name.trim(),
    background: draft.background,
    accent: draft.accent,
    foreground: draft.foreground,
    details: resolvedDetails(draft),
    background_image: draft.image ? { path: draft.image.path, opacity: draft.image.opacity } : null,
    terminal_colors: { normal: { ...draft.normal }, bright: { ...draft.bright } },
    cortx: hasCortx ? cortx : null,
  };
}

// ---------------------------------------------------------------------------
// Reading a picture
// ---------------------------------------------------------------------------

/** A chosen wallpaper: what to show now, what to save, and its pixels. */
export interface LoadedImage {
  path: string;
  url: string;
  pixels: Uint8ClampedArray;
}

/**
 * Decode an image file into pixels the palette generator can read.
 *
 * Two things happen at once because both need the bytes: a blob URL so the
 * preview can show the picture before it has been copied anywhere, and a
 * downscaled `getImageData` for the palette.
 *
 * The decode is scaled to at most 160 px on the long side. That is not about
 * speed — `quantize` already skips pixels — it is about *what the palette
 * means*: at full size a photograph's palette is dominated by noise and JPEG
 * ringing, while a thumbnail is the colours a person would say the picture
 * is made of.
 */
export async function loadImage(path: string): Promise<LoadedImage> {
  const bytes = await readFile(path);
  // `readFile` hands back a view that may be a slice of a larger buffer;
  // `BlobPart` wants the bytes themselves.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer]);
  const url = URL.createObjectURL(blob);
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    throw new Error('This build cannot decode images.');
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h).data;
  bitmap.close();
  return { path, url, pixels };
}

/** CSS for the wallpaper layer of a preview, matching how the window paints it. */
export function wallpaperStyle(image: DraftImage | null): Record<string, string> {
  if (!image) return {};
  const size = image.fit === 'tile' ? 'auto' : image.fit === 'center' ? 'auto' : image.fit;
  return {
    backgroundImage: `url("${image.url}")`,
    backgroundSize: size,
    backgroundPosition: 'center',
    backgroundRepeat: image.fit === 'tile' ? 'repeat' : 'no-repeat',
    opacity: String(Math.max(0, Math.min(100, image.opacity)) / 100),
    filter: image.blur > 0 ? `blur(${image.blur}px)` : 'none',
  };
}
