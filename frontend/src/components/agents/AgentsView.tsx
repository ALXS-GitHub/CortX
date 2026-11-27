import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronRight,
  Copy,
  EyeOff,
  FolderOpen,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  SquareTerminal,
} from 'lucide-react';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore } from '@/stores/appStore';
import { useViewPrefsStore } from '@/stores/viewPrefsStore';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { AgentSession, Project } from '@/types';
import { ensureTerminalAgents } from '@/components/terminal/agentsStore';
import { openAgentSession } from '@/components/terminal/actions';
import { AgentRenameDialog } from './AgentRenameDialog';
import { AgentStateDot } from './AgentStateDot';
import { useAgentActions } from './useAgentActions';
import { useAgentSessions, useNow } from './useAgentSessions';
import { cwdKey, folderName, isLive } from './agentUtils';

const DEFAULT_RECENT_DAYS = 7;

type Scope = 'recent' | 'all';

interface AgentsViewProps {
  /** When set, the view is embedded in a project tab: that project's sessions, no page header. */
  projectId?: string;
}

interface Group {
  key: string;
  label: string;
  isProject: boolean;
  sessions: AgentSession[];
  last: number;
}

const time = (s: AgentSession) => new Date(s.lastActivityAt).getTime() || 0;

function groupByProject(sessions: AgentSession[], projects: Project[]): Group[] {
  const groups = new Map<string, Group>();
  for (const s of sessions) {
    const project = s.projectId ? projects.find((p) => p.id === s.projectId) : undefined;
    const key = project ? `project:${project.id}` : `dir:${cwdKey(s.cwd)}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, label: project?.name ?? folderName(s.cwd), isProject: !!project, sessions: [], last: 0 };
      groups.set(key, g);
    }
    g.sessions.push(s);
    g.last = Math.max(g.last, time(s));
  }
  for (const g of groups.values()) {
    g.sessions.sort((a, b) => Number(b.annotations.pinned) - Number(a.annotations.pinned) || time(b) - time(a));
  }
  return [...groups.values()].sort((a, b) => b.last - a.last);
}

/**
 * The Agents section of the main window (ticket CORT-62): the history of
 * your agent sessions, by project, one line each — the way the Claude
 * desktop app's sidebar lists them. The live ones on top. A click opens the
 * session in the Terminal window (where it runs, or resumed there in the
 * default mode); the menu has the rest.
 */
export function AgentsView({ projectId }: AgentsViewProps) {
  const embedded = projectId !== undefined;
  const { agentSessions, isLoadingAgents, agentsLoaded, projects, settings, refreshAgentSessions, selectedAgentSessionId, selectAgentSession } =
    useAppStore();
  const { agentsCollapsedGroups, toggleAgentsGroupCollapsed } = useViewPrefsStore();
  const recentDays = settings?.agents?.recentDays ?? DEFAULT_RECENT_DAYS;
  const [scope, setScope] = useState<Scope>('recent');
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState<AgentSession | null>(null);

  useEffect(() => ensureTerminalAgents(), []);
  useAgentSessions({ sinceDays: scope === 'all' ? null : recentDays, includeHidden: false });
  const now = useNow();
  const actions = useAgentActions(setRenaming);
  // "Open in Agents" from a terminal tab selects a session: it is shown, then forgotten.
  useEffect(() => () => selectAgentSession(null), [selectAgentSession]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agentSessions
      .filter((s) => !s.annotations.hidden)
      .filter((s) => !embedded || s.projectId === projectId)
      .filter(
        (s) =>
          !q ||
          s.title.toLowerCase().includes(q) ||
          s.cwd.toLowerCase().includes(q) ||
          (s.lastUserPrompt ?? '').toLowerCase().includes(q)
      );
  }, [agentSessions, embedded, projectId, search]);
  const live = visible.filter(isLive).sort((a, b) => time(b) - time(a));
  const past = visible.filter((s) => !isLive(s));
  const groups = embedded ? null : groupByProject(past, projects);
  const flat = embedded ? past.slice().sort((a, b) => Number(b.annotations.pinned) - Number(a.annotations.pinned) || time(b) - time(a)) : null;

  const handleRefresh = async () => {
    try {
      await refreshAgentSessions();
    } catch (e) {
      toast.error('Failed to refresh sessions', { description: String(e) });
    }
  };

  const row = (s: AgentSession) => (
    <SessionRow
      key={s.id}
      session={s}
      now={now}
      selected={s.id === selectedAgentSessionId}
      onOpen={(mode) => void openAgentSession(s, mode)}
      onRename={() => setRenaming(s)}
      onPin={() => actions.togglePin(s)}
      onHide={() => actions.toggleHidden(s)}
      onCopy={() => void actions.copyResumeCommand(s)}
      onFolder={() => actions.openFolder(s)}
    />
  );

  const body = !agentsLoaded ? (
    <div className="space-y-1.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-8 w-full rounded-md" />
      ))}
    </div>
  ) : visible.length === 0 ? (
    <p className="py-10 text-center text-sm text-muted-foreground">
      {search ? 'No session matches.' : `No agent session${scope === 'recent' ? ` in the last ${recentDays} days` : ''}.`}
    </p>
  ) : (
    <div className="flex flex-col gap-5">
      {live.length > 0 && (
        <section>
          <h3 className="eyebrow mb-1 px-2">Running</h3>
          <div className="flex flex-col">{live.map(row)}</div>
        </section>
      )}
      {flat && flat.length > 0 && <div className="flex flex-col">{flat.map(row)}</div>}
      {groups?.map((g) => {
        const collapsed = agentsCollapsedGroups.includes(g.key);
        return (
          <section key={g.key}>
            <button
              type="button"
              onClick={() => toggleAgentsGroupCollapsed(g.key)}
              className="group/g mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', !collapsed && 'rotate-90')} />
              <span className={cn('truncate', !g.isProject && 'font-mono text-[11px]')}>{g.label}</span>
              <span className="text-xs font-normal text-faint">{g.sessions.length}</span>
            </button>
            {!collapsed && <div className="flex flex-col">{g.sessions.map(row)}</div>}
          </section>
        );
      })}
    </div>
  );

  const toolbar = (
    <>
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input placeholder="Search sessions…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Segmented<Scope>
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'recent', label: 'Recent', title: `The last ${recentDays} days` },
            { value: 'all', label: 'All' },
          ]}
        />
        <Button variant="ghost" size="icon-sm" onClick={handleRefresh} disabled={isLoadingAgents} title="Rescan the sessions">
          <RefreshCw className={cn(isLoadingAgents && 'animate-spin')} />
        </Button>
      </div>
    </>
  );

  const dialogs = <AgentRenameDialog session={renaming} onOpenChange={(open) => !open && setRenaming(null)} />;

  if (embedded) {
    return (
      <div className="space-y-3" data-agents-list>
        <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
        <div className="mx-auto max-w-3xl">{body}</div>
        {dialogs}
      </div>
    );
  }

  return (
    <div className="h-full min-h-0" data-agents-list>
      <Screen title="Agents" subtitle="Your Claude Code sessions, by project" toolbar={toolbar} narrow>
        {body}
        {dialogs}
      </Screen>
    </div>
  );
}

interface SessionRowProps {
  session: AgentSession;
  now: number;
  selected: boolean;
  onOpen: (mode?: 'tui' | 'gui') => void;
  onRename: () => void;
  onPin: () => void;
  onHide: () => void;
  onCopy: () => void;
  onFolder: () => void;
}

/** One session, one line: its state, its title, when. */
function SessionRow({ session, now, selected, onOpen, onRename, onPin, onHide, onCopy, onFolder }: SessionRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'center' });
  }, [selected]);
  const claude = session.provider === 'claude-code';
  return (
    <div
      ref={ref}
      className={cn(
        'group/row flex h-8 items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-accent',
        selected && 'bg-accent ring-1 ring-primary/40'
      )}
    >
      <button
        type="button"
        onClick={() => onOpen()}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        title={session.lastUserPrompt ? `${session.title}\n\n${session.lastUserPrompt}` : session.title}
      >
        <AgentStateDot state={session.state} size={7} />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{session.title}</span>
        {session.annotations.pinned && <Pin className="size-3 shrink-0 text-faint" />}
        <span className="shrink-0 text-xs tabular-nums text-faint group-hover/row:hidden">
          {formatRelativeTime(session.lastActivityAt, now)}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="hidden size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background/60 hover:text-foreground group-hover/row:grid data-[state=open]:grid"
            aria-label="Session actions"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {claude && (
            <DropdownMenuItem onSelect={() => onOpen('gui')}>
              <MessagesSquare />
              Open in GUI mode
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => onOpen('tui')}>
            <SquareTerminal />
            Open in the terminal
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onRename}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onPin}>
            {session.annotations.pinned ? <PinOff /> : <Pin />}
            {session.annotations.pinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onCopy}>
            <Copy />
            Copy the resume command
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onFolder}>
            <FolderOpen />
            Open the folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onHide}>
            <EyeOff />
            Hide
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
