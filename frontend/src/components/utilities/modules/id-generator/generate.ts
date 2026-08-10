/**
 * Generation logic for the ID & Secret Generator, kept out of the panel so it
 * stays testable and readable. Everything random goes through Web Crypto —
 * `Math.random()` is never acceptable for something labelled "secret".
 */

export type GeneratorKind = 'uuid-v4' | 'uuid-v7' | 'ulid' | 'nanoid' | 'password' | 'custom';

export type AlphabetId =
  | 'base62'
  | 'alnum-upper'
  | 'hex-lower'
  | 'hex-upper'
  | 'digits'
  | 'base32-crockford'
  | 'base64url'
  | 'custom';

export type CaseTransform = 'none' | 'upper' | 'lower';

export interface GeneratorOptions {
  kind: GeneratorKind;
  count: number;
  /** Length of the random part, before prefix and grouping. */
  length: number;
  alphabet: AlphabetId;
  customAlphabet: string;
  prefix: string;
  /** 0 disables grouping. */
  groupSize: number;
  groupSeparator: string;
  caseTransform: CaseTransform;
  // Password-only knobs.
  useLowercase: boolean;
  useUppercase: boolean;
  useDigits: boolean;
  useSymbols: boolean;
  excludeAmbiguous: boolean;
}

export const DEFAULT_OPTIONS: GeneratorOptions = {
  kind: 'uuid-v4',
  count: 5,
  length: 24,
  alphabet: 'base62',
  customAlphabet: '',
  prefix: '',
  groupSize: 0,
  groupSeparator: '-',
  caseTransform: 'none',
  useLowercase: true,
  useUppercase: true,
  useDigits: true,
  useSymbols: true,
  excludeAmbiguous: true,
};

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/';
/** Glyphs that are easy to misread when a secret is typed by hand. */
const AMBIGUOUS = new Set('0O1lI|`\'"');

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const ALPHABETS: Record<Exclude<AlphabetId, 'custom'>, string> = {
  base62: DIGITS + UPPER + LOWER,
  'alnum-upper': DIGITS + UPPER,
  'hex-lower': '0123456789abcdef',
  'hex-upper': '0123456789ABCDEF',
  digits: DIGITS,
  'base32-crockford': CROCKFORD,
  base64url: UPPER + LOWER + DIGITS + '-_',
};

export const ALPHABET_LABELS: Record<AlphabetId, string> = {
  base62: 'Base62 (0-9 A-Z a-z)',
  'alnum-upper': 'Uppercase + digits',
  'hex-lower': 'Hex (lowercase)',
  'hex-upper': 'Hex (uppercase)',
  digits: 'Digits only',
  'base32-crockford': 'Base32 (Crockford)',
  base64url: 'Base64 URL-safe',
  custom: 'Custom…',
};

export const KIND_LABELS: Record<GeneratorKind, string> = {
  'uuid-v4': 'UUID v4 (random)',
  'uuid-v7': 'UUID v7 (time-sortable)',
  ulid: 'ULID',
  nanoid: 'Nano ID',
  password: 'Password',
  custom: 'Custom format',
};

/** True when the option only affects `password` / `custom` output. */
export function usesAlphabet(kind: GeneratorKind): boolean {
  return kind === 'custom' || kind === 'nanoid';
}

export function usesLength(kind: GeneratorKind): boolean {
  return kind === 'custom' || kind === 'nanoid' || kind === 'password';
}

export interface Preset {
  id: string;
  label: string;
  options: Partial<GeneratorOptions>;
}

export const PRESETS: Preset[] = [
  { id: 'uuid-v4', label: 'UUID v4', options: { kind: 'uuid-v4' } },
  { id: 'uuid-v7', label: 'UUID v7', options: { kind: 'uuid-v7' } },
  { id: 'ulid', label: 'ULID', options: { kind: 'ulid' } },
  { id: 'nanoid', label: 'Nano ID (21)', options: { kind: 'nanoid', length: 21, alphabet: 'base64url' } },
  {
    id: 'strong-password',
    label: 'Strong password',
    options: {
      kind: 'password',
      length: 24,
      useLowercase: true,
      useUppercase: true,
      useDigits: true,
      useSymbols: true,
      excludeAmbiguous: true,
      prefix: '',
      groupSize: 0,
    },
  },
  {
    id: 'pin',
    label: 'PIN (6 digits)',
    options: { kind: 'custom', length: 6, alphabet: 'digits', prefix: '', groupSize: 0, caseTransform: 'none' },
  },
  {
    id: 'api-key',
    label: 'API key (sk_…)',
    options: { kind: 'custom', length: 32, alphabet: 'base62', prefix: 'sk_', groupSize: 0, caseTransform: 'none' },
  },
  {
    id: 'hex-32',
    label: 'Hex 32',
    options: { kind: 'custom', length: 32, alphabet: 'hex-lower', prefix: '', groupSize: 0, caseTransform: 'none' },
  },
  {
    id: 'base64url-43',
    label: 'Base64url 43 (256 bits)',
    options: { kind: 'custom', length: 43, alphabet: 'base64url', prefix: '', groupSize: 0, caseTransform: 'none' },
  },
  {
    id: 'license-key',
    label: 'License key (XXXXX-XXXXX-…)',
    options: {
      kind: 'custom',
      length: 25,
      alphabet: 'alnum-upper',
      prefix: '',
      groupSize: 5,
      groupSeparator: '-',
      caseTransform: 'upper',
    },
  },
];

/**
 * Uniform pick over `alphabet` using rejection sampling. Taking `byte % len`
 * would bias the first `256 % len` characters, which is exactly the kind of
 * quiet weakness a generator like this must not ship.
 */
function randomChars(count: number, alphabet: string): string {
  const len = alphabet.length;
  if (len === 0) return '';

  const max = Math.floor(256 / len) * len;
  let out = '';
  const buf = new Uint8Array(Math.max(count * 2, 32));

  while (out.length < count) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < count; i++) {
      if (buf[i] < max) out += alphabet[buf[i] % len];
    }
  }

  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function formatUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uuidV4(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(toHex(bytes));
}

function uuidV7(now: number): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // 48-bit big-endian millisecond timestamp, then version 7 and the RFC variant.
  bytes[0] = Math.floor(now / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(now / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(now / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(now / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return formatUuid(toHex(bytes));
}

function ulid(now: number): string {
  let time = '';
  let rest = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }
  return time + randomChars(16, CROCKFORD);
}

export function passwordAlphabet(options: GeneratorOptions): string {
  let alphabet = '';
  if (options.useLowercase) alphabet += LOWER;
  if (options.useUppercase) alphabet += UPPER;
  if (options.useDigits) alphabet += DIGITS;
  if (options.useSymbols) alphabet += SYMBOLS;
  // Every class unchecked would mean "no characters allowed"; fall back to the
  // default set rather than silently producing empty strings.
  if (!alphabet) alphabet = LOWER + UPPER + DIGITS;
  if (options.excludeAmbiguous) {
    alphabet = Array.from(alphabet)
      .filter((c) => !AMBIGUOUS.has(c))
      .join('');
  }
  return alphabet;
}

export function resolveAlphabet(options: GeneratorOptions): string {
  if (options.kind === 'password') return passwordAlphabet(options);

  const base =
    options.alphabet === 'custom'
      ? Array.from(new Set(Array.from(options.customAlphabet))).join('')
      : ALPHABETS[options.alphabet];

  if (!options.excludeAmbiguous) return base;
  const filtered = Array.from(base)
    .filter((c) => !AMBIGUOUS.has(c))
    .join('');
  // Filtering "digits only" down to nothing would break generation — keep the
  // original set when the exclusion leaves too little to work with.
  return filtered.length >= 2 ? filtered : base;
}

/** Password classes the user asked for, restricted to what survived filtering. */
function requiredClasses(options: GeneratorOptions): string[] {
  const alphabet = passwordAlphabet(options);
  const has = (set: string) => Array.from(set).filter((c) => alphabet.includes(c)).join('');
  const classes: string[] = [];
  if (options.useLowercase) classes.push(has(LOWER));
  if (options.useUppercase) classes.push(has(UPPER));
  if (options.useDigits) classes.push(has(DIGITS));
  if (options.useSymbols) classes.push(has(SYMBOLS));
  return classes.filter(Boolean);
}

function group(value: string, size: number, separator: string): string {
  if (size <= 0 || !separator) return value;
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += size) chunks.push(value.slice(i, i + size));
  return chunks.join(separator);
}

function applyCase(value: string, transform: CaseTransform): string {
  if (transform === 'upper') return value.toUpperCase();
  if (transform === 'lower') return value.toLowerCase();
  return value;
}

function generatePassword(options: GeneratorOptions): string {
  const alphabet = passwordAlphabet(options);
  const classes = requiredClasses(options);
  const length = Math.max(1, options.length);

  // Asking for one char per class in a shorter password is unsatisfiable; in
  // that case take whatever the plain draw gives.
  if (classes.length === 0 || classes.length > length) return randomChars(length, alphabet);

  // Draw one character per class, fill the rest freely, then shuffle so the
  // guaranteed characters aren't stuck at the front.
  const chars = classes.map((set) => randomChars(1, set));
  chars.push(...Array.from(randomChars(length - classes.length, alphabet)));

  for (let i = chars.length - 1; i > 0; i--) {
    const pick = new Uint32Array(1);
    crypto.getRandomValues(pick);
    const j = pick[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

function generateOne(options: GeneratorOptions, now: number): string {
  switch (options.kind) {
    case 'uuid-v4':
      return applyCase(uuidV4(), options.caseTransform);
    case 'uuid-v7':
      return applyCase(uuidV7(now), options.caseTransform);
    case 'ulid':
      return ulid(now);
    case 'password':
      return options.prefix + generatePassword(options);
    case 'nanoid':
    case 'custom': {
      const body = randomChars(Math.max(1, options.length), resolveAlphabet(options));
      return options.prefix + group(applyCase(body, options.caseTransform), options.groupSize, options.groupSeparator);
    }
  }
}

export function generate(options: GeneratorOptions): string[] {
  const now = Date.now();
  const count = Math.min(Math.max(1, options.count), 500);
  return Array.from({ length: count }, () => generateOne(options, now));
}

/** Shannon entropy of the random part, in bits — prefix and separators add none. */
export function entropyBits(options: GeneratorOptions): number {
  switch (options.kind) {
    case 'uuid-v4':
      return 122;
    case 'uuid-v7':
      return 74; // 62 random bits + 12 in the rand_a field, timestamp excluded.
    case 'ulid':
      return 80;
    case 'password':
      return Math.max(1, options.length) * Math.log2(passwordAlphabet(options).length);
    case 'nanoid':
    case 'custom': {
      const size = resolveAlphabet(options).length;
      return size < 2 ? 0 : Math.max(1, options.length) * Math.log2(size);
    }
  }
}

export function entropyLabel(bits: number): { label: string; className: string } {
  if (bits >= 128) return { label: 'Excellent', className: 'text-emerald-500' };
  if (bits >= 80) return { label: 'Strong', className: 'text-emerald-500' };
  if (bits >= 60) return { label: 'Good', className: 'text-amber-500' };
  if (bits >= 40) return { label: 'Weak', className: 'text-orange-500' };
  return { label: 'Very weak', className: 'text-red-500' };
}
