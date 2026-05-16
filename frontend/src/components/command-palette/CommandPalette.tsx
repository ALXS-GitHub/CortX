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
    >
      <CommandInput
        placeholder="Type a command, or search..."
        value={query}
        onValueChange={setQuery}
      />
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
                    value={`${action.label} ${action.keywords ?? ''}`}
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
