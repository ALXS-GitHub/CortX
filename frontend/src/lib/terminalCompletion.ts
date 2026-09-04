/**
 * The completion engine (#17) — pure, synchronous, and deliberately free of
 * any dependency on xterm, React or Tauri.
 *
 * It answers two questions about a half-typed command line:
 *
 * - {@link analyseLine}: *what would help here?* — which word is being
 *   completed and which data sources are worth fetching for it. The async
 *   layer (`terminalCompletionData.ts`) reads that and nothing else.
 * - {@link completeLine} / {@link ghostFor}: *given whatever data we already
 *   have, what should be offered?* Never touches the disk, never awaits, so
 *   it can run on every keystroke inside a `requestAnimationFrame`.
 *
 * Keeping it a pure module is what makes it reusable: the input editor of
 * ticket #15 can call the very same functions on its own buffer without an
 * xterm grid anywhere in sight.
 */
import type { CommandSpec, CommandSuggestion, PathCompletion, SpecItem } from '@/types';

/** Where a completion comes from; the menu shows it as a small tag. */
export type CompletionKind = 'history' | 'subcommand' | 'flag' | 'branch' | 'script' | 'path';

export interface CompletionItem {
  /** Text that replaces `line.slice(from)` when accepted. */
  value: string;
  /** Shown in the menu (usually the last segment of `value`). */
  label: string;
  /** Second column: description, script body, run count… */
  detail?: string;
  kind: CompletionKind;
  /** Index in the line where `value` starts. */
  from: number;
  /** Higher is better. Only meaningful for sorting one result set. */
  score: number;
  /** Accepting should also type a space (a finished word, not a directory). */
  space: boolean;
}

/** One shell word, with the offsets it occupies in the line. */
export interface Word {
  /** Text with surrounding quotes removed. */
  text: string;
  /** Index of the first character of the word *including* an opening quote. */
  start: number;
  end: number;
  quoted: boolean;
}

/** What the async layer should go and fetch for this cursor position. */
export interface CompletionRequest {
  /** First word of the line — the program a spec would describe. */
  command: string | null;
  /** The word being completed (empty right after a space). */
  word: string;
  /** Offset of `word` in the line. */
  wordStart: number;
  /** 0 for the program itself, 1 for its first argument, … */
  wordIndex: number;
  needsSpec: boolean;
  needsGitRefs: boolean;
  needsNpmScripts: boolean;
  needsPaths: boolean;
}

/** Everything the engine may use. Any field may be missing or stale. */
export interface CompletionData {
  history?: CommandSuggestion[];
  spec?: CommandSpec | null;
  gitRefs?: string[];
  npmScripts?: SpecItem[];
  paths?: PathCompletion[];
}

/** `git <these> <TAB>` completes a branch / tag rather than a path. */
const GIT_REF_SUBCOMMANDS = new Set([
  'checkout',
  'switch',
  'merge',
  'rebase',
  'branch',
  'log',
  'diff',
  'cherry-pick',
  'reset',
  'revert',
  'push',
  'pull',
  'tag',
  'show',
  'restore',
]);

const SCRIPT_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/** Same rule as `terminal::spec::is_safe_command_name` on the Rust side. */
const SAFE_COMMAND = /^[A-Za-z0-9_][A-Za-z0-9._+-]{0,63}$/;

/** True when `name` may be handed to `getCommandSpec`. */
export function isSafeCommandName(name: string): boolean {
  return SAFE_COMMAND.test(name);
}

/**
 * Split a command line into words, honouring single and double quotes.
 * Unterminated quotes are fine — that is the normal state while typing.
 */
export function splitWords(line: string): Word[] {
  const words: Word[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    const start = i;
    let text = '';
    let quoted = false;
    let quote: string | null = null;
    while (i < line.length) {
      const ch = line[i];
      if (quote) {
        if (ch === quote) {
          quote = null;
          i++;
          continue;
        }
        text += ch;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        quoted = true;
        i++;
        continue;
      }
      if (/\s/.test(ch)) break;
      text += ch;
      i++;
    }
    words.push({ text, start, end: i, quoted });
  }
  return words;
}

/** Decide what is being completed and which sources are worth fetching. */
export function analyseLine(line: string): CompletionRequest {
  const words = splitWords(line);
  const endsWithSpace = line.length > 0 && /\s$/.test(line);
  const atNewWord = endsWithSpace || words.length === 0;
  const wordIndex = atNewWord ? words.length : words.length - 1;
  const current = atNewWord ? null : words[words.length - 1];
  const word = current?.text ?? '';
  const wordStart = current?.start ?? line.length;
  const command = words[0]?.text ?? null;

  const isFlag = word.startsWith('-');
  const sub = words[1]?.text ?? null;
  const needsGitRefs =
    !isFlag && command === 'git' && wordIndex >= 2 && sub !== null && GIT_REF_SUBCOMMANDS.has(sub);
  const needsNpmScripts =
    !isFlag && command !== null && SCRIPT_RUNNERS.has(command) && sub === 'run' && wordIndex === 2;

  return {
    command,
    word,
    wordStart,
    wordIndex,
    needsSpec: wordIndex >= 1 && command !== null && isSafeCommandName(command),
    needsGitRefs,
    needsNpmScripts,
    // Paths are the fallback for any argument that isn't one of the above.
    needsPaths: wordIndex >= 1 && !isFlag && !needsNpmScripts,
  };
}

function startsWithCI(haystack: string, needle: string): boolean {
  return needle.length === 0 || haystack.toLowerCase().startsWith(needle.toLowerCase());
}

/** Base scores, so one source can't drown another by accident. */
const SCORE = {
  history: 1000,
  script: 800,
  subcommand: 780,
  branch: 760,
  flag: 700,
  path: 600,
} as const;

/** How much a history entry's own ranking can move it inside its band. */
const HISTORY_SPREAD = 40;

/**
 * Rank every completion available for `line` given the data at hand.
 *
 * History entries replace the whole line (they are complete commands);
 * everything else replaces the word under the cursor.
 */
export function completeLine(line: string, data: CompletionData, limit = 40): CompletionItem[] {
  const req = analyseLine(line);
  const items: CompletionItem[] = [];

  // --- History: extends the whole line, at any position. ---------------
  const typed = line.trimStart();
  const offset = line.length - typed.length;
  if (typed.length > 0) {
    const matches = (data.history ?? []).filter(
      (h) => h.command.length > typed.length && startsWithCI(h.command, typed)
    );
    // Commands that never once succeeded only show up when nothing else does.
    const healthy = matches.filter((m) => !m.failed);
    const chosen = healthy.length > 0 ? healthy : matches;
    // `score` is unbounded; squash it into a band so history stays above the
    // other sources without one outlier dwarfing the rest.
    const best = chosen[0]?.score ?? 1;
    for (const m of chosen.slice(0, limit)) {
      items.push({
        value: m.command,
        label: m.command,
        detail: m.count > 1 ? `${m.count}×` : undefined,
        kind: 'history',
        from: offset,
        score: SCORE.history + (best > 0 ? (m.score / best) * HISTORY_SPREAD : 0),
        space: false,
      });
    }
  }

  const { word, wordStart } = req;
  const push = (
    value: string,
    kind: CompletionKind,
    score: number,
    detail?: string,
    space = true
  ) => {
    items.push({ value, label: value, detail, kind, from: wordStart, score, space });
  };

  // --- npm run <script> ------------------------------------------------
  if (req.needsNpmScripts) {
    for (const s of data.npmScripts ?? []) {
      if (startsWithCI(s.name, word)) push(s.name, 'script', SCORE.script, s.description);
    }
  }

  // --- git checkout <ref> ----------------------------------------------
  if (req.needsGitRefs) {
    let rank = 0;
    for (const ref of data.gitRefs ?? []) {
      if (!startsWithCI(ref, word)) continue;
      // `git for-each-ref` is sorted by last commit; keep that order.
      push(ref, 'branch', SCORE.branch - rank++ * 0.1);
    }
  }

  // --- Spec: subcommands and flags --------------------------------------
  const spec = data.spec;
  if (spec) {
    if (word.startsWith('-')) {
      let rank = 0;
      for (const f of spec.flags) {
        if (!startsWithCI(f.name, word)) continue;
        // Long flags first: `--verbose` is what people mean by "-v" here.
        const long = f.name.startsWith('--') ? 5 : 0;
        push(f.name, 'flag', SCORE.flag + long - rank++ * 0.1, f.description, !f.takesValue);
      }
    } else if (req.wordIndex === 1) {
      let rank = 0;
      for (const s of spec.subcommands) {
        if (!startsWithCI(s.name, word)) continue;
        push(s.name, 'subcommand', SCORE.subcommand - rank++ * 0.1, s.description);
      }
    }
  }

  // --- Paths -------------------------------------------------------------
  if (req.needsPaths) {
    let rank = 0;
    for (const p of data.paths ?? []) {
      // The backend already filtered on the fragment and sorted directories
      // first; a stale answer for another word is dropped here.
      if (!startsWithCI(p.value, word)) continue;
      push(p.value, 'path', SCORE.path - rank++ * 0.1, undefined, !p.isDir);
    }
  }

  const seen = new Set<string>();
  return items
    .filter((it) => {
      const key = `${it.kind}:${it.from}:${it.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
    .slice(0, limit);
}

/**
 * The ghost text to draw after the cursor, or `null`.
 *
 * History wins — it is the behaviour that already existed and the one that is
 * right most of the time. When nothing in the history extends the line, the
 * best of the other sources is used, but only when it unambiguously extends
 * the word under the cursor.
 */
export function ghostFor(line: string, data: CompletionData, minPrefix = 2): string | null {
  const typed = line.trimStart();
  if (typed.length < minPrefix) return null;

  const matches = (data.history ?? []).filter(
    (h) => h.command.length > typed.length && startsWithCI(h.command, typed)
  );
  const healthy = matches.filter((m) => !m.failed);
  const fromHistory = (healthy.length > 0 ? healthy : matches)[0];
  if (fromHistory) return fromHistory.command.slice(typed.length);

  const req = analyseLine(line);
  if (!req.word) return null;
  const best = completeLine(line, { ...data, history: [] }, 1)[0];
  if (!best || best.kind === 'history') return null;
  if (best.value.length <= req.word.length) return null;
  if (!startsWithCI(best.value, req.word)) return null;
  return best.value.slice(req.word.length);
}

/**
 * How to accept `item` on `line`, expressed as keystrokes for the shell: how
 * many characters to erase first, then what to type.
 *
 * `backspaces` is 0 whenever the item simply extends what is already there,
 * which is the usual case; it is only non-zero when the match differed in
 * case (`git CH` → `checkout`).
 */
export function acceptanceFor(
  line: string,
  item: CompletionItem
): { backspaces: number; text: string } | null {
  const already = line.slice(item.from);
  if (!startsWithCI(item.value, already)) return null;
  const suffix = item.space ? ' ' : '';
  if (item.value.startsWith(already)) {
    return { backspaces: 0, text: item.value.slice(already.length) + suffix };
  }
  return { backspaces: already.length, text: item.value + suffix };
}
