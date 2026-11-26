/**
 * The agents of the panes in GUI mode (ticket CORT-62): one Claude Code
 * process per pane, started by CortX in stream-json mode
 * (`src-tauri/src/agent_gui.rs`), and what it said so far (`streamJson.ts`).
 *
 * The process is started on demand — when the pane is switched to GUI mode,
 * or at the first prompt of a pane restored in GUI mode — and resumes the
 * pane's session (`LeafNode.agentSession`) when it has one. A resumed
 * session's past is read once from its transcript, to be shown above what
 * the process says live; nothing follows the file.
 */
import { create } from 'zustand';
import { readFile } from '@tauri-apps/plugin-fs';
import { toast } from 'sonner';
import {
  agentGuiRunning,
  agentGuiSend,
  agentGuiStart,
  agentGuiStop,
  getAgentTranscript,
  onAgentGuiEvent,
  type AgentGuiEventPayload,
} from '@/lib/tauri';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { collectLeaves } from '@/lib/terminalLayout';
import type { AgentImage, AgentMessage } from '@/types';
import {
  allowResponse,
  controlRequest,
  denyResponse,
  initialState,
  newRequestId,
  reduce,
  reduceText,
  userMessage,
  withPendingControl,
  withUserPrompt,
  type GuiAgentState,
  type OutgoingContent,
  type PermissionRequest,
} from './streamJson';

export type PaneAgentStatus = 'idle' | 'starting' | 'running' | 'exited';

export interface PaneAgent {
  key: string;
  status: PaneAgentStatus;
  generation: number | null;
  cwd: string;
  /** The session to resume at the next start (known from the leaf, then from `init`). */
  resumeId: string | null;
  /** A resumed session's past, read once from its transcript. */
  history: AgentMessage[];
  historyState: 'none' | 'loading' | 'loaded' | 'failed';
  state: GuiAgentState;
  exitCode: number | null;
  /** Why it could not start / stopped, for the view. */
  error: string | null;
  /** When the current turn started (epoch ms), for the live timer. */
  turnStartedAt: number | null;
}

interface AgentGuiStore {
  panes: Record<string, PaneAgent>;
  patch: (key: string, fn: (p: PaneAgent) => PaneAgent) => void;
}

export const useAgentGuiStore = create<AgentGuiStore>()((set) => ({
  panes: {},
  patch: (key, fn) =>
    set((s) => {
      const p = s.panes[key];
      return p ? { panes: { ...s.panes, [key]: fn(p) } } : s;
    }),
}));

function guiCommand(): string {
  return (useAppStore.getState().settings?.terminal?.agentGuiCommand ?? 'claude').trim() || 'claude';
}

/** The permission mode a new agent starts in; null = the command's own. */
function guiPermissionMode(): string | null {
  return useAppStore.getState().settings?.terminal?.agentGuiPermissionMode ?? null;
}

// ---------------------------------------------------------------------------
// Events from the processes
// ---------------------------------------------------------------------------

let listening = false;

function ensureListening() {
  if (listening) return;
  listening = true;
  void onAgentGuiEvent(onEvent).catch(() => {
    listening = false;
  });
  // A pane closed, or no longer in GUI mode: its agent goes with it.
  useTerminalLayoutStore.subscribe((s) => {
    const panes = useAgentGuiStore.getState().panes;
    const keys = Object.keys(panes);
    if (keys.length === 0) return;
    const gui = new Set<string>();
    for (const tab of s.doc.window.tabs) for (const leaf of collectLeaves(tab.layout)) if (leaf.view === 'agent') gui.add(leaf.terminalId);
    for (const key of keys) {
      if (gui.has(key)) continue;
      if (panes[key].status === 'running' || panes[key].status === 'starting') void agentGuiStop(key).catch(() => {});
      forgetPaneAgent(key);
    }
  });
}

function onEvent(payload: AgentGuiEventPayload) {
  const store = useAgentGuiStore.getState();
  const pane = store.panes[payload.key];
  if (!pane || pane.generation !== payload.generation) return;
  if (payload.exited) {
    store.patch(payload.key, (p) => ({
      ...p,
      status: 'exited',
      generation: null,
      exitCode: payload.exitCode ?? null,
      turnStartedAt: null,
      state: { ...p.state, busy: false, streaming: null, permissions: [] },
      error:
        payload.exitCode && payload.exitCode !== 0
          ? p.state.logs.slice(-3).join('\n') || `Claude Code stopped (exit ${payload.exitCode})`
          : p.error,
    }));
    return;
  }
  if (payload.text !== undefined) {
    store.patch(payload.key, (p) => ({ ...p, state: reduceText(p.state, payload.text!) }));
    return;
  }
  if (!payload.message) return;
  const before = pane.state;
  const next = reduce(before, payload.message);
  store.patch(payload.key, (p) => ({
    ...p,
    status: 'running',
    state: next,
    resumeId: next.sessionId ?? p.resumeId,
    turnStartedAt: next.busy ? p.turnStartedAt ?? Date.now() : null,
  }));
  // The session is known: the pane remembers it (restore, switch to TUI).
  if (next.sessionId && next.sessionId !== before.sessionId) {
    useTerminalLayoutStore.getState().setLeafView(payload.key, 'agent', next.sessionId);
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** The pane's entry, created when first seen. Loads a resumed session's past once. */
export function ensurePaneAgent(key: string, cwd: string, sessionId: string | null) {
  ensureListening();
  const store = useAgentGuiStore.getState();
  if (!store.panes[key]) {
    useAgentGuiStore.setState((s) => ({
      panes: {
        ...s.panes,
        [key]: {
          key,
          status: 'idle',
          generation: null,
          cwd,
          resumeId: sessionId,
          history: [],
          historyState: 'none',
          state: initialState(),
          exitCode: null,
          error: null,
          turnStartedAt: null,
        },
      },
    }));
    // Back after a reload of the window: the process may still be up.
    void agentGuiRunning(key)
      .then((generation) => {
        if (generation !== null) useAgentGuiStore.getState().patch(key, (p) => ({ ...p, generation, status: 'running' }));
      })
      .catch(() => {});
  }
  const pane = useAgentGuiStore.getState().panes[key];
  if (sessionId && pane.historyState === 'none' && pane.state.messages.length === 0) {
    useAgentGuiStore.getState().patch(key, (p) => ({ ...p, historyState: 'loading' }));
    getAgentTranscript(sessionId, { end: null, limit: 400 })
      .then((page) => useAgentGuiStore.getState().patch(key, (p) => ({ ...p, history: page.messages, historyState: 'loaded' })))
      .catch(() => useAgentGuiStore.getState().patch(key, (p) => ({ ...p, historyState: 'failed' })));
  }
}

/** Start (or restart) the pane's agent, resuming its session if it has one. */
export async function startPaneAgent(key: string): Promise<boolean> {
  const pane = useAgentGuiStore.getState().panes[key];
  if (!pane) return false;
  if (pane.status === 'running' || pane.status === 'starting') return true;
  const store = useAgentGuiStore.getState();
  store.patch(key, (p) => ({ ...p, status: 'starting', error: null, exitCode: null }));
  try {
    const generation = await agentGuiStart(key, pane.cwd, guiCommand(), pane.resumeId, guiPermissionMode());
    store.patch(key, (p) => ({ ...p, generation, status: 'running' }));
    // The SDK's handshake: the agent answers with its commands, models…
    const id = newRequestId();
    store.patch(key, (p) => ({ ...p, state: withPendingControl(p.state, id, 'initialize') }));
    await agentGuiSend(key, controlRequest(id, { subtype: 'initialize', hooks: null }));
    // As the SDK does: the first prompt waits for the handshake's answer.
    await waitFor(key, (p) => p.state.initialized || p.status === 'exited', INIT_TIMEOUT_MS);
    return useAgentGuiStore.getState().panes[key]?.status === 'running';
  } catch (error) {
    store.patch(key, (p) => ({ ...p, status: 'exited', generation: null, error: String(error) }));
    return false;
  }
}

const INIT_TIMEOUT_MS = 30_000;

/** Resolves once the pane's entry satisfies `ok`, or after `timeoutMs`. */
function waitFor(key: string, ok: (p: PaneAgent) => boolean, timeoutMs: number): Promise<void> {
  const check = () => {
    const p = useAgentGuiStore.getState().panes[key];
    return !p || ok(p);
  };
  if (check()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      unsubscribe();
      window.clearTimeout(timer);
      resolve();
    };
    const unsubscribe = useAgentGuiStore.subscribe(() => {
      if (check()) done();
    });
    const timer = window.setTimeout(done, timeoutMs);
  });
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export interface PromptInput {
  text: string;
  images: string[];
  files: string[];
}

/** Send a prompt (starting the agent first when it is not running). */
export async function sendPanePrompt(key: string, input: PromptInput): Promise<boolean> {
  const pane = useAgentGuiStore.getState().panes[key];
  if (!pane) return false;
  if (pane.status !== 'running' && !(await startPaneAgent(key))) return false;

  const content: OutgoingContent[] = [];
  const unreadable: string[] = [];
  const shown: AgentImage[] = [];
  for (const path of input.images) {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const mediaType = IMAGE_TYPES[ext];
    try {
      if (!mediaType) throw new Error('not an image');
      const bytes = await readFile(path);
      const data = toBase64(bytes);
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
      shown.push({ mediaType, data });
    } catch {
      unreadable.push(path);
    }
  }
  // Files (and images that could not be read here) as paths: the agent reads them.
  const paths = [...input.files, ...unreadable].map((p) => (/\s/.test(p) ? `"${p}"` : p));
  const text = [input.text.trim(), paths.join(' ')].filter(Boolean).join('\n\n');
  if (text) content.unshift({ type: 'text', text });
  if (content.length === 0) return false;

  const store = useAgentGuiStore.getState();
  store.patch(key, (p) => ({
    ...p,
    state: withUserPrompt(p.state, input.text.trim() || paths.join(' '), shown),
    turnStartedAt: p.turnStartedAt ?? Date.now(),
  }));
  try {
    await agentGuiSend(key, userMessage(content, useAgentGuiStore.getState().panes[key]?.state.sessionId ?? null));
    return true;
  } catch (error) {
    toast.error('The prompt could not be sent', { description: String(error) });
    return false;
  }
}

/** Stop the current turn (the SDK's interrupt). */
export async function interruptPaneAgent(key: string) {
  const pane = useAgentGuiStore.getState().panes[key];
  if (!pane || pane.status !== 'running') return;
  const id = newRequestId();
  useAgentGuiStore.getState().patch(key, (p) => ({ ...p, state: withPendingControl(p.state, id, 'interrupt') }));
  await agentGuiSend(key, controlRequest(id, { subtype: 'interrupt' })).catch(() => {});
}

/** Change the permission mode (default, acceptEdits, plan, bypassPermissions). */
export async function setPanePermissionMode(key: string, mode: string) {
  const id = newRequestId();
  useAgentGuiStore.getState().patch(key, (p) => ({
    ...p,
    state: { ...withPendingControl(p.state, id, 'set_permission_mode'), permissionMode: mode },
  }));
  await agentGuiSend(key, controlRequest(id, { subtype: 'set_permission_mode', mode })).catch(() => {});
}

export type PermissionDecision =
  | { kind: 'allow'; always?: boolean; updatedInput?: unknown; updatedPermissions?: unknown[] }
  | { kind: 'deny'; message?: string; interrupt?: boolean };

/** Answer a permission request (Allow / Always allow / Deny, an AskUserQuestion's answers). */
export async function answerPermission(key: string, request: PermissionRequest, decision: PermissionDecision) {
  const message =
    decision.kind === 'allow'
      ? allowResponse(request, {
          always: decision.always,
          updatedInput: decision.updatedInput,
          updatedPermissions: decision.updatedPermissions,
        })
      : denyResponse(request, decision.message ?? 'The user refused this.', decision.interrupt ?? false);
  useAgentGuiStore.getState().patch(key, (p) => ({
    ...p,
    state: { ...p.state, permissions: p.state.permissions.filter((r) => r.requestId !== request.requestId) },
  }));
  try {
    await agentGuiSend(key, message);
  } catch (error) {
    toast.error('Could not answer the agent', { description: String(error) });
  }
}

/** Stop the pane's agent (switch to the TUI, close the pane). Its entry stays until `forgetPaneAgent`. */
export async function stopPaneAgent(key: string) {
  useAgentGuiStore.getState().patch(key, (p) => ({
    ...p,
    status: 'idle',
    generation: null,
    turnStartedAt: null,
    state: { ...p.state, busy: false, streaming: null, permissions: [] },
  }));
  await agentGuiStop(key).catch(() => {});
}

export function forgetPaneAgent(key: string) {
  useAgentGuiStore.setState((s) => {
    if (!s.panes[key]) return s;
    const panes = { ...s.panes };
    delete panes[key];
    return { panes };
  });
}
