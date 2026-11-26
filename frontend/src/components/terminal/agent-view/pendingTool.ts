/**
 * What the agent view needs to know about the tool call an agent is on, and
 * how to tell a person what it is about — the way the Claude desktop app
 * words its permission and question cards.
 *
 * Pure functions over the normalised transcript (`AgentMessage`), tested in
 * `pendingTool.test.ts`.
 */
import type { AgentMessage, AgentPart } from '@/types';

export type ToolCall = Extract<AgentPart, { type: 'tool-call' }>;

/** The last tool call of the transcript that has no result yet, if any. */
export function pendingToolCall(messages: readonly AgentMessage[]): ToolCall | null {
  const done = new Set<string>();
  for (const m of messages) for (const p of m.parts) if (p.type === 'tool-result') done.add(p.toolId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i].parts;
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j];
      if (p.type === 'tool-call') return done.has(p.toolId) ? null : p;
    }
  }
  return null;
}

function str(input: unknown, key: string): string | null {
  if (!input || typeof input !== 'object') return null;
  const v = (input as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

export type ToolPreview =
  | { kind: 'command'; command: string; description: string | null }
  | { kind: 'edit'; path: string; hunks: { removed: string; added: string }[] }
  | { kind: 'write'; path: string; content: string }
  | { kind: 'plan'; plan: string }
  | { kind: 'question'; header: string | null }
  | { kind: 'url'; url: string; prompt: string | null }
  | { kind: 'generic'; summary: string | null; input: unknown };

/** What a tool call is about, for its card. */
export function toolPreview(call: ToolCall): ToolPreview {
  const input = call.input;
  switch (call.name) {
    case 'Bash':
    case 'PowerShell':
      return { kind: 'command', command: str(input, 'command') ?? '', description: str(input, 'description') };
    case 'Edit':
      return {
        kind: 'edit',
        path: str(input, 'file_path') ?? '',
        hunks: [{ removed: str(input, 'old_string') ?? '', added: str(input, 'new_string') ?? '' }],
      };
    case 'MultiEdit': {
      const edits = input && typeof input === 'object' ? (input as { edits?: unknown }).edits : null;
      const hunks = Array.isArray(edits)
        ? edits.map((e) => ({ removed: str(e, 'old_string') ?? '', added: str(e, 'new_string') ?? '' }))
        : [];
      return { kind: 'edit', path: str(input, 'file_path') ?? '', hunks };
    }
    case 'Write':
      return { kind: 'write', path: str(input, 'file_path') ?? '', content: str(input, 'content') ?? '' };
    case 'ExitPlanMode':
      return { kind: 'plan', plan: str(input, 'plan') ?? '' };
    case 'AskUserQuestion':
      return { kind: 'question', header: null };
    case 'WebFetch':
      return { kind: 'url', url: str(input, 'url') ?? '', prompt: str(input, 'prompt') };
    default: {
      let summary: string | null = null;
      for (const key of ['file_path', 'path', 'pattern', 'query', 'url', 'description', 'prompt', 'skill']) {
        summary = str(input, key);
        if (summary) break;
      }
      return { kind: 'generic', summary, input };
    }
  }
}

/** The card's title for a tool waiting on you, in the desktop app's words. */
export function toolCardTitle(call: ToolCall | null, agentName: string): string {
  if (!call) return `${agentName} needs your input`;
  switch (call.name) {
    case 'Bash':
    case 'PowerShell':
      return `Allow ${agentName} to run this command?`;
    case 'Edit':
    case 'MultiEdit':
      return `Allow ${agentName} to edit this file?`;
    case 'Write':
      return `Allow ${agentName} to write this file?`;
    case 'ExitPlanMode':
      return `${agentName} has a plan for you`;
    case 'AskUserQuestion':
      return `${agentName} has a question`;
    case 'WebFetch':
      return `Allow ${agentName} to fetch this page?`;
    default:
      return call.name.startsWith('mcp__')
        ? `Allow ${agentName} to use ${call.name.split('__').slice(2).join('__') || call.name}?`
        : `Allow ${agentName} to use ${call.name}?`;
  }
}

/** The lines of a diff hunk, for the edit card (`-` / `+`). */
export function diffLines(hunk: { removed: string; added: string }): { sign: '-' | '+'; text: string }[] {
  const out: { sign: '-' | '+'; text: string }[] = [];
  if (hunk.removed) for (const line of hunk.removed.split('\n')) out.push({ sign: '-', text: line });
  if (hunk.added) for (const line of hunk.added.split('\n')) out.push({ sign: '+', text: line });
  return out;
}
