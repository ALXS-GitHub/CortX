/**
 * Getting a prompt back from the agent (Claude Code's own Esc behaviour).
 *
 * In Claude Code, a message sent while the agent is busy waits in a queue;
 * Esc interrupts the agent *and* puts the queued message back in its input
 * box, to be edited. Too late — the message already taken up — Esc only
 * interrupts, and the input stays empty. Sent from the agent prompt, the
 * message came back into Claude Code's input, not into the bubble it was
 * written in.
 *
 * CortX does not guess which of the two happened: it reads Claude Code's
 * input box off the screen after the Esc. When it holds the prompt the bubble
 * just sent, the agent decided to give it back — the box is emptied and the
 * prompt goes back into the bubble. When it does not, nothing happens. The
 * agent's logic stays the agent's.
 *
 * Pure functions here (the screen is a list of strings), tested in
 * `agentPromptRestore.test.ts`; the wiring is in `AgentPromptBar.tsx`.
 */

/** A row of Claude Code's frame around its input: a rule of `─`. */
function isRule(row: string): boolean {
  const t = row.trim();
  return t.length >= 8 && /^─+$/.test(t);
}

/**
 * The text in Claude Code's input box: the rows between the last two rules
 * on the screen, without its `❯` / `>` prompt. Null when there is no such
 * box (another program, a menu in its place).
 */
export function readInputBox(screen: readonly string[]): string | null {
  let last = -1;
  let prev = -1;
  for (let i = screen.length - 1; i >= 0; i--) {
    if (!isRule(screen[i])) continue;
    if (last < 0) last = i;
    else {
      prev = i;
      break;
    }
  }
  if (prev < 0 || last - prev < 2) return null;
  const rows = screen.slice(prev + 1, last).map((r) => r.replace(/\s+$/, ''));
  if (!/^\s*[❯>]/.test(rows[0])) return null;
  const first = rows[0].replace(/^\s*[❯>]\s?/, '');
  return [first, ...rows.slice(1).map((r) => r.replace(/^ {2}/, ''))].join('\n');
}

const IMAGE_RE = /\[Image #\d+\]/g;
const PASTED_RE = /\[Pasted text #\d+[^\]]*\]/g;

/** Comparison key: no image markers, no whitespace (the box wraps and indents). */
function squash(text: string): string {
  return text.replace(IMAGE_RE, '').replace(/\s+/g, '');
}

/**
 * Does the agent's input box hold `sent` (the prompt the bubble sent)?
 *
 * Whitespace is ignored (the box wraps long lines and indents the next ones)
 * and so are image markers (Claude Code numbers them its own way). A long
 * paste Claude Code folded into `[Pasted text #N +M lines]` matches when what
 * is left around the placeholder is part of the prompt.
 */
export function inputHoldsPrompt(box: string | null, sent: string): boolean {
  if (box === null) return false;
  const want = squash(sent);
  const folded = PASTED_RE.test(box);
  PASTED_RE.lastIndex = 0;
  if (folded) {
    const rest = box.split(PASTED_RE).map(squash).filter(Boolean);
    return rest.every((piece) => want.includes(piece));
  }
  const got = squash(box);
  return got.length > 0 && got === want;
}

/** The keys that empty the box: to the end, then one Backspace per character (and a few more). */
export function clearKeys(box: string): string {
  return '\x05' + '\x7f'.repeat(Array.from(box).length + 8);
}
