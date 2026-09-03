import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScriptItem } from './ScriptItem';
import { ScriptForm } from './ScriptForm';
import type { Project, Script, CreateScriptInput, UpdateScriptInput } from '@/types';
import { Plus, FileCode } from 'lucide-react';
import { toast } from 'sonner';

interface ScriptsTabProps {
  project: Project;
}

export function ScriptsTab({ project }: ScriptsTabProps) {
  const { addScript, updateScript, deleteScript, scriptRuntimes } = useAppStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editingScript, setEditingScript] = useState<Script | undefined>();

  const scripts = project.scripts || [];
  const services = project.services || [];
  const total = scripts.length;
  const running = scripts.filter((s) => scriptRuntimes.get(s.id)?.status === 'running').length;

  const handleAdd = () => {
    setEditingScript(undefined);
    setFormOpen(true);
  };

  const handleEdit = (script: Script) => {
    setEditingScript(script);
    setFormOpen(true);
  };

  const handleDelete = async (script: Script) => {
    try {
      await deleteScript(script.id);
      toast.success(`Deleted ${script.name}`);
    } catch (error) {
      toast.error(`Failed to delete ${script.name}: ${error}`);
    }
  };

  const handleSubmit = async (data: CreateScriptInput | UpdateScriptInput) => {
    if (editingScript) {
      await updateScript(editingScript.id, data as UpdateScriptInput);
      toast.success(`Updated ${data.name || editingScript.name}`);
    } else {
      await addScript(project.id, data as CreateScriptInput);
      toast.success(`Added ${data.name}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold">Scripts</h2>
          <p className="text-xs text-muted-foreground">
            {total === 0
              ? 'Builds, tests, deployments and other one-off tasks'
              : `${total} script${total !== 1 ? 's' : ''}${running > 0 ? ` · ${running} running` : ''}`}
          </p>
        </div>
        <Button size="sm" variant={total === 0 ? 'default' : 'outline'} onClick={handleAdd}>
          <Plus className="size-4" />
          Add script
        </Button>
      </div>

      {total === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong">
          <EmptyState
            compact
            icon={FileCode}
            title="No scripts yet"
            description="Add scripts for common tasks like builds, tests, or deployments."
            action={
              <Button onClick={handleAdd}>
                <Plus />
                Add script
              </Button>
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {scripts
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((script) => (
              <ScriptItem
                key={script.id}
                script={script}
                services={services}
                onEdit={() => handleEdit(script)}
                onDelete={() => handleDelete(script)}
              />
            ))}
        </div>
      )}

      <ScriptForm
        open={formOpen}
        onOpenChange={setFormOpen}
        script={editingScript}
        services={services}
        projectPath={project.rootPath}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
