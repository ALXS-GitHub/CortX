import { Suspense, useMemo, useState } from 'react';
import { Loader2, Search, Wand2 } from 'lucide-react';

import { Screen } from '@/components/layout/Screen';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { useUtilityContext } from './context';
import { useUtilitySelection } from './selection';
import { UTILITIES, getUtility, type RegisteredUtility } from './registry';
import { UTILITY_CATEGORY_LABELS, type UtilityCategory } from './types';

function UtilityCard({ utility, onOpen }: { utility: RegisteredUtility; onOpen: () => void }) {
  const { meta } = utility;
  const Icon = meta.icon;

  return (
    <Card
      interactive
      size="sm"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[var(--rad-sm)] bg-accent text-primary">
            <Icon className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">{meta.name}</CardTitle>
            <CardDescription className="line-clamp-2 text-xs">{meta.description}</CardDescription>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

function UtilityHost({ id, onBack }: { id: string; onBack: () => void }) {
  const utility = getUtility(id);
  // Hooks must run unconditionally, so build the context before the guard.
  const ctx = useUtilityContext(id);

  if (!utility) {
    return (
      <Screen title="Unknown utility" eyebrow="Utilities" onBack={onBack} backLabel="Back to utilities">
        <p className="text-sm text-muted-foreground">Unknown utility: <span className="font-mono text-[11px]">{id}</span></p>
      </Screen>
    );
  }

  const { meta, Panel } = utility;
  const Icon = meta.icon;

  return (
    <Screen
      eyebrow="Utilities"
      title={
        <span className="inline-flex items-center gap-2">
          <Icon className="size-4 shrink-0 text-primary" />
          {meta.name}
        </span>
      }
      subtitle={meta.description}
      onBack={onBack}
      backLabel="Back to utilities"
    >
      <Suspense
        fallback={
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        }
      >
        <Panel meta={meta} ctx={ctx} />
      </Suspense>
    </Screen>
  );
}

export function UtilitiesView() {
  const { openId, openUtility } = useUtilitySelection();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<UtilityCategory | null>(null);

  const categories = useMemo(() => {
    const present = new Set(UTILITIES.map((u) => u.meta.category));
    return (Object.keys(UTILITY_CATEGORY_LABELS) as UtilityCategory[]).filter((c) =>
      present.has(c),
    );
  }, []);

  const filtered = useMemo(() => {
    let result = UTILITIES;

    if (category) {
      result = result.filter((u) => u.meta.category === category);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (u) =>
          u.meta.name.toLowerCase().includes(q) ||
          u.meta.description.toLowerCase().includes(q) ||
          u.meta.keywords?.some((k) => k.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [search, category]);

  if (openId) {
    return <UtilityHost id={openId} onBack={() => openUtility(null)} />;
  }

  const count = UTILITIES.length;

  return (
    <Screen
      title="Utilities"
      subtitle={`${count} module${count !== 1 ? 's' : ''} · small offline tools, no upload, no online converter`}
      toolbar={
        <>
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              placeholder="Search utilities…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {categories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {categories.map((c) => {
                const isActive = category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setCategory(isActive ? null : c)}
                    className={cn(
                      'rounded-full transition-opacity',
                      isActive ? 'ring-2 ring-ring/50 ring-offset-1 ring-offset-background' : 'opacity-60 hover:opacity-100',
                    )}
                  >
                    <Chip dot={false} neutral={!isActive}>
                      {UTILITY_CATEGORY_LABELS[c]}
                    </Chip>
                  </button>
                );
              })}
            </div>
          )}
        </>
      }
    >
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong">
          <EmptyState
            compact
            icon={Wand2}
            title={UTILITIES.length === 0 ? 'No utility installed yet' : 'No utility matches'}
            description={UTILITIES.length === 0 ? undefined : 'Try a different search or clear the category filter.'}
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((u) => (
            <UtilityCard key={u.meta.id} utility={u} onOpen={() => openUtility(u.meta.id)} />
          ))}
        </div>
      )}
    </Screen>
  );
}
