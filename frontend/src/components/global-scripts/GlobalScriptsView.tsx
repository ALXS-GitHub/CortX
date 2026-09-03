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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Search, ScanSearch, Check, Loader2, Star, FileCode } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import type { GlobalScript, ScriptStatus, CreateGlobalScriptInput, UpdateGlobalScriptInput, DiscoveredScript } from '@/types';

type SortOption = 'name' | 'created';

export function GlobalScriptsView() {
  const {
    globalScripts,
    tagDefinitions,
    statusDefinitions,
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
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>('name');
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

  // Unique statuses from statusDefinitions + existing scripts
  const allStatuses = useMemo(() => {
    const set = new Set([
      ...statusDefinitions.map((d) => d.name),
      ...globalScripts.map((s) => s.status).filter(Boolean) as string[],
    ]);
    return Array.from(set);
  }, [globalScripts, statusDefinitions]);

  const runningCount = useMemo(
    () => globalScripts.filter((s) => globalScriptRuntimes.get(s.id)?.status === 'running').length,
    [globalScripts, globalScriptRuntimes]
  );

  const filteredScripts = useMemo(() => {
    let scripts = globalScripts;

    // Tag filter (OR semantics): show scripts that have at least one of the selected tags
    if (selectedTags.size > 0) {
      scripts = scripts.filter((s) =>
        s.tags.some((t) => selectedTags.has(t.toLowerCase()))
      );
    }

    if (selectedStatus) {
      scripts = scripts.filter((s) => s.status === selectedStatus);
    }

    if (favoritesOnly) {
      scripts = scripts.filter((s) => s.favorite);
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

    return scripts.slice().sort((a, b) => {
      // Favorites float to the top of whatever sort is active.
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      switch (sort) {
        case 'created': return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default: return a.name.localeCompare(b.name);
      }
    });
  }, [globalScripts, selectedTags, selectedStatus, favoritesOnly, search, sort]);

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

  const handleToggleFavorite = async (script: GlobalScript) => {
    try {
      await updateGlobalScript(script.id, { favorite: !script.favorite });
    } catch (e) {
      toast.error('Failed to update favorite', { description: String(e) });
    }
  };

  const openAddForm = () => {
    setEditingScript(undefined);
    setShowScriptForm(true);
  };

  const scriptItemProps = (script: GlobalScript) => ({
    script,
    status: getScriptStatus(script.id),
    onRun: () => handleRun(script),
    onStop: () => handleStop(script.id),
    onEdit: () => { setEditingScript(script); setShowScriptForm(true); },
    onDelete: () => setDeletingScript(script),
    onClick: () => selectGlobalScript(script.id),
    onToggleFavorite: () => handleToggleFavorite(script),
  });

  const renderScriptList = (scripts: GlobalScript[]) => {
    if (scripts.length === 0) return null;
    if (scriptsViewMode === 'card') {
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {scripts.map((script) => <GlobalScriptCardView key={script.id} {...scriptItemProps(script)} />)}
        </div>
      );
    }
    if (scriptsViewMode === 'compact') {
      return (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-soft">
          {scripts.map((script) => <GlobalScriptCompactItem key={script.id} {...scriptItemProps(script)} />)}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {scripts.map((script) => <GlobalScriptCard key={script.id} {...scriptItemProps(script)} />)}
      </div>
    );
  };

  const subtitle = `${globalScripts.length} script${globalScripts.length !== 1 ? 's' : ''}${runningCount > 0 ? ` · ${runningCount} running` : ''}`;

  return (
    <Screen
      title="Scripts"
      subtitle={subtitle}
      actions={
        <>
          <Button variant="outline" onClick={handleScan} disabled={isScanning}>
            {isScanning ? <Loader2 className="animate-spin" /> : <ScanSearch />}
            Scan folder
          </Button>
          <Button onClick={openAddForm}>
            <Plus />
            Add script
          </Button>
        </>
      }
      toolbar={
        <>
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input
              placeholder="Search scripts…"
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
            <ViewModeToggle value={scriptsViewMode} onChange={setScriptsViewMode} />
          </div>

          {sortedTagDefs.length > 0 && (
            <div className="flex w-full flex-wrap items-center gap-1.5">
              {sortedTagDefs.map((tag) => {
                const isActive = selectedTags.has(tag.name.toLowerCase());
                return (
                  <button
                    key={tag.name}
                    type="button"
                    onClick={() => toggleTag(tag.name.toLowerCase())}
                    aria-pressed={isActive}
                    className={cn('rounded-full transition-opacity', isActive ? 'ring-2 ring-ring/50 ring-offset-1 ring-offset-background' : 'opacity-60 hover:opacity-100')}
                  >
                    <Chip color={tag.color} neutral={!tag.color} dot={false}>
                      {tag.name}
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
      {filteredScripts.length === 0 ? (
        globalScripts.length === 0 ? (
          <EmptyState
            icon={FileCode}
            title="No scripts yet"
            description="Register a CLI tool, an automation task or any command you run often, with its parameters and presets."
            action={
              <>
                <Button variant="outline" onClick={handleScan} disabled={isScanning}>
                  {isScanning ? <Loader2 className="animate-spin" /> : <ScanSearch />}
                  Scan folder
                </Button>
                <Button onClick={openAddForm}>
                  <Plus />
                  Add script
                </Button>
              </>
            }
          />
        ) : (
          <EmptyState icon={Search} title="No matching scripts" description="Try a different search or clear the filters." />
        )
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
            <AlertDialogTitle>Delete script</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingScript?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteScript}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Scan Results Dialog */}
      <Dialog open={showScanDialog} onOpenChange={setShowScanDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Discovered scripts</DialogTitle>
            <DialogDescription>
              {discoveredScripts.length === 0 && scanTotal === 0
                ? 'No script files found in the configured folder. Check your scan extensions in Settings.'
                : discoveredScripts.length === 0
                  ? `Found ${scanTotal} script(s), but all are already imported.`
                  : `Found ${discoveredScripts.length} new script(s)${scanTotal > discoveredScripts.length ? ` (${scanTotal - discoveredScripts.length} already imported)` : ''}. Select which ones to import.`}
            </DialogDescription>
          </DialogHeader>

          {discoveredScripts.length > 0 && (
            <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
              <div className="overflow-hidden rounded-lg border border-border bg-card/60">
                {discoveredScripts.map((script) => (
                  <label
                    key={script.path}
                    className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-2.5 transition-colors last:border-b-0 hover:bg-accent/50"
                  >
                    <Checkbox
                      checked={selectedDiscovered.has(script.path)}
                      onCheckedChange={() => toggleDiscoveredScript(script.path)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{script.name}</span>
                        <Badge variant="secondary" className="font-mono">{script.extension}</Badge>
                      </div>
                      {script.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{script.description}</p>
                      )}
                      <p className="mt-0.5 truncate font-mono text-[11px] text-faint" title={script.path}>{script.path}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowScanDialog(false)}>
              Cancel
            </Button>
            {discoveredScripts.length > 0 && (
              <Button onClick={handleImportDiscovered} disabled={selectedDiscovered.size === 0 || isImporting}>
                {isImporting ? <Loader2 className="animate-spin" /> : <Check />}
                Import {selectedDiscovered.size} script(s)
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Screen>
  );
}
