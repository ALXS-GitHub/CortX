import { useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusDot } from '@/components/ui/StatusDot';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { collectLeaves, terminalWindowIdOf, terminalWindowName } from '@/lib/terminalLayout';
import { useItemMap } from './model';
import { openTerminalWindow, siblingWindowsWithTabs, terminalWindowRects } from './terminalWindows';

interface WindowSummary {
  label: string;
  tabs: number;
  running: number;
}

/**
 * Title-bar hint of the first Terminal window: the other Terminal windows that
 * hold sessions, and a menu to bring one up.
 *
 * A detached window is easy to lose: it opens on its own screen, sits behind
 * something, or was closed with its X — which only hides it while its shells
 * keep running. Nothing in this window used to say it existed. Opening the
 * Terminal now raises all of them; this is the quiet reminder in between.
 * Nothing is shown when there is no other window.
 */
export function OtherWindowsMenu() {
  const tabs = useTerminalLayoutStore((s) => s.doc.window.tabs);
  const items = useItemMap();
  // Which windows are on screen, asked when the menu opens: visibility is not
  // in the shared document, and polling it for a hint would be a waste.
  const [visible, setVisible] = useState<Set<string> | null>(null);

  const windows = useMemo<WindowSummary[]>(
    () =>
      siblingWindowsWithTabs(tabs).map((label) => {
        const own = tabs.filter((t) => terminalWindowIdOf(t) === label);
        const running = own
          .flatMap((t) => collectLeaves(t.layout))
          .filter((leaf) => items.get(leaf.terminalId)?.status === 'running').length;
        return { label, tabs: own.length, running };
      }),
    [tabs, items]
  );

  if (windows.length === 0) return null;

  const onOpenChange = (open: boolean) => {
    if (!open) return;
    terminalWindowRects()
      .then((rects) => setVisible(new Set(rects.map((r) => r.label))))
      .catch(() => setVisible(null));
  };

  const count = windows.length;
  const title = `${count} other Terminal window${count > 1 ? 's' : ''}`;

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" title={title} aria-label={title}>
          <Layers />
          <span className="tabular-nums">{count}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>Other windows</DropdownMenuLabel>
        {windows.map((w) => {
          const hidden = visible !== null && !visible.has(w.label);
          return (
            <DropdownMenuItem
              key={w.label}
              onSelect={() => {
                openTerminalWindow(w.label).catch((error) =>
                  toast.error(`Could not open ${terminalWindowName(w.label)}`, { description: String(error) })
                );
              }}
            >
              <span className="flex-1 truncate">{terminalWindowName(w.label)}</span>
              <span className="flex items-center gap-1.5 text-xs tabular-nums text-faint">
                {w.running > 0 && <StatusDot tone="running" size={6} title={`${w.running} running`} />}
                {w.tabs} tab{w.tabs > 1 ? 's' : ''}
                {hidden && <span>· hidden</span>}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
