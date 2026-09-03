import { Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { TagBadge } from '@/components/ui/TagBadge';
import { cn } from '@/lib/utils';
import type { AgentProvider, AgentState, TagDefinition } from '@/types';
import {
  ALL_PROVIDERS, ALL_STATES, PROVIDER_LABEL, STATE_LABEL, activeFilterCount, defaultFilters,
  type AgentFilterState,
} from './agentUtils';

interface AgentFiltersProps {
  value: AgentFilterState;
  onChange: (next: AgentFilterState) => void;
  availableTags: string[];
  tagDefinitions: TagDefinition[];
}

function toggleInSet<T>(set: Set<T>, item: T): Set<T> {
  const next = new Set(set);
  if (next.has(item)) next.delete(item);
  else next.add(item);
  return next;
}

/** Filters live behind one button (no permanent bar) — count badge shows how many are active. */
export function AgentFilters({ value, onChange, availableTags, tagDefinitions }: AgentFiltersProps) {
  const active = activeFilterCount(value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title="Filters"
          aria-pressed={active > 0}
          className={cn(active > 0 && 'border-accent-border bg-accent')}
        >
          <Filter className={cn(active > 0 && 'text-primary')} />
          Filters
          {active > 0 && (
            <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-foreground">{active}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-3 p-3">
        <FilterSection title="Provider">
          {ALL_PROVIDERS.map((p) => (
            <CheckRow
              key={p}
              id={`agents-provider-${p}`}
              label={PROVIDER_LABEL[p]}
              checked={value.providers.has(p)}
              onChange={() => onChange({ ...value, providers: toggleInSet<AgentProvider>(value.providers, p) })}
            />
          ))}
        </FilterSection>

        <FilterSection title="State">
          {ALL_STATES.map((s) => (
            <CheckRow
              key={s}
              id={`agents-state-${s}`}
              label={STATE_LABEL[s]}
              checked={value.states.has(s)}
              onChange={() => onChange({ ...value, states: toggleInSet<AgentState>(value.states, s) })}
            />
          ))}
        </FilterSection>

        {availableTags.length > 0 && (
          <FilterSection title="Tags">
            <div className="flex flex-wrap gap-1.5">
              {availableTags.map((tag) => {
                const isActive = value.tags.has(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onChange({ ...value, tags: toggleInSet(value.tags, tag) })}
                    className={cn(
                      'rounded-full transition-opacity',
                      isActive ? 'ring-2 ring-ring/50 ring-offset-1 ring-offset-background' : 'opacity-60 hover:opacity-100',
                    )}
                  >
                    <TagBadge tag={tag} tagDefinitions={tagDefinitions} />
                  </button>
                );
              })}
            </div>
          </FilterSection>
        )}

        <Separator />

        <div className="flex items-center justify-between">
          <Label htmlFor="agents-show-hidden" className="text-xs font-normal">Show hidden</Label>
          <Switch id="agents-show-hidden" checked={value.showHidden} onCheckedChange={(v) => onChange({ ...value, showHidden: v })} />
        </div>

        {active > 0 && (
          <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange(defaultFilters())}>
            Clear filters
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="eyebrow block">{title}</span>
      {children}
    </div>
  );
}

function CheckRow({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="cursor-pointer text-xs font-normal">{label}</Label>
    </div>
  );
}
