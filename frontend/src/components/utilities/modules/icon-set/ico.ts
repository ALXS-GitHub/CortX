/**
 * Minimal ICO container writer.
 *
 * Every entry stores a full PNG rather than a BMP bitmap — allowed since
 * Windows Vista, supported by every current browser, and it avoids hand-rolling
 * the BMP + AND-mask encoding that the legacy format requires.
 */
export function buildIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const entries = images
    .filter((image) => image.size > 0 && image.size <= 256)
    .sort((a, b) => a.size - b.size);

  if (entries.length === 0) throw new Error('An .ico needs at least one image of 256px or less');

  const HEADER = 6;
  const DIRECTORY_ENTRY = 16;
  const dataOffset = HEADER + DIRECTORY_ENTRY * entries.length;

  const total = dataOffset + entries.reduce((sum, entry) => sum + entry.png.byteLength, 0);
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // 1 = icon
  view.setUint16(4, entries.length, true);

  let offset = dataOffset;

  entries.forEach((entry, index) => {
    const base = HEADER + DIRECTORY_ENTRY * index;
    // 256 is stored as 0 — the field is a single byte.
    view.setUint8(base + 0, entry.size === 256 ? 0 : entry.size);
    view.setUint8(base + 1, entry.size === 256 ? 0 : entry.size);
    view.setUint8(base + 2, 0); // palette size
    view.setUint8(base + 3, 0); // reserved
    view.setUint16(base + 4, 1, true); // colour planes
    view.setUint16(base + 6, 32, true); // bits per pixel
    view.setUint32(base + 8, entry.png.byteLength, true);
    view.setUint32(base + 12, offset, true);

    bytes.set(entry.png, offset);
    offset += entry.png.byteLength;
  });

  return bytes;
}
