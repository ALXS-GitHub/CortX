import { useState, useMemo } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Search, Star, AppWindow } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useViewPrefsStore } from '@/stores/viewPrefsStore';
import { AppCard } from './AppCard';
import { AppCardView } from './AppCardView';
import { AppCompactItem } from './AppCompactItem';
import { AppForm } from './AppForm';
import { ViewModeToggle } from '@/components/ui/view-mode-toggle';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { App, CreateAppInput, UpdateAppInput } from '@/types';

type SortOption = 'name' | 'created';

const DEFAULT_STATUSES = ['Active', 'Inactive', 'To Test', 'Archived', 'Replaced'];

export function AppsView() {
  const {
    apps,
    tagDefinitions,
    statusDefinitions,
    createApp,
    updateAppItem,
    deleteApp,
    selectApp,
  } = useAppStore();
  const { appsViewMode, setAppsViewMode } = useViewPrefsStore();

  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>('name');
  const [showAppForm, setShowAppForm] = useState(false);
  const [editingApp, setEditingApp] = useState<App | undefined>(undefined);
  const [deletingApp, setDeletingApp] = useState<App | null>(null);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  // All unique tags from apps + tag definitions
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const td of tagDefinitions) set.add(td.name);
    for (const a of apps) {
      for (const tag of a.tags) set.add(tag);
    }
    return Array.from(set).sort((a, b) => {
      const aDef = tagDefinitions.find((d) => d.name === a);
      const bDef = tagDefinitions.find((d) => d.name === b);
      const aOrder = aDef?.order ?? Infinity;
      const bOrder = bDef?.order ?? Infinity;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.localeCompare(b);
    });
  }, [apps, tagDefinitions]);

  // Unique statuses from statusDefinitions + existing apps
  const allStatuses = useMemo(() => {
    const set = new Set([
      ...DEFAULT_STATUSES,
      ...statusDefinitions.map((d) => d.name),
      ...apps.map((a) => a.status).filter(Boolean) as string[],
    ]);
    return Array.from(set);
  }, [apps, statusDefinitions]);

  const filteredApps = useMemo(() => {
    let result = apps;

    // Tag filter (OR semantics): show apps that have at least one selected tag
    if (selectedTags.size > 0) {
      result = result.filter((a) => a.tags.some((tag) => selectedTags.has(tag)));
    }

    if (selectedStatus) {
      result = result.filter((a) => a.status === selectedStatus);
    }

    if (favoritesOnly) {
      result = result.filter((a) => a.favorite);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description?.toLowerCase().includes(q) ||
          a.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }

    return result.slice().sort((a, b) => {
      // Favorites float to the top of whatever sort is active.
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      switch (sort) {
        case 'created': return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default: return a.name.localeCompare(b.name);
      }
    });
  }, [apps, selectedTags, selectedStatus, favoritesOnly, search, sort]);

  const handleCreateApp = async (data: CreateAppInput | UpdateAppInput) => {
    await createApp(data as CreateAppInput);
    toast.success('App created');
  };

  const handleUpdateApp = async (data: CreateAppInput | UpdateAppInput) => {
    if (!editingApp) return;
    await updateAppItem(editingApp.id, data as UpdateAppInput);
    toast.success('App updated');
  };

  const handleDeleteApp = async () => {
    if (!deletingApp) return;
    try {
      await deleteApp(deletingApp.id);
      toast.success('App deleted');
    } catch (e) {
      toast.error('Failed to delete app', { description: String(e) });
    }
    setDeletingApp(null);
  };

  const handleToggleFavorite = async (app: App) => {
    try {
      await updateAppItem(app.id, { favorite: !app.favorite });
    } catch (e) {
      toast.error('Failed to update favorite', { description: String(e) });
    }
  };

  const appItemProps = (app: App) => ({
    app,
    tagDefinitions,
    onEdit: () => { setEditingApp(app); setShowAppForm(true); },
    onDelete: () => setDeletingApp(app),
    onClick: () => selectApp(app.id),
    onToggleFavorite: () => handleToggleFavorite(app),
  });

  const openAddForm = () => {
    setEditingApp(undefined);
    setShowAppForm(true);
  };

  const renderAppList = (appList: App[]) => {
    if (appList.length === 0) return null;
    if (appsViewMode === 'card') {
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {appList.map((app) => <AppCardView key={app.id} {...appItemProps(app)} />)}
        </div>
      );
    }
    if (appsViewMode === 'compact') {
      return (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-soft">
          {appList.map((app) => <AppCompactItem key={app.id} {...appItemProps(app)} />)}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {appList.map((app) => <AppCard key={app.id} {...appItemProps(app)} />)}
      </div>
    );
  };

  const subtitle = `${apps.length} app${apps.length !== 1 ? 's' : ''}`;

  return (
    <Screen
      title="Apps"
      subtitle={subtitle}
      actions={
        <Button onClick={openAddForm}>
          <Plus />
          Add app
        </Button>
      }
      toolbar={
        <>
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              placeholder="Search apps…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select
            value={selectedStatus ?? '__all__'}
            onValueChange={(v) => setSelectedStatus(v === '__all__' ? null : v)}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              {allStatuses.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="created">Date created</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            onClick={() => setFavoritesOnly((v) => !v)}
            aria-pressed={favoritesOnly}
            title="Show favorites only"
            className={cn(favoritesOnly && 'border-accent-border bg-accent')}
          >
            <Star className={favoritesOnly ? 'fill-warning text-warning' : ''} />
            Favorites
          </Button>

          <div className="ml-auto">
            <ViewModeToggle value={appsViewMode} onChange={setAppsViewMode} />
          </div>

          {allTags.length > 0 && (
            <div className="flex w-full flex-wrap items-center gap-1.5">
              {allTags.map((tag) => {
                const isActive = selectedTags.has(tag);
                const def = tagDefinitions.find((d) => d.name.toLowerCase() === tag.toLowerCase());
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    aria-pressed={isActive}
                    className={cn('rounded-full transition-opacity', isActive ? 'ring-2 ring-ring/50 ring-offset-1 ring-offset-background' : 'opacity-60 hover:opacity-100')}
                  >
                    <Chip color={def?.color} neutral={!def?.color} dot={false}>
                      {tag}
                    </Chip>
                  </button>
                );
              })}
              {selectedTags.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedTags(new Set())}
                  className="ml-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </>
      }
    >
      {filteredApps.length === 0 ? (
        apps.length === 0 ? (
          <EmptyState
            icon={AppWindow}
            title="No apps yet"
            description="Register your GUI applications to track them and launch them from here."
            action={
              <Button onClick={openAddForm}>
                <Plus />
                Add app
              </Button>
            }
          />
        ) : (
          <EmptyState icon={Search} title="No matching apps" description="Try a different search or clear the filters." />
        )
      ) : (
        renderAppList(filteredApps)
      )}

      {/* App Form */}
      <AppForm
        open={showAppForm}
        onOpenChange={(open) => {
          setShowAppForm(open);
          if (!open) setEditingApp(undefined);
        }}
        app={editingApp}
        apps={apps}
        tagDefinitions={tagDefinitions}
        statusDefinitions={statusDefinitions}
        onSubmit={editingApp ? handleUpdateApp : handleCreateApp}
      />

      {/* Delete App Confirmation */}
      <AlertDialog open={!!deletingApp} onOpenChange={(open) => !open && setDeletingApp(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete app</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deletingApp?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteApp}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Screen>
  );
}
