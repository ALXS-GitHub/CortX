import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { Plus, Search, Loader2, Check, ScanSearch } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useViewPrefsStore } from '@/stores/viewPrefsStore';
import { ToolCard } from './ToolCard';
import { ToolCardView } from './ToolCardView';
import { ToolCompactItem } from './ToolCompactItem';
import { ToolForm } from './ToolForm';
import { ViewModeToggle } from '@/components/ui/view-mode-toggle';
import { TagBadge } from '@/components/ui/TagBadge';
import { scanInstalledTools } from '@/lib/tauri';
import { toast } from 'sonner';
import type { Tool, CreateToolInput, UpdateToolInput, DiscoveredTool } from '@/types';

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
      ...tools.map(t => t.status),
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

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }

    return result.slice().sort((a, b) => a.order - b.order);
  }, [tools, selectedTags, selectedStatus, search]);

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
  });

  const renderToolList = (toolList: Tool[]) => {
    if (toolList.length === 0) return null;
    if (toolsViewMode === 'card') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {toolList.map((tool) => <ToolCardView key={tool.id} {...toolItemProps(tool)} />)}
        </div>
      );
    }
    if (toolsViewMode === 'compact') {
      return (
        <div className="space-y-1">
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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tools</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track your dev tools, CLI utilities, and their configurations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleScanTools} disabled={isScanning}>
            {isScanning ? <Loader2 className="size-4 mr-2 animate-spin" /> : <ScanSearch className="size-4 mr-2" />}
            {isScanning ? 'Scanning...' : 'Scan Installed'}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingTool(undefined);
              setShowToolForm(true);
            }}
          >
            <Plus className="size-4 mr-2" />
            Add Tool
          </Button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search tools..."
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
            {allStatuses.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ViewModeToggle value={toolsViewMode} onChange={setToolsViewMode} />
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

      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap">
        <Badge
          variant={selectedStatus === null ? 'default' : 'outline'}
          className="cursor-pointer"
          onClick={() => setSelectedStatus(null)}
        >
          All ({tools.length})
        </Badge>
        {allStatuses.map(status => {
          const count = tools.filter(t => t.status === status).length;
          if (count === 0) return null;
          return (
            <Badge
              key={status}
              variant={selectedStatus === status ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setSelectedStatus(selectedStatus === status ? null : status)}
            >
              {status} ({count})
            </Badge>
          );
        })}
      </div>

      {/* Tools list */}
      {filteredTools.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-lg font-medium">No tools yet</p>
          <p className="text-sm mt-1">Register your first tool to get started</p>
          <Button
            className="mt-4"
            onClick={() => {
              setEditingTool(undefined);
              setShowToolForm(true);
            }}
          >
            <Plus className="size-4 mr-2" />
            Add Tool
          </Button>
        </div>
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
            <AlertDialogTitle>Delete Tool</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingTool?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTool}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Scan Results Dialog */}
      <Dialog open={showScanDialog} onOpenChange={setShowScanDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Discovered Tools</DialogTitle>
            <DialogDescription>
              {discoveredTools.length === 0 && scanTotal === 0
                ? 'No tools found. Make sure Scoop or Chocolatey is installed.'
                : discoveredTools.length === 0
                  ? `Found ${scanTotal} tool(s), but all are already imported.`
                  : `Found ${discoveredTools.length} new tool(s)${scanTotal > discoveredTools.length ? ` (${scanTotal - discoveredTools.length} already imported)` : ''}. Select which ones to import.`}
            </DialogDescription>
          </DialogHeader>

          {discoveredTools.length > 0 && (
            <div className="flex-1 min-h-0 overflow-y-auto border rounded-md">
              <div className="space-y-1 p-2">
                {discoveredTools.map((tool) => {
                  const key = `${tool.source}:${tool.name}`;
                  return (
                    <label
                      key={key}
                      className="flex items-start gap-3 p-2 rounded-md hover:bg-muted cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedDiscovered.has(key)}
                        onCheckedChange={() => toggleDiscoveredTool(key)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{tool.name}</span>
                          {tool.version && (
                            <Badge variant="outline" className="text-xs">
                              {tool.version}
                            </Badge>
                          )}
                          <Badge
                            variant="secondary"
                            className={`text-xs ${tool.source === 'scoop' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'}`}
                          >
                            {tool.source}
                          </Badge>
                        </div>
                        {tool.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{tool.description}</p>
                        )}
                        {tool.installLocation && (
                          <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">{tool.installLocation}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setShowScanDialog(false)}>
              Cancel
            </Button>
            {discoveredTools.length > 0 && (
              <Button onClick={handleImportDiscoveredTools} disabled={selectedDiscovered.size === 0 || isImporting}>
                {isImporting ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Check className="size-4 mr-2" />
                )}
                Import {selectedDiscovered.size} tool(s)
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
