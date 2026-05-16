/**
 * Custom filter for cmdk that supports:
 * - Scope syntax: `@<category> <query>` (e.g. `@tools yazi`) restricts results
 *   to one category by prefix-matching the category name.
 * - Strict scoring: prefix > word-boundary > substring. No "fuzzy chars in
 *   order" like cmdk's default — "git" no longer matches "Go to settings".
 *
 * Items are expected to have a `value` of the form
 *   `${category} | ${label} | ${keywords}`
 * so the filter can read the category without lookup.
 */

export interface ParsedQuery {
  /** Lowercased scope name from `@<scope>`, or null when no scope was typed. */
  scope: string | null;
  /** The remaining search text, trimmed. May be empty. */
  text: string;
}

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trimStart();
  const m = trimmed.match(/^@(\w+)(?:\s+([\s\S]*))?$/);
  if (m) {
    return { scope: m[1].toLowerCase(), text: (m[2] ?? '').trim() };
  }
  return { scope: null, text: raw.trim() };
}

/**
 * Score a haystack against a multi-word needle. Returns 0 if any word fails
 * to match, otherwise the average per-word score in [0, 1].
 *
 * Per-word scoring (highest wins):
 *   1.0  haystack starts with the word
 *   0.7  any word in the haystack starts with the word (word boundary)
 *   0.3  haystack contains the word as a contiguous substring
 *   0    no match -> whole item is excluded
 */
export function strictScore(haystack: string, needle: string): number {
  if (!needle) return 1;
  const h = haystack.toLowerCase();
  const words = needle.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;

  let total = 0;
  for (const word of words) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let s = 0;
    if (h.startsWith(word)) s = 1;
    else if (new RegExp(`\\b${escaped}`).test(h)) s = 0.7;
    else if (h.includes(word)) s = 0.3;

    if (s === 0) return 0;
    total += s;
  }
  return total / words.length;
}

/**
 * cmdk filter callback. `value` is the item's value attribute (we encode
 * `${category} | ${label} | ${keywords}`). `search` is the raw input.
 */
export function commandFilter(value: string, search: string): number {
  const parts = value.split('|').map((s) => s.trim());
  const category = parts[0] ?? '';
  const rest = parts.slice(1).join(' '); // label + keywords for text scoring

  const { scope, text } = parseQuery(search);

  if (scope) {
    // Prefix match on category name, case-insensitive.
    if (!category.toLowerCase().startsWith(scope)) return 0;
  }

  return strictScore(rest, text);
}

/**
 * Build the `value` attribute encoding category + label + keywords so the
 * filter has everything it needs without a separate lookup.
 */
export function buildItemValue(
  category: string,
  label: string,
  keywords: string | undefined,
): string {
  return `${category} | ${label} | ${keywords ?? ''}`;
}
