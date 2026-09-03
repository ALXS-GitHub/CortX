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

import { buildEntities } from './buildEntities';
import { buildItemValue, commandFilter, parseQuery } from './searchFilter';
import { formatShortcut, matchesShortcut, SHORTCUTS } from './shortcuts';
import type { CommandEntity, EntityAction, EntityCategory } from './types';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_ORDER: EntityCategory[] = [
  'Navigation',
  'Apps',
  'Projects',
  'Services',
  'Agents',
  'Scripts',
  'Tools',
  'Shell Config',
];

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const store = useAppStore();
  const [query, setQuery] = useState('');
  const [selectedValue, setSelectedValue] = useState('');
  const [actionsPanelOpen, setActionsPanelOpen] = useState(false);

  const entities = useMemo(() => buildEntities(store), [store]);
  const grouped = useMemo(() => groupByCategory(entities), [entities]);
  const activeScope = useMemo(() => parseQuery(query).scope, [query]);

  /** Map value attribute → entity, for keyboard shortcut dispatch. */
  const entityByValue = useMemo(() => {
    const m = new Map<string, CommandEntity>();
    for (const e of entities) {
      m.set(buildItemValue(e.category, e.label, e.keywords), e);
    }
    return m;
  }, [entities]);

  const closeAndReset = useCallback(() => {
    onOpenChange(false);
    setQuery('');
    setActionsPanelOpen(false);
  }, [onOpenChange]);

  const runAction = useCallback(
    async (action: EntityAction) => {
      closeAndReset();
      try {
        await action.run();
      } catch (err) {
        toast.error(`Failed: ${err}`);
      }
    },
    [closeAndReset],
  );

  // Reset transient state every time the palette opens fresh.
  useEffect(() => {
    if (!open) {
      setActionsPanelOpen(false);
    }
  }, [open]);

  // Global keydown while palette is open: action shortcuts + Ctrl+K toggle +
  // Esc-out of the actions panel. Capture phase so we beat cmdk's own Enter.
  useEffect(() => {
    if (!open) return;
    const selected = entityByValue.get(selectedValue);

    const onKey = (e: KeyboardEvent) => {
      // Esc inside an open actions panel closes the panel first.
      if (e.key === 'Escape' && actionsPanelOpen) {
        e.preventDefault();
        e.stopPropagation();
        setActionsPanelOpen(false);
        return;
      }

      // Toggle the actions panel — works regardless of whether an entity is
      // selected, but only useful when one is.
      if (matchesShortcut(e, SHORTCUTS.toggleActions)) {
        e.preventDefault();
        e.stopPropagation();
        setActionsPanelOpen((v) => !v);
        return;
      }

      if (!selected) return;

      // Plain Enter -> primary action (cmdk also fires onSelect, which calls
      // runAction; we don't need a separate handler here).
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        return;
      }

      // Other shortcuts: walk the entity's actions and fire the matching one.
      for (const action of selected.actions) {
        if (action.shortcut && matchesShortcut(e, action.shortcut)) {
          // The primary action also has the Enter shortcut — but plain Enter
          // is handled by cmdk's onSelect, so skip it here to avoid firing twice.
          if (
            action.shortcut.key === 'Enter' &&
            !action.shortcut.meta &&
            !action.shortcut.shift &&
            !action.shortcut.alt
          ) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          void runAction(action);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, selectedValue, entityByValue, actionsPanelOpen, runAction]);

  const selectedEntity = entityByValue.get(selectedValue);
  const primaryAction = selectedEntity?.actions[0];

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) closeAndReset();
        else onOpenChange(o);
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
        <div className="border-b border-border bg-card/40 px-4 py-1.5 text-xs text-muted-foreground">
          Filtered by scope: <span className="font-mono font-medium text-primary">@{activeScope}</span>
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
                {items.map((entity) => (
                  <CommandItem
                    key={entity.id}
                    value={buildItemValue(entity.category, entity.label, entity.keywords)}
                    onSelect={() => {
                      const primary = entity.actions[0];
                      if (primary) void runAction(primary);
                    }}
                  >
                    {entity.icon}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{entity.label}</span>
                      {entity.subtitle && (
                        <span className="truncate text-xs text-faint">
                          {entity.subtitle}
                        </span>
                      )}
                    </div>
                    {entity.actions[0]?.label && (
                      <span className="ml-auto shrink-0 text-xs text-faint">
                        {entity.actions[0].label}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          );
        })}
      </CommandList>

      {actionsPanelOpen && selectedEntity && (
        <ActionsPanel
          entity={selectedEntity}
          onPick={runAction}
          onClose={() => setActionsPanelOpen(false)}
        />
      )}

      <Footer
        primaryLabel={primaryAction?.label}
        hasActions={(selectedEntity?.actions.length ?? 0) > 1}
      />
    </CommandDialog>
  );
}

function ActionsPanel({
  entity,
  onPick,
  onClose,
}: {
  entity: CommandEntity;
  onPick: (action: EntityAction) => void;
  onClose: () => void;
}) {
  return (
    <div className="max-h-64 overflow-y-auto border-t border-border bg-card/40 px-2 py-2">
      <div className="flex items-center justify-between px-2.5 py-1">
        <span className="eyebrow truncate">Actions for {entity.label}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
      <div className="flex flex-col">
        {entity.actions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => onPick(action)}
            className="flex items-center gap-2.5 rounded-[calc(var(--radius-sm)-2px)] px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground"
          >
            {action.icon}
            <span className="flex-1 truncate">{action.label}</span>
            {action.shortcut && <Kbd shortcut={action.shortcut} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function Footer({
  primaryLabel,
  hasActions,
}: {
  primaryLabel?: string;
  hasActions: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border bg-card/40 px-4 py-2 text-xs text-faint">
      <div className="flex items-center gap-1.5">
        <kbd className="kbd">↵</kbd>
        <span>{primaryLabel ?? 'Select'}</span>
      </div>
      <div className="flex items-center gap-3">
        {hasActions && (
          <div className="flex items-center gap-1.5">
            <Kbd shortcut={SHORTCUTS.toggleActions} />
            <span>Actions</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <kbd className="kbd">Esc</kbd>
          <span>Close</span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ shortcut }: { shortcut: import('./types').KeyBinding }) {
  const parts = formatShortcut(shortcut);
  return (
    <span className="inline-flex items-center gap-0.5">
      {parts.map((p, i) => (
        <kbd key={i} className="kbd">
          {p}
        </kbd>
      ))}
    </span>
  );
}

function groupByCategory(entities: CommandEntity[]): Map<EntityCategory, CommandEntity[]> {
  const m = new Map<EntityCategory, CommandEntity[]>();
  for (const e of entities) {
    const list = m.get(e.category) ?? [];
    list.push(e);
    m.set(e.category, list);
  }
  return m;
}
