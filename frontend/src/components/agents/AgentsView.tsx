import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bot, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ViewModeToggle } from '@/components/ui/view-mode-toggle';
import { useAppStore } from '@/stores/appStore';
import { useViewPrefsStore, type AgentsGroupMode } from '@/stores/viewPrefsStore';
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
import { collectTags, defaultFilters, filterSessions, sortSessions } from './agentUtils';

const DEFAULT_RECENT_DAYS = 7;

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
    agentsCollapsedGroups, toggleAgentsGroupCollapsed,
  } = useViewPrefsStore();

  const recentDays = settings?.agents?.recentDays ?? DEFAULT_RECENT_DAYS;
  const [filters, setFilters] = useState(defaultFilters);
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState<AgentSession | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);

  const { changeToken } = useAgentSessions({
    sinceDays: filters.showAll ? null : recentDays,
    includeHidden: filters.showHidden,
  });
  const now = useNow();
  const actions = useAgentActions(setRenaming);

  // Leaving the view closes the detail sheet.
  useEffect(() => () => selectAgentSession(null), [selectAgentSession]);

  const scoped = embedded ? agentSessions.filter((s) => s.projectId === projectId) : agentSessions;
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
      <RefreshCw className={cn('size-4', isLoadingAgents && 'animate-spin')} />
      Refresh
    </Button>
  );

  const renderBody = () => {
    if (!agentsLoaded) {
      return (
        <div className="space-y-1.5">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11 w-full rounded-md" />)}
        </div>
      );
    }
    if (scoped.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
          <Bot className="size-8 mb-3 opacity-60" />
          <p className="text-lg font-medium text-foreground">No agent sessions{embedded ? ' for this project' : ''}</p>
          <p className="text-sm mt-1 max-w-md">
            Claude Code and Codex sessions show up here automatically. Start one in a terminal, or check the provider
            status if you expected some.
          </p>
          <div className="mt-4 flex items-center gap-2">
            {refreshButton}
            {!embedded && <AgentHealthPopover health={agentsHealth} />}
          </div>
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">No sessions match the current search or filters.</p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => { setSearch(''); setFilters(defaultFilters()); }}>
            Clear
          </Button>
        </div>
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

  return (
    <div className={cn(embedded ? 'space-y-4' : 'p-6 space-y-6')} data-agents-list>
      {!embedded && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold flex items-center gap-2">Agents <BetaBadge /></h1>
            <p className="text-sm text-muted-foreground mt-1">
              Claude Code and Codex sessions: who is running, who is waiting for you, what to resume
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <AgentHealthPopover health={agentsHealth} />
            {refreshButton}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search title, folder, prompt, ticket…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {agentsLoaded && scoped.length > 0 && (
          <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
            {runningCount > 0 && <span className="text-emerald-600 dark:text-emerald-400">{runningCount} running</span>}
            {runningCount > 0 && waitingCount > 0 && ' · '}
            {waitingCount > 0 && <span className="text-amber-600 dark:text-amber-400">{waitingCount} waiting</span>}
            {(runningCount > 0 || waitingCount > 0) && ' · '}
            {filtered.length}{filtered.length !== scoped.length ? ` of ${scoped.length}` : ''} shown
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!embedded && (
            <Tabs value={agentsGroupMode} onValueChange={(v) => setAgentsGroupMode(v as AgentsGroupMode)}>
              <TabsList className="h-8">
                <TabsTrigger value="global" className="text-xs px-2.5">Global</TabsTrigger>
                <TabsTrigger value="project" className="text-xs px-2.5">By project</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <AgentFilters
            value={filters}
            onChange={setFilters}
            availableTags={collectTags(scoped, tagDefinitions)}
            tagDefinitions={tagDefinitions}
            recentDays={recentDays}
          />
          <ViewModeToggle value={agentsViewMode} onChange={setAgentsViewMode} />
          {embedded && (
            <>
              <AgentHealthPopover health={agentsHealth} />
              {refreshButton}
            </>
          )}
        </div>
      </div>

      {renderBody()}

      <AgentRenameDialog session={renaming} onOpenChange={(open) => { if (!open) setRenaming(null); }} />
      <AgentDetailSheet
        session={selected}
        onClose={() => selectAgentSession(null)}
        actions={actions}
        changeToken={changeToken}
      />
    </div>
  );
}
