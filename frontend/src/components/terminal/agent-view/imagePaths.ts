/**
 * The image files a message names by their path (CORT-66): "saved the
 * screenshot to C:\shots\home.png", `./docs/flow.svg`. The agent view shows
 * them as thumbnails under the message, read from disk, the way it shows an
 * image the agent embedded in markdown.
 *
 * Pure, no imports, so `imagePaths.test.ts` runs it on plain Node.
 *
 * Only paths that name a folder count (`shots/a.png`, `C:\a.png`, `/tmp/a.png`,
 * `~/a.png`, `./a.png`): a bare `logo.png` is too often a word about a file
 * rather than a pointer to one. Links (`https://…/a.png`) and images already
 * embedded in markdown (`![](a.png)`) are left out.
 */

const EXT = '(?:png|jpe?g|gif|webp|bmp|svg)';
/** One path segment, without spaces (those need quotes or backticks). */
const SEG = '[^\\s"\'`<>|*?()\\[\\]{}\\\\/]+';
const SEP = '[\\\\/]';
const PREFIX = `(?:[A-Za-z]:${SEP}|~${SEP}|\\.{1,2}${SEP}|${SEP})?`;

/** A path standing on its own in the text. */
const BARE = new RegExp(`(?<![\\w:/\\\\.~%-])(${PREFIX}(?:${SEG}${SEP})*${SEG}\\.${EXT})(?![\\w/\\\\])`, 'gi');
/** A path in backticks or quotes — the only way to write one with spaces. */
const QUOTED = new RegExp(`[\`"]([^\`"\\n]*${SEP}[^\`"\\n]*\\.${EXT})[\`"]`, 'gi');
/** Markdown images (already shown) and link targets (`[a](https://…)`). */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

const MAX = 8;

/** The image paths in `text`, in order, each once. */
export function imagePathsIn(text: string): string[] {
  if (!text || !/\.(png|jpe?g|gif|webp|bmp|svg)\b/i.test(text)) return [];
  const body = text.replace(MARKDOWN_IMAGE, ' ').replace(URL, ' ');
  const found: { index: number; path: string }[] = [];
  for (const m of body.matchAll(QUOTED)) found.push({ index: m.index ?? 0, path: m[1].trim() });
  // Quoted paths are taken out, so a path with spaces is not cut in two.
  const unquoted = body.replace(QUOTED, (m) => ' '.repeat(m.length));
  for (const m of unquoted.matchAll(BARE)) {
    const path = m[1];
    if (!/[\\/]/.test(path)) continue;
    found.push({ index: m.index ?? 0, path });
  }
  found.sort((a, b) => a.index - b.index);
  const out: string[] = [];
  for (const { path } of found) {
    if (!out.includes(path)) out.push(path);
    if (out.length >= MAX) break;
  }
  return out;
}
