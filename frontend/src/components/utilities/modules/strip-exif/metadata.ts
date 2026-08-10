/**
 * Metadata removal that does not touch the pixels.
 *
 * Re-encoding through a canvas would also drop metadata, but it recompresses:
 * a "strip EXIF" that silently degrades the image is the wrong tool. So each
 * format is edited at the container level, leaving the compressed image data
 * byte-for-byte identical.
 */

export interface StripOptions {
  /** Keep the embedded ICC colour profile (drop it and colours can shift). */
  keepColorProfile: boolean;
  /** Keep resolution / density hints (JFIF density, PNG pHYs). */
  keepDensity: boolean;
}

export interface StripResult {
  data: Uint8Array;
  removed: string[];
}

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'unknown';

export function detectKind(bytes: Uint8Array): ImageKind {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'webp';
  }
  return 'unknown';
}

const APP_NAMES: Record<number, string> = {
  0xe0: 'JFIF',
  0xe1: 'EXIF / XMP',
  0xe2: 'ICC profile',
  0xed: 'Photoshop / IPTC',
};

/**
 * Walks the JPEG segment list and copies everything except the metadata
 * markers. Entropy-coded scan data is copied verbatim from the first SOS to
 * the end of the file.
 */
function stripJpeg(bytes: Uint8Array, options: StripOptions): StripResult {
  const kept: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  const removed = new Set<string>();

  let offset = 2;

  while (offset < bytes.length - 1) {
    if (bytes[offset] !== 0xff) break;

    const marker = bytes[offset + 1];

    // Start of scan: everything after this is compressed pixel data.
    if (marker === 0xda) {
      kept.push(bytes.subarray(offset));
      offset = bytes.length;
      break;
    }
    // Standalone markers carry no length field.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      kept.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) break;

    const isExifOrXmp = marker === 0xe1;
    const isIptc = marker === 0xed;
    const isComment = marker === 0xfe;
    const isIcc = marker === 0xe2;
    const isJfif = marker === 0xe0;
    // Any other APPn segment is application-specific metadata.
    const isOtherApp = marker >= 0xe3 && marker <= 0xef;

    const drop =
      isExifOrXmp ||
      isIptc ||
      isComment ||
      isOtherApp ||
      (isIcc && !options.keepColorProfile) ||
      (isJfif && !options.keepDensity);

    if (drop) {
      removed.add(
        isComment ? 'Comment' : APP_NAMES[marker] ?? `APP${(marker & 0x0f).toString()}`,
      );
    } else {
      kept.push(bytes.subarray(offset, end));
    }

    offset = end;
  }

  if (offset < bytes.length) kept.push(bytes.subarray(offset));

  return { data: concat(kept), removed: [...removed] };
}

const PNG_ALWAYS_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS']);
const PNG_COLOR_CHUNKS = new Set(['iCCP', 'gAMA', 'cHRM', 'sRGB', 'sBIT']);
const PNG_DENSITY_CHUNKS = new Set(['pHYs']);

function stripPng(bytes: Uint8Array, options: StripOptions): StripResult {
  const kept: Uint8Array[] = [bytes.subarray(0, 8)]; // signature
  const removed = new Set<string>();

  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const length = view.getUint32(0);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length; // length + type + data + crc
    if (end > bytes.length) break;

    const keep =
      PNG_ALWAYS_KEEP.has(type) ||
      (options.keepColorProfile && PNG_COLOR_CHUNKS.has(type)) ||
      (options.keepDensity && PNG_DENSITY_CHUNKS.has(type));

    if (keep) kept.push(bytes.subarray(offset, end));
    else removed.add(type);

    offset = end;
    if (type === 'IEND') break;
  }

  return { data: concat(kept), removed: [...removed] };
}

/**
 * WebP is a RIFF container: drop the EXIF/XMP chunks, then clear the matching
 * flag bits in VP8X so decoders don't go looking for what was removed.
 */
function stripWebp(bytes: Uint8Array, options: StripOptions): StripResult {
  const kept: Uint8Array[] = [];
  const removed = new Set<string>();

  let offset = 12; // RIFF header + "WEBP"
  let vp8xIndex = -1;

  while (offset + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const type = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(4, true);
    // Chunks are padded to an even length.
    const end = offset + 8 + size + (size % 2);
    if (end > bytes.length) break;

    const drop = type === 'EXIF' || type === 'XMP ' || (type === 'ICCP' && !options.keepColorProfile);

    if (drop) {
      removed.add(type.trim());
    } else {
      if (type === 'VP8X') vp8xIndex = kept.length;
      kept.push(bytes.subarray(offset, end));
    }

    offset = end;
  }

  if (vp8xIndex >= 0) {
    // VP8X flag byte: bit 5 ICC, bit 3 EXIF, bit 2 XMP.
    const chunk = new Uint8Array(kept[vp8xIndex]);
    if (removed.has('ICCP')) chunk[8] &= ~0b00100000;
    if (removed.has('EXIF')) chunk[8] &= ~0b00001000;
    if (removed.has('XMP')) chunk[8] &= ~0b00000100;
    kept[vp8xIndex] = chunk;
  }

  const body = concat(kept);
  const output = new Uint8Array(12 + body.byteLength);
  output.set(bytes.subarray(0, 12));
  output.set(body, 12);
  // RIFF size counts everything after the size field itself.
  new DataView(output.buffer).setUint32(4, output.byteLength - 8, true);

  return { data: output, removed: [...removed] };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function stripMetadata(bytes: Uint8Array, options: StripOptions): StripResult {
  switch (detectKind(bytes)) {
    case 'jpeg':
      return stripJpeg(bytes, options);
    case 'png':
      return stripPng(bytes, options);
    case 'webp':
      return stripWebp(bytes, options);
    default:
      throw new Error('Only JPEG, PNG and WebP can be stripped without re-encoding');
  }
}
