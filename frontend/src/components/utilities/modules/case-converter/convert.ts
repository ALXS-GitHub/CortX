export interface CaseOptions {
  /** Convert each line on its own instead of treating the input as one string. */
  perLine: boolean;
  /** "café" -> "cafe". Required for slugs, optional elsewhere. */
  stripAccents: boolean;
  /** Split "parseHTMLString" into parse + HTML + string rather than one word. */
  splitAcronyms: boolean;
  /** Split "utf8bom" into utf + 8 + bom. */
  splitDigits: boolean;
  /** Separator used by the slug output. */
  slugSeparator: string;
  /** 0 = no limit. Truncates on a separator boundary, never mid-word. */
  slugMaxLength: number;
}

export const DEFAULT_CASE_OPTIONS: CaseOptions = {
  perLine: true,
  stripAccents: true,
  splitAcronyms: true,
  splitDigits: false,
  slugSeparator: '-',
  slugMaxLength: 0,
};

/** Strips diacritics but keeps the base letter: "Ångström" -> "Angstrom". */
export function stripAccents(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/ø/g, 'o')
    .replace(/Ø/g, 'O')
    .replace(/đ|ð/g, 'd')
    .replace(/Đ|Ð/g, 'D')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L');
}

/**
 * Split arbitrary text into words. This is the whole game: every output format
 * is just a join of these words, so all the subtlety (acronyms, digits,
 * punctuation) is handled once here.
 */
export function toWords(input: string, options: CaseOptions): string[] {
  let value = options.stripAccents ? stripAccents(input) : input;

  // Explicit boundaries first: anything that isn't a letter or digit.
  value = value.replace(/[^\p{L}\p{N}]+/gu, ' ');

  // "fooBar" -> "foo Bar"
  value = value.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2');

  if (options.splitAcronyms) {
    // "HTMLParser" -> "HTML Parser" (keeps the acronym whole)
    value = value.replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2');
  }

  if (options.splitDigits) {
    value = value.replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2');
  }

  return value.split(/\s+/).filter(Boolean);
}

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/** Words that stay lowercase inside Title Case, unless first or last. */
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or',
  'per', 'the', 'to', 'up', 'via', 'vs',
]);

export interface CaseResult {
  id: string;
  label: string;
  value: string;
}

function slugify(words: string[], options: CaseOptions): string {
  const separator = options.slugSeparator || '-';
  const full = words.map((w) => w.toLowerCase()).join(separator);
  if (options.slugMaxLength <= 0 || full.length <= options.slugMaxLength) return full;

  // Cut on a separator so the slug never ends mid-word.
  const cut = full.slice(0, options.slugMaxLength);
  const lastSeparator = cut.lastIndexOf(separator);
  return lastSeparator > 0 ? cut.slice(0, lastSeparator) : cut;
}

function convertOnce(input: string, options: CaseOptions): CaseResult[] {
  const words = toWords(input, options);
  const lower = words.map((w) => w.toLowerCase());

  return [
    { id: 'camel', label: 'camelCase', value: lower.map((w, i) => (i === 0 ? w : cap(w))).join('') },
    { id: 'pascal', label: 'PascalCase', value: lower.map(cap).join('') },
    { id: 'snake', label: 'snake_case', value: lower.join('_') },
    { id: 'constant', label: 'CONSTANT_CASE', value: lower.join('_').toUpperCase() },
    { id: 'kebab', label: 'kebab-case', value: lower.join('-') },
    { id: 'train', label: 'Train-Case', value: lower.map(cap).join('-') },
    { id: 'dot', label: 'dot.case', value: lower.join('.') },
    { id: 'path', label: 'path/case', value: lower.join('/') },
    {
      id: 'title',
      label: 'Title Case',
      value: lower
        .map((w, i) => (i > 0 && i < lower.length - 1 && MINOR_WORDS.has(w) ? w : cap(w)))
        .join(' '),
    },
    {
      id: 'sentence',
      label: 'Sentence case',
      value: lower.length ? cap(lower[0]) + (lower.length > 1 ? ' ' + lower.slice(1).join(' ') : '') : '',
    },
    { id: 'lower', label: 'lower case', value: lower.join(' ') },
    { id: 'upper', label: 'UPPER CASE', value: lower.join(' ').toUpperCase() },
    { id: 'slug', label: 'URL slug', value: slugify(words, options) },
  ];
}

export function convert(input: string, options: CaseOptions): CaseResult[] {
  if (!options.perLine) return convertOnce(input, options);

  const lines = input.split('\n');
  if (lines.length <= 1) return convertOnce(input, options);

  // Convert each line independently, then stitch the results back together so
  // the output stays line-for-line aligned with the input.
  const perLine = lines.map((line) => convertOnce(line, options));
  return perLine[0].map((_, index) => ({
    id: perLine[0][index].id,
    label: perLine[0][index].label,
    value: perLine.map((results) => results[index].value).join('\n'),
  }));
}
