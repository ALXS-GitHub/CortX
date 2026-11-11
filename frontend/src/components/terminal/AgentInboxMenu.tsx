import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppStore } from '@/stores/appStore';
import { comboLabelFor } from '@/lib/keybindings';
import { formatDuration } from '@/lib/terminalNames';
import { AgentPhaseDot } from './TerminalStatusGlyph';
import { attentionOrder } from './agentPhase';
import { revealTerminal, useLocalAgents, type AgentEntry } from './agentInbox';
import { tabProject, tabTitle, useItemMap } from './model';

/**
 * Agent mode's title-bar counter, and the inbox behind it: "2 need you · 1
 * done", and a click lists them — the ones stopped on you first, then the
 * ones that finished and were not looked at, the longest waiting first. A row
 * opens its agent. Nothing to report, nothing drawn but a quiet count of the
 * agents at work.
 */
export function AgentInboxMenu() {
  const entries = useLocalAgents();
  const items = useItemMap();
  const projects = useAppStore((s) => s.projects);
  const keybindings = useAppStore((s) => s.settings?.terminal.keybindings);
  const combo = comboLabelFor('agents.next', keybindings);
  // "Waiting for 3 min" is measured from when the menu opened.
  const [openedAt, setOpenedAt] = useState(0);
  if (entries.length === 0) return null;

  const needs = entries.filter((e) => e.phase === 'needs-you').length;
  const done = entries.filter((e) => e.phase === 'done').length;
  const working = entries.filter((e) => e.phase === 'working').length;
  const queue = attentionOrder(entries);
  const parts = [needs > 0 && `${needs} need${needs > 1 ? '' : 's'} you`, done > 0 && `${done} done`].filter(Boolean);
  const summary = parts.length > 0 ? parts.join(' · ') : working > 0 ? `${working} working` : `${entries.length} idle`;

  const row = (e: AgentEntry) => {
    const project = tabProject(e.tab, projects);
    return (
      <DropdownMenuItem key={e.terminalId} onSelect={() => revealTerminal(e.terminalId)} className="gap-2">
        <AgentPhaseDot phase={e.phase} needsInput={e.agent.needsInput} />
        <span className="min-w-0 flex-1 truncate">{tabTitle(e.tab, items)}</span>
        {project && <span className="max-w-24 shrink-0 truncate text-[11px] text-faint">{project.name}</span>}
        {e.since > 0 && openedAt > e.since && (
          <span className="shrink-0 text-[11px] tabular-nums text-faint">{formatDuration(openedAt - e.since)}</span>
        )}
      </DropdownMenuItem>
    );
  };

  return (
    <DropdownMenu onOpenChange={(open) => open && setOpenedAt(Date.now())}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          title={combo ? `Agents (next one that needs you: ${combo})` : 'Agents'}
          aria-label={`Agents: ${summary}`}
        >
          {needs > 0 ? (
            <AgentPhaseDot phase="needs-you" />
          ) : done > 0 ? (
            <AgentPhaseDot phase="done" />
          ) : (
            <Inbox className="text-faint" />
          )}
          <span className={needs > 0 || done > 0 ? 'text-foreground' : 'text-faint'}>{summary}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {queue.length > 0 ? (
          <>
            <DropdownMenuLabel>Waiting for you</DropdownMenuLabel>
            {queue.map(row)}
          </>
        ) : (
          <DropdownMenuLabel className="font-normal text-faint">Nothing waiting for you.</DropdownMenuLabel>
        )}
        {working > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Working</DropdownMenuLabel>
            {entries.filter((e) => e.phase === 'working').map(row)}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
