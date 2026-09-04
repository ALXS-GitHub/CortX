/**
 * Inline-image repair and translation for the PTY byte stream.
 *
 * Two problems this fixes, both found by capturing real PTY output (see
 * `scripts/terminal-images.ps1`):
 *
 * 1. **iTerm2 inline images (OSC 1337) with no `size=`.** `@xterm/addon-image`
 *    refuses any `File=` header without an exact `size` field
 *    (`IIPHandler.put`: `if (!inline || !size || size > iipSizeLimit) abort`),
 *    and the size has to match the payload to the byte — its base64 decoder
 *    is pre-sized and fails at `end()` otherwise. iTerm2's own protocol makes
 *    `size` optional, and **fastfetch omits it**: it emits
 *    `ESC ] 1337 ; File=inline=1 : <base64> BEL`. That is why Sixel showed up
 *    in CortX and iTerm2 images never did. We buffer such a sequence (only
 *    those without `size`; a well-formed one streams straight through) and
 *    re-emit it with the exact size computed from the base64 length.
 *
 * 2. **Kitty graphics (APC `ESC _ G ... ESC \`).** xterm.js has no APC handler
 *    at all — the parser swallows the whole string — and the image addon does
 *    not implement the protocol. ConPTY *does* pass APC through unchanged
 *    (verified), so the sequences reach us intact. Rather than build a second
 *    image layer next to the addon's (which owns scroll, reflow and the
 *    alternate buffer), we translate the kitty transmission into the iTerm2
 *    sequence the addon already renders. Supported: direct transmission
 *    (`t=d`), PNG (`f=100`) and raw RGB / RGBA (`f=24` / `f=32`), zlib
 *    (`o=z`), chunking (`m=1`), cell sizing (`c=` / `r=`), display at the
 *    cursor (`a=T`) and the support query (`a=q`). Not supported: placements
 *    by id (`a=p`), deletion, animation, unicode placeholders, and file /
 *    shared-memory transmission — those are swallowed, exactly as xterm.js
 *    would have done anyway.
 *
 * The filter is a byte-level state machine, so a sequence split across PTY
 * chunks (an image always is) is handled. Everything it cannot make sense of
 * is passed through untouched.
 */

const ESC = 0x1b;
const BEL = 0x07;

/** `ESC ] 1 3 3 7 ;` */
const OSC_1337 = [0x1b, 0x5d, 0x31, 0x33, 0x33, 0x37, 0x3b];
/** `ESC _ G` */
const APC_G = [0x1b, 0x5f, 0x47];

/** Header bytes before the `:` that starts the payload. */
const MAX_HEADER = 4096;
/** Payload we are willing to hold to repair one sequence (the addon's own
 *  iipSizeLimit is 20 MB of *decoded* data). Past this we stop buffering and
 *  let the bytes through as they are. */
const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * One piece of output. `bytes` is ready to write; `promise` resolves to the
 * bytes later (a kitty frame that had to be decompressed or re-encoded) and
 * must be written in order — see `drainImageParts` in `terminalSessions`.
 */
export interface ImagePart {
  bytes?: Uint8Array;
  promise?: Promise<Uint8Array | null>;
}

type State = 'pass' | 'header' | 'stream' | 'buffer' | 'kitty';

function latin1(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function toBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** Decoded byte length of a base64 payload, without decoding it. */
export function base64ByteLength(b64: string): number {
  let chars = 0;
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i);
    // Skip padding and any stray whitespace.
    if (c === 0x3d || c === 0x0a || c === 0x0d || c === 0x20 || c === 0x09) continue;
    chars++;
  }
  return Math.floor((chars * 3) / 4);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/[^A-Za-z0-9+/=]/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

/**
 * The iTerm2 sequence the image addon understands, with the exact size it
 * insists on. `cols` / `rows` are kitty's cell counts when it asked for a
 * specific box.
 */
export function iipSequence(b64: string, byteLength: number, cols?: string, rows?: string): Uint8Array {
  let header = `File=inline=1;size=${byteLength}`;
  if (cols) header += `;width=${cols}`;
  if (rows) header += `;height=${rows}`;
  // The addon ignores `height` unless aspect ratio is off, so only a request
  // for both dimensions turns it off.
  header += `;preserveAspectRatio=${cols && rows ? 0 : 1}`;
  return toBytes(`\x1b]1337;${header}:${b64}\x07`);
}

/** Re-encode raw RGB / RGBA pixels as a PNG, through a canvas. */
function rawToPng(pixels: Uint8Array, width: number, height: number, channels: 3 | 4): string | null {
  if (!width || !height || width * height * channels > pixels.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const data = new Uint8ClampedArray(width * height * 4);
  if (channels === 4) {
    data.set(pixels.subarray(0, data.length));
  } else {
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      data[i * 4] = pixels[j];
      data[i * 4 + 1] = pixels[j + 1];
      data[i * 4 + 2] = pixels[j + 2];
      data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(new ImageData(data, width, height), 0, 0);
  const url = canvas.toDataURL('image/png');
  const comma = url.indexOf(',');
  return comma < 0 ? null : url.slice(comma + 1);
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  const Stream = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!Stream) return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new Stream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

type Kv = Record<string, string>;

function parseControl(text: string): Kv {
  const kv: Kv = {};
  for (const pair of text.split(',')) {
    const eq = pair.indexOf('=');
    if (eq > 0) kv[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return kv;
}

export interface ImageFilterOptions {
  /** Write a reply back to the PTY (the kitty `a=q` support query). */
  respond?: (data: string) => void;
  /** Translate kitty graphics. Off = the APC sequences are left in the
   *  stream, where xterm.js discards them silently, as before. */
  kitty?: () => boolean;
}

/**
 * Per-terminal, stateful. Feed it every chunk of PTY output in order and
 * write the parts it returns, in order.
 */
export class TerminalImageFilter {
  private state: State = 'pass';
  /** Bytes held back because a marker may be starting at the end of a chunk. */
  private carry: Uint8Array = new Uint8Array(0);
  /** Header / payload / kitty bytes collected so far. */
  private buf: number[] = [];
  /** Header of the OSC 1337 currently being repaired (no `size` field). */
  private header = '';
  /** Saw `ESC` inside a string: `ESC \` may be the terminator. */
  private sawEsc = false;
  /** Gave up buffering this sequence (too big): let it through raw. */
  private overflow = false;
  /** Kitty: control block of the first chunk of a multi-chunk transmission. */
  private kittyControl: Kv | null = null;
  private kittyPayload: string[] = [];

  private readonly opts: ImageFilterOptions;

  constructor(opts: ImageFilterOptions = {}) {
    this.opts = opts;
  }

  /** Drop any half-collected sequence (terminal reset / detach). */
  reset(): void {
    this.state = 'pass';
    this.carry = new Uint8Array(0);
    this.buf = [];
    this.header = '';
    this.sawEsc = false;
    this.overflow = false;
    this.kittyControl = null;
    this.kittyPayload = [];
  }

  feed(chunk: Uint8Array): ImagePart[] {
    const parts: ImagePart[] = [];
    let data = chunk;
    if (this.carry.length) {
      const merged = new Uint8Array(this.carry.length + chunk.length);
      merged.set(this.carry, 0);
      merged.set(chunk, this.carry.length);
      data = merged;
      this.carry = new Uint8Array(0);
    }
    let i = 0;
    const n = data.length;
    let passStart = 0;

    const flushPass = (end: number) => {
      if (end > passStart) parts.push({ bytes: data.subarray(passStart, end) });
    };

    while (i < n) {
      if (this.state === 'pass') {
        const esc = data.indexOf(ESC, i);
        if (esc < 0) {
          i = n;
          break;
        }
        const match = matchMarker(data, esc);
        if (match === 'partial') {
          // The marker may continue in the next chunk: emit up to here and
          // hold the tail back.
          flushPass(esc);
          this.carry = data.slice(esc);
          return parts;
        }
        if (match === 'osc') {
          flushPass(esc);
          i = esc + OSC_1337.length;
          this.state = 'header';
          this.buf = [];
          this.header = '';
          this.sawEsc = false;
          this.overflow = false;
          continue;
        }
        if (match === 'apc' && this.opts.kitty?.() !== false) {
          flushPass(esc);
          i = esc + APC_G.length;
          this.state = 'kitty';
          this.buf = [];
          this.sawEsc = false;
          this.overflow = false;
          continue;
        }
        // Some other escape: skip past the ESC and keep scanning.
        i = esc + 1;
        continue;
      }

      // Inside a sequence.
      const b = data[i++];

      if (this.state === 'header') {
        if (b === 0x3a /* : */) {
          this.header = latin1(Uint8Array.from(this.buf));
          this.buf = [];
          if (/(^|;)size=\d+/.test(this.header)) {
            // Well formed: nothing to repair, stream it through untouched.
            parts.push({ bytes: toBytes(`\x1b]1337;${this.header}:`) });
            this.state = 'stream';
          } else {
            this.state = 'buffer';
          }
          continue;
        }
        if (this.isTerminator(b) || this.buf.length > MAX_HEADER || isAbort(b)) {
          // Not a `File=` header we can use: give it back verbatim.
          parts.push({ bytes: toBytes(`\x1b]1337;${latin1(Uint8Array.from(this.buf))}`) });
          this.endSequence(parts, b);
          passStart = i;
          continue;
        }
        this.buf.push(b);
        continue;
      }

      if (this.state === 'stream') {
        // Pass bytes straight through, only watching for the terminator.
        const start = i - 1;
        let j = start;
        let done = false;
        for (; j < n; j++) {
          const c = data[j];
          if (this.sawEsc) {
            this.sawEsc = false;
            if (c === 0x5c /* \ */) {
              j++;
              done = true;
              break;
            }
          }
          if (c === ESC) {
            this.sawEsc = true;
            continue;
          }
          if (c === BEL) {
            j++;
            done = true;
            break;
          }
          if (isAbort(c)) {
            done = true;
            break;
          }
        }
        parts.push({ bytes: data.subarray(start, j) });
        i = j;
        if (done) {
          this.state = 'pass';
          this.sawEsc = false;
          passStart = i;
        }
        continue;
      }

      if (this.state === 'buffer') {
        if (this.sawEsc) {
          this.sawEsc = false;
          if (b === 0x5c) {
            this.finishIip(parts, '\x1b\\');
            passStart = i;
            continue;
          }
          this.push(0x1b);
        }
        if (b === ESC) {
          this.sawEsc = true;
          continue;
        }
        if (b === BEL) {
          this.finishIip(parts, '\x07');
          passStart = i;
          continue;
        }
        if (isAbort(b) || this.overflow) {
          // Malformed or too big: hand back what we hold, unchanged.
          parts.push({ bytes: toBytes(`\x1b]1337;${this.header}:${latin1(Uint8Array.from(this.buf))}`) });
          this.endSequence(parts, b);
          passStart = i;
          continue;
        }
        this.push(b);
        continue;
      }

      // kitty
      if (this.sawEsc) {
        this.sawEsc = false;
        if (b === 0x5c) {
          this.finishKitty(parts);
          passStart = i;
          continue;
        }
        this.push(0x1b);
      }
      if (b === ESC) {
        this.sawEsc = true;
        continue;
      }
      if (isAbort(b) || this.overflow) {
        // Not a kitty sequence after all: give the bytes back.
        parts.push({ bytes: toBytes(`\x1b_G${latin1(Uint8Array.from(this.buf))}`) });
        this.endSequence(parts, b);
        passStart = i;
        continue;
      }
      this.push(b);
    }

    if (this.state === 'pass') flushPass(n);
    return parts;
  }

  private push(b: number) {
    if (this.buf.length >= MAX_BUFFER) {
      this.overflow = true;
      return;
    }
    this.buf.push(b);
  }

  /** Leave the current sequence, re-emitting the byte that ended it. */
  private endSequence(parts: ImagePart[], last: number) {
    this.buf = [];
    this.header = '';
    this.sawEsc = false;
    this.overflow = false;
    this.state = 'pass';
    parts.push({ bytes: Uint8Array.of(last) });
  }

  private isTerminator(b: number): boolean {
    return b === BEL || b === ESC;
  }

  /** The buffered `File=` payload, re-emitted with the size the addon needs. */
  private finishIip(parts: ImagePart[], terminator: string) {
    const payload = latin1(Uint8Array.from(this.buf));
    this.buf = [];
    this.state = 'pass';
    this.sawEsc = false;
    const size = base64ByteLength(payload);
    const header = size > 0 ? `${this.header};size=${size}` : this.header;
    parts.push({ bytes: toBytes(`\x1b]1337;${header}:${payload}${terminator}`) });
    this.header = '';
  }

  private finishKitty(parts: ImagePart[]) {
    const raw = Uint8Array.from(this.buf);
    this.buf = [];
    this.state = 'pass';
    this.sawEsc = false;

    const sep = raw.indexOf(0x3b);
    const control = parseControl(latin1(raw, 0, sep < 0 ? raw.length : sep));
    const payload = sep < 0 ? '' : latin1(raw, sep + 1);

    // Support query: answering makes tools actually use the protocol.
    if (control.a === 'q') {
      const id = control.i ? `i=${control.i}` : 'i=0';
      const num = control.I ? `,I=${control.I}` : '';
      this.opts.respond?.(`\x1b_G${id}${num};OK\x1b\\`);
      return;
    }

    // Chunked transmission: the control block of the first chunk rules.
    if (this.kittyControl === null && this.kittyPayload.length === 0) {
      this.kittyControl = control;
    }
    this.kittyPayload.push(payload);
    if (control.m === '1') return;

    const head = this.kittyControl ?? control;
    const data = this.kittyPayload.join('');
    this.kittyControl = null;
    this.kittyPayload = [];

    // Only "transmit and display at the cursor", direct transmission.
    if (head.a !== 'T') return;
    if (head.t && head.t !== 'd') return;
    if (!data) return;

    const cols = head.c && head.c !== '0' ? head.c : undefined;
    const rows = head.r && head.r !== '0' ? head.r : undefined;
    const format = head.f ?? '32';
    const width = Number(head.s ?? 0);
    const height = Number(head.v ?? 0);

    if (format === '100' && !head.o) {
      // Already a PNG: the addon takes it as is.
      parts.push({ bytes: iipSequence(data, base64ByteLength(data), cols, rows) });
      return;
    }
    parts.push({ promise: kittyToIip(data, format, head.o, width, height, cols, rows) });
  }
}

async function kittyToIip(
  b64: string,
  format: string,
  compression: string | undefined,
  width: number,
  height: number,
  cols?: string,
  rows?: string
): Promise<Uint8Array | null> {
  try {
    let bytes = base64ToBytes(b64);
    if (compression === 'z') {
      const out = await inflate(bytes);
      if (!out) return null;
      bytes = out;
    }
    if (format === '100') return iipSequence(bytesToBase64(bytes), bytes.length, cols, rows);
    if (format !== '24' && format !== '32') return null;
    const png = rawToPng(bytes, width, height, format === '24' ? 3 : 4);
    if (!png) return null;
    return iipSequence(png, base64ByteLength(png), cols, rows);
  } catch {
    return null;
  }
}

/** A C0 byte that ends a string sequence in every terminal (xterm.js included). */
function isAbort(b: number): boolean {
  return b < 0x20 && b !== ESC && b !== BEL;
}

function startsWith(data: Uint8Array, at: number, marker: number[]): 'yes' | 'partial' | 'no' {
  const cmp = Math.min(data.length - at, marker.length);
  for (let k = 0; k < cmp; k++) {
    if (data[at + k] !== marker[k]) return 'no';
  }
  return cmp === marker.length ? 'yes' : 'partial';
}

/** Does a known marker start at `at`? `partial` = need more bytes to tell. */
function matchMarker(data: Uint8Array, at: number): 'osc' | 'apc' | 'partial' | 'no' {
  const osc = startsWith(data, at, OSC_1337);
  if (osc === 'yes') return 'osc';
  const apc = startsWith(data, at, APC_G);
  if (apc === 'yes') return 'apc';
  return osc === 'partial' || apc === 'partial' ? 'partial' : 'no';
}
