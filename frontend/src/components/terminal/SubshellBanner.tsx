import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, Plug, X } from 'lucide-react';
import { create } from 'zustand';
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
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { tabsInScope } from '@/lib/terminalLayout';
import { activeLeafOf } from './model';
import { detectSubshell, warpifySubshell, type SubshellShell } from './subshell';

/**
 * The footer Warp calls its "warpify banner" (ticket #16): when the command
 * running in the pane looks like it started a shell of its own, offer — never
 * impose — to hand it the CortX shell integration.
 *
 * It lives here rather than inside the pane because a pane is a terminal
 * surface: anything drawn in it has to be a floating layer anyway, and this
 * one is per-window, not per-split.
 */

const SHELLS: Array<{ id: SubshellShell; label: string }> = [
  { id: 'bash', label: 'bash' },
  { id: 'zsh', label: 'zsh' },
  { id: 'fish', label: 'fish' },
  { id: 'powershell', label: 'PowerShell' },
];

interface DismissedState {
  /** Terminal ids the user said "not now" to, and the command they said it about. */
  dismissed: Record<string, string>;
  dismiss: (terminalId: string, command: string) => void;
}

/** In memory, for the life of the window: a dismissal is not a preference. */
const useDismissedStore = create<DismissedState>((set) => ({
  dismissed: {},
  dismiss: (terminalId, command) => set((s) => ({ dismissed: { ...s.dismissed, [terminalId]: command } })),
}));

export function SubshellBanner() {
  const win = useTerminalLayoutStore((s) => s.doc.window);
  const states = useAppStore((s) => s.terminalStates);
  const dismissed = useDismissedStore((s) => s.dismissed);
  const dismiss = useDismissedStore((s) => s.dismiss);
  const [busy, setBusy] = useState(false);

  // The pane on screen: the same tab `TerminalWindow` shows, its active leaf.
  const target = useMemo(() => {
    const scoped = tabsInScope(win, win.scope);
    const tab = scoped.find((t) => t.id === win.activeTabId) ?? scoped[0] ?? null;
    if (!tab) return null;
    const terminalId = activeLeafOf(tab).terminalId;
    const state = states.get(terminalId);
    // Only while the command is actually running: once it ends, the shell it
    // started is gone and there is nothing to offer.
    if (!state || state.phase !== 'running') return null;
    const match = detectSubshell(state.command);
    if (!match) return null;
    if (dismissed[terminalId] === state.command) return null;
    return { terminalId, command: state.command ?? '', match };
  }, [win, states, dismissed]);

  const run = useCallback(
    async (shell: SubshellShell) => {
      if (!target) return;
      setBusy(true);
      try {
        const result = await warpifySubshell(target.terminalId, shell, { remote: target.match.remote });
        if (result.ok) dismiss(target.terminalId, target.command);
      } finally {
        setBusy(false);
      }
    },
    [target, dismiss]
  );

  if (!target) return null;
  const suggested = target.match.shell ?? 'bash';

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-[min(680px,100%)] items-center gap-3 rounded-[var(--rad-md)] border border-border-strong bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
        <Plug className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate">
            <span className="font-medium">{target.match.what}</span> is running here without CortX shell
            integration.
          </p>
          <p className="truncate text-[11px] text-faint">
            Wait for its prompt, then enable it: CortX types one line to set up the cwd and command tracking.
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          <Button size="xs" disabled={busy} className="rounded-r-none" onClick={() => void run(suggested)}>
            Enable
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="xs"
                disabled={busy}
                className="rounded-l-none border-l border-primary-foreground/25 px-1.5"
                aria-label="Choose the sub-shell"
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuLabel>Which shell is it?</DropdownMenuLabel>
              {SHELLS.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => void run(s.id)}>
                  {s.label}
                  {s.id === suggested && <span className="ml-auto text-[10px] text-faint">detected</span>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => dismiss(target.terminalId, target.command)}>
                <X />
                Not now
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <button
          type="button"
          className="grid size-5 shrink-0 place-items-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => dismiss(target.terminalId, target.command)}
          title="Not now"
          aria-label="Not now"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}
