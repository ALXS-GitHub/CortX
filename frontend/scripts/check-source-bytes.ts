/**
 * Guard: no source file may contain a raw C0 control byte.
 *
 * `terminalBlocks.ts` once carried two literal NULs and a SOH inside a
 * template string — the separators of the toolbar signature, written as real
 * bytes instead of escapes. One byte is enough to make git call the file
 * binary: `git diff` prints `Bin 60123 -> 61206 bytes` instead of the change,
 * `grep` and `rg` skip the file unless you pass `-a`, and merge tools can
 * refuse it outright. Fifteen hundred lines carrying the whole block renderer
 * went unreviewable for it.
 *
 * The fix was to write `\u0000` / `\u0001`, exactly as `terminalCompletionData`
 * already did. This test is what stops the next one from landing.
 *
 * Run by `npm test`. It lives in scripts/ rather than beside the unit tests
 * because it is the only check that reads the tree off disk, and the app's
 * tsconfig deliberately excludes Node's types.
 *
 * Tab, LF and CR are allowed: they are ordinary text.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const EXTENSIONS = ['.ts', '.tsx', '.css', '.json', '.html'];
/** Everything below 0x20 except tab (0x09), LF (0x0a) and CR (0x0d), plus DEL. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(path);
  }
  return out;
}

const files = sourceFiles(SRC);
const offenders: string[] = [];
for (const path of files) {
  const text = readFileSync(path, 'utf8');
  const at = text.search(FORBIDDEN);
  if (at === -1) continue;
  const code = text.charCodeAt(at).toString(16).padStart(4, '0');
  const line = text.slice(0, at).split('\n').length;
  offenders.push(`${path}:${line} — U+${code.toUpperCase()} (write it as \\u${code})`);
}

if (offenders.length > 0) {
  console.error(`check-source-bytes: raw control byte in ${offenders.length} file(s):`);
  for (const offender of offenders) console.error(`  ${offender}`);
  process.exit(1);
}

console.log(`check-source-bytes: ${files.length} files clean`);
