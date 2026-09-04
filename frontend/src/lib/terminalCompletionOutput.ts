/**
 * Candidates read out of the **previous command's output** (#17, second pass).
 *
 * This is the piece that was missing. History alone answers "what do you
 * usually run?"; it cannot answer "what does this screen tell you to run
 * next?" — and that second question is the one with the good answer most of
 * the time:
 *
 * ```
 * fatal: The current branch feat/x has no upstream branch.
 * To push the current branch and set the remote as upstream, use
 *
 *     git push --set-upstream origin feat/x
 * ```
 *
 * The command is right there, printed by the program that just failed. Same
 * for `npm notice To upgrade run: npm install -g npm@11.0.0`, for
 * ``Run `npm audit fix` to fix them``, and for the session id a coding agent
 * prints on its way out (`claude --resume <uuid>`).
 *
 * The rules are deliberately **conservative** — a wrong ghost is worse than
 * no ghost — so every candidate has to survive, in order:
 *
 * 1. a character allowlist ({@link SAFE_LINE}): no pipes, no redirections, no
 *    substitutions, no globs, no `<placeholder>`;
 * 2. a **prose filter**: no English/French function words outside quotes, no
 *    sentence punctuation, no "… failed / … is required" tail. This is what
 *    keeps `node version 20 is required` from becoming a command;
 * 3. a **known program** gate: the first word is either one of
 *    {@link WELL_KNOWN} or a program the user has actually run before;
 * 4. a **destructive** deny list ({@link DESTRUCTIVE}) — `rm -rf`, `git reset
 *    --hard`, `sudo …`, `curl … | sh`. CortX never offers those from text it
 *    scraped off a screen, whatever the confidence;
 * 5. a confidence score. Only a candidate the program **explicitly told the
 *    user to run** (introduced by a run verb, quoted inside such a sentence,
 *    or shown after a shell prompt) scores above the default ghost threshold.
 *    A command merely *sitting* in the output stays under it and shows up in
 *    the Ctrl+Space menu only.
 *
 * Pure and synchronous, and it runs **once per finished command** — never
 * while typing. No xterm, no React, no Tauri, so it is testable on its own
 * (`terminalCompletionOutput.test.ts`) and reusable by the input editor.
 */

/*
 * What Warp actually does, checked on this machine (v0.2026.08.05.09.03):
 * its "Next Command" ghost is an **AI** call — `/ai/generate_input_suggestions`
 * with a `block_context { command, output, exit_code, pwd, git_branch, … }`
 * payload, exactly as its own setting says ("based on your command history,
 * outputs, and common workflows"). CortX cannot do that on the keystroke path.
 *
 * But Warp *also* ships a second, purely local subsystem —
 * `command-corrections`, 36 vendored rules that are plain regexes over the
 * previous block's output (`git_push_set_upstream`, `git_command_not_found`,
 * `cargo_no_command`, `npm_unknown_command`, `leading_shell_prompt`, …). That
 * is the deterministic half, it needs no model, and it is what the rules below
 * reimplement. Warp also validates its predictions before showing them
 * ("Discarding most likely next command from rich history that failed
 * validation") and its completion menu does not open while typing
 * (`terminal.input.completions_open_while_typing` defaults to false) — both of
 * which CortX now matches.
 */

/** Why we think this line is a command worth offering. */
export type OutputReason =
  /** Quoted or backticked inside a sentence that says to run it. */
  | 'quoted'
  /** Indented on a line of its own — the usual "copy me" formatting. */
  | 'indented'
  /** Written out after a run verb (`… to upgrade run: npm install -g npm`). */
  | 'sentence'
  /** Prefixed by a shell prompt (`$ `, `> `, `PS …> `). */
  | 'prompt'
  /** The program named the subcommand the user meant ("did you mean …"). */
  | 'correction'
  /** Rebuilt from a token the program printed (a session id). */
  | 'resume';

export interface OutputCandidate {
  /** The command line to offer, exactly as it would be typed. */
  command: string;
  /** 0..1. Compared against the ghost's threshold; never a hard boolean. */
  confidence: number;
  reason: OutputReason;
}

export interface OutputScanOptions {
  /**
   * Program of the command whose output this is (`claude`, `git`, …). Enables
   * the {@link RESUME_RECIPES} and always counts as a known program.
   */
  program?: string | null;
  /** Programs the user has actually run before (first words of the history). */
  knownPrograms?: Iterable<string>;
  /**
   * The command line that produced this output. Needed to rewrite a mistyped
   * subcommand the program itself corrected ("did you mean `build`?").
   */
  lastCommand?: string | null;
  /** Most candidates to return. */
  limit?: number;
}

/** Lines of output scanned. Older advice is stale advice. */
export const MAX_SCANNED_LINES = 120;

/** Longest command we will ever offer from a screen. */
const MAX_COMMAND_LENGTH = 160;
const MAX_WORDS = 12;

/**
 * Programs accepted without ever having seen the user run them. Everything
 * else has to appear in the history first — that is the single strongest
 * guard against turning a line of prose into a suggestion.
 */
const WELL_KNOWN = new Set([
  'git',
  'gh',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'node',
  'deno',
  'tsc',
  'vite',
  'eslint',
  'prettier',
  'vitest',
  'jest',
  'cargo',
  'rustup',
  'rustc',
  'python',
  'python3',
  'pip',
  'pip3',
  'poetry',
  'uv',
  'pytest',
  'ruff',
  'go',
  'dotnet',
  'java',
  'mvn',
  'gradle',
  'make',
  'cmake',
  'docker',
  'podman',
  'kubectl',
  'helm',
  'terraform',
  'claude',
  'codex',
  'zorg',
  'cortx',
]);

/**
 * Every character a command we are willing to type may contain. Anything with
 * a pipe, a redirection, a substitution, a glob or a placeholder is rejected
 * outright — that is either prose or something we have no business
 * reconstructing.
 */
const SAFE_LINE = /^[A-Za-z0-9_.\\/][A-Za-z0-9 _.\\/:=@+~,'"-]*$/;

/** Placeholders a program prints for the user to fill in. Never offered. */
const PLACEHOLDER = /\.\.\.|\bYOUR[_ ]|\bxxx+\b|\bTODO\b/i;

/**
 * Function words. A command line does not contain them outside quotes; a
 * sentence that happens to start with a program name always does.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'am',
  'to', 'of', 'in', 'on', 'at', 'by', 'from', 'with', 'without',
  'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'it', 'its', 'you', 'your', 'we', 'our', 'they', 'their',
  'has', 'have', 'had', 'will', 'would', 'can', 'could', 'should', 'must',
  'may', 'might', 'does', 'do', 'did', 'not', 'no', 'yes', 'please',
  'est', 'sont', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'et', 'ou',
  'dans', 'pour', 'avec', 'sans', 'vous', 'votre', 'nest', 'pas', 'sur',
]);

/** How a sentence ends, never how a command ends. */
const PROSE_TAIL =
  /\s(failed|failing|succeeded|passed|missing|required|needed|installed|updated|outdated|found|available|deprecated|skipped|done|ok|error|errors|warning|warnings|instead|already|again|here|there|now|first|next|yet|too)$/i;

/**
 * Never offered from output, at any confidence. These are the commands where
 * a false positive is not "annoying" but "destroyed some work", and the user
 * is perfectly able to type them out.
 */
const DESTRUCTIVE: RegExp[] = [
  /(^|\s)sudo(\s|$)/i,
  /(^|\s)rm\s+-[A-Za-z]*[rf]/i,
  /(^|\s)del\s+\/[a-z]/i,
  /(^|\s)rmdir\s+\/s/i,
  /(^|\s)Remove-Item(\s|$)/i,
  /(^|\s)git\s+reset\s+--hard(\s|$)/i,
  /(^|\s)git\s+clean\s+-[A-Za-z]*f/i,
  /(^|\s)git\s+push\s+(--force(?!-with-lease)|-f)(\s|$)/i,
  /(^|\s)git\s+checkout\s+--\s/i,
  /(^|\s)(mkfs|fdisk|diskpart|format)(\s|$)/i,
  /(^|\s)dd\s+if=/i,
  /(^|\s)(shutdown|reboot|Restart-Computer|Stop-Computer)(\s|$)/i,
  /(^|\s)(kill|taskkill|Stop-Process)(\s|$)/i,
  /(^|\s)drop\s+(database|table)(\s|$)/i,
];

/** A command that only prints something. Correct, but never what comes next. */
const USELESS_TAIL = /\s(--help|-h|--version|-V|help|version)$/i;

/** Sentences that introduce a command. Deliberately short and unambiguous. */
const RUN_VERB =
  /\b(run|runs|running|use|used|using|try|trying|execute|invoke|resume|continue|retry|rerun|relaunch|launch|utilisez|lancez|essayez|exécutez|relancez)\b/i;

/** The same verbs, for "…, run: <command>" — global so the last one wins. */
const RUN_VERB_TAIL =
  /\b(?:run|running|use|using|try|trying|execute|invoke|retry|rerun|relaunch|launch|lancez|utilisez|exécutez|relancez)\b\s*:?\s+/gi;

/** `$ cmd`, `> cmd`, `❯ cmd`, `PS C:\x> cmd`. */
const PROMPT_PREFIX = /^(?:PS\s+[^>]{0,120}>|\$|❯|➜|>)\s+(?=\S)/;

/** Frame characters a TUI draws down the left of its output. */
const LEADING_DECORATION = /^[\s\u2502\u2503\u250a\u250e\u2551|]+/;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Programs whose output carries a token that is only useful once glued to a
 * flag. Kept tiny on purpose: each entry is a claim about a specific CLI, and
 * a wrong claim is exactly the kind of bad suggestion this pass exists to
 * remove.
 *
 * `claude` prints the id of the session it just closed; `claude --resume
 * <id>` reopens it. That is the case that started this ticket.
 */
const RESUME_RECIPES: Record<string, { build: (token: string) => string; token: RegExp }> = {
  claude: { build: (id) => `claude --resume ${id}`, token: UUID },
};

/** A line that names the session the token belongs to raises confidence. */
const RESUME_CONTEXT = /\b(session|resume|--resume|--continue|conversation)\b/i;

/**
 * `git: 'stauts' is not a git command … The most similar command is` — the
 * name follows on its own indented line, so this only marks where to look.
 * (Warp's `git/git_command_not_found.rs` uses the same anchor.)
 */
const MOST_SIMILAR = /\bthe most similar commands?\s+(?:is|are)\b\s*(.*)$/i;

/**
 * ``Did you mean `build`?`` (cargo), `Did you mean "install"?` (npm, brew),
 * `maybe you meant "install"` (pip), `Did you mean 'conda install'` — the
 * program names the subcommand it expected.
 */
const DID_YOU_MEAN =
  /\b(?:did you mean|maybe you meant)\b[^A-Za-z0-9`'"]*[`'"]?([A-Za-z][A-Za-z0-9._:+-]{0,40})[`'"]?/i;

/** A plausible subcommand, and nothing else. */
const SUBCOMMAND = /^[A-Za-z][A-Za-z0-9._:+-]{0,40}$/;

// ---------------------------------------------------------------------------
// Confidence. Only these first four reach the default ghost threshold (0.55);
// everything below it lives in the Ctrl+Space menu and nowhere else.
// ---------------------------------------------------------------------------

/** Indented on its own line, right after a sentence that says to run it. */
const CONF_INTRODUCED = 0.85;
/** The program named the subcommand it expected. Hard to argue with. */
const CONF_CORRECTION = 0.85;
/**
 * It named several; the first is the program's own best guess, but a guess is
 * exactly what the ghost must not draw. Menu only.
 */
const CONF_CORRECTION_AMBIGUOUS = 0.5;
/** Quoted inside such a sentence. */
const CONF_QUOTED = 0.8;
/** Session id the program labelled as such. */
const CONF_RESUME_LABELLED = 0.78;
/** Spelled out after a run verb (`… to upgrade run: npm install -g npm`). */
const CONF_SENTENCE = 0.75;
/** Shown after a shell prompt. */
const CONF_PROMPT = 0.7;
/** The only session id in the output, but the program never named it. */
const CONF_RESUME_BARE = 0.65;
/** A command simply sitting in the output, introduced by nothing. */
const CONF_STANDALONE = 0.5;
/** Several unrelated tokens: we would be picking one at random. */
const CONF_RESUME_AMBIGUOUS = 0.4;
/**
 * `git add`, `npm test`: a program and a bare subcommand. Real commands, but
 * the history already knows them and half of them need an argument we do not
 * have, so they never make it to the ghost.
 */
const PENALTY_BARE_PAIR = 0.3;

/**
 * First word of a command line, without its directory or extension.
 *
 * A quoted first word is taken whole, which is how a path with a space in it
 * gets typed on Windows (`"C:\Program Files\nodejs\npm.cmd" run dev`).
 */
export function programOf(command: string): string {
  const text = command.trim();
  const quoted = text.match(/^"([^"]+)"|^'([^']+)'/);
  const first = quoted ? (quoted[1] ?? quoted[2]) : (text.split(/\s+/, 1)[0] ?? '');
  const base = first.split(/[\\/]/).pop() ?? first;
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

function quotesAreBalanced(text: string): boolean {
  const singles = (text.match(/'/g) ?? []).length;
  const doubles = (text.match(/"/g) ?? []).length;
  return singles % 2 === 0 && doubles % 2 === 0;
}

/** The line with every quoted run removed — where prose has nowhere to hide. */
function unquoted(text: string): string {
  return text.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ');
}

function readsLikeProse(command: string): boolean {
  if (PROSE_TAIL.test(command)) return true;
  const words = unquoted(command).split(/\s+/).slice(1);
  return words.some((w) => STOPWORDS.has(w.replace(/[^A-Za-zÀ-ÿ]/g, '').toLowerCase()));
}

/**
 * Is `text` something we would be willing to type into the shell on the
 * user's behalf? Rules 1–4 of the module doc, in order.
 */
export function isOfferableCommand(text: string, known: ReadonlySet<string>): boolean {
  const command = text.trim();
  if (command.length < 3 || command.length > MAX_COMMAND_LENGTH) return false;
  if (!SAFE_LINE.test(command)) return false;
  if (PLACEHOLDER.test(command)) return false;
  if (!quotesAreBalanced(command)) return false;
  const words = command.split(/\s+/);
  if (words.length < 2 || words.length > MAX_WORDS) return false;
  // Prose ends in punctuation; a command does not. `git add .` is the one
  // exception people actually type.
  if (/[.,:;!?]$/.test(command) && !/\s\.$/.test(command)) return false;
  if (USELESS_TAIL.test(command)) return false;
  if (readsLikeProse(command)) return false;
  if (!known.has(programOf(command))) return false;
  return !DESTRUCTIVE.some((re) => re.test(command));
}

/** `git add` and `npm test` are real, but never worth a ghost. */
function barePair(command: string): boolean {
  const words = command.trim().split(/\s+/);
  return words.length === 2 && !/[-./\\=@:]/.test(words[1]);
}

/**
 * Strip a TUI's left frame, keeping the indentation that follows it, and turn
 * tabs into spaces so a tab-indented command still reads as indented.
 */
function undecorate(line: string): string {
  return line
    .replace(LEADING_DECORATION, (m) => m.replace(/\S/g, ' '))
    .replace(/\t/g, '    ')
    .replace(/\s+$/, '');
}

/** Does one of the three lines above `i` say "run this"? */
function introduced(lines: string[], i: number): boolean {
  for (let y = i - 1; y >= 0 && y >= i - 3; y--) {
    const text = lines[y].trim();
    if (!text) continue;
    // The first non-empty line above decides; anything further up is about
    // something else.
    return RUN_VERB.test(text) || text.endsWith(':');
  }
  return false;
}

interface Found {
  command: string;
  confidence: number;
  reason: OutputReason;
  /** Line index, so later advice beats earlier advice at equal confidence. */
  at: number;
}

function record(out: Found[], command: string, confidence: number, reason: OutputReason, at: number) {
  const text = command.trim();
  out.push({
    command: text,
    confidence: Math.max(0, confidence - (barePair(text) ? PENALTY_BARE_PAIR : 0)),
    reason,
    at,
  });
}

/** Quoted commands on a line that tells the user to run them. */
function scanQuoted(line: string, i: number, known: ReadonlySet<string>, out: Found[]) {
  if (!RUN_VERB.test(line)) return;
  for (const raw of line.match(/`[^`]{3,160}`|'[^']{3,160}'|"[^"]{3,160}"/g) ?? []) {
    const inner = raw.slice(1, -1);
    if (isOfferableCommand(inner, known)) record(out, inner, CONF_QUOTED, 'quoted', i);
  }
}

/**
 * A command written out inside a sentence:
 * `npm notice To upgrade run: npm install -g npm@11.0.0`,
 * `Resume with: claude --resume <id>`.
 *
 * Every plausible cut point is tried left to right and the first one whose
 * tail is a real command wins — leftmost means longest, so we get the whole
 * command rather than its last argument.
 */
function scanSentence(line: string, i: number, known: ReadonlySet<string>, out: Found[]) {
  const cuts: number[] = [];
  RUN_VERB_TAIL.lastIndex = 0;
  for (let m = RUN_VERB_TAIL.exec(line); m; m = RUN_VERB_TAIL.exec(line)) {
    cuts.push(m.index + m[0].length);
  }
  // `<short label>: <command>` — the other way programs point at a command.
  for (const m of line.matchAll(/(?<=^|\s)[A-Za-z][A-Za-z ]{0,30}:\s+/g)) {
    cuts.push(m.index + m[0].length);
  }
  for (const cut of cuts.sort((a, b) => a - b)) {
    const tail = line.slice(cut).trim().replace(/[.,;]+$/, '');
    if (!isOfferableCommand(tail, known)) continue;
    record(out, tail, CONF_SENTENCE, 'sentence', i);
    return;
  }
}

/**
 * Turn the tail of a command's output into commands worth offering.
 *
 * `lines` is the output as the grid holds it: already free of escape
 * sequences, one entry per screen row, in order.
 */
export function candidatesFromOutput(
  lines: readonly string[],
  options: OutputScanOptions = {}
): OutputCandidate[] {
  const known = new Set(WELL_KNOWN);
  for (const p of options.knownPrograms ?? []) {
    const name = programOf(p);
    if (name) known.add(name);
  }
  const program = options.program ? programOf(options.program) : null;
  if (program) known.add(program);

  const scanned = lines.slice(-MAX_SCANNED_LINES).map(undecorate);
  const found: Found[] = [];

  for (let i = 0; i < scanned.length; i++) {
    const line = scanned[i];
    if (!line.trim()) continue;

    scanQuoted(line, i, known, found);
    scanSentence(line, i, known, found);

    const bare = line.trimStart();
    const prompt = bare.match(PROMPT_PREFIX);
    if (prompt) {
      const rest = bare.slice(prompt[0].length);
      if (isOfferableCommand(rest, known)) record(found, rest, CONF_PROMPT, 'prompt', i);
      continue;
    }

    // A command on a line of its own, indented the way every CLI formats the
    // thing it wants you to copy.
    const indent = line.length - bare.length;
    if (indent >= 2 && isOfferableCommand(line, known)) {
      record(found, line, introduced(scanned, i) ? CONF_INTRODUCED : CONF_STANDALONE, 'indented', i);
    }
  }

  found.push(...correctionCandidates(scanned, options.lastCommand ?? null, known));
  found.push(...resumeCandidates(scanned, program));

  // Later beats earlier at equal confidence: the last thing a program says is
  // usually the thing to do about it.
  found.sort((a, b) => b.confidence - a.confidence || b.at - a.at);

  const seen = new Set<string>();
  const out: OutputCandidate[] = [];
  for (const f of found) {
    const key = f.command.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ command: f.command, confidence: f.confidence, reason: f.reason });
    if (out.length >= (options.limit ?? 8)) break;
  }
  return out;
}

/**
 * The command the user *meant*, when the program itself said so.
 *
 * `git stauts` → `git: 'stauts' is not a git command … The most similar
 * command is / status` → `git status`. Only the subcommand is ever rewritten,
 * and only when the rest of the line survives {@link isOfferableCommand}, so
 * this can never invent arguments.
 */
function correctionCandidates(
  lines: string[],
  lastCommand: string | null,
  known: ReadonlySet<string>
): Found[] {
  const words = (lastCommand ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [];
  if (!known.has(programOf(words[0]))) return [];
  const wrong = words[1];
  // A flag or a path is the user's business; only a subcommand is corrected.
  if (!SUBCOMMAND.test(wrong)) return [];

  const out: Found[] = [];
  const propose = (name: string, confidence: number, at: number) => {
    if (out.length > 0 || !SUBCOMMAND.test(name)) return;
    const lower = name.toLowerCase();
    // "Did you mean this?" — the name is on the next line, not in the question.
    if (lower === wrong.toLowerCase() || lower === 'this' || lower === 'one') return;
    const fixed = [words[0], name, ...words.slice(2)].join(' ');
    if (!isOfferableCommand(fixed, known)) return;
    out.push({ command: fixed, confidence, reason: 'correction', at });
  };

  for (let i = 0; i < lines.length && out.length === 0; i++) {
    const similar = lines[i].match(MOST_SIMILAR);
    if (similar) {
      const confidence = /commands\s+are/i.test(similar[0])
        ? CONF_CORRECTION_AMBIGUOUS
        : CONF_CORRECTION;
      const inline = similar[1].trim();
      if (inline) {
        propose(inline.split(/\s+/)[0], confidence, i);
      } else {
        for (let y = i + 1; y < lines.length && y <= i + 4; y++) {
          const text = lines[y].trim();
          if (!text) continue;
          propose(text.split(/\s+/)[0], confidence, y);
          break;
        }
      }
    }
    const mean = lines[i].match(DID_YOU_MEAN);
    if (mean) propose(mean[1], CONF_CORRECTION, i);
  }
  return out;
}

/** `claude --resume <id>`, rebuilt from a token in the output. */
function resumeCandidates(lines: string[], program: string | null): Found[] {
  if (!program) return [];
  const recipe = RESUME_RECIPES[program];
  if (!recipe) return [];

  const hits: { token: string; at: number; labelled: boolean }[] = [];
  for (let i = 0; i < lines.length; i++) {
    recipe.token.lastIndex = 0;
    const matches = lines[i].match(recipe.token);
    if (!matches) continue;
    const labelled = RESUME_CONTEXT.test(lines[i]);
    for (const token of matches) hits.push({ token, at: i, labelled });
  }
  if (hits.length === 0) return [];

  const distinct = new Set(hits.map((h) => h.token.toLowerCase()));
  // Prefer a token the program itself named ("Session id: …"); otherwise the
  // last one printed. Several unrelated tokens means we would be picking one
  // at random, so the confidence drops below the ghost threshold and the
  // candidate survives in the Ctrl+Space menu only.
  const labelled = [...hits].reverse().find((h) => h.labelled);
  const chosen = labelled ?? hits[hits.length - 1];
  const confidence = labelled
    ? CONF_RESUME_LABELLED
    : distinct.size === 1
      ? CONF_RESUME_BARE
      : CONF_RESUME_AMBIGUOUS;
  return [{ command: recipe.build(chosen.token), confidence, reason: 'resume', at: chosen.at }];
}
