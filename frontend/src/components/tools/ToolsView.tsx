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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Plus, Search, FolderPlus, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useViewPrefsStore } from '@/stores/viewPrefsStore';
import { ToolCard } from './ToolCard';
import { ToolCardView } from './ToolCardView';
import { ToolCompactItem } from './ToolCompactItem';
import { ToolForm } from './ToolForm';
import { ViewModeToggle } from '@/components/ui/view-mode-toggle';
import { FolderForm } from '@/components/global-scripts/FolderManager';
import { toast } from 'sonner';
import type { Tool, CreateToolInput, UpdateToolInput, VirtualFolder, CreateFolderInput, UpdateFolderInput } from '@/types';

const DEFAULT_STATUSES = ['Active', 'Inactive', 'To Test', 'Archived', 'Replaced'];

export function ToolsView() {
  const {
    tools,
    folders,
    createTool,
    updateTool,
    deleteTool,
    selectTool,
    createFolder,
    updateFolder,
    deleteFolder,
  } = useAppStore();
  const { toolsViewMode, setToolsViewMode } = useViewPrefsStore();

  const [search, setSearch] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showToolForm, setShowToolForm] = useState(false);
  const [editingTool, setEditingTool] = useState<Tool | undefined>(undefined);
  const [deletingTool, setDeletingTool] = useState<Tool | null>(null);
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [editingFolder, setEditingFolder] = useState<VirtualFolder | undefined>(undefined);
  const [deletingFolder, setDeletingFolder] = useState<VirtualFolder | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const toggleFolderCollapse = (folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const toolFolders = useMemo(
    () => folders
      .filter(f => f.folderType === 'tool')
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity)),
    [folders]
  );

  const selectedFolder = useMemo(
    () => toolFolders.find((f) => f.id === selectedFolderId),
    [toolFolders, selectedFolderId]
  );

  // Unique statuses and categories from existing tools
  const allStatuses = useMemo(() => {
    const set = new Set([...DEFAULT_STATUSES, ...tools.map(t => t.status)]);
    return Array.from(set);
  }, [tools]);

  const allCategories = useMemo(() => {
    const set = new Set(tools.map(t => t.category).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [tools]);

  const filteredTools = useMemo(() => {
    let result = tools;

    if (selectedFolderId) {
      result = result.filter((t) => t.folderId === selectedFolderId);
    }

    if (selectedStatus) {
      result = result.filter((t) => t.status === selectedStatus);
    }

    if (selectedCategory) {
      result = result.filter((t) => t.category === selectedCategory);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.category?.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }

    return result.slice().sort((a, b) => a.order - b.order);
  }, [tools, selectedFolderId, selectedStatus, selectedCategory, search]);

  const unfolderedTools = useMemo(
    () => filteredTools.filter((t) => !t.folderId),
    [filteredTools]
  );

  const toolsByFolder = useMemo(() => {
    const map = new Map<string, Tool[]>();
    for (const t of filteredTools) {
      if (t.folderId) {
        const existing = map.get(t.folderId) || [];
        existing.push(t);
        map.set(t.folderId, existing);
      }
    }
    return map;
  }, [filteredTools]);

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

  const handleCreateFolder = async (data: CreateFolderInput | UpdateFolderInput) => {
    await createFolder(data as CreateFolderInput);
    toast.success('Folder created');
  };

  const handleUpdateFolder = async (data: CreateFolderInput | UpdateFolderInput) => {
    if (!editingFolder) return;
    await updateFolder(editingFolder.id, data as UpdateFolderInput);
    toast.success('Folder updated');
  };

  const handleDeleteFolder = async () => {
    if (!deletingFolder) return;
    try {
      await deleteFolder(deletingFolder.id);
      if (selectedFolderId === deletingFolder.id) {
        setSelectedFolderId(null);
      }
      toast.success('Folder deleted');
    } catch (e) {
      toast.error('Failed to delete folder', { description: String(e) });
    }
    setDeletingFolder(null);
  };

  const toolItemProps = (tool: Tool) => ({
    key: tool.id,
    tool,
    onEdit: () => { setEditingTool(tool); setShowToolForm(true); },
    onDelete: () => setDeletingTool(tool),
    onClick: () => selectTool(tool.id),
  });

  const renderToolList = (toolList: Tool[]) => {
    if (toolList.length === 0) return null;
    if (toolsViewMode === 'card') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {toolList.map((tool) => <ToolCardView {...toolItemProps(tool)} />)}
        </div>
      );
    }
    if (toolsViewMode === 'compact') {
      return (
        <div className="space-y-1">
          {toolList.map((tool) => <ToolCompactItem {...toolItemProps(tool)} />)}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {toolList.map((tool) => <ToolCard {...toolItemProps(tool)} />)}
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

        {allCategories.length > 0 && (
          <Select
            value={selectedCategory ?? '__all__'}
            onValueChange={(v) => setSelectedCategory(v === '__all__' ? null : v)}
          >
            <SelectTrigger size="sm" className="w-[160px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All categories</SelectItem>
              {allCategories.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex items-center gap-1.5">
          <Select
            value={selectedFolderId ?? '__all__'}
            onValueChange={(v) => setSelectedFolderId(v === '__all__' ? null : v)}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All folders</SelectItem>
              {toolFolders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: folder.color || '#6b7280' }}
                    />
                    {folder.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedFolder && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="size-8 p-0"
                onClick={() => {
                  setEditingFolder(selectedFolder);
                  setShowFolderForm(true);
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="size-8 p-0 text-destructive hover:text-destructive"
                onClick={() => setDeletingFolder(selectedFolder)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingFolder(undefined);
              setShowFolderForm(true);
            }}
          >
            <FolderPlus className="size-4 mr-1.5" />
            New Folder
          </Button>
        </div>
        <ViewModeToggle value={toolsViewMode} onChange={setToolsViewMode} />
      </div>

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
      ) : selectedFolderId ? (
        renderToolList(filteredTools)
      ) : (
        <div className="space-y-4">
          {unfolderedTools.length > 0 && renderToolList(unfolderedTools)}

          {toolFolders.map((folder) => {
            const folderTools = toolsByFolder.get(folder.id);
            if (!folderTools || folderTools.length === 0) return null;
            const isOpen = !collapsedFolders.has(folder.id);
            return (
              <Collapsible key={folder.id} open={isOpen} onOpenChange={() => toggleFolderCollapse(folder.id)}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full py-1.5 hover:bg-muted/50 rounded-md px-2 transition-colors cursor-pointer">
                  {isOpen ? (
                    <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                  )}
                  <span
                    className="size-3 rounded-sm shrink-0"
                    style={{ backgroundColor: folder.color || '#6b7280' }}
                  />
                  <span className="text-sm font-medium text-muted-foreground">
                    {folder.name}
                  </span>
                  <span className="text-xs text-muted-foreground">({folderTools.length})</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  {renderToolList(folderTools)}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
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
        folders={folders}
        onSubmit={editingTool ? handleUpdateTool : handleCreateTool}
      />

      {/* Folder Form */}
      <FolderForm
        open={showFolderForm}
        onOpenChange={(open) => {
          setShowFolderForm(open);
          if (!open) setEditingFolder(undefined);
        }}
        folder={editingFolder}
        folderType="tool"
        onSubmit={editingFolder ? handleUpdateFolder : handleCreateFolder}
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

      {/* Delete Folder Confirmation */}
      <AlertDialog open={!!deletingFolder} onOpenChange={(open) => !open && setDeletingFolder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the folder "{deletingFolder?.name}"? Tools in this folder will become unfoldered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFolder}
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
