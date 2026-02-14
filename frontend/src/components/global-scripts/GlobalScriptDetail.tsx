import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  Play,
  Square,
  Pencil,
  FileCode,
  FolderOpen,
  Terminal,
  Tag,
  Settings2,
  History,
  Layers,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { GlobalScriptForm } from './GlobalScriptForm';
import { ParameterEditor } from './ParameterEditor';
import { PresetEditor } from './PresetEditor';
import { ExecutionHistory } from './ExecutionHistory';
import { toast } from 'sonner';
import type { ScriptStatus, UpdateGlobalScriptInput } from '@/types';
import { formatCommandDisplay } from '@/lib/utils';

export function GlobalScriptDetail() {
  const {
    globalScripts,
    folders,
    globalScriptRuntimes,
    selectedGlobalScriptId,
    setCurrentView,
    stopGlobalScript,
    updateGlobalScript,
    openRunScriptDialog,
  } = useAppStore();

  const [showEditForm, setShowEditForm] = useState(false);

  const script = useMemo(
    () => globalScripts.find((s) => s.id === selectedGlobalScriptId),
    [globalScripts, selectedGlobalScriptId]
  );

  const runtime = selectedGlobalScriptId
    ? globalScriptRuntimes.get(selectedGlobalScriptId)
    : undefined;
  const status: ScriptStatus = runtime?.status || 'idle';
  const isRunning = status === 'running';

  const folder = useMemo(
    () => (script?.folderId ? folders.find((f) => f.id === script.folderId) : undefined),
    [script, folders]
  );

  const handleRun = () => {
    if (!script) return;
    openRunScriptDialog(script);
  };

  const handleStop = async () => {
    if (!script) return;
    try {
      await stopGlobalScript(script.id);
    } catch (e) {
      toast.error('Failed to stop script', { description: String(e) });
    }
  };

  const handleUpdate = async (data: UpdateGlobalScriptInput) => {
    if (!script) return;
    await updateGlobalScript(script.id, data);
    toast.success('Script updated');
  };

  if (!script) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => setCurrentView('scripts')}>
          <ArrowLeft className="size-4 mr-2" />
          Back to Scripts
        </Button>
        <p className="text-muted-foreground mt-4">Script not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Back + Header */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => setCurrentView('scripts')} className="mb-4">
          <ArrowLeft className="size-4 mr-2" />
          Back to Scripts
        </Button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <FileCode className="size-8" style={{ color: script.color || '#6b7280' }} />
            <div>
              <h1 className="text-2xl font-bold">{script.name}</h1>
              {script.description && (
                <p className="text-sm text-muted-foreground mt-0.5">{script.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowEditForm(true)}>
              <Pencil className="size-4 mr-2" />
              Edit
            </Button>
            {isRunning ? (
              <Button variant="destructive" size="sm" onClick={handleStop}>
                <Square className="size-4 mr-2" />
                Stop
              </Button>
            ) : (
              <Button size="sm" onClick={handleRun}>
                <Play className="size-4 mr-2" />
                Run
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">
            <Terminal className="size-3.5 mr-1.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="parameters">
            <Settings2 className="size-3.5 mr-1.5" />
            Parameters
            {script.parameters.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                {script.parameters.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="presets">
            <Layers className="size-3.5 mr-1.5" />
            Presets
            {script.parameterPresets.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                {script.parameterPresets.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="size-3.5 mr-1.5" />
            History
          </TabsTrigger>
        </TabsList>

        {/* Overview tab */}
        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Terminal className="size-4" />
                Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Command:</span>
                <code className="ml-2 px-1.5 py-0.5 bg-muted rounded text-xs font-mono">{formatCommandDisplay(script.command, script.scriptPath)}</code>
              </div>
              {script.workingDir && (
                <div className="flex items-center gap-2">
                  <FolderOpen className="size-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Default working dir:</span>
                  <span className="font-mono text-xs truncate">{script.workingDir}</span>
                </div>
              )}
              {script.scriptPath && (
                <div className="flex items-center gap-2">
                  <FileCode className="size-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Script file:</span>
                  <span className="font-mono text-xs truncate">{script.scriptPath}</span>
                </div>
              )}
              {folder && (
                <div className="flex items-center gap-2">
                  <div className="size-3 rounded-sm" style={{ backgroundColor: folder.color || '#6b7280' }} />
                  <span className="text-muted-foreground">Folder:</span>
                  <span>{folder.name}</span>
                </div>
              )}
              {script.tags.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Tag className="size-3.5 text-muted-foreground" />
                  {script.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs py-0">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
              {script.parameters.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <span className="text-muted-foreground">Parameters:</span>
                  <span className="ml-2">{script.parameters.length} configured</span>
                  {script.parameterPresets.length > 0 && (
                    <span className="text-muted-foreground ml-2">
                      ({script.parameterPresets.length} preset{script.parameterPresets.length > 1 ? 's' : ''})
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Parameters tab */}
        <TabsContent value="parameters" className="mt-4">
          <ParameterEditor key={script.id} script={script} />
        </TabsContent>

        {/* Presets tab */}
        <TabsContent value="presets" className="mt-4">
          <PresetEditor key={script.id} script={script} />
        </TabsContent>

        {/* History tab */}
        <TabsContent value="history" className="mt-4">
          <ExecutionHistory scriptId={script.id} />
        </TabsContent>
      </Tabs>

      {/* Edit Form */}
      <GlobalScriptForm
        open={showEditForm}
        onOpenChange={setShowEditForm}
        script={script}
        folders={folders}
        onSubmit={handleUpdate}
      />
    </div>
  );
}
