/**
 * Claude Code's stream-json protocol, as the agent view speaks it (ticket
 * CORT-62) — the protocol the Agent SDK and the Claude desktop app use.
 *
 * CortX starts `claude -p --input-format stream-json --output-format
 * stream-json --verbose --include-partial-messages --permission-prompt-tool
 * stdio` for a pane in GUI mode (`src-tauri/src/agent_gui.rs`). Everything
 * the agent does arrives on its stdout, live, one JSON message per line:
 *
 * - `system` / `init`: the session (id, model, permission mode, tools…);
 * - `stream_event`: the answer as it is being written (text and thinking
 *   deltas, a tool call's input as it is typed);
 * - `assistant`: a finished content block (text, thinking, tool_use) —
 *   several of them for one API message, which are one message here;
 * - `user`: tool results (and the sub-agents' messages, with a
 *   `parent_tool_use_id`);
 * - `result`: the turn is over (duration, cost, error);
 * - `control_request` / `can_use_tool`: a tool wants your permission. The
 *   answer is a `control_response` on stdin.
 *
 * What goes to the agent are `user` messages and `control_request`s
 * (interrupt, set the permission mode…), built by the helpers at the end.
 *
 * This file is pure: `reduce` folds one message into the view's state, and
 * is tested in `streamJson.test.ts`. The state uses the transcript's own
 * shape (`AgentMessage`), so the conversation renderer draws a live session
 * and a resumed one's history the same way.
 */
import type { AgentMessage, AgentPart } from '@/types';

type Json = Record<string, unknown>;

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: unknown;
  toolUseId: string | null;
  /** Rules Claude Code proposes for "always allow" (sent back as `updatedPermissions`). */
  suggestions: unknown[];
  /** Why it asks, when it says (a path outside the workspace…). */
  reason: string | null;
  /** The agent's own wording of the request, when it gives one. */
  title: string | null;
  description: string | null;
  /** No "always allow" for this one. */
  suppressAlways: boolean;
}

export interface TurnResult {
  isError: boolean;
  subtype: string;
  durationMs: number | null;
  costUsd: number | null;
  text: string | null;
}

/** A message being written (stream_event deltas), not finished yet. */
export interface StreamingMessage {
  messageId: string;
  /** Parts by content-block index. */
  blocks: Record<number, AgentPart>;
}

export interface GuiAgentState {
  sessionId: string | null;
  model: string | null;
  permissionMode: string | null;
  slashCommands: string[];
  /** This process's messages (a resumed session's history is kept apart). */
  messages: AgentMessage[];
  streaming: StreamingMessage | null;
  /** How many content blocks of each message id are already final. */
  finalBlocks: Record<string, number>;
  /** A turn is under way: sent, no `result` yet. */
  busy: boolean;
  permissions: PermissionRequest[];
  lastResult: TurnResult | null;
  /** What each running sub-agent (by its Task tool call) is doing now. */
  subagents: Record<string, string>;
  /** Output that is not protocol (stderr, a stray line), latest last. */
  logs: string[];
  /** Ids of our own control requests waiting for their response. */
  pendingControl: Record<string, string>;
  /** The `initialize` handshake was answered: prompts can go. */
  initialized: boolean;
  /** What the agent is busy with besides answering (`compacting`, `retrying`…). */
  activity: string | null;
  /** The models the agent offers (from `initialize`). */
  models: { value: string; displayName: string }[];
}

export function initialState(): GuiAgentState {
  return {
    sessionId: null,
    model: null,
    permissionMode: null,
    slashCommands: [],
    messages: [],
    streaming: null,
    finalBlocks: {},
    busy: false,
    permissions: [],
    lastResult: null,
    subagents: {},
    logs: [],
    pendingControl: {},
    initialized: false,
    activity: null,
    models: [],
  };
}

function obj(v: unknown): Json | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** The text of a tool_result's content (a string, or text blocks). */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const o = obj(b);
        if (!o) return '';
        if (o.type === 'text') return str(o.text) ?? '';
        if (o.type === 'image') return '[image]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return content == null ? '' : JSON.stringify(content);
}

/** Content blocks of an API message, as parts. */
function partsOf(content: unknown, role: 'user' | 'assistant'): AgentPart[] {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  const parts: AgentPart[] = [];
  for (const b of content) {
    const o = obj(b);
    if (!o) continue;
    switch (o.type) {
      case 'text': {
        const t = str(o.text) ?? '';
        if (t.trim()) parts.push({ type: 'text', text: t });
        break;
      }
      case 'thinking': {
        const t = str(o.thinking) ?? '';
        if (t.trim()) parts.push({ type: 'reasoning', text: t });
        break;
      }
      case 'tool_use':
        parts.push({ type: 'tool-call', toolId: str(o.id) ?? '', name: str(o.name) ?? 'tool', input: o.input ?? null });
        break;
      case 'tool_result':
        parts.push({
          type: 'tool-result',
          toolId: str(o.tool_use_id) ?? '',
          output: resultText(o.content),
          isError: o.is_error === true,
        });
        break;
      case 'image':
        if (role === 'user') parts.push({ type: 'attachment', description: 'image' });
        break;
    }
  }
  return parts;
}

const LOG_LIMIT = 200;

function withLog(state: GuiAgentState, line: string): GuiAgentState {
  const logs = [...state.logs, line];
  return { ...state, logs: logs.length > LOG_LIMIT ? logs.slice(-LOG_LIMIT) : logs };
}

/** A line the agent wrote that is not JSON (or on stderr). */
export function reduceText(state: GuiAgentState, text: string): GuiAgentState {
  return withLog(state, text);
}

/** A short description of what a sub-agent's message is doing, for its Task row. */
function subagentActivity(parts: AgentPart[]): string | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === 'tool-call') {
      const input = obj(p.input);
      const target = str(input?.description) ?? str(input?.file_path) ?? str(input?.pattern) ?? str(input?.command) ?? '';
      return target ? `${p.name} · ${target.split(/[\\/]/).pop()}` : p.name;
    }
    if (p.type === 'text' && p.text.trim()) return p.text.trim().split('\n')[0].slice(0, 80);
  }
  return null;
}

/** Fold one stdout message into the state. */
export function reduce(state: GuiAgentState, message: Json, now: number = Date.now()): GuiAgentState {
  const type = str(message.type);
  const parent = str(message.parent_tool_use_id);

  switch (type) {
    case 'system': {
      const subtype = str(message.subtype);
      if (subtype === 'init') {
        return {
          ...state,
          sessionId: str(message.session_id) ?? state.sessionId,
          model: str(message.model) ?? state.model,
          permissionMode: str(message.permissionMode) ?? state.permissionMode,
          slashCommands: Array.isArray(message.slash_commands)
            ? message.slash_commands.filter((c): c is string => typeof c === 'string')
            : state.slashCommands,
        };
      }
      if (subtype === 'compact_boundary') {
        return { ...state, activity: null, messages: [...state.messages, systemNote(`compact:${now}`, 'Conversation compacted', now)] };
      }
      if (subtype === 'status') {
        const status = str(message.status);
        return {
          ...state,
          activity: status === 'compacting' ? 'Compacting the conversation' : null,
          permissionMode: str(message.permissionMode) ?? state.permissionMode,
        };
      }
      if (subtype === 'session_state_changed') {
        const s2 = str(message.state);
        if (s2 === 'idle') return { ...state, busy: false, streaming: null };
        if (s2 === 'running' || s2 === 'requires_action') return { ...state, busy: true };
        return state;
      }
      if (subtype === 'api_retry') {
        const attempt = typeof message.attempt === 'number' ? message.attempt : null;
        const max = typeof message.max_retries === 'number' ? message.max_retries : null;
        return { ...state, activity: `Retrying${attempt !== null ? ` (${attempt}${max !== null ? `/${max}` : ''})` : ''}` };
      }
      if (subtype === 'local_command_output') {
        const content = str(message.content);
        return content ? { ...state, messages: [...state.messages, systemNote(str(message.uuid) ?? `out:${now}`, content, now)] } : state;
      }
      return state;
    }

    case 'stream_event': {
      if (parent) return state; // a sub-agent's deltas: its Task row says enough
      const event = obj(message.event);
      if (!event) return state;
      return reduceStreamEvent(state, event);
    }

    case 'assistant': {
      const msg = obj(message.message);
      if (!msg) return state;
      const parts = partsOf(msg.content, 'assistant');
      if (parent) {
        const activity = subagentActivity(parts);
        return activity ? { ...state, subagents: { ...state.subagents, [parent]: activity } } : state;
      }
      const id = str(msg.id) ?? str(message.uuid) ?? `assistant-${now}`;
      const finalCount = (state.finalBlocks[id] ?? 0) + (Array.isArray(msg.content) ? msg.content.length : 1);
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant' && last.id === id) {
        messages[messages.length - 1] = { ...last, parts: [...last.parts, ...parts], timestamp: new Date(now).toISOString() };
      } else {
        messages.push({ id, role: 'assistant', timestamp: new Date(now).toISOString(), parts, isSidechain: false });
      }
      return {
        ...state,
        sessionId: str(message.session_id) ?? state.sessionId,
        messages,
        finalBlocks: { ...state.finalBlocks, [id]: finalCount },
        busy: true,
      };
    }

    case 'user': {
      const msg = obj(message.message);
      if (!msg) return state;
      const parts = partsOf(msg.content, 'user');
      if (parent) return state;
      if (parts.length === 0) return state;
      // A tool result ends the sub-agent it belonged to.
      let subagents = state.subagents;
      for (const p of parts) {
        if (p.type === 'tool-result' && subagents[p.toolId]) {
          subagents = { ...subagents };
          delete subagents[p.toolId];
        }
      }
      const id = str(message.uuid) ?? `user-${now}-${state.messages.length}`;
      return {
        ...state,
        subagents,
        messages: [...state.messages, { id, role: 'user', timestamp: new Date(now).toISOString(), parts, isSidechain: false }],
      };
    }

    case 'result': {
      const result: TurnResult = {
        isError: message.is_error === true,
        subtype: str(message.subtype) ?? 'success',
        durationMs: typeof message.duration_ms === 'number' ? message.duration_ms : null,
        costUsd: typeof message.total_cost_usd === 'number' ? message.total_cost_usd : null,
        text: str(message.result),
      };
      return {
        ...state,
        sessionId: str(message.session_id) ?? state.sessionId,
        busy: false,
        streaming: null,
        permissions: [],
        subagents: {},
        activity: null,
        lastResult: result,
      };
    }

    case 'control_request': {
      const requestId = str(message.request_id);
      const request = obj(message.request);
      if (!requestId || !request) return state;
      if (request.subtype === 'can_use_tool') {
        const perm: PermissionRequest = {
          requestId,
          toolName: str(request.tool_name) ?? 'tool',
          input: request.input ?? null,
          toolUseId: str(request.tool_use_id),
          suggestions: Array.isArray(request.permission_suggestions) ? request.permission_suggestions : [],
          reason: str(request.decision_reason) ?? str(request.blocked_path),
          title: str(request.title),
          description: str(request.description),
          suppressAlways: request.suppress_always_allow_rule === true,
        };
        return { ...state, permissions: [...state.permissions.filter((p) => p.requestId !== requestId), perm] };
      }
      return state;
    }

    case 'control_cancel_request': {
      const requestId = str(message.request_id);
      return requestId ? { ...state, permissions: state.permissions.filter((p) => p.requestId !== requestId) } : state;
    }

    case 'control_response': {
      const response = obj(message.response);
      const requestId = str(response?.request_id);
      if (!requestId || !(requestId in state.pendingControl)) return state;
      const pendingControl = { ...state.pendingControl };
      const subtype = pendingControl[requestId];
      delete pendingControl[requestId];
      let next: GuiAgentState = { ...state, pendingControl };
      const body = obj(response?.response);
      if (response?.subtype === 'error') next = withLog(next, `Control request ${subtype} failed: ${str(response.error) ?? ''}`);
      if (subtype === 'initialize') {
        next = { ...next, initialized: true };
        if (body && Array.isArray(body.commands)) {
          const names = body.commands.map((c) => str(obj(c)?.name)).filter((n): n is string => !!n);
          if (names.length > 0) next = { ...next, slashCommands: names };
        }
        if (body && Array.isArray(body.models)) {
          const models = body.models
            .map((m) => obj(m))
            .filter((m): m is Json => !!m && typeof m.value === 'string')
            .map((m) => ({ value: m.value as string, displayName: str(m.displayName) ?? (m.value as string) }));
          next = { ...next, models };
        }
      }
      return next;
    }

    default:
      return state;
  }
}

function systemNote(id: string, text: string, now: number): AgentMessage {
  return { id, role: 'system', timestamp: new Date(now).toISOString(), parts: [{ type: 'text', text }], isSidechain: false };
}

function reduceStreamEvent(state: GuiAgentState, event: Json): GuiAgentState {
  switch (event.type) {
    case 'message_start': {
      const id = str(obj(event.message)?.id) ?? `stream-${Object.keys(state.finalBlocks).length}`;
      return { ...state, busy: true, streaming: { messageId: id, blocks: {} } };
    }
    case 'content_block_start': {
      if (!state.streaming || typeof event.index !== 'number') return state;
      const block = obj(event.content_block);
      let part: AgentPart | null = null;
      if (block?.type === 'text') part = { type: 'text', text: str(block.text) ?? '' };
      else if (block?.type === 'thinking') part = { type: 'reasoning', text: str(block.thinking) ?? '' };
      else if (block?.type === 'tool_use') part = { type: 'tool-call', toolId: str(block.id) ?? '', name: str(block.name) ?? 'tool', input: null };
      if (!part) return state;
      return { ...state, streaming: { ...state.streaming, blocks: { ...state.streaming.blocks, [event.index]: part } } };
    }
    case 'content_block_delta': {
      if (!state.streaming || typeof event.index !== 'number') return state;
      const delta = obj(event.delta);
      const current = state.streaming.blocks[event.index];
      if (!delta || !current) return state;
      let next: AgentPart = current;
      if (delta.type === 'text_delta' && current.type === 'text') next = { ...current, text: current.text + (str(delta.text) ?? '') };
      else if (delta.type === 'thinking_delta' && current.type === 'reasoning')
        next = { ...current, text: current.text + (str(delta.thinking) ?? '') };
      else return state;
      return { ...state, streaming: { ...state.streaming, blocks: { ...state.streaming.blocks, [event.index]: next } } };
    }
    case 'message_stop':
      return { ...state, streaming: null };
    default:
      return state;
  }
}

/**
 * The messages to draw: the finished ones, then what is being written —
 * minus the blocks of it that already arrived finished (Claude Code sends
 * each block whole as soon as it is done, before the message ends).
 */
export function visibleMessages(state: GuiAgentState): AgentMessage[] {
  const s = state.streaming;
  if (!s) return state.messages;
  const done = state.finalBlocks[s.messageId] ?? 0;
  const live = Object.entries(s.blocks)
    .map(([i, p]) => [Number(i), p] as const)
    .filter(([i]) => i >= done)
    .sort((a, b) => a[0] - b[0])
    .map(([, p]) => p)
    .filter((p) => p.type !== 'text' || p.text.length > 0);
  if (live.length === 0) return state.messages;
  const messages = [...state.messages];
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant' && last.id === s.messageId) {
    messages[messages.length - 1] = { ...last, parts: [...last.parts, ...live] };
  } else {
    messages.push({ id: s.messageId, role: 'assistant', timestamp: new Date().toISOString(), parts: live, isSidechain: false });
  }
  return messages;
}

// ---------------------------------------------------------------------------
// What goes to the agent
// ---------------------------------------------------------------------------

let requestSeq = 0;
export function newRequestId(): string {
  requestSeq += 1;
  return `cortx-${Date.now().toString(36)}-${requestSeq}`;
}

export type OutgoingContent = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

/** A prompt of yours. */
export function userMessage(content: OutgoingContent[], sessionId: string | null): Json {
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    session_id: sessionId ?? '',
  };
}

/** One of our control requests (`interrupt`, `initialize`, `set_permission_mode`…). */
export function controlRequest(requestId: string, request: Json): Json {
  return { type: 'control_request', request_id: requestId, request };
}

/** Allow a tool call (with what it was asked with, or an edited input — AskUserQuestion's answers). */
export function allowResponse(
  req: PermissionRequest,
  options: { updatedInput?: unknown; always?: boolean; updatedPermissions?: unknown[] } = {}
): Json {
  const response: Json = { behavior: 'allow', updatedInput: options.updatedInput ?? req.input ?? {} };
  const updates = [
    ...(options.always && !req.suppressAlways ? req.suggestions : []),
    ...(options.updatedPermissions ?? []),
  ];
  if (updates.length > 0) response.updatedPermissions = updates;
  if (req.toolUseId) response.toolUseID = req.toolUseId;
  return { type: 'control_response', response: { subtype: 'success', request_id: req.requestId, response } };
}

/** Refuse a tool call; `interrupt` also stops the turn. */
export function denyResponse(req: PermissionRequest, message: string, interrupt = false): Json {
  const response: Json = { behavior: 'deny', message };
  if (interrupt) response.interrupt = true;
  if (req.toolUseId) response.toolUseID = req.toolUseId;
  return { type: 'control_response', response: { subtype: 'success', request_id: req.requestId, response } };
}

/**
 * AskUserQuestion's answer: the questions as asked, and for each question
 * its answer (an option's label, labels for a multi-select, or free text).
 */
export function questionAnswers(req: PermissionRequest, answers: Record<string, string | string[]>): unknown {
  const input = obj(req.input) ?? {};
  return { ...input, answers };
}

/** "Approve the plan, and accept the edits that follow" — the setMode update of ExitPlanMode. */
export function setModeUpdate(mode: string): Json {
  return { type: 'setMode', mode, destination: 'session' };
}

/** Our own prompt, shown at once (the agent does not echo it back). */
export function withUserPrompt(state: GuiAgentState, text: string, images: number, now: number = Date.now()): GuiAgentState {
  const parts: AgentPart[] = [];
  if (text.trim()) parts.push({ type: 'text', text });
  for (let i = 0; i < images; i++) parts.push({ type: 'attachment', description: 'image' });
  const message: AgentMessage = { id: `prompt-${now}-${state.messages.length}`, role: 'user', timestamp: new Date(now).toISOString(), parts, isSidechain: false };
  return { ...state, busy: true, lastResult: null, messages: [...state.messages, message] };
}

/** Remember a control request of ours, to read its response. */
export function withPendingControl(state: GuiAgentState, requestId: string, subtype: string): GuiAgentState {
  return { ...state, pendingControl: { ...state.pendingControl, [requestId]: subtype } };
}
