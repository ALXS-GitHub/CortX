import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Columns2, Loader2, PanelBottom, RotateCcw, Rows2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TerminalTypeIcon } from '@/components/layout/terminal-dnd/TerminalTypeIcon';
import { XtermView } from '@/components/layout/XtermView';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { formatDuration } from '@/lib/terminalNames';
import type { LeafNode, TerminalTab } from '@/lib/terminalLayout';
import { cn } from '@/lib/utils';
import type { TerminalItem } from '@/components/layout/terminal-dnd/types';
import type { GlobalScript } from '@/types';
import { closeLeaf, sendLeafToDock, splitLeaf } from './actions';
import { cwdLabel, hasEnded } from './model';

/**
 * How to start the process behind an ended service / script leaf again. The
 * restarted process keeps its terminal id, so the leaf comes back alive by
 * itself. `null` for shells and for global scripts that need parameters.
 */
function restartActionFor(item: TerminalItem | undefined, globalScripts: GlobalScript[]): (() => Promise<void>) | null {
  if (!item || item.type === 'shell') return null;
  const id = item.id.slice(item.id.indexOf(':') + 1);
  const app = useAppStore.getState;
  switch (item.type) {
    case 'service':
      return () => app().startService(id);
    case 'script':
      return () => app().runScript(id);
    case 'global-script': {
      const script = globalScripts.find((s) => s.id === id);
      if (!script) return null;
      const needsInput = script.parameters.some((p) => p.required && !p.defaultValue);
      if (needsInput && !script.defaultPresetId) return null;
      return () => app().runGlobalScript(id);
    }
    default:
      return null;
  }
}

interface LeafPaneProps {
  tab: TerminalTab;
  leaf: LeafNode;
  item: TerminalItem | undefined;
  /** This leaf is the tab's active leaf. */
  isActiveLeaf: boolean;
  /** The tab is the window's active tab (keyboard focus goes here). */
  isActiveTab: boolean;
  /** The tab holds several leaves (show the active ring). */
  multi: boolean;
}

function HeaderAction({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className={cn(
            'grid size-5 place-items-center rounded-[6px] text-muted-foreground transition-colors',
            danger ? 'hover:bg-destructive/15 hover:text-destructive' : 'hover:bg-accent hover:text-foreground'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** What the shell is doing right now, for the header strip. */
function Activity({ item }: { item: TerminalItem }) {
  const shell = item.shell;
  if (!shell) return null;
  if (shell.phase === 'running') {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-primary">
        <Loader2 className="size-3 shrink-0 animate-spin" />
        <span className="truncate font-mono">{shell.command ?? '(command)'}</span>
      </span>
    );
  }
  if (!shell.lastCommand) return null;
  const code = shell.lastExitCode;
  const ok = code == null || code === 0;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-mono text-faint">{shell.lastCommand}</span>
      <span className={cn('shrink-0 font-mono', ok ? 'text-st-done' : 'text-st-blocked')}>
        {code == null ? 'ended' : ok ? 'ok' : `exit ${code}`}
      </span>
      {shell.lastDurationMs != null && <span className="shrink-0 font-mono text-faint">{formatDuration(shell.lastDurationMs)}</span>}
    </span>
  );
}

/**
 * Wait a moment before declaring a terminal unknown: at boot the layout
 * arrives before the shell runtimes, and a flash of "ended" would be wrong.
 */
function useSettled(delayMs: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(true), delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs]);
  return settled;
}

/**
 * One terminal of a tab: a 28 px header (name · cwd · activity, hover
 * actions) above the persistent xterm session. Clicking anywhere makes it
 * the tab's active leaf.
 */
export function LeafPane({ tab, leaf, item, isActiveLeaf, isActiveTab, multi }: LeafPaneProps) {
  const setActiveLeaf = useTerminalLayoutStore((s) => s.setActiveLeaf);
  const markTerminalSeen = useAppStore((s) => s.markTerminalSeen);
  const globalScripts = useAppStore((s) => s.globalScripts);
  const settled = useSettled(1500);
  const restart = useMemo(() => restartActionFor(item, globalScripts), [item, globalScripts]);
  const handleRestart = async () => {
    if (!restart) return;
    try {
      await restart();
    } catch (error) {
      toast.error(`Failed to restart ${item?.name ?? 'the process'}`, { description: String(error) });
    }
  };

  const ended = item ? hasEnded(item) : settled;
  const exitCode = item?.lastExitCode ?? item?.shell?.lastExitCode ?? null;
  const cwd = cwdLabel(item);
  // Only shells with integration report activity; processes just show a name.
  const showActivity = !!item?.shell && (item.shell.phase === 'running' || !!item.shell.lastCommand);

  const activate = () => {
    if (!isActiveLeaf || !isActiveTab) setActiveLeaf(tab.id, leaf.id);
    markTerminalSeen(leaf.terminalId);
  };

  return (
    <div
      className={cn(
        'group/leaf relative flex min-h-0 min-w-0 flex-1 flex-col',
        multi && isActiveLeaf && 'ring-1 ring-inset ring-primary/40'
      )}
      onMouseDownCapture={activate}
    >
      {/* Header strip */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-background/60 px-2 text-[11px] text-muted-foreground">
        <TerminalTypeIcon type={item?.type ?? 'shell'} className="size-3.5 shrink-0 text-faint" />
        <span className={cn('shrink-0 truncate font-medium', isActiveLeaf ? 'text-foreground' : 'text-muted-foreground')}>
          {item?.name ?? 'Terminal'}
        </span>
        {cwd && (
          <>
            <span className="text-faint">·</span>
            <span className="shrink-0 truncate font-mono text-faint" title={item?.shell?.cwd ?? item?.cwd}>
              {cwd}
            </span>
          </>
        )}
        {item && showActivity && (
          <>
            <span className="text-faint">·</span>
            <Activity item={item} />
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/leaf:opacity-100 focus-within:opacity-100">
          <HeaderAction label="Split right (Ctrl+Shift+D)" onClick={() => void splitLeaf(tab.id, leaf.id, 'horizontal')}>
            <Columns2 className="size-3.5" />
          </HeaderAction>
          <HeaderAction label="Split down (Ctrl+Shift+E)" onClick={() => void splitLeaf(tab.id, leaf.id, 'vertical')}>
            <Rows2 className="size-3.5" />
          </HeaderAction>
          <HeaderAction label="Send to dock" onClick={() => sendLeafToDock(leaf.terminalId)}>
            <PanelBottom className="size-3.5" />
          </HeaderAction>
          <HeaderAction label="Close (Ctrl+Shift+W)" danger onClick={() => closeLeaf(leaf.terminalId)}>
            <X className="size-3.5" />
          </HeaderAction>
        </div>
      </div>

      {/* Terminal */}
      <div className="relative min-h-0 flex-1">
        <XtermView terminalId={leaf.terminalId} autoFocus={isActiveTab && isActiveLeaf} />
        {ended && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
            <div className="glass-strong pointer-events-auto flex items-center gap-3 rounded-lg border border-border-strong px-4 py-2.5 text-xs shadow-pop">
              <span className="text-muted-foreground">
                {item ? 'Process ended' : 'Terminal not found'}
                {item && exitCode != null && (
                  <span className={cn('ml-1 font-mono', exitCode === 0 ? 'text-st-done' : 'text-st-blocked')}>· exit {exitCode}</span>
                )}
              </span>
              {restart && (
                <Button variant="outline" size="xs" onClick={() => void handleRestart()}>
                  <RotateCcw />
                  Restart
                </Button>
              )}
              <Button variant="outline" size="xs" onClick={() => closeLeaf(leaf.terminalId)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
