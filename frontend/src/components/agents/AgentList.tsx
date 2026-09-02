import type { AgentSession, ListViewMode, Project, TagDefinition } from '@/types';
import type { AgentsGroupMode } from '@/stores/viewPrefsStore';
import { AgentRow } from './AgentRow';
import { AgentCompactItem } from './AgentCompactItem';
import { AgentCard } from './AgentCard';
import { AgentGroup } from './AgentGroup';
import { groupSessions, projectLabel, type AgentActionHandlers } from './agentUtils';

interface AgentListProps {
  /** Already filtered and sorted. */
  sessions: AgentSession[];
  viewMode: ListViewMode;
  groupMode: AgentsGroupMode;
  projects: Project[];
  tagDefinitions: TagDefinition[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  actions: AgentActionHandlers;
  now: number;
  collapsedGroups: string[];
  onToggleGroup: (key: string) => void;
  onCreateProject: (sessionId: string) => void;
  creatingProject: boolean;
}

/** Renders sessions in the chosen view mode, flat or grouped by project. */
export function AgentList(props: AgentListProps) {
  const { sessions, viewMode, groupMode, projects, tagDefinitions, selectedId, onSelect, actions, now } = props;

  const renderItems = (list: AgentSession[]) => {
    const itemProps = (session: AgentSession) => ({
      session,
      project: projectLabel(session, projects),
      selected: session.id === selectedId,
      onSelect: () => onSelect(session.id),
      actions,
      now,
      tagDefinitions,
    });
    if (viewMode === 'card') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map((s) => <AgentCard key={s.id} {...itemProps(s)} />)}
        </div>
      );
    }
    if (viewMode === 'compact') {
      return <div className="space-y-1">{list.map((s) => <AgentCompactItem key={s.id} {...itemProps(s)} />)}</div>;
    }
    return <div className="space-y-1.5">{list.map((s) => <AgentRow key={s.id} {...itemProps(s)} />)}</div>;
  };

  if (groupMode === 'global') return renderItems(sessions);

  const { projectGroups, noProjectGroups } = groupSessions(sessions, projects);
  const { collapsedGroups, onToggleGroup, onCreateProject, creatingProject } = props;

  return (
    <div className="space-y-5">
      {projectGroups.map((group) => (
        <AgentGroup
          key={group.key}
          group={group}
          collapsed={collapsedGroups.includes(group.key)}
          onToggle={() => onToggleGroup(group.key)}
        >
          {renderItems(group.sessions)}
        </AgentGroup>
      ))}

      {noProjectGroups.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground pl-1">
            No project ({noProjectGroups.reduce((n, g) => n + g.sessions.length, 0)})
          </h2>
          {noProjectGroups.map((group) => (
            <AgentGroup
              key={group.key}
              group={group}
              collapsed={collapsedGroups.includes(group.key)}
              onToggle={() => onToggleGroup(group.key)}
              onCreateProject={onCreateProject}
              creatingProject={creatingProject}
            >
              {renderItems(group.sessions)}
            </AgentGroup>
          ))}
        </div>
      )}
    </div>
  );
}
