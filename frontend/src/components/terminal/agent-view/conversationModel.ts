/**
 * The conversation of the agent view, as a person reads it — the way the
 * Claude desktop app lays one out — built from the normalised transcript.
 *
 * - A **user turn** is what you wrote (a slash command shows as a command,
 *   Claude Code's own bookkeeping — system reminders, caveats, task
 *   notifications — does not show at all).
 * - An **assistant turn** is everything the agent did until you spoke again,
 *   whatever the number of API messages it took: its text, its thinking, and
 *   its tool calls folded into **steps** ("Read 3 files, ran a command"),
 *   each with its result attached.
 * - A few tools are not steps but content: the to-do list (`TodoWrite`), the
 *   plan (`ExitPlanMode`), a question asked (`AskUserQuestion`).
 *
 * Pure functions, tested in `conversationModel.test.ts`.
 */
import type { AgentMessage, AgentPart } from '@/types';

export type ToolCallPart = Extract<AgentPart, { type: 'tool-call' }>;
export type ToolResultPart = Extract<AgentPart, { type: 'tool-result' }>;

export interface Step {
  call: ToolCallPart;
  result: ToolResultPart | null;
}

export interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

export type Block =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'thinking'; key: string; text: string }
  | { kind: 'steps'; key: string; steps: Step[] }
  | { kind: 'todos'; key: string; todos: Todo[] }
  | { kind: 'plan'; key: string; plan: string; result: ToolResultPart | null }
  | { kind: 'question'; key: string; questions: string[]; answer: string | null; pending: boolean };

export type Turn =
  | { kind: 'user'; id: string; timestamp: string; text: string; images: number; command: { name: string; args: string } | null }
  | { kind: 'notice'; id: string; timestamp: string; text: string }
  | { kind: 'assistant'; id: string; timestamp: string; blocks: Block[] };

/** Tools drawn as content of the answer, not as steps. */
const CONTENT_TOOLS = new Set(['TodoWrite', 'ExitPlanMode', 'AskUserQuestion']);

const HIDDEN_USER_TEXT = /^\s*<(system-reminder|local-command-caveat|task-notification|user-prompt-submit-hook|bash-notification)>/;
const COMMAND_RE = /<command-name>\s*([^<]*?)\s*<\/command-name>/;
const COMMAND_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/;
const STDOUT_RE = /^\s*<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-(stdout|stderr)>\s*$/;
const BASH_INPUT_RE = /^\s*<bash-input>([\s\S]*?)<\/bash-input>\s*$/;
const BASH_OUT_RE = /^\s*<bash-(stdout|stderr)>/;
const INTERRUPTED_RE = /^\s*\[Request interrupted by user(?: for tool use)?\]\s*$/;
const IMAGE_MARKER_RE = /\[Image #\d+\]/g;

function isToolResultOnly(m: AgentMessage): boolean {
  return m.parts.length > 0 && m.parts.every((p) => p.type === 'tool-result');
}

function todosOf(input: unknown): Todo[] {
  const list = input && typeof input === 'object' ? (input as { todos?: unknown }).todos : null;
  if (!Array.isArray(list)) return [];
  return list
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof (t as { content?: unknown }).content === 'string')
    .map((t) => ({
      content: String(t.content),
      status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending',
      activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined,
    }));
}

function questionsOf(input: unknown): string[] {
  const list = input && typeof input === 'object' ? (input as { questions?: unknown }).questions : null;
  if (!Array.isArray(list)) return [];
  return list.map((q) => (q && typeof q === 'object' ? (q as { question?: unknown }).question : null)).filter((q): q is string => typeof q === 'string');
}

/** The user's answer out of AskUserQuestion's result (`… "Question"="Answer" …`). */
export function answerOf(output: string): string {
  const pairs = [...output.matchAll(/"([^"]*)"\s*=\s*"([^"]*)"/g)].map((m) => m[2]);
  if (pairs.length > 0) return pairs.join(' · ');
  return output.replace(/^User has answered your questions?:\s*/i, '').split(/\.\s+You can now/i)[0].trim();
}

/** What a user message shows, or null when it is bookkeeping. */
function userTurn(m: AgentMessage): Turn | null {
  const texts = m.parts.filter((p): p is Extract<AgentPart, { type: 'text' }> => p.type === 'text').map((p) => p.text);
  const images = m.parts.filter((p) => p.type === 'attachment').length;
  const kept: string[] = [];
  for (const t of texts) {
    if (HIDDEN_USER_TEXT.test(t) || BASH_OUT_RE.test(t)) continue;
    if (INTERRUPTED_RE.test(t)) return { kind: 'notice', id: m.id, timestamp: m.timestamp, text: 'Interrupted' };
    const cmd = COMMAND_RE.exec(t);
    if (cmd) {
      const name = cmd[1].startsWith('/') ? cmd[1] : `/${cmd[1]}`;
      const args = (COMMAND_ARGS_RE.exec(t)?.[1] ?? '').trim();
      return { kind: 'user', id: m.id, timestamp: m.timestamp, text: '', images: 0, command: { name, args } };
    }
    const out = STDOUT_RE.exec(t);
    if (out) {
      const body = out[2].trim();
      if (!body) return null;
      return { kind: 'notice', id: m.id, timestamp: m.timestamp, text: body };
    }
    const bash = BASH_INPUT_RE.exec(t);
    if (bash) {
      return { kind: 'user', id: m.id, timestamp: m.timestamp, text: '', images: 0, command: { name: '!', args: bash[1].trim() } };
    }
    kept.push(t);
  }
  const text = kept.join('\n').replace(IMAGE_MARKER_RE, '').trim();
  if (!text && images === 0) return null;
  return { kind: 'user', id: m.id, timestamp: m.timestamp, text, images, command: null };
}

/** Build the turns of a conversation from its messages (chronological). */
export function buildTurns(messages: readonly AgentMessage[]): Turn[] {
  const results = new Map<string, ToolResultPart>();
  for (const m of messages) for (const p of m.parts) if (p.type === 'tool-result') results.set(p.toolId, p);

  const turns: Turn[] = [];
  let current: Extract<Turn, { kind: 'assistant' }> | null = null;

  for (const m of messages) {
    if (m.isSidechain) continue;
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      if (isToolResultOnly(m)) continue;
      const turn = userTurn(m);
      if (!turn) continue;
      turns.push(turn);
      current = null;
      continue;
    }
    // Assistant: everything until the next user turn is one answer.
    if (!current) {
      current = { kind: 'assistant', id: m.id, timestamp: m.timestamp, blocks: [] };
      turns.push(current);
    }
    current.timestamp = m.timestamp;
    const blocks = current.blocks;
    for (let i = 0; i < m.parts.length; i++) {
      const p = m.parts[i];
      const key = `${m.id}:${i}`;
      const last = blocks[blocks.length - 1];
      if (p.type === 'text') {
        if (!p.text.trim()) continue;
        blocks.push({ kind: 'text', key, text: p.text });
      } else if (p.type === 'reasoning') {
        if (!p.text.trim()) continue;
        blocks.push({ kind: 'thinking', key, text: p.text });
      } else if (p.type === 'tool-call') {
        const result = results.get(p.toolId) ?? null;
        if (CONTENT_TOOLS.has(p.name)) {
          if (p.name === 'TodoWrite') {
            const todos = todosOf(p.input);
            if (todos.length > 0) blocks.push({ kind: 'todos', key, todos });
          } else if (p.name === 'ExitPlanMode') {
            const plan = (p.input as { plan?: unknown } | null)?.plan;
            blocks.push({ kind: 'plan', key, plan: typeof plan === 'string' ? plan : '', result });
          } else {
            blocks.push({
              kind: 'question',
              key,
              questions: questionsOf(p.input),
              answer: result && !result.isError ? answerOf(result.output) : null,
              pending: !result,
            });
          }
          continue;
        }
        const step = { call: p, result };
        if (last?.kind === 'steps') last.steps.push(step);
        else blocks.push({ kind: 'steps', key, steps: [step] });
      }
    }
  }
  // An answer with nothing to show (all its parts empty) is no answer.
  return turns.filter((t) => t.kind !== 'assistant' || t.blocks.length > 0);
}

// ---------------------------------------------------------------------------
// Steps, in words
// ---------------------------------------------------------------------------

function str(input: unknown, key: string): string | null {
  if (!input || typeof input !== 'object') return null;
  const v = (input as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function oneLine(s: string, max = 80): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export type StepCategory = 'read' | 'edit' | 'command' | 'search' | 'web' | 'agent' | 'other';

export interface StepLabel {
  category: StepCategory;
  /** "Read", "Edited", "Ran"… (done) / "Reading", "Editing", "Running"… (in progress). */
  verb: string;
  /** What it was done to, shown in mono when it is a path or a command. */
  target: string;
  mono: boolean;
}

/** One step in words: verb + target. */
export function stepLabel(call: ToolCallPart, done: boolean): StepLabel {
  const input = call.input;
  const v = (past: string, present: string) => (done ? past : present);
  switch (call.name) {
    case 'Read':
      return { category: 'read', verb: v('Read', 'Reading'), target: basename(str(input, 'file_path') ?? ''), mono: true };
    case 'NotebookRead':
      return { category: 'read', verb: v('Read', 'Reading'), target: basename(str(input, 'notebook_path') ?? ''), mono: true };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { category: 'edit', verb: v('Edited', 'Editing'), target: basename(str(input, 'file_path') ?? str(input, 'notebook_path') ?? ''), mono: true };
    case 'Write':
      return { category: 'edit', verb: v('Wrote', 'Writing'), target: basename(str(input, 'file_path') ?? ''), mono: true };
    case 'Bash':
    case 'PowerShell':
      return {
        category: 'command',
        verb: v('Ran', 'Running'),
        target: oneLine(str(input, 'description') ?? str(input, 'command') ?? ''),
        mono: !str(input, 'description'),
      };
    case 'BashOutput':
      return { category: 'command', verb: v('Checked', 'Checking'), target: 'background command', mono: false };
    case 'KillShell':
    case 'KillBash':
      return { category: 'command', verb: v('Stopped', 'Stopping'), target: 'background command', mono: false };
    case 'Grep':
      return { category: 'search', verb: v('Searched for', 'Searching for'), target: oneLine(str(input, 'pattern') ?? ''), mono: true };
    case 'Glob':
      return { category: 'search', verb: v('Listed', 'Listing'), target: oneLine(str(input, 'pattern') ?? ''), mono: true };
    case 'LS':
      return { category: 'search', verb: v('Listed', 'Listing'), target: basename(str(input, 'path') ?? ''), mono: true };
    case 'WebFetch':
      return { category: 'web', verb: v('Fetched', 'Fetching'), target: hostOf(str(input, 'url') ?? ''), mono: false };
    case 'WebSearch':
      return { category: 'web', verb: v('Searched the web for', 'Searching the web for'), target: oneLine(str(input, 'query') ?? ''), mono: false };
    case 'Task':
    case 'Agent':
      return { category: 'agent', verb: v('Ran an agent:', 'Running an agent:'), target: oneLine(str(input, 'description') ?? str(input, 'prompt') ?? ''), mono: false };
    case 'Skill':
      return { category: 'other', verb: v('Used the skill', 'Using the skill'), target: str(input, 'skill') ?? str(input, 'command') ?? '', mono: true };
    default: {
      if (call.name.startsWith('mcp__')) {
        const [, server = '', ...tool] = call.name.split('__');
        return { category: 'other', verb: v('Used', 'Using'), target: `${tool.join('__') || call.name} · ${server}`, mono: false };
      }
      const summary = str(input, 'description') ?? str(input, 'file_path') ?? str(input, 'path') ?? str(input, 'query') ?? '';
      return { category: 'other', verb: call.name, target: oneLine(summary), mono: false };
    }
  }
}

/** Lines added / removed by an edit step, or null for other tools. */
export function editStats(call: ToolCallPart): { added: number; removed: number } | null {
  const lines = (s: string | null) => (s ? s.split('\n').length : 0);
  const input = call.input;
  switch (call.name) {
    case 'Edit':
      return { added: lines(str(input, 'new_string')), removed: lines(str(input, 'old_string')) };
    case 'MultiEdit': {
      const edits = input && typeof input === 'object' ? (input as { edits?: unknown }).edits : null;
      if (!Array.isArray(edits)) return null;
      let added = 0;
      let removed = 0;
      for (const e of edits) {
        added += lines(str(e, 'new_string'));
        removed += lines(str(e, 'old_string'));
      }
      return { added, removed };
    }
    case 'Write':
      return { added: lines(str(input, 'content')), removed: 0 };
    default:
      return null;
  }
}

const CATEGORY_WORDS: Record<StepCategory, [string, string, string]> = {
  // verb, singular, plural
  read: ['Read', 'file', 'files'],
  edit: ['Edited', 'file', 'files'],
  command: ['Ran', 'command', 'commands'],
  search: ['Searched', 'time', 'times'],
  web: ['Browsed', 'page', 'pages'],
  agent: ['Ran', 'agent', 'agents'],
  other: ['Used', 'tool', 'tools'],
};

/** "Read 3 files, edited 2 files, ran a command" — the folded header of a run of steps. */
export function stepsSummary(steps: readonly Step[]): string {
  const counts = new Map<StepCategory, number>();
  const distinct = new Map<StepCategory, Set<string>>();
  for (const s of steps) {
    const label = stepLabel(s.call, true);
    counts.set(label.category, (counts.get(label.category) ?? 0) + 1);
    if (!distinct.has(label.category)) distinct.set(label.category, new Set());
    distinct.get(label.category)!.add(label.target || s.call.toolId);
  }
  const phrases: string[] = [];
  for (const [category, count] of counts) {
    const [verb, one, many] = CATEGORY_WORDS[category];
    // Files count once however many times they were read / edited.
    const n = category === 'read' || category === 'edit' ? distinct.get(category)!.size : count;
    const what = n === 1 ? (one === 'time' ? 'once' : `a${/^[aeiou]/.test(one) ? 'n' : ''} ${one}`) : `${n} ${many}`;
    phrases.push(`${verb} ${what}`);
  }
  const text = phrases.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/, ([A-Z])/g, (_, c: string) => `, ${c.toLowerCase()}`);
}
