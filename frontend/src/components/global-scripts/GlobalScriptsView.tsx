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
import { Plus, Search, ScanSearch, Check, Loader2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { open } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '@/stores/appStore';
import { useViewPrefsStore } from '@/stores/viewPrefsStore';
import { GlobalScriptCard } from './GlobalScriptCard';
import { GlobalScriptCardView } from './GlobalScriptCardView';
import { GlobalScriptCompactItem } from './GlobalScriptCompactItem';
import { GlobalScriptForm } from './GlobalScriptForm';
import { ViewModeToggle } from '@/components/ui/view-mode-toggle';
import { toast } from 'sonner';
import type { GlobalScript, ScriptStatus, CreateGlobalScriptInput, UpdateGlobalScriptInput, DiscoveredScript } from '@/types';

export function GlobalScriptsView() {
  const {
    globalScripts,
    tagDefinitions,
    globalScriptRuntimes,
    settings,
    createGlobalScript,
    updateGlobalScript,
    deleteGlobalScript,
    stopGlobalScript,
    selectGlobalScript,
    openRunScriptDialog,
    scanScriptsFolder,
  } = useAppStore();
  const { scriptsViewMode, setScriptsViewMode } = useViewPrefsStore();

  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [showScriptForm, setShowScriptForm] = useState(false);
  const [editingScript, setEditingScript] = useState<GlobalScript | undefined>(undefined);
  const [deletingScript, setDeletingScript] = useState<GlobalScript | null>(null);
  // Scan state
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredScripts, setDiscoveredScripts] = useState<DiscoveredScript[]>([]);
  const [selectedDiscovered, setSelectedDiscovered] = useState<Set<string>>(new Set());
  const [showScanDialog, setShowScanDialog] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const sortedTagDefs = useMemo(
    () => [...tagDefinitions].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity)),
    [tagDefinitions]
  );

  const toggleTag = (tagName: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagName)) next.delete(tagName);
      else next.add(tagName);
      return next;
    });
  };

  const getScriptStatus = (scriptId: string): ScriptStatus => {
    return globalScriptRuntimes.get(scriptId)?.status || 'idle';
  };

  const filteredScripts = useMemo(() => {
    let scripts = globalScripts;

    // Tag filter (OR semantics): show scripts that have at least one of the selected tags
    if (selectedTags.size > 0) {
      scripts = scripts.filter((s) =>
        s.tags.some((t) => selectedTags.has(t.toLowerCase()))
      );
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
  }, [globalScripts, selectedTags, search]);

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
        // Determine the command from config templates
        const ext = script.extension.toLowerCase().replace('.', '');
        const templates = settings?.scriptsConfig?.commandTemplates ?? {};
        const command = templates[ext] || `{{SCRIPT_FILE}}`;

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

  const scriptItemProps = (script: GlobalScript) => ({
    key: script.id,
    script,
    status: getScriptStatus(script.id),
    onRun: () => handleRun(script),
    onStop: () => handleStop(script.id),
    onEdit: () => { setEditingScript(script); setShowScriptForm(true); },
    onDelete: () => setDeletingScript(script),
    onClick: () => selectGlobalScript(script.id),
  });

  const renderScriptList = (scripts: GlobalScript[]) => {
    if (scripts.length === 0) return null;
    if (scriptsViewMode === 'card') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {scripts.map((script) => <GlobalScriptCardView {...scriptItemProps(script)} />)}
        </div>
      );
    }
    if (scriptsViewMode === 'compact') {
      return (
        <div className="space-y-1">
          {scripts.map((script) => <GlobalScriptCompactItem {...scriptItemProps(script)} />)}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {scripts.map((script) => <GlobalScriptCard {...scriptItemProps(script)} />)}
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

      {/* Search + tag filter */}
      <div className="space-y-3">
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
          <ViewModeToggle value={scriptsViewMode} onChange={setScriptsViewMode} />
        </div>

        {/* Tag filter pills */}
        {sortedTagDefs.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {sortedTagDefs.map((tag) => {
              const isActive = selectedTags.has(tag.name.toLowerCase());
              return (
                <button
                  key={tag.name}
                  type="button"
                  onClick={() => toggleTag(tag.name.toLowerCase())}
                  className="inline-flex items-center transition-all"
                >
                  <Badge
                    variant="outline"
                    className={`text-xs cursor-pointer transition-all ${
                      isActive ? 'ring-1 ring-offset-1 ring-primary' : 'opacity-60 hover:opacity-100'
                    }`}
                    style={
                      tag.color
                        ? {
                            borderColor: tag.color,
                            color: tag.color,
                            backgroundColor: isActive ? `${tag.color}20` : `${tag.color}10`,
                          }
                        : undefined
                    }
                  >
                    {tag.name}
                  </Badge>
                </button>
              );
            })}
            {selectedTags.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTags(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground ml-1"
              >
                Clear
              </button>
            )}
          </div>
        )}
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
      ) : (
        renderScriptList(filteredScripts)
      )}

      {/* Script Form */}
      <GlobalScriptForm
        open={showScriptForm}
        onOpenChange={(open) => {
          setShowScriptForm(open);
          if (!open) setEditingScript(undefined);
        }}
        script={editingScript}
        onSubmit={editingScript ? handleUpdateScript : handleCreateScript}
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
