import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Plus, Search } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useViewPrefsStore } from '@/stores/viewPrefsStore';
import { AppCard } from './AppCard';
import { AppCardView } from './AppCardView';
import { AppCompactItem } from './AppCompactItem';
import { AppForm } from './AppForm';
import { ViewModeToggle } from '@/components/ui/view-mode-toggle';
import { TagBadge } from '@/components/ui/TagBadge';
import { toast } from 'sonner';
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
      switch (sort) {
        case 'created': return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default: return a.name.localeCompare(b.name);
      }
    });
  }, [apps, selectedTags, selectedStatus, search, sort]);

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

  const appItemProps = (app: App) => ({
    app,
    tagDefinitions,
    onEdit: () => { setEditingApp(app); setShowAppForm(true); },
    onDelete: () => setDeletingApp(app),
    onClick: () => selectApp(app.id),
  });

  const renderAppList = (appList: App[]) => {
    if (appList.length === 0) return null;
    if (appsViewMode === 'card') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {appList.map((app) => <AppCardView key={app.id} {...appItemProps(app)} />)}
        </div>
      );
    }
    if (appsViewMode === 'compact') {
      return (
        <div className="space-y-1">
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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Apps</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track your GUI applications and launch them quickly
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setEditingApp(undefined);
              setShowAppForm(true);
            }}
          >
            <Plus className="size-4 mr-2" />
            Add App
          </Button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search apps..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={selectedStatus ?? '__all__'}
          onValueChange={(v) => setSelectedStatus(v === '__all__' ? null : v)}
        >
          <SelectTrigger size="sm" className="w-[140px]">
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
          <SelectTrigger size="sm" className="w-[140px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="created">Date Created</SelectItem>
          </SelectContent>
        </Select>

        <ViewModeToggle value={appsViewMode} onChange={setAppsViewMode} />
      </div>

      {/* Tag filter pills */}
      {allTags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {allTags.map((tag) => {
            const isActive = selectedTags.has(tag);
            return (
              <button
                key={tag}
                type="button"
                className="cursor-pointer"
                onClick={() => toggleTag(tag)}
              >
                <TagBadge
                  tag={tag}
                  tagDefinitions={tagDefinitions}
                  className={isActive ? 'ring-2 ring-primary ring-offset-1' : 'opacity-60 hover:opacity-100'}
                />
              </button>
            );
          })}
          {selectedTags.size > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground ml-1 cursor-pointer"
              onClick={() => setSelectedTags(new Set())}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Apps list */}
      {filteredApps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-lg font-medium">No apps yet</p>
          <p className="text-sm mt-1">Register your first app to get started</p>
          <Button
            className="mt-4"
            onClick={() => {
              setEditingApp(undefined);
              setShowAppForm(true);
            }}
          >
            <Plus className="size-4 mr-2" />
            Add App
          </Button>
        </div>
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
            <AlertDialogTitle>Delete App</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingApp?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteApp}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
