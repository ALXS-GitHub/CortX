/**
 * What the agent prompt sends, in order (`agentPrompt.ts` does the sending).
 *
 * An image sits *in* the text, where it was pasted or dropped, as a
 * `[Image #N]` marker — the way Claude Code's own input shows one. To land
 * there in the agent's input too, the prompt goes out as a sequence of
 * pastes: the text up to the marker, then the image's path *on its own*
 * (which is what Claude Code and Codex turn into an attached image, at the
 * caret), then the rest of the text. A path in the middle of a paste would
 * stay text, hence one paste per piece.
 *
 * Pure: no Tauri, no DOM, so it runs under `node --test`.
 */

export interface PromptAttachment {
  path: string;
  name: string;
  image: boolean;
  /** Images only: the N of the `[Image #N]` marker that places it in the text. */
  n?: number;
}

export type PromptPart = { kind: 'text'; text: string } | { kind: 'image'; path: string };

const MARKER_RE = /\[Image #(\d+)\]/g;

export function imageMarker(n: number): string {
  return `[Image #${n}]`;
}

/** The number the next pasted image gets in this draft. */
export function nextImageNumber(attachments: readonly PromptAttachment[]): number {
  return attachments.reduce((max, a) => Math.max(max, a.n ?? 0), 0) + 1;
}

/** Images whose marker is still in the text (deleting the marker drops the image). */
export function placedImages(text: string, attachments: readonly PromptAttachment[]): PromptAttachment[] {
  const present = new Set<number>();
  for (const m of text.matchAll(MARKER_RE)) present.add(Number(m[1]));
  return attachments.filter((a) => a.image && a.n !== undefined && present.has(a.n));
}

/** What the attachment chips show: the files, and the images still placed. */
export function visibleAttachments(text: string, attachments: readonly PromptAttachment[]): PromptAttachment[] {
  const placed = new Set(placedImages(text, attachments));
  return attachments.filter((a) => !a.image || a.n === undefined || placed.has(a));
}

function quote(path: string): string {
  if (!/[\s"'()&;|<>$`]/.test(path)) return path;
  return `"${path.replace(/"/g, '\\"')}"`;
}

/**
 * The pastes, in order. Images without a marker (older drafts) go first, as
 * they always did; files go last, as paths in the text.
 */
export function promptParts(text: string, attachments: readonly PromptAttachment[]): PromptPart[] {
  const parts: PromptPart[] = [];
  for (const a of attachments) if (a.image && a.n === undefined) parts.push({ kind: 'image', path: quote(a.path) });

  const byNumber = new Map<number, PromptAttachment>();
  for (const a of attachments) if (a.image && a.n !== undefined) byNumber.set(a.n, a);
  const files = attachments.filter((a) => !a.image).map((a) => quote(a.path));
  let body = text.replace(/\s+$/, '');
  if (files.length > 0) body = body ? `${body}\n\n${files.join(' ')}` : files.join(' ');

  let last = 0;
  for (const m of body.matchAll(MARKER_RE)) {
    const image = byNumber.get(Number(m[1]));
    if (!image) continue; // a marker typed by hand: plain text
    const before = body.slice(last, m.index);
    if (before) parts.push({ kind: 'text', text: before });
    parts.push({ kind: 'image', path: quote(image.path) });
    last = m.index! + m[0].length;
  }
  const rest = body.slice(last);
  if (rest) parts.push({ kind: 'text', text: rest });
  return parts;
}
