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
import { Plus, Search, Star, SquareTerminal } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useViewPrefsStore } from '@/stores/viewPrefsStore';
import { AliasCard } from './AliasCard';
import { AliasCardView } from './AliasCardView';
import { AliasCompactItem } from './AliasCompactItem';
import { AliasForm } from './AliasForm';
import { ViewModeToggle } from '@/components/ui/view-mode-toggle';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { ShellAlias, CreateShellAliasInput, UpdateShellAliasInput } from '@/types';

type SortOption = 'name' | 'created';

export function AliasesView() {
  const {
    aliases,
    tools,
    tagDefinitions,
    statusDefinitions,
    createAlias,
    updateAlias,
    deleteAlias,
    selectAlias,
  } = useAppStore();
  const { aliasesViewMode, setAliasesViewMode } = useViewPrefsStore();

  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>('name');
  const [showAliasForm, setShowAliasForm] = useState(false);
  const [editingAlias, setEditingAlias] = useState<ShellAlias | undefined>(undefined);
  const [deletingAlias, setDeletingAlias] = useState<ShellAlias | null>(null);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  // All unique tags
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const td of tagDefinitions) set.add(td.name);
    for (const a of aliases) {
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
  }, [aliases, tagDefinitions]);

  // Unique statuses from statusDefinitions + existing aliases
  const allStatuses = useMemo(() => {
    const set = new Set([
      ...statusDefinitions.map((d) => d.name),
      ...aliases.map((a) => a.status).filter(Boolean) as string[],
    ]);
    return Array.from(set);
  }, [aliases, statusDefinitions]);

  const filteredAliases = useMemo(() => {
    let result = aliases;

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
          a.command.toLowerCase().includes(q) ||
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
  }, [aliases, selectedTags, selectedStatus, favoritesOnly, search, sort]);

  const handleCreateAlias = async (data: CreateShellAliasInput | UpdateShellAliasInput) => {
    await createAlias(data as CreateShellAliasInput);
    toast.success('Alias created');
  };

  const handleUpdateAlias = async (data: CreateShellAliasInput | UpdateShellAliasInput) => {
    if (!editingAlias) return;
    await updateAlias(editingAlias.id, data as UpdateShellAliasInput);
    toast.success('Alias updated');
  };

  const handleDeleteAlias = async () => {
    if (!deletingAlias) return;
    try {
      await deleteAlias(deletingAlias.id);
      toast.success('Alias deleted');
    } catch (e) {
      toast.error('Failed to delete alias', { description: String(e) });
    }
    setDeletingAlias(null);
  };

  const handleToggleFavorite = async (alias: ShellAlias) => {
    try {
      await updateAlias(alias.id, { favorite: !alias.favorite });
    } catch (e) {
      toast.error('Failed to update favorite', { description: String(e) });
    }
  };

  const aliasItemProps = (alias: ShellAlias) => ({
    alias,
    tagDefinitions,
    onEdit: () => { setEditingAlias(alias); setShowAliasForm(true); },
    onDelete: () => setDeletingAlias(alias),
    onClick: () => selectAlias(alias.id),
    onToggleFavorite: () => handleToggleFavorite(alias),
  });

  const openAddForm = () => {
    setEditingAlias(undefined);
    setShowAliasForm(true);
  };

  const renderAliasList = (aliasList: ShellAlias[]) => {
    if (aliasList.length === 0) return null;
    if (aliasesViewMode === 'card') {
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {aliasList.map((alias) => <AliasCardView key={alias.id} {...aliasItemProps(alias)} />)}
        </div>
      );
    }
    if (aliasesViewMode === 'compact') {
      return (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-soft">
          {aliasList.map((alias) => <AliasCompactItem key={alias.id} {...aliasItemProps(alias)} />)}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {aliasList.map((alias) => <AliasCard key={alias.id} {...aliasItemProps(alias)} />)}
      </div>
    );
  };

  const subtitle = `${aliases.length} alias${aliases.length !== 1 ? 'es' : ''}`;

  return (
    <Screen
      title="Shell Config"
      subtitle={subtitle}
      actions={
        <Button onClick={openAddForm}>
          <Plus />
          Add alias
        </Button>
      }
      toolbar={
        <>
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              placeholder="Search shell config…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {allStatuses.length > 0 && (
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
          )}

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
            <ViewModeToggle value={aliasesViewMode} onChange={setAliasesViewMode} />
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
      {filteredAliases.length === 0 ? (
        aliases.length === 0 ? (
          <EmptyState
            icon={SquareTerminal}
            title="No shell config yet"
            description="Create your first shell function, init or script to get started."
            action={
              <Button onClick={openAddForm}>
                <Plus />
                Add alias
              </Button>
            }
          />
        ) : (
          <EmptyState icon={Search} title="No matching entries" description="Try a different search or clear the filters." />
        )
      ) : (
        renderAliasList(filteredAliases)
      )}

      {/* Alias Form */}
      <AliasForm
        open={showAliasForm}
        onOpenChange={(open) => {
          setShowAliasForm(open);
          if (!open) setEditingAlias(undefined);
        }}
        alias={editingAlias}
        aliases={aliases}
        tools={tools}
        tagDefinitions={tagDefinitions}
        statusDefinitions={statusDefinitions}
        onSubmit={editingAlias ? handleUpdateAlias : handleCreateAlias}
      />

      {/* Delete Alias Confirmation */}
      <AlertDialog open={!!deletingAlias} onOpenChange={(open) => !open && setDeletingAlias(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete shell config</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deletingAlias?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteAlias}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Screen>
  );
}
