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
import { NoticeBar, ShellNoteBanner } from './ShellNoteBanner';
import { detectSubshell, warpifySubshell, type SubshellShell } from './subshell';

/**
 * The footer Warp calls its "warpify banner" (ticket #16): when the command
 * running in the pane looks like it started a shell of its own, offer — never
 * impose — to hand it the CortX shell integration.
 *
 * It lives here rather than inside the pane because a pane is a terminal
 * surface: anything drawn in it has to be a floating layer anyway, and this
 * one is per-window, not per-split.
 *
 * It is also the banner *slot* of the Terminal window, because two banners
 * stacked in the same corner is one banner too many. The other tenant is
 * `ShellNoteBanner` ("CortX has no shell integration for <shell>"), and the
 * offer wins whenever both apply: it is actionable and it lasts only as long
 * as the sub-shell command runs, while the note is a standing fact about the
 * user's shell that will still be true a minute later — so the note simply
 * takes the slot back when the offer is gone.
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

  // Nothing to offer: the slot goes back to the standing shell note.
  if (!target) return <ShellNoteBanner surface="window" />;
  const suggested = target.match.shell ?? 'bash';

  return (
    <NoticeBar
      icon={Plug}
      onDismiss={() => dismiss(target.terminalId, target.command)}
      dismissLabel="Not now"
      actions={
        <>
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
        </>
      }
    >
      <p className="truncate">
        <span className="font-medium">{target.match.what}</span> is running here without CortX shell
        integration.
      </p>
      <p className="truncate text-[11px] text-faint">
        Wait for its prompt, then enable it: CortX types one line to set up the cwd and command tracking.
      </p>
    </NoticeBar>
  );
}
