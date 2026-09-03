import { useEffect, useMemo, useState } from 'react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { toast } from 'sonner';
import { Folder, Loader2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { tabsInScope } from '@/lib/terminalLayout';
import { basename, formatDuration } from '@/lib/terminalNames';
import { cn } from '@/lib/utils';
import { activeLeafOf, itemCwd, type ItemMap } from './model';

/**
 * Milliseconds elapsed since `startedAt`, refreshed every second while set.
 * The first tick lands within a second, so a fresh command briefly reads 0.
 */
function useElapsed(startedAt: number | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  return startedAt == null ? null : Math.max(0, now - startedAt);
}

/**
 * 26 px bottom bar: where the active leaf is (click copies the full path),
 * which program runs there, what it is doing, and how many tabs the scope
 * holds.
 */
export function TerminalStatusBar({ items }: { items: ItemMap }) {
  const win = useTerminalLayoutStore((s) => s.doc.window);
  const shellRuntimes = useAppStore((s) => s.shellRuntimes);

  const activeTab = useMemo(() => win.tabs.find((t) => t.id === win.activeTabId) ?? null, [win]);
  const tabCount = useMemo(() => tabsInScope(win, win.scope).length, [win]);

  const terminalId = activeTab ? activeLeafOf(activeTab).terminalId : null;
  const item = terminalId ? items.get(terminalId) : undefined;
  const shell = item?.shell;
  const cwd = itemCwd(item);
  const running = shell?.phase === 'running';
  const elapsed = useElapsed(running ? shell?.startedAt : null);

  // Program name: the shell binary for shells, the kind for processes.
  let program: string | null = null;
  if (item && terminalId) {
    if (item.type === 'shell') {
      const rt = shellRuntimes.get(terminalId.slice('shell:'.length));
      program = rt ? basename(rt.program).replace(/\.exe$/i, '') : 'shell';
    } else {
      program = item.type === 'service' ? 'service' : 'script';
    }
  }

  const copyCwd = async () => {
    if (!cwd) return;
    try {
      await writeText(cwd);
      toast.success('Path copied', { description: cwd });
    } catch (error) {
      toast.error(`Copy failed: ${String(error)}`);
    }
  };

  return (
    <div className="glass flex h-[26px] shrink-0 items-center gap-3 border-t border-border px-3 text-[11px] text-muted-foreground">
      {cwd ? (
        <button
          type="button"
          onClick={() => void copyCwd()}
          className="flex min-w-0 max-w-[50%] items-center gap-1.5 rounded-[var(--rad-xs)] px-1 font-mono transition-colors hover:bg-accent hover:text-foreground"
          title="Copy path"
        >
          <Folder className="size-3 shrink-0 text-faint" />
          <span className="truncate">{cwd}</span>
        </button>
      ) : (
        <span className="text-faint">{activeTab ? 'No working directory reported' : 'No terminal'}</span>
      )}
      {program && (
        <>
          <span className="text-faint">·</span>
          <span className="shrink-0 font-mono">{program}</span>
        </>
      )}
      {shell && (running || shell.lastCommand) && (
        <>
          <span className="text-faint">·</span>
          <span className="flex min-w-0 items-center gap-1.5">
            {running ? (
              <>
                <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
                <span className="shrink-0">Running</span>
                <span className="truncate font-mono text-foreground">{shell.command ?? '(command)'}</span>
                {elapsed != null && <span className="shrink-0 font-mono tabular-nums text-faint">{formatDuration(elapsed)}</span>}
              </>
            ) : (
              <>
                <span className="shrink-0">Last:</span>
                <span className="truncate font-mono">{shell.lastCommand}</span>
                <span className="shrink-0">→</span>
                <span
                  className={cn(
                    'shrink-0 font-mono',
                    shell.lastExitCode == null || shell.lastExitCode === 0 ? 'text-st-done' : 'text-st-blocked'
                  )}
                >
                  {shell.lastExitCode == null ? 'ended' : shell.lastExitCode === 0 ? 'ok' : `exit ${shell.lastExitCode}`}
                </span>
                {shell.lastDurationMs != null && (
                  <span className="shrink-0 font-mono text-faint">· {formatDuration(shell.lastDurationMs)}</span>
                )}
              </>
            )}
          </span>
        </>
      )}
      <span className="ml-auto shrink-0 tabular-nums text-faint">
        {tabCount} {tabCount === 1 ? 'tab' : 'tabs'}
        {win.scope !== 'global' && ' in scope'}
      </span>
    </div>
  );
}
