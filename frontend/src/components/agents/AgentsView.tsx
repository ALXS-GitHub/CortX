import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bot, RefreshCw, Search, SearchX } from 'lucide-react';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { ViewModeToggle } from '@/components/ui/view-mode-toggle';
import { useAppStore } from '@/stores/appStore';
import { useViewPrefsStore, type AgentsGroupMode, type AgentsScope } from '@/stores/viewPrefsStore';
import { createProjectFromSession } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import type { AgentSession } from '@/types';
import { BetaBadge } from './BetaBadge';
import { AgentFilters } from './AgentFilters';
import { AgentHealthPopover } from './AgentHealthPopover';
import { AgentList } from './AgentList';
import { AgentRenameDialog } from './AgentRenameDialog';
import { AgentDetailSheet } from './AgentDetailSheet';
import { useAgentActions } from './useAgentActions';
import { useAgentSessions, useNow } from './useAgentSessions';
import { collectTags, defaultFilters, filterSessions, isLive, sortSessions } from './agentUtils';

const DEFAULT_RECENT_DAYS = 7;

const GROUP_OPTIONS: { value: AgentsGroupMode; label: string }[] = [
  { value: 'global', label: 'Global' },
  { value: 'project', label: 'By project' },
];

interface AgentsViewProps {
  /** When set, the view is embedded in a project tab: scoped to that project, no page header. */
  projectId?: string;
}

export function AgentsView({ projectId }: AgentsViewProps) {
  const embedded = projectId !== undefined;
  const {
    agentSessions, isLoadingAgents, agentsLoaded, agentsHealth, projects, tagDefinitions, settings,
    refreshAgentSessions, loadAgentSessions, loadProjects, selectedAgentSessionId, selectAgentSession,
  } = useAppStore();
  const {
    agentsViewMode, setAgentsViewMode, agentsGroupMode, setAgentsGroupMode,
    agentsScope, setAgentsScope, agentsCollapsedGroups, toggleAgentsGroupCollapsed,
  } = useViewPrefsStore();

  const recentDays = settings?.agents?.recentDays ?? DEFAULT_RECENT_DAYS;
  const [filters, setFilters] = useState(defaultFilters);
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState<AgentSession | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);

  // "active" only needs the live sessions, which the backend always returns
  // whatever the window; asking for the recent window keeps the switch to
  // "recent" instant.
  const { changeToken } = useAgentSessions({
    sinceDays: agentsScope === 'all' ? null : recentDays,
    includeHidden: filters.showHidden,
  });
  const now = useNow();
  const actions = useAgentActions(setRenaming);

  // Leaving the view closes the detail sheet.
  useEffect(() => () => selectAgentSession(null), [selectAgentSession]);

  const inProject = embedded ? agentSessions.filter((s) => s.projectId === projectId) : agentSessions;
  const scoped = agentsScope === 'active' ? inProject.filter(isLive) : inProject;
  const filtered = sortSessions(filterSessions(scoped, filters, search, projects));
  const selected = agentSessions.find((s) => s.id === selectedAgentSessionId) ?? null;
  const runningCount = scoped.filter((s) => s.state === 'running').length;
  const waitingCount = scoped.filter((s) => s.state === 'waiting').length;

  const toggleSelect = (id: string) => selectAgentSession(selectedAgentSessionId === id ? null : id);

  const handleRefresh = async () => {
    try {
      await refreshAgentSessions();
      toast.success('Sessions rescanned');
    } catch (e) {
      toast.error('Failed to refresh sessions', { description: String(e) });
    }
  };

  const handleCreateProject = async (sessionId: string) => {
    setCreatingProject(true);
    try {
      const project = await createProjectFromSession(sessionId);
      await loadProjects();
      await loadAgentSessions();
      toast.success(`Project "${project.name}" created`, { description: project.rootPath });
    } catch (e) {
      toast.error('Failed to create project', { description: String(e) });
    } finally {
      setCreatingProject(false);
    }
  };

  const refreshButton = (
    <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoadingAgents} title="Rescan provider folders">
      <RefreshCw className={cn(isLoadingAgents && 'animate-spin')} />
      Refresh
    </Button>
  );

  const scopeOptions: { value: AgentsScope; label: string; title: string }[] = [
    { value: 'active', label: 'Active', title: 'Running or waiting for you' },
    { value: 'recent', label: 'Recent', title: `Finished in the last ${recentDays} day${recentDays === 1 ? '' : 's'}` },
    { value: 'all', label: 'All', title: 'Every session on this machine' },
  ];

  const toolbar = (
    <>
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input
          placeholder="Search title, folder, prompt, ticket…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      {agentsLoaded && scoped.length > 0 && (
        <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {runningCount > 0 && <span className="text-st-done">{runningCount} running</span>}
          {runningCount > 0 && waitingCount > 0 && ' · '}
          {waitingCount > 0 && <span className="text-st-progress">{waitingCount} waiting</span>}
          {(runningCount > 0 || waitingCount > 0) && ' · '}
          {filtered.length}{filtered.length !== scoped.length ? ` of ${scoped.length}` : ''} shown
        </span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Segmented<AgentsScope> value={agentsScope} onChange={setAgentsScope} options={scopeOptions} size="sm" />
        {!embedded && (
          <Segmented<AgentsGroupMode> value={agentsGroupMode} onChange={setAgentsGroupMode} options={GROUP_OPTIONS} size="sm" />
        )}
        <AgentFilters
          value={filters}
          onChange={setFilters}
          availableTags={collectTags(scoped, tagDefinitions)}
          tagDefinitions={tagDefinitions}
        />
        <ViewModeToggle value={agentsViewMode} onChange={setAgentsViewMode} />
      </div>
    </>
  );

  const renderBody = () => {
    if (!agentsLoaded) {
      return (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}
        </div>
      );
    }
    if (scoped.length === 0 && agentsScope === 'active' && inProject.length > 0) {
      return (
        <EmptyState
          compact={embedded}
          icon={Bot}
          title={`No active session${embedded ? ' for this project' : ''}`}
          description="Nothing is running or waiting for you right now. Switch to Recent or All to resume a finished session."
          action={
            <Button variant="outline" size="sm" onClick={() => setAgentsScope('recent')}>
              Show recent sessions
            </Button>
          }
        />
      );
    }
    if (scoped.length === 0) {
      return (
        <EmptyState
          compact={embedded}
          icon={Bot}
          title={`No agent sessions${embedded ? ' for this project' : ''}`}
          description="Claude Code and Codex sessions show up here automatically. Start one in a terminal, or check the provider status if you expected some."
          action={
            <>
              {refreshButton}
              {!embedded && <AgentHealthPopover health={agentsHealth} />}
            </>
          }
        />
      );
    }
    if (filtered.length === 0) {
      return (
        <EmptyState
          compact={embedded}
          icon={SearchX}
          title="No matching sessions"
          description="No sessions match the current search or filters."
          action={
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setFilters(defaultFilters()); }}>
              Clear
            </Button>
          }
        />
      );
    }
    return (
      <AgentList
        sessions={filtered}
        viewMode={agentsViewMode}
        groupMode={embedded ? 'global' : agentsGroupMode}
        projects={projects}
        tagDefinitions={tagDefinitions}
        selectedId={selectedAgentSessionId}
        onSelect={toggleSelect}
        actions={actions}
        now={now}
        collapsedGroups={agentsCollapsedGroups}
        onToggleGroup={toggleAgentsGroupCollapsed}
        onCreateProject={handleCreateProject}
        creatingProject={creatingProject}
      />
    );
  };

  const dialogs = (
    <>
      <AgentRenameDialog session={renaming} onOpenChange={(open) => { if (!open) setRenaming(null); }} />
      <AgentDetailSheet
        session={selected}
        onClose={() => selectAgentSession(null)}
        actions={actions}
        changeToken={changeToken}
      />
    </>
  );

  if (embedded) {
    return (
      <div className="space-y-4" data-agents-list>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-base font-semibold">
              Agents
              <BetaBadge />
            </h2>
            <p className="text-xs text-muted-foreground">
              {agentsLoaded
                ? `${scoped.length} session${scoped.length !== 1 ? 's' : ''}${runningCount > 0 ? ` · ${runningCount} running` : ''}`
                : 'Loading…'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <AgentHealthPopover health={agentsHealth} />
            {refreshButton}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">{toolbar}</div>

        {renderBody()}
        {dialogs}
      </div>
    );
  }

  return (
    <div className="h-full min-h-0" data-agents-list>
      <Screen
        title={
          <span className="inline-flex items-center gap-2">
            Agents
            <BetaBadge />
          </span>
        }
        subtitle="Claude Code and Codex sessions: who is running, who is waiting for you, what to resume"
        actions={
          <>
            <AgentHealthPopover health={agentsHealth} />
            {refreshButton}
          </>
        }
        toolbar={toolbar}
      >
        {renderBody()}
        {dialogs}
      </Screen>
    </div>
  );
}
