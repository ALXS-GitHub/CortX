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
import { AliasCard } from './AliasCard';
import { AliasCardView } from './AliasCardView';
import { AliasCompactItem } from './AliasCompactItem';
import { AliasForm } from './AliasForm';
import { ViewModeToggle } from '@/components/ui/view-mode-toggle';
import { TagBadge } from '@/components/ui/TagBadge';
import { toast } from 'sonner';
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
      switch (sort) {
        case 'created': return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default: return a.name.localeCompare(b.name);
      }
    });
  }, [aliases, selectedTags, selectedStatus, search, sort]);

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

  const aliasItemProps = (alias: ShellAlias) => ({
    alias,
    tagDefinitions,
    onEdit: () => { setEditingAlias(alias); setShowAliasForm(true); },
    onDelete: () => setDeletingAlias(alias),
    onClick: () => selectAlias(alias.id),
  });

  const renderAliasList = (aliasList: ShellAlias[]) => {
    if (aliasList.length === 0) return null;
    if (aliasesViewMode === 'card') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {aliasList.map((alias) => <AliasCardView key={alias.id} {...aliasItemProps(alias)} />)}
        </div>
      );
    }
    if (aliasesViewMode === 'compact') {
      return (
        <div className="space-y-1">
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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Shell Config</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage shell functions, init scripts, and aliases for your terminal
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setEditingAlias(undefined);
              setShowAliasForm(true);
            }}
          >
            <Plus className="size-4 mr-2" />
            Add Alias
          </Button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search shell config..."
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
        )}

        <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
          <SelectTrigger size="sm" className="w-[140px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="created">Date Created</SelectItem>
          </SelectContent>
        </Select>

        <ViewModeToggle value={aliasesViewMode} onChange={setAliasesViewMode} />
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

      {/* Aliases list */}
      {filteredAliases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-lg font-medium">No shell config yet</p>
          <p className="text-sm mt-1">Create your first shell function, init, or script to get started</p>
          <Button
            className="mt-4"
            onClick={() => {
              setEditingAlias(undefined);
              setShowAliasForm(true);
            }}
          >
            <Plus className="size-4 mr-2" />
            Add Alias
          </Button>
        </div>
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
            <AlertDialogTitle>Delete Shell Config</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingAlias?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAlias}
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
