import { Suspense, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Search, Wand2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

import { useUtilityContext } from './context';
import { UTILITIES, getUtility, type RegisteredUtility } from './registry';
import { UTILITY_CATEGORY_LABELS, type UtilityCategory } from './types';

function UtilityCard({ utility, onOpen }: { utility: RegisteredUtility; onOpen: () => void }) {
  const { meta } = utility;
  const Icon = meta.icon;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/40"
    >
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
            <Icon className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">{meta.name}</CardTitle>
            <CardDescription className="line-clamp-2">{meta.description}</CardDescription>
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
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <p className="mt-4 text-sm text-muted-foreground">Unknown utility: {id}</p>
      </div>
    );
  }

  const { meta, Panel } = utility;
  const Icon = meta.icon;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to utilities">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{meta.name}</h2>
          <p className="truncate text-sm text-muted-foreground">{meta.description}</p>
        </div>
      </div>

      <div className="flex-1 p-6">
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
      </div>
    </div>
  );
}

export function UtilitiesView() {
  const [openId, setOpenId] = useState<string | null>(null);
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
    return <UtilityHost id={openId} onBack={() => setOpenId(null)} />;
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Utilities</h1>
        <p className="text-sm text-muted-foreground">
          Small offline tools — no upload, no online converter.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search utilities…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        {categories.map((c) => (
          <Badge
            key={c}
            variant={category === c ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setCategory(category === c ? null : c)}
          >
            {UTILITY_CATEGORY_LABELS[c]}
          </Badge>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <Wand2 className="mb-3 size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {UTILITIES.length === 0 ? 'No utility installed yet.' : 'No utility matches.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((u) => (
            <UtilityCard key={u.meta.id} utility={u} onOpen={() => setOpenId(u.meta.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
