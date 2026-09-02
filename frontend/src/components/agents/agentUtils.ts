import type { AgentProvider, AgentSession, AgentState, Project, TagDefinition } from '@/types';

// ---------------------------------------------------------------------------
// Labels & ordering
// ---------------------------------------------------------------------------

/** Sort weight: running > waiting > unknown > stopped. */
export const STATE_RANK: Record<AgentState, number> = {
  running: 0,
  waiting: 1,
  unknown: 2,
  stopped: 3,
};

export const STATE_LABEL: Record<AgentState, string> = {
  running: 'Running',
  waiting: 'Waiting for you',
  stopped: 'Stopped',
  unknown: 'Unknown',
};

export const PROVIDER_LABEL: Record<AgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

export const ALL_PROVIDERS: AgentProvider[] = ['claude-code', 'codex'];
export const ALL_STATES: AgentState[] = ['running', 'waiting', 'stopped', 'unknown'];

export function isLive(session: AgentSession): boolean {
  return session.state === 'running' || session.state === 'waiting';
}

/** Pinned first, then by state, then most recent activity. */
export function sortSessions(sessions: AgentSession[]): AgentSession[] {
  return sessions.slice().sort((a, b) => {
    if (a.annotations.pinned !== b.annotations.pinned) return a.annotations.pinned ? -1 : 1;
    const rank = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (rank !== 0) return rank;
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  });
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Last path segment of a cwd ("C:\\dev\\CortX" -> "CortX"). */
export function folderName(cwd: string): string {
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || cwd;
}

/** Case/separator-insensitive key for bucketing sessions by folder. */
export function cwdKey(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export interface ProjectLabel {
  name: string;
  /** False when the label is just the cwd folder (no CortX project). */
  isProject: boolean;
}

export function projectLabel(session: AgentSession, projects: Project[]): ProjectLabel {
  const project = session.projectId ? projects.find((p) => p.id === session.projectId) : undefined;
  if (project) return { name: project.name, isProject: true };
  return { name: folderName(session.cwd), isProject: false };
}

export type LastExchangeKind = 'tool' | 'waiting' | 'prompt' | 'assistant' | 'none';

export interface LastExchange {
  kind: LastExchangeKind;
  text: string;
}

/** The one-line "what is happening" summary shown on every row. */
export function lastExchange(session: AgentSession): LastExchange {
  const prompt = session.lastUserPrompt?.trim();
  const reply = session.lastAssistantText?.trim();
  if (session.state === 'running' && session.currentTool) {
    return { kind: 'tool', text: `Running ${session.currentTool}` };
  }
  if (session.state === 'waiting') {
    return { kind: 'waiting', text: reply || 'Waiting for your reply' };
  }
  if (prompt) return { kind: 'prompt', text: prompt };
  if (reply) return { kind: 'assistant', text: reply };
  return { kind: 'none', text: '' };
}

export function resumeVerb(provider: AgentProvider): string {
  return provider === 'codex' ? 'codex resume' : 'claude --resume';
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface AgentFilterState {
  providers: Set<AgentProvider>;
  states: Set<AgentState>;
  tags: Set<string>;
  showHidden: boolean;
}

export function defaultFilters(): AgentFilterState {
  return { providers: new Set(), states: new Set(), tags: new Set(), showHidden: false };
}

export function activeFilterCount(f: AgentFilterState): number {
  return (
    (f.providers.size > 0 ? 1 : 0) +
    (f.states.size > 0 ? 1 : 0) +
    (f.tags.size > 0 ? 1 : 0) +
    (f.showHidden ? 1 : 0)
  );
}

export function filterSessions(
  sessions: AgentSession[],
  filters: AgentFilterState,
  search: string,
  projects: Project[],
): AgentSession[] {
  let result = sessions;
  if (filters.providers.size > 0) result = result.filter((s) => filters.providers.has(s.provider));
  if (filters.states.size > 0) result = result.filter((s) => filters.states.has(s.state));
  if (filters.tags.size > 0) {
    result = result.filter((s) => s.annotations.tags.some((t) => filters.tags.has(t)));
  }
  const q = search.trim().toLowerCase();
  if (q) {
    result = result.filter((s) => {
      const label = projectLabel(s, projects).name;
      return (
        s.title.toLowerCase().includes(q) ||
        s.cwd.toLowerCase().includes(q) ||
        (s.lastUserPrompt?.toLowerCase().includes(q) ?? false) ||
        (s.gitBranch?.toLowerCase().includes(q) ?? false) ||
        label.toLowerCase().includes(q) ||
        s.ticketRefs.some((r) => r.toLowerCase().includes(q)) ||
        s.annotations.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }
  return result;
}

export function collectTags(sessions: AgentSession[], tagDefinitions: TagDefinition[]): string[] {
  const set = new Set<string>();
  for (const td of tagDefinitions) set.add(td.name);
  for (const s of sessions) for (const t of s.annotations.tags) set.add(t);
  return Array.from(set).sort((a, b) => {
    const ao = tagDefinitions.find((d) => d.name === a)?.order ?? Infinity;
    const bo = tagDefinitions.find((d) => d.name === b)?.order ?? Infinity;
    if (ao !== bo) return ao - bo;
    return a.localeCompare(b);
  });
}

// ---------------------------------------------------------------------------
// Grouping ("By project" mode)
// ---------------------------------------------------------------------------

export interface AgentGroupData {
  /** Stable key, persisted in viewPrefs when collapsed. */
  key: string;
  name: string;
  subtitle?: string;
  projectId?: string;
  sessions: AgentSession[];
  runningCount: number;
  /** For no-project buckets: any session id whose cwd can seed a new project. */
  createFromSessionId?: string;
}

export interface GroupedSessions {
  projectGroups: AgentGroupData[];
  noProjectGroups: AgentGroupData[];
}

export function groupSessions(sessions: AgentSession[], projects: Project[]): GroupedSessions {
  const byProject = new Map<string, AgentSession[]>();
  const byCwd = new Map<string, AgentSession[]>();
  for (const s of sessions) {
    const project = s.projectId ? projects.find((p) => p.id === s.projectId) : undefined;
    if (project) {
      const list = byProject.get(project.id) ?? [];
      list.push(s);
      byProject.set(project.id, list);
    } else {
      const key = cwdKey(s.cwd);
      const list = byCwd.get(key) ?? [];
      list.push(s);
      byCwd.set(key, list);
    }
  }

  const toGroup = (key: string, name: string, list: AgentSession[], extra: Partial<AgentGroupData>): AgentGroupData => ({
    key,
    name,
    sessions: sortSessions(list),
    runningCount: list.filter((s) => s.state === 'running').length,
    ...extra,
  });

  const projectGroups = Array.from(byProject.entries()).map(([id, list]) => {
    const project = projects.find((p) => p.id === id)!;
    return toGroup(id, project.name, list, { projectId: id, subtitle: project.rootPath });
  });
  const noProjectGroups = Array.from(byCwd.entries()).map(([key, list]) =>
    toGroup(`cwd:${key}`, folderName(list[0].cwd), list, { subtitle: list[0].cwd, createFromSessionId: list[0].id }),
  );

  // Most alive first, then most recent.
  const byActivity = (a: AgentGroupData, b: AgentGroupData) => {
    const live = (g: AgentGroupData) => g.sessions.filter(isLive).length;
    if (live(a) !== live(b)) return live(b) - live(a);
    const last = (g: AgentGroupData) => Math.max(...g.sessions.map((s) => new Date(s.lastActivityAt).getTime()));
    return last(b) - last(a);
  };
  projectGroups.sort(byActivity);
  noProjectGroups.sort(byActivity);
  return { projectGroups, noProjectGroups };
}

// ---------------------------------------------------------------------------
// Shared item contract (row / compact / card all take the same props)
// ---------------------------------------------------------------------------

export interface AgentActionHandlers {
  resume: (session: AgentSession) => void;
  fork: (session: AgentSession) => void;
  copyResumeCommand: (session: AgentSession) => void;
  togglePin: (session: AgentSession) => void;
  toggleHidden: (session: AgentSession) => void;
  rename: (session: AgentSession) => void;
  openFolder: (session: AgentSession) => void;
}

export interface AgentItemProps {
  session: AgentSession;
  project: ProjectLabel;
  selected: boolean;
  onSelect: () => void;
  actions: AgentActionHandlers;
  /** Current time (ms), ticked by the view so relative times stay fresh. */
  now: number;
  tagDefinitions: TagDefinition[];
}
