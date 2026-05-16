import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useAppStore } from '@/stores/appStore';
import { toast } from 'sonner';

import { buildActions } from './buildActions';
import { buildItemValue, commandFilter, parseQuery } from './searchFilter';
import type { CommandAction, CommandCategory } from './types';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_ORDER: CommandCategory[] = [
  'Navigation',
  'Apps',
  'Services',
  'Scripts',
  'Projects',
  'Tools',
];

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  // Subscribe so the action list refreshes when relevant slices change
  // (services running/stopped, projects added, etc.).
  const store = useAppStore();
  const [query, setQuery] = useState('');
  const [selectedValue, setSelectedValue] = useState('');

  const actions = useMemo(() => buildActions(store), [store]);
  const grouped = useMemo(() => groupByCategory(actions), [actions]);
  const activeScope = useMemo(() => parseQuery(query).scope, [query]);

  // Lookup from a CommandItem's `value` to the action it represents — used by
  // the Cmd+Enter handler to find the action of the currently-selected row.
  const actionByValue = useMemo(() => {
    const m = new Map<string, CommandAction>();
    for (const a of actions) {
      m.set(buildItemValue(a.category, a.label, a.keywords), a);
    }
    return m;
  }, [actions]);

  const handleAction = useCallback(
    async (action: CommandAction, mode: 'run' | 'navigate') => {
      onOpenChange(false);
      setQuery('');
      try {
        if (mode === 'navigate' && action.navigateTo) {
          await action.navigateTo();
        } else {
          await action.run();
        }
      } catch (err) {
        toast.error(`Failed: ${err}`);
      }
    },
    [onOpenChange],
  );

  // Cmd+Enter / Ctrl+Enter -> navigateTo on the currently selected item.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const isAlt = e.key === 'Enter' && (e.metaKey || e.ctrlKey);
      if (!isAlt) return;
      const action = actionByValue.get(selectedValue);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      void handleAction(action, 'navigate');
    };
    // Capture phase so cmdk's own Enter handler doesn't fire first.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, selectedValue, actionByValue, handleAction]);

  const selectedAction = actionByValue.get(selectedValue);
  const hasNavigate = !!selectedAction?.navigateTo;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQuery('');
      }}
      filter={commandFilter}
      value={selectedValue}
      onValueChange={setSelectedValue}
    >
      <CommandInput
        placeholder="Type a command, or @tools / @apps / @services..."
        value={query}
        onValueChange={setQuery}
      />
      {activeScope && (
        <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">
          Filtered by scope: <span className="text-foreground font-medium">@{activeScope}</span>
        </div>
      )}
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {CATEGORY_ORDER.map((cat, i) => {
          const items = grouped.get(cat);
          if (!items || items.length === 0) return null;
          return (
            <div key={cat}>
              {i > 0 && <CommandSeparator />}
              <CommandGroup heading={cat}>
                {items.map((action) => (
                  <CommandItem
                    key={action.id}
                    value={buildItemValue(action.category, action.label, action.keywords)}
                    onSelect={() => handleAction(action, 'run')}
                  >
                    {action.icon}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate">{action.label}</span>
                      {action.subtitle && (
                        <span className="text-xs text-muted-foreground truncate">
                          {action.subtitle}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          );
        })}
      </CommandList>
      <div className="flex items-center justify-end gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
        <span>
          <kbd className="px-1 py-0.5 rounded border bg-muted text-foreground">↵</kbd> Run
        </span>
        {hasNavigate && (
          <span>
            <kbd className="px-1 py-0.5 rounded border bg-muted text-foreground">⌘/Ctrl</kbd>
            <kbd className="ml-1 px-1 py-0.5 rounded border bg-muted text-foreground">↵</kbd> Go to detail
          </span>
        )}
        <span>
          <kbd className="px-1 py-0.5 rounded border bg-muted text-foreground">Esc</kbd> Close
        </span>
      </div>
    </CommandDialog>
  );
}

function groupByCategory(actions: CommandAction[]): Map<CommandCategory, CommandAction[]> {
  const m = new Map<CommandCategory, CommandAction[]>();
  for (const a of actions) {
    const list = m.get(a.category) ?? [];
    list.push(a);
    m.set(a.category, list);
  }
  return m;
}
