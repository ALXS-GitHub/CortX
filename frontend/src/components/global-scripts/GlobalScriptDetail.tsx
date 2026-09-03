import { useMemo, useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusDot } from '@/components/ui/StatusDot';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  Play,
  Square,
  Pencil,
  FileCode,
  Terminal,
  Settings2,
  History,
  Layers,
  Star,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { GlobalScriptForm } from './GlobalScriptForm';
import { ParameterEditor } from './ParameterEditor';
import { PresetEditor } from './PresetEditor';
import { ExecutionHistory } from './ExecutionHistory';
import { ScriptRunBadge } from './GlobalScriptCard';
import { TagBadge } from '@/components/ui/TagBadge';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { toast } from 'sonner';
import type { ScriptStatus, UpdateGlobalScriptInput } from '@/types';
import { formatCommandDisplay } from '@/lib/utils';

export function GlobalScriptDetail() {
  const {
    globalScripts,
    tagDefinitions,
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

  const handleToggleFavorite = async () => {
    if (!script) return;
    try {
      await updateGlobalScript(script.id, { favorite: !script.favorite });
    } catch (e) {
      toast.error('Failed to update favorite', { description: String(e) });
    }
  };

  const runtime = selectedGlobalScriptId
    ? globalScriptRuntimes.get(selectedGlobalScriptId)
    : undefined;
  const status: ScriptStatus = runtime?.status || 'idle';
  const isRunning = status === 'running';

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

  const handleBack = () => setCurrentView('scripts');

  if (!script) {
    return (
      <Screen eyebrow="Scripts" title="Script" onBack={handleBack} backLabel="Back to scripts">
        <EmptyState
          icon={FileCode}
          title="Script not found"
          description="It may have been deleted from another window or from the CLI."
          action={
            <Button onClick={handleBack}>
              <ArrowLeft />
              Back to scripts
            </Button>
          }
        />
      </Screen>
    );
  }

  const commandDisplay = formatCommandDisplay(script.command, script.scriptPath);

  return (
    <Screen
      eyebrow="Scripts"
      title={
        <span className="inline-flex items-center gap-2">
          {isRunning && <StatusDot tone="running" size={8} />}
          <span
            className="grid size-5 shrink-0 place-items-center rounded-[6px]"
            style={{ backgroundColor: `color-mix(in srgb, ${script.color || 'var(--text-faint)'} 16%, transparent)`, color: script.color || 'var(--text-faint)' }}
          >
            <FileCode className="size-3" />
          </span>
          {script.name}
          <ScriptRunBadge status={status} />
          <StatusBadge status={script.status} />
        </span>
      }
      subtitle={<span className="font-mono">{commandDisplay}</span>}
      onBack={handleBack}
      backLabel="Back to scripts"
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-pressed={script.favorite}
            onClick={handleToggleFavorite}
            title={script.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={script.favorite ? 'fill-warning text-warning' : ''} />
          </Button>
          <Button variant="outline" onClick={() => setShowEditForm(true)}>
            <Pencil />
            Edit
          </Button>
          {isRunning ? (
            <Button variant="outline" onClick={handleStop} className="text-destructive hover:text-destructive">
              <Square />
              Stop
            </Button>
          ) : (
            <Button onClick={handleRun}>
              <Play />
              Run
            </Button>
          )}
        </>
      }
    >
      {/* Description + tags */}
      {(script.description || script.tags.length > 0) && (
        <div className="mb-5 flex flex-col gap-2">
          {script.description && <p className="max-w-3xl text-sm text-muted-foreground">{script.description}</p>}
          {script.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {script.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
              ))}
            </div>
          )}
        </div>
      )}

      <Tabs defaultValue="overview" className="gap-5">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="overview" className="flex-none">
            <Terminal />
            Overview
          </TabsTrigger>
          <TabsTrigger value="parameters" className="flex-none">
            <Settings2 />
            Parameters
            {script.parameters.length > 0 && <TabsCount>{script.parameters.length}</TabsCount>}
          </TabsTrigger>
          <TabsTrigger value="presets" className="flex-none">
            <Layers />
            Presets
            {script.parameterPresets.length > 0 && <TabsCount>{script.parameterPresets.length}</TabsCount>}
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-none">
            <History />
            History
          </TabsTrigger>
        </TabsList>

        {/* Overview tab */}
        <TabsContent value="overview" className="space-y-4">
          <div>
            <h2 className="font-display text-base font-semibold">Configuration</h2>
            <p className="text-xs text-muted-foreground">How this script is launched.</p>
          </div>
          <Card size="sm" className="py-0">
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
              <span className="eyebrow">cmd</span>
              <TruncatedText className="min-w-0 font-mono text-[12px] text-foreground/80">{commandDisplay}</TruncatedText>
              {script.scriptPath && (
                <>
                  <span className="eyebrow">file</span>
                  <TruncatedText className="min-w-0 font-mono text-[11px] text-muted-foreground">{script.scriptPath}</TruncatedText>
                </>
              )}
              {script.workingDir && (
                <>
                  <span className="eyebrow">cwd</span>
                  <TruncatedText className="min-w-0 font-mono text-[11px] text-muted-foreground">{script.workingDir}</TruncatedText>
                </>
              )}
              <span className="eyebrow">params</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {script.parameters.length > 0 ? (
                  <>
                    <Badge variant="secondary">{script.parameters.length} configured</Badge>
                    {script.parameterPresets.length > 0 && (
                      <Badge variant="secondary">
                        {script.parameterPresets.length} preset{script.parameterPresets.length > 1 ? 's' : ''}
                      </Badge>
                    )}
                  </>
                ) : (
                  'None'
                )}
              </span>
            </div>
          </Card>
        </TabsContent>

        {/* Parameters tab */}
        <TabsContent value="parameters">
          <ParameterEditor key={script.id} script={script} />
        </TabsContent>

        {/* Presets tab */}
        <TabsContent value="presets">
          <PresetEditor key={script.id} script={script} />
        </TabsContent>

        {/* History tab */}
        <TabsContent value="history">
          <ExecutionHistory scriptId={script.id} />
        </TabsContent>
      </Tabs>

      {/* Edit Form */}
      <GlobalScriptForm
        open={showEditForm}
        onOpenChange={setShowEditForm}
        script={script}
        onSubmit={handleUpdate}
      />
    </Screen>
  );
}
