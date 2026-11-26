/**
 * What the side panel of the agent view shows about a session (ticket
 * CORT-62), the way the Claude desktop app's side panel does: the to-do
 * list, the sub-agents, the background commands, the files changed, the
 * images, the web sources — all read off the conversation's messages.
 *
 * Pure, tested in `sessionPanel.test.ts`.
 */
import type { AgentImage, AgentMessage, AgentPart } from '@/types';
import { basename, editStats, type Todo } from './conversationModel.ts';

type ToolCall = Extract<AgentPart, { type: 'tool-call' }>;
type ToolResult = Extract<AgentPart, { type: 'tool-result' }>;

export type ItemStatus = 'running' | 'done' | 'failed';

export interface SubagentItem {
  id: string;
  description: string;
  kind: string | null;
  status: ItemStatus;
}

export interface BackgroundItem {
  id: string;
  command: string;
  description: string | null;
  /** The shell id Claude Code gave it, to match a later kill. */
  shellId: string | null;
  status: 'running' | 'stopped' | 'failed';
}

export interface ChangedFile {
  path: string;
  name: string;
  added: number;
  removed: number;
  /** Written from scratch (Write) rather than edited. */
  created: boolean;
  edits: number;
}

export interface WebSource {
  kind: 'page' | 'search';
  label: string;
  url: string | null;
}

export interface PanelImage {
  image: AgentImage;
  label: string;
}

export interface SessionPanelData {
  todos: Todo[];
  subagents: SubagentItem[];
  background: BackgroundItem[];
  changes: ChangedFile[];
  images: PanelImage[];
  sources: WebSource[];
}

function str(input: unknown, key: string): string | null {
  if (!input || typeof input !== 'object') return null;
  const v = (input as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function statusOf(result: ToolResult | undefined): ItemStatus {
  if (!result) return 'running';
  return result.isError ? 'failed' : 'done';
}

/** Everything the panel lists, from the messages of the conversation. */
export function sessionPanel(messages: readonly AgentMessage[], live: boolean): SessionPanelData {
  const results = new Map<string, ToolResult>();
  for (const m of messages) for (const p of m.parts) if (p.type === 'tool-result') results.set(p.toolId, p);

  let todos: Todo[] = [];
  const subagents: SubagentItem[] = [];
  const background: BackgroundItem[] = [];
  const changes = new Map<string, ChangedFile>();
  const images: PanelImage[] = [];
  const sources: WebSource[] = [];
  const killed = new Set<string>();

  for (const m of messages) {
    if (m.isSidechain) continue;
    for (const p of m.parts) {
      if (p.type === 'image' && m.role === 'user') images.push({ image: { mediaType: p.mediaType, data: p.data }, label: 'Your image' });
      if (p.type === 'tool-result' && p.images) for (const image of p.images) images.push({ image, label: p.name ?? 'Tool result' });
      if (p.type !== 'tool-call') continue;
      const call: ToolCall = p;
      const result = results.get(call.toolId);
      switch (call.name) {
        case 'TodoWrite': {
          const list = (call.input as { todos?: unknown } | null)?.todos;
          if (Array.isArray(list)) {
            todos = list
              .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof (t as { content?: unknown }).content === 'string')
              .map((t) => ({
                content: String(t.content),
                status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending',
                activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined,
              }));
          }
          break;
        }
        case 'Task':
        case 'Agent': {
          const status = statusOf(result);
          subagents.push({
            id: call.toolId,
            description: str(call.input, 'description') ?? str(call.input, 'prompt')?.slice(0, 80) ?? 'Sub-agent',
            kind: str(call.input, 'subagent_type'),
            // A turn that ended without its result: interrupted, not running.
            status: status === 'running' && !live ? 'failed' : status,
          });
          break;
        }
        case 'Bash':
        case 'PowerShell': {
          if ((call.input as { run_in_background?: unknown } | null)?.run_in_background !== true) break;
          const shellId = result ? /ID:\s*([\w-]+)/.exec(result.output)?.[1] ?? null : null;
          background.push({
            id: call.toolId,
            command: str(call.input, 'command') ?? '',
            description: str(call.input, 'description'),
            shellId,
            status: result?.isError ? 'failed' : 'running',
          });
          break;
        }
        case 'KillShell':
        case 'KillBash': {
          const id = str(call.input, 'shell_id') ?? str(call.input, 'bash_id');
          if (id) killed.add(id);
          break;
        }
        case 'Edit':
        case 'MultiEdit':
        case 'Write':
        case 'NotebookEdit': {
          if (result?.isError) break;
          const path = str(call.input, 'file_path') ?? str(call.input, 'notebook_path');
          if (!path) break;
          const stats = editStats(call) ?? { added: 0, removed: 0 };
          const prev = changes.get(path);
          changes.set(path, {
            path,
            name: basename(path),
            added: (prev?.added ?? 0) + stats.added,
            removed: (prev?.removed ?? 0) + stats.removed,
            created: prev ? prev.created : call.name === 'Write',
            edits: (prev?.edits ?? 0) + 1,
          });
          break;
        }
        case 'WebFetch': {
          const url = str(call.input, 'url');
          if (url && !sources.some((s) => s.url === url)) {
            let label = url;
            try {
              const u = new URL(url);
              label = `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
            } catch {
              /* keep the raw url */
            }
            sources.push({ kind: 'page', label, url });
          }
          break;
        }
        case 'WebSearch': {
          const query = str(call.input, 'query');
          if (query) sources.push({ kind: 'search', label: query, url: null });
          break;
        }
      }
    }
  }

  for (const b of background) if (b.shellId && killed.has(b.shellId)) b.status = 'stopped';

  return {
    todos,
    subagents,
    background,
    changes: [...changes.values()],
    images,
    sources,
  };
}

/** Context used by the conversation, from the last answer's usage. */
export function contextUsed(usage: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | null): number {
  if (!usage) return 0;
  return (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
}
