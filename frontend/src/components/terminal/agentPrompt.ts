/**
 * The agent prompt (Warp's "rich input" for third-party CLI agents): a real
 * text field docked under a terminal while an agent (Claude Code, Codex) runs
 * in it, whose prompt is handed to the agent as if you had pasted it in its
 * own input and pressed Enter.
 *
 * Nothing here talks to the agent any other way: the text goes through the
 * PTY, exactly what the agent would have received from the keyboard. So it
 * works with any agent that reads a line — and the agent's own input stays
 * usable as before.
 *
 * - The text is **pasted** (`term.paste`: bracketed when the program asked for
 *   it, which Claude Code and Codex do), so a multi-line prompt stays one
 *   prompt instead of being sent line by line. Enter follows, alone, a moment
 *   later: an Enter glued to the paste would be taken as part of it.
 * - **Images** sit in the text where they were pasted or dropped, as an
 *   `[Image #N]` marker, the way Claude Code's own input shows them. They are
 *   sent in place: the text before, the image's bare path on its own (what
 *   Claude Code and Codex turn into an attached image, at the caret), the
 *   text after — one paste each, since a path inside a paste stays text
 *   (`agentPromptParts.ts`).
 * - **Other files** go into the text as paths: the agent reads them.
 *
 * The state (drafts, which editor is open) is per terminal and lives here,
 * not in the component: the pane can be unmounted (a tab switch, the grid)
 * without losing what you were writing.
 */
import { appCacheDir, join } from '@tauri-apps/api/path';
import { mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { writeTerminal } from '@/lib/tauri';
import { pasteIntoTerminal, terminalScreenRows } from '@/lib/terminalSessions';
import { promptParts, type PromptAttachment } from './agentPromptParts';
import { clearKeys, inputHoldsPrompt, readInputBox } from './agentPromptRestore';

export type AgentAttachment = PromptAttachment;

export interface AgentDraft {
  text: string;
  attachments: AgentAttachment[];
}

/** Events the bar of one terminal answers (`detail.terminalId`). */
export const AGENT_PROMPT_EVENTS = {
  /** Open the editor (or close it, when it is open and has the focus). */
  toggle: 'cortx:agent-prompt-toggle',
  /** Files to attach (`detail.paths`): a drop on the bar, the file picker. */
  attach: 'cortx:agent-prompt-attach',
} as const;

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_RE.test(path);
}

export function attachmentOf(path: string): AgentAttachment {
  const name = path.split(/[\\/]/).pop() || path;
  return { path, name, image: isImagePath(path) };
}

const drafts = new Map<string, AgentDraft>();
/** The last prompt the bubble sent to each terminal's agent, until it is given back or goes stale. */
const lastSent = new Map<string, { draft: AgentDraft; at: number; escForwarded: boolean }>();
/** A sent prompt can sit in Claude Code's queue for as long as a turn lasts. */
const SENT_TTL = 30 * 60_000;
const history = new Map<string, string[]>();
const openEditors = new Set<string>();
const HISTORY_LIMIT = 50;

export function draftOf(terminalId: string): AgentDraft {
  return drafts.get(terminalId) ?? { text: '', attachments: [] };
}

export function saveDraft(terminalId: string, draft: AgentDraft) {
  if (!draft.text && draft.attachments.length === 0) drafts.delete(terminalId);
  else drafts.set(terminalId, draft);
}

/** Prompts sent to this terminal's agent, most recent last. */
export function promptHistory(terminalId: string): readonly string[] {
  return history.get(terminalId) ?? [];
}

export function setEditorOpen(terminalId: string, open: boolean) {
  if (open) openEditors.add(terminalId);
  else openEditors.delete(terminalId);
}

export function isEditorOpen(terminalId: string): boolean {
  return openEditors.has(terminalId);
}

export function toggleAgentPrompt(terminalId: string) {
  window.dispatchEvent(new CustomEvent(AGENT_PROMPT_EVENTS.toggle, { detail: { terminalId } }));
}

export function attachToAgentPrompt(terminalId: string, paths: string[]) {
  window.dispatchEvent(new CustomEvent(AGENT_PROMPT_EVENTS.attach, { detail: { terminalId, paths } }));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Hand a prompt to the agent running in `terminalId`. Resolves to false when
 * the terminal is not there to receive it (nothing was sent).
 */
export async function sendAgentPrompt(terminalId: string, draft: AgentDraft): Promise<boolean> {
  const parts = promptParts(draft.text, draft.attachments);
  if (parts.length === 0) return false;
  for (const part of parts) {
    if (!pasteIntoTerminal(terminalId, part.kind === 'image' ? part.path : part.text)) return false;
    // One paste at a time: the agent reads an image's file before it places
    // it, and the text after it must not overtake it.
    await sleep(part.kind === 'image' ? 220 : 120);
  }
  await writeTerminal(terminalId, '\r');
  lastSent.set(terminalId, { draft, at: Date.now(), escForwarded: false });
  if (draft.text.trim()) {
    const list = history.get(terminalId) ?? [];
    if (list[list.length - 1] !== draft.text) list.push(draft.text);
    if (list.length > HISTORY_LIMIT) list.splice(0, list.length - HISTORY_LIMIT);
    history.set(terminalId, list);
  }
  return true;
}

function freshSent(terminalId: string) {
  const sent = lastSent.get(terminalId);
  if (!sent) return null;
  if (Date.now() - sent.at > SENT_TTL || !sent.draft.text.trim()) {
    lastSent.delete(terminalId);
    return null;
  }
  return sent;
}

/**
 * Esc in the bubble, right after it sent a prompt and with nothing typed
 * since: the Esc is the agent's (stop, and give the queued prompt back), the
 * way it is in Claude Code's own input. Once only — a second Esc closes the
 * bubble, and never reaches the agent as the double Esc that opens its
 * history.
 */
export function escapeGoesToAgent(terminalId: string): boolean {
  const sent = freshSent(terminalId);
  if (!sent || sent.escForwarded) return false;
  if (Date.now() - sent.at > ESC_WINDOW) return false;
  sent.escForwarded = true;
  return true;
}
/** How long after a send Esc in the bubble still means "stop" rather than "close". */
const ESC_WINDOW = 60_000;

/** Send the agent an Esc, as its own input would. */
export async function sendEscapeToAgent(terminalId: string) {
  await writeTerminal(terminalId, '\x1b');
}

const restoring = new Set<string>();

/**
 * An Esc just reached the agent: if it gives back the prompt the bubble sent
 * (`agentPromptRestore.ts`), take it out of the agent's input box and resolve
 * to it, for the bubble. Null when the agent kept it — too late, the message
 * was already taken up — or when there is nothing to watch for.
 */
export async function takeBackPrompt(terminalId: string): Promise<AgentDraft | null> {
  const sent = freshSent(terminalId);
  if (!sent || restoring.has(terminalId)) return null;
  restoring.add(terminalId);
  try {
    // The agent redraws its box a moment after the key.
    let box: string | null = null;
    const until = Date.now() + 1500;
    while (Date.now() < until) {
      await sleep(80);
      box = readInputBox(terminalScreenRows(terminalId) ?? []);
      if (inputHoldsPrompt(box, sent.draft.text)) break;
      box = null;
    }
    if (box === null) return null;
    await writeTerminal(terminalId, clearKeys(box));
    // Only take it if the box really let go of it: otherwise it stays where
    // the agent put it, rather than living in two places.
    let after: string | null = box;
    const settle = Date.now() + 800;
    while (Date.now() < settle) {
      await sleep(80);
      after = readInputBox(terminalScreenRows(terminalId) ?? []);
      if (after === '') break;
    }
    if (after === box) return null;
    lastSent.delete(terminalId);
    return sent.draft;
  } finally {
    restoring.delete(terminalId);
  }
}

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

/**
 * An image from the clipboard, saved where the agent can read it (CortX's
 * cache folder, `agent-images/`). Returns its attachment.
 */
export async function saveClipboardImage(blob: Blob): Promise<AgentAttachment> {
  const ext = IMAGE_EXT[blob.type] ?? 'png';
  const dir = await join(await appCacheDir(), 'agent-images');
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = await join(dir, `pasted-${stamp}.${ext}`);
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return { path, name: `pasted image.${ext}`, image: true };
}
