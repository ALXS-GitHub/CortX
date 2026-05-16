import { useMemo, useState } from 'react';

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

  const actions = useMemo(() => buildActions(store), [store]);
  const grouped = useMemo(() => groupByCategory(actions), [actions]);
  const activeScope = useMemo(() => parseQuery(query).scope, [query]);

  const handleRun = async (action: CommandAction) => {
    onOpenChange(false);
    setQuery('');
    try {
      await action.run();
    } catch (err) {
      toast.error(`Failed: ${err}`);
    }
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQuery('');
      }}
      filter={commandFilter}
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
                    onSelect={() => handleRun(action)}
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
