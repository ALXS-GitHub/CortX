import { useState, useMemo } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Search, Loader2, Check, ScanSearch, Star, Wrench } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useViewPrefsStore } from '@/stores/viewPrefsStore';
import { ToolCard } from './ToolCard';
import { ToolCardView } from './ToolCardView';
import { ToolCompactItem } from './ToolCompactItem';
import { ToolForm } from './ToolForm';
import { ViewModeToggle } from '@/components/ui/view-mode-toggle';
import { scanInstalledTools } from '@/lib/tauri';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Tool, CreateToolInput, UpdateToolInput, DiscoveredTool } from '@/types';

type SortOption = 'name' | 'created';

export function ToolsView() {
  const {
    tools,
    tagDefinitions,
    statusDefinitions,
    createTool,
    updateTool,
    deleteTool,
    selectTool,
  } = useAppStore();
  const { toolsViewMode, setToolsViewMode } = useViewPrefsStore();

  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>('name');
  const [showToolForm, setShowToolForm] = useState(false);
  const [editingTool, setEditingTool] = useState<Tool | undefined>(undefined);
  const [deletingTool, setDeletingTool] = useState<Tool | null>(null);
  // Scan state
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredTools, setDiscoveredTools] = useState<DiscoveredTool[]>([]);
  const [selectedDiscovered, setSelectedDiscovered] = useState<Set<string>>(new Set());
  const [showScanDialog, setShowScanDialog] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [scanTotal, setScanTotal] = useState(0);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  // All unique tags from tools + tag definitions
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const td of tagDefinitions) set.add(td.name);
    for (const t of tools) {
      for (const tag of t.tags) set.add(tag);
    }
    return Array.from(set).sort((a, b) => {
      const aDef = tagDefinitions.find((d) => d.name === a);
      const bDef = tagDefinitions.find((d) => d.name === b);
      const aOrder = aDef?.order ?? Infinity;
      const bOrder = bDef?.order ?? Infinity;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.localeCompare(b);
    });
  }, [tools, tagDefinitions]);

  // Unique statuses from statusDefinitions + existing tools
  const allStatuses = useMemo(() => {
    const set = new Set([
      ...statusDefinitions.map((d) => d.name),
      // A tool with a cleared status has an empty string: it is not a filter option.
      ...tools.map(t => t.status).filter(Boolean),
    ]);
    return Array.from(set);
  }, [tools, statusDefinitions]);

  const filteredTools = useMemo(() => {
    let result = tools;

    // Tag filter (OR semantics): show tools that have at least one selected tag
    if (selectedTags.size > 0) {
      result = result.filter((t) => t.tags.some((tag) => selectedTags.has(tag)));
    }

    if (selectedStatus) {
      result = result.filter((t) => t.status === selectedStatus);
    }

    if (favoritesOnly) {
      result = result.filter((t) => t.favorite);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
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
  }, [tools, selectedTags, selectedStatus, favoritesOnly, search, sort]);

  const handleCreateTool = async (data: CreateToolInput | UpdateToolInput) => {
    await createTool(data as CreateToolInput);
    toast.success('Tool created');
  };

  const handleUpdateTool = async (data: CreateToolInput | UpdateToolInput) => {
    if (!editingTool) return;
    await updateTool(editingTool.id, data as UpdateToolInput);
    toast.success('Tool updated');
  };

  const handleDeleteTool = async () => {
    if (!deletingTool) return;
    try {
      await deleteTool(deletingTool.id);
      toast.success('Tool deleted');
    } catch (e) {
      toast.error('Failed to delete tool', { description: String(e) });
    }
    setDeletingTool(null);
  };

  const handleScanTools = async () => {
    setIsScanning(true);
    try {
      const results = await scanInstalledTools();
      setScanTotal(results.length);
      const existingNames = new Set(tools.map(t => t.name.toLowerCase()));
      const newTools = results.filter(d => !existingNames.has(d.name.toLowerCase()));
      setDiscoveredTools(newTools);
      setSelectedDiscovered(new Set(newTools.map(d => `${d.source}:${d.name}`)));
      setShowScanDialog(true);
    } catch (e) {
      toast.error('Scan failed', { description: String(e) });
    } finally {
      setIsScanning(false);
    }
  };

  const toggleDiscoveredTool = (key: string) => {
    setSelectedDiscovered((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleImportDiscoveredTools = async () => {
    setIsImporting(true);
    try {
      let count = 0;
      for (const tool of discoveredTools) {
        const key = `${tool.source}:${tool.name}`;
        if (!selectedDiscovered.has(key)) continue;
        await createTool({
          name: tool.name,
          description: tool.description,
          version: tool.version,
          installMethod: tool.source,
          installLocation: tool.installLocation,
          homepage: tool.homepage,
          status: 'Active',
        });
        count++;
      }
      toast.success(`Imported ${count} tool(s)`);
      setShowScanDialog(false);
    } catch (e) {
      toast.error('Import failed', { description: String(e) });
    } finally {
      setIsImporting(false);
    }
  };

  const toolItemProps = (tool: Tool) => ({
    tool,
    tagDefinitions,
    onEdit: () => { setEditingTool(tool); setShowToolForm(true); },
    onDelete: () => setDeletingTool(tool),
    onClick: () => selectTool(tool.id),
    onToggleFavorite: () => handleToggleFavorite(tool),
  });

  const handleToggleFavorite = async (tool: Tool) => {
    try {
      await updateTool(tool.id, { favorite: !tool.favorite });
    } catch (e) {
      toast.error('Failed to update favorite', { description: String(e) });
    }
  };

  const openAddForm = () => {
    setEditingTool(undefined);
    setShowToolForm(true);
  };

  const renderToolList = (toolList: Tool[]) => {
    if (toolList.length === 0) return null;
    if (toolsViewMode === 'card') {
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {toolList.map((tool) => <ToolCardView key={tool.id} {...toolItemProps(tool)} />)}
        </div>
      );
    }
    if (toolsViewMode === 'compact') {
      return (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-soft">
          {toolList.map((tool) => <ToolCompactItem key={tool.id} {...toolItemProps(tool)} />)}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {toolList.map((tool) => <ToolCard key={tool.id} {...toolItemProps(tool)} />)}
      </div>
    );
  };

  const subtitle = `${tools.length} tool${tools.length !== 1 ? 's' : ''}`;

  return (
    <Screen
      title="Tools"
      subtitle={subtitle}
      actions={
        <>
          <Button variant="outline" onClick={handleScanTools} disabled={isScanning}>
            {isScanning ? <Loader2 className="animate-spin" /> : <ScanSearch />}
            {isScanning ? 'Scanning…' : 'Scan installed'}
          </Button>
          <Button onClick={openAddForm}>
            <Plus />
            Add tool
          </Button>
        </>
      }
      toolbar={
        <>
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              placeholder="Search tools…"
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
              {allStatuses.map(s => (
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
            <ViewModeToggle value={toolsViewMode} onChange={setToolsViewMode} />
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
      {filteredTools.length === 0 ? (
        tools.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No tools yet"
            description="Track your dev tools, CLI utilities and their configurations from one place."
            action={
              <>
                <Button variant="outline" onClick={handleScanTools} disabled={isScanning}>
                  {isScanning ? <Loader2 className="animate-spin" /> : <ScanSearch />}
                  Scan installed
                </Button>
                <Button onClick={openAddForm}>
                  <Plus />
                  Add tool
                </Button>
              </>
            }
          />
        ) : (
          <EmptyState icon={Search} title="No matching tools" description="Try a different search or clear the filters." />
        )
      ) : (
        renderToolList(filteredTools)
      )}

      {/* Tool Form */}
      <ToolForm
        open={showToolForm}
        onOpenChange={(open) => {
          setShowToolForm(open);
          if (!open) setEditingTool(undefined);
        }}
        tool={editingTool}
        tools={tools}
        tagDefinitions={tagDefinitions}
        statusDefinitions={statusDefinitions}
        onSubmit={editingTool ? handleUpdateTool : handleCreateTool}
      />

      {/* Delete Tool Confirmation */}
      <AlertDialog open={!!deletingTool} onOpenChange={(open) => !open && setDeletingTool(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tool</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deletingTool?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteTool}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Scan Results Dialog */}
      <Dialog open={showScanDialog} onOpenChange={setShowScanDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Discovered tools</DialogTitle>
            <DialogDescription>
              {discoveredTools.length === 0 && scanTotal === 0
                ? 'No tools found. Make sure Scoop or Chocolatey is installed.'
                : discoveredTools.length === 0
                  ? `Found ${scanTotal} tool(s), but all are already imported.`
                  : `Found ${discoveredTools.length} new tool(s)${scanTotal > discoveredTools.length ? ` (${scanTotal - discoveredTools.length} already imported)` : ''}. Select which ones to import.`}
            </DialogDescription>
          </DialogHeader>

          {discoveredTools.length > 0 && (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card/50">
              <div className="space-y-0.5 p-1.5">
                {discoveredTools.map((tool) => {
                  const key = `${tool.source}:${tool.name}`;
                  return (
                    <label
                      key={key}
                      className="flex cursor-pointer items-start gap-3 rounded-sm px-2.5 py-2 transition-colors hover:bg-accent/60"
                    >
                      <Checkbox
                        checked={selectedDiscovered.has(key)}
                        onCheckedChange={() => toggleDiscoveredTool(key)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium">{tool.name}</span>
                          {tool.version && (
                            <Badge variant="outline" className="font-mono">{tool.version}</Badge>
                          )}
                          <Badge variant={tool.source === 'scoop' ? 'info' : 'warning'}>{tool.source}</Badge>
                        </div>
                        {tool.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{tool.description}</p>
                        )}
                        {tool.installLocation && (
                          <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{tool.installLocation}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter className="shrink-0">
            <Button variant="ghost" onClick={() => setShowScanDialog(false)}>
              Cancel
            </Button>
            {discoveredTools.length > 0 && (
              <Button onClick={handleImportDiscoveredTools} disabled={selectedDiscovered.size === 0 || isImporting}>
                {isImporting ? <Loader2 className="animate-spin" /> : <Check />}
                Import {selectedDiscovered.size} tool(s)
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Screen>
  );
}
