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
import { Plus, Search, FolderPlus, Pencil, Trash2, ScanSearch, Check, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { open } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '@/stores/appStore';
import { GlobalScriptCard } from './GlobalScriptCard';
import { GlobalScriptForm } from './GlobalScriptForm';
import { FolderForm } from './FolderManager';
import { toast } from 'sonner';
import type { GlobalScript, ScriptStatus, CreateGlobalScriptInput, UpdateGlobalScriptInput, VirtualFolder, CreateFolderInput, UpdateFolderInput, DiscoveredScript } from '@/types';

export function GlobalScriptsView() {
  const {
    globalScripts,
    folders,
    globalScriptRuntimes,
    createGlobalScript,
    updateGlobalScript,
    deleteGlobalScript,
    stopGlobalScript,
    selectGlobalScript,
    openRunScriptDialog,
    createFolder,
    updateFolder,
    deleteFolder,
    scanScriptsFolder,
  } = useAppStore();

  const [search, setSearch] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [showScriptForm, setShowScriptForm] = useState(false);
  const [editingScript, setEditingScript] = useState<GlobalScript | undefined>(undefined);
  const [deletingScript, setDeletingScript] = useState<GlobalScript | null>(null);
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [editingFolder, setEditingFolder] = useState<VirtualFolder | undefined>(undefined);
  const [deletingFolder, setDeletingFolder] = useState<VirtualFolder | null>(null);

  // Collapsible folder state
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const toggleFolderCollapse = (folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  // Scan state
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredScripts, setDiscoveredScripts] = useState<DiscoveredScript[]>([]);
  const [selectedDiscovered, setSelectedDiscovered] = useState<Set<string>>(new Set());
  const [showScanDialog, setShowScanDialog] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const scriptFolders = useMemo(
    () => folders
      .filter(f => f.folderType === 'script')
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity)),
    [folders]
  );

  // Resolve the currently selected folder object for edit/delete buttons
  const selectedFolder = useMemo(
    () => scriptFolders.find((f) => f.id === selectedFolderId),
    [scriptFolders, selectedFolderId]
  );

  const getScriptStatus = (scriptId: string): ScriptStatus => {
    return globalScriptRuntimes.get(scriptId)?.status || 'idle';
  };

  const filteredScripts = useMemo(() => {
    let scripts = globalScripts;

    if (selectedFolderId) {
      scripts = scripts.filter((s) => s.folderId === selectedFolderId);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      scripts = scripts.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q) ||
          s.command.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    return scripts.slice().sort((a, b) => a.order - b.order);
  }, [globalScripts, selectedFolderId, search]);

  // Scripts without a folder
  const unfolderedScripts = useMemo(
    () => filteredScripts.filter((s) => !s.folderId),
    [filteredScripts]
  );

  // Scripts grouped by folder
  const scriptsByFolder = useMemo(() => {
    const map = new Map<string, GlobalScript[]>();
    for (const s of filteredScripts) {
      if (s.folderId) {
        const existing = map.get(s.folderId) || [];
        existing.push(s);
        map.set(s.folderId, existing);
      }
    }
    return map;
  }, [filteredScripts]);

  const handleCreateScript = async (data: CreateGlobalScriptInput | UpdateGlobalScriptInput) => {
    await createGlobalScript(data as CreateGlobalScriptInput);
    toast.success('Script created');
  };

  const handleUpdateScript = async (data: CreateGlobalScriptInput | UpdateGlobalScriptInput) => {
    if (!editingScript) return;
    await updateGlobalScript(editingScript.id, data as UpdateGlobalScriptInput);
    toast.success('Script updated');
  };

  const handleDeleteScript = async () => {
    if (!deletingScript) return;
    try {
      await deleteGlobalScript(deletingScript.id);
      toast.success('Script deleted');
    } catch (e) {
      toast.error('Failed to delete script', { description: String(e) });
    }
    setDeletingScript(null);
  };

  const handleRun = (script: GlobalScript) => {
    openRunScriptDialog(script);
  };

  const handleStop = async (scriptId: string) => {
    try {
      await stopGlobalScript(scriptId);
    } catch (e) {
      toast.error('Failed to stop script', { description: String(e) });
    }
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

  const [scanTotal, setScanTotal] = useState(0);

  const handleScan = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select folder to scan for scripts',
      });
      if (!selected || typeof selected !== 'string') return;

      setIsScanning(true);
      const results = await scanScriptsFolder(selected);
      setScanTotal(results.length);
      // Filter out scripts that already exist (by path)
      const existingPaths = new Set(globalScripts.map((s) => s.scriptPath).filter(Boolean));
      const newScripts = results.filter((s) => !existingPaths.has(s.path));
      setDiscoveredScripts(newScripts);
      setSelectedDiscovered(new Set(newScripts.map((s) => s.path)));
      setShowScanDialog(true);
    } catch (e) {
      toast.error('Scan failed', { description: String(e) });
    }
    setIsScanning(false);
  };

  const handleImportDiscovered = async () => {
    setIsImporting(true);
    let imported = 0;
    for (const script of discoveredScripts) {
      if (!selectedDiscovered.has(script.path)) continue;
      try {
        // Determine the command based on extension
        let command: string;
        const ext = script.extension.toLowerCase();
        if (ext === '.py') {
          command = `python {{SCRIPT_FILE}}`;
        } else if (ext === '.ps1') {
          command = `powershell -ExecutionPolicy Bypass -File {{SCRIPT_FILE}}`;
        } else if (ext === '.bat' || ext === '.cmd') {
          command = `{{SCRIPT_FILE}}`;
        } else if (ext === '.sh') {
          command = `bash {{SCRIPT_FILE}}`;
        } else {
          command = `{{SCRIPT_FILE}}`;
        }

        await createGlobalScript({
          name: script.name,
          description: script.description || undefined,
          command,
          scriptPath: script.path,
          tags: [],
          parameters: [],
          parameterPresets: [],
        });
        imported++;
      } catch (e) {
        console.error(`Failed to import ${script.name}:`, e);
      }
    }
    setIsImporting(false);
    setShowScanDialog(false);
    toast.success(`Imported ${imported} script(s)`);
  };

  const toggleDiscoveredScript = (path: string) => {
    setSelectedDiscovered((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderScriptList = (scripts: GlobalScript[]) => {
    if (scripts.length === 0) return null;
    return (
      <div className="space-y-2">
        {scripts.map((script) => (
          <GlobalScriptCard
            key={script.id}
            script={script}
            status={getScriptStatus(script.id)}
            onRun={() => handleRun(script)}
            onStop={() => handleStop(script.id)}
            onEdit={() => {
              setEditingScript(script);
              setShowScriptForm(true);
            }}
            onDelete={() => setDeletingScript(script)}
            onClick={() => selectGlobalScript(script.id)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Global Scripts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your scripts, CLI tools, and automation tasks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleScan}
            disabled={isScanning}
          >
            {isScanning ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <ScanSearch className="size-4 mr-2" />
            )}
            Scan Folder
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingScript(undefined);
              setShowScriptForm(true);
            }}
          >
            <Plus className="size-4 mr-2" />
            Add Script
          </Button>
        </div>
      </div>

      {/* Search + folder filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search scripts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Select
            value={selectedFolderId ?? '__all__'}
            onValueChange={(value) => setSelectedFolderId(value === '__all__' ? null : value)}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All folders</SelectItem>
              {scriptFolders.map((folder) => (
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
      </div>

      {/* Scripts list */}
      {filteredScripts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-lg font-medium">No scripts yet</p>
          <p className="text-sm mt-1">Create your first global script to get started</p>
          <Button
            className="mt-4"
            onClick={() => {
              setEditingScript(undefined);
              setShowScriptForm(true);
            }}
          >
            <Plus className="size-4 mr-2" />
            Add Script
          </Button>
        </div>
      ) : selectedFolderId ? (
        // When a folder is selected, show flat list
        renderScriptList(filteredScripts)
      ) : (
        // Show grouped by folder with collapsible sections
        <div className="space-y-4">
          {/* Unfoldered scripts first */}
          {unfolderedScripts.length > 0 && renderScriptList(unfolderedScripts)}

          {/* Foldered scripts in collapsible sections */}
          {scriptFolders.map((folder) => {
            const scripts = scriptsByFolder.get(folder.id);
            if (!scripts || scripts.length === 0) return null;
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
                  <span className="text-xs text-muted-foreground">({scripts.length})</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  {renderScriptList(scripts)}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}

      {/* Script Form */}
      <GlobalScriptForm
        open={showScriptForm}
        onOpenChange={(open) => {
          setShowScriptForm(open);
          if (!open) setEditingScript(undefined);
        }}
        script={editingScript}
        folders={folders}
        onSubmit={editingScript ? handleUpdateScript : handleCreateScript}
      />

      {/* Folder Form */}
      <FolderForm
        open={showFolderForm}
        onOpenChange={(open) => {
          setShowFolderForm(open);
          if (!open) setEditingFolder(undefined);
        }}
        folder={editingFolder}
        folderType="script"
        onSubmit={editingFolder ? handleUpdateFolder : handleCreateFolder}
      />

      {/* Delete Script Confirmation */}
      <AlertDialog open={!!deletingScript} onOpenChange={(open) => !open && setDeletingScript(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Script</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingScript?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteScript}
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
              Are you sure you want to delete the folder "{deletingFolder?.name}"? Scripts in this folder will become unfoldered.
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

      {/* Scan Results Dialog */}
      <Dialog open={showScanDialog} onOpenChange={setShowScanDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Discovered Scripts</DialogTitle>
            <DialogDescription>
              {discoveredScripts.length === 0 && scanTotal === 0
                ? 'No script files found in the configured folder. Check your scan extensions in Settings.'
                : discoveredScripts.length === 0
                  ? `Found ${scanTotal} script(s), but all are already imported.`
                  : `Found ${discoveredScripts.length} new script(s)${scanTotal > discoveredScripts.length ? ` (${scanTotal - discoveredScripts.length} already imported)` : ''}. Select which ones to import.`}
            </DialogDescription>
          </DialogHeader>

          {discoveredScripts.length > 0 && (
            <div className="flex-1 min-h-0 overflow-y-auto border rounded-md">
              <div className="space-y-1 p-2">
                {discoveredScripts.map((script) => (
                  <label
                    key={script.path}
                    className="flex items-start gap-3 p-2 rounded-md hover:bg-muted cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedDiscovered.has(script.path)}
                      onCheckedChange={() => toggleDiscoveredScript(script.path)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{script.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {script.extension}
                        </Badge>
                      </div>
                      {script.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{script.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">{script.path}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setShowScanDialog(false)}>
              Cancel
            </Button>
            {discoveredScripts.length > 0 && (
              <Button onClick={handleImportDiscovered} disabled={selectedDiscovered.size === 0 || isImporting}>
                {isImporting ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Check className="size-4 mr-2" />
                )}
                Import {selectedDiscovered.size} script(s)
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
