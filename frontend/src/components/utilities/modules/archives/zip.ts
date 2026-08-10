/**
 * ZIP reader and writer built on the platform's own deflate.
 *
 * `CompressionStream('deflate-raw')` is exactly the codec a ZIP entry wants, so
 * archiving needs no external binary and no dependency — same reasoning as the
 * image tools: a utility that requires an install first is one you don't reach
 * for.
 *
 * Scope: the classic 32-bit format, store or deflate. Zip64 (archives or
 * members above 4 GB) and encrypted entries are rejected explicitly rather than
 * silently mishandled.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
/** Bit 11: the name is UTF-8 rather than CP437. */
const FLAG_UTF8 = 0x800;
/** Bit 0: the entry is encrypted. */
const FLAG_ENCRYPTED = 0x1;

const MAX_UINT32 = 0xffffffff;

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;

  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }

  crcTable = table;
  return table;
}

export function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice().buffer]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice().buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** DOS timestamp: 2-second resolution, epoch 1980. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export interface ZipEntry {
  /** Path inside the archive, always with forward slashes. */
  name: string;
  data: Uint8Array;
}

export interface ZipOptions {
  /** false stores entries uncompressed — faster, useful for already-compressed data. */
  compress: boolean;
}

export async function createZip(
  entries: ZipEntry[],
  options: ZipOptions,
  now: Date,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(now);

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const [index, entry] of entries.entries()) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);

    let payload = entry.data;
    let method = 0;

    if (options.compress && entry.data.length > 0) {
      const deflated = await deflateRaw(entry.data);
      // Deflate can inflate incompressible data; store it instead.
      if (deflated.length < entry.data.length) {
        payload = deflated;
        method = 8;
      }
    }

    if (entry.data.length > MAX_UINT32 || payload.length > MAX_UINT32) {
      throw new Error(`"${entry.name}" is larger than 4 GB, which needs Zip64`);
    }

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_HEADER, true);
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, FLAG_UTF8, true);
    localView.setUint16(8, method, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, payload.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true); // extra field length
    local.set(nameBytes, 30);

    locals.push(local, payload);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, CENTRAL_HEADER, true);
    centralView.setUint16(4, 20, true); // version made by
    centralView.setUint16(6, 20, true); // version needed
    centralView.setUint16(8, FLAG_UTF8, true);
    centralView.setUint16(10, method, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, payload.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);

    centrals.push(central);
    offset += local.length + payload.length;

    onProgress?.(index + 1, entries.length);
  }

  const centralSize = centrals.reduce((sum, chunk) => sum + chunk.length, 0);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return concat([...locals, ...centrals, end]);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export interface ReadZipEntry {
  name: string;
  size: number;
  compressedSize: number;
  read(): Promise<Uint8Array>;
}

export async function readZip(bytes: Uint8Array): Promise<ReadZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end record sits at the tail, after an optional comment of up to 64 kB.
  let endOffset = -1;
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL) {
      endOffset = i;
      break;
    }
  }
  if (endOffset === -1) throw new Error('Not a ZIP archive (no end-of-central-directory record)');

  const count = view.getUint16(endOffset + 10, true);
  let cursor = view.getUint32(endOffset + 16, true);

  if (cursor === MAX_UINT32) throw new Error('Zip64 archives are not supported');

  const decoder = new TextDecoder();
  const entries: ReadZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== CENTRAL_HEADER) break;

    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    if (flags & FLAG_ENCRYPTED) {
      throw new Error(`"${name}" is encrypted — password-protected archives are not supported`);
    }

    entries.push({
      name,
      size,
      compressedSize,
      async read() {
        // The local header repeats the name and extra fields, and its extra
        // field length can differ from the central one — read it, don't assume.
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        const payload = bytes.subarray(start, start + compressedSize);

        if (method === 0) return payload.slice();
        if (method === 8) return inflateRaw(payload);
        throw new Error(`"${name}" uses compression method ${method}, which is not supported`);
      },
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Rejects paths that would escape the extraction folder (zip slip). */
export function isSafeEntryName(name: string): boolean {
  if (!name || name.startsWith('/') || name.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(name)) return false;
  return !name.split(/[/\\]/).includes('..');
}
