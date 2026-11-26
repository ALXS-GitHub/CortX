/**
 * Reading the menu an agent shows on its screen (Claude Code's permission
 * prompts, `AskUserQuestion`, the plan approval), so the agent view (ticket
 * CORT-62) can draw it as buttons — and send the keys that pick an option,
 * exactly as if you had used the arrows and Enter in the terminal.
 *
 * The agent stays the only one deciding what its menu holds: CortX reads it
 * off the screen after each repaint, so whatever the agent does with a key
 * (move on to the next question, open a text field, close the menu), the
 * buttons follow. Nothing is assumed about Claude Code beyond the look of a
 * menu: numbered rows, one of them under the `❯` pointer.
 *
 * Pure functions (the screen is a list of strings), tested in
 * `agentMenu.test.ts`; the view is in `agent-view/`.
 */

export interface AgentMenuOption {
  /** The number the agent printed (1-based). */
  n: number;
  label: string;
  /** Rows printed under the option (its description), joined. */
  detail: string;
  /** Under the pointer. */
  selected: boolean;
  /** A checkbox option (multi-select): ticked or not; null when it has none. */
  checked: boolean | null;
  /** Picking it opens a text field in the agent ("Type something", "Other"). */
  freeText: boolean;
}

export interface AgentMenu {
  /** The line just above the options ("Do you want to proceed?"), if any. */
  title: string | null;
  /** Rows above the title, up to the frame or a blank run (what is asked about). */
  context: string[];
  options: AgentMenuOption[];
  /** The hint row under the menu ("Esc to cancel · Tab to amend"), if any. */
  hint: string | null;
}

const POINTER = /^[❯›▶>]\s*/;
const OPTION_RE = /^([❯›▶>]\s*)?(\d{1,2})[.)]\s+(.*)$/;
const CHECKBOX_RE = /^(\[[ xX✔✓]\]|[☐☑☒✔✓◻◼])\s*/;
const FREE_TEXT_RE = /^(type something|other|something else|chat about this)\b/i;

/** A row without the frame drawn around it (`│ … │`) and without its right padding. */
function unframe(row: string): string {
  return row.replace(/^\s*[│┃|]\s?/, '').replace(/\s*[│┃|]\s*$/, '').replace(/\s+$/, '');
}

function isFrame(row: string): boolean {
  const t = row.trim();
  return t.length >= 3 && /^[─━═╭╮╰╯┌┐└┘├┤\s╌┄-]+$/.test(t);
}

/**
 * The menu at the bottom of the screen, or null when there is none.
 *
 * A menu is a run of rows numbered 1…N (N ≥ 2), in order, one of them behind
 * the pointer — a numbered list in the agent's own answer has no pointer and
 * is never taken for one. Rows between two options belong to the option
 * above (its description).
 */
export function readAgentMenu(screen: readonly string[]): AgentMenu | null {
  const rows = screen.map(unframe);
  // The bottom-most row that looks like an option.
  let last = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (OPTION_RE.test(rows[i].trim())) {
      last = i;
      break;
    }
  }
  if (last < 0) return null;

  // Walk up to option 1, collecting the rows under each option.
  const found: { row: number; n: number; text: string; pointer: boolean; detail: string[] }[] = [];
  let pendingDetail: string[] = [];
  let first = -1;
  for (let i = last; i >= 0; i--) {
    const t = rows[i].trim();
    const m = OPTION_RE.exec(t);
    if (m) {
      const n = Number(m[2]);
      const expected = found.length === 0 ? n : found[found.length - 1].n - 1;
      if (n !== expected) return null;
      found.push({ row: i, n, text: m[3], pointer: !!m[1], detail: pendingDetail.reverse() });
      pendingDetail = [];
      if (n === 1) {
        first = i;
        break;
      }
      continue;
    }
    if (isFrame(rows[i])) return null;
    if (t) pendingDetail.push(t);
    // A blank row between options is part of the menu; two in a row end it.
    else if (i > 0 && !rows[i - 1].trim() && found.length > 0) return null;
  }
  if (first < 0 || found.length < 2) return null;
  if (!found.some((o) => o.pointer)) return null;

  // Rows under the last option indented past its number: its description.
  // Then the first row after them: the hint ("Esc to cancel · …").
  const digitCol = rows[last].search(/\d/);
  const tail: string[] = [];
  let i = last + 1;
  for (; i < rows.length; i++) {
    const r = rows[i];
    if (!r.trim() || isFrame(r) || r.search(/\S/) <= digitCol) break;
    tail.push(r.trim());
  }
  let hint: string | null = null;
  for (; i < rows.length && i <= last + tail.length + 3; i++) {
    if (isFrame(rows[i])) continue;
    const t = rows[i].trim();
    if (t) {
      hint = t;
      break;
    }
  }

  const options = found.reverse().map((o, idx, all): AgentMenuOption => {
    let label = o.text.trim();
    let checked: boolean | null = null;
    const box = CHECKBOX_RE.exec(label);
    if (box) {
      checked = !/\[ \]|☐|◻/.test(box[1]);
      label = label.slice(box[0].length).trim();
    }
    // Each option's description is the rows under it; the last one's runs
    // to the hint.
    const detail = (idx === all.length - 1 ? tail : o.detail).join(' ').trim();
    return { n: o.n, label, detail, selected: o.pointer, checked, freeText: FREE_TEXT_RE.test(label) };
  });

  // The title: the closest non-empty row above option 1; the context, the
  // rows above it up to a frame or two blank rows.
  let title: string | null = null;
  const context: string[] = [];
  let blanks = 0;
  for (let i = first - 1; i >= 0; i--) {
    if (isFrame(rows[i])) break;
    const t = rows[i].trim();
    if (!t) {
      if (title !== null && ++blanks >= 2) break;
      continue;
    }
    blanks = 0;
    if (POINTER.test(t)) break;
    if (title === null) title = t;
    else if (context.length < 12) context.unshift(t);
    else break;
  }

  return { title, context, options, hint };
}

/** Keys that move a menu's pointer down / up (CSI form, which Ink reads). */
export const KEY_DOWN = '\x1b[B';
export const KEY_UP = '\x1b[A';
export const KEY_ENTER = '\r';

/**
 * The keys that take the pointer from where it is to `target`, one entry per
 * key (they are sent one at a time: a TUI reading a chunk as one key would
 * miss the rest).
 */
export function keysToOption(menu: AgentMenu, target: number): string[] {
  const from = menu.options.find((o) => o.selected)?.n ?? 1;
  const delta = target - from;
  return Array.from({ length: Math.abs(delta) }, () => (delta > 0 ? KEY_DOWN : KEY_UP));
}

/** Same menu (same options, same pointer)? To skip a re-render on every repaint. */
export function sameMenu(a: AgentMenu | null, b: AgentMenu | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.title !== b.title || a.hint !== b.hint || a.options.length !== b.options.length) return false;
  if (a.context.join('\n') !== b.context.join('\n')) return false;
  return a.options.every((o, i) => {
    const p = b.options[i];
    return o.label === p.label && o.selected === p.selected && o.checked === p.checked && o.detail === p.detail;
  });
}
