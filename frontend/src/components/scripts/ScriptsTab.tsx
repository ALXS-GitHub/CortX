import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { ScriptItem } from './ScriptItem';
import { ScriptForm } from './ScriptForm';
import type { Project, Script, CreateScriptInput, UpdateScriptInput } from '@/types';
import { Plus, FileCode } from 'lucide-react';
import { toast } from 'sonner';

interface ScriptsTabProps {
  project: Project;
}

export function ScriptsTab({ project }: ScriptsTabProps) {
  const { addScript, updateScript, deleteScript } = useAppStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editingScript, setEditingScript] = useState<Script | undefined>();

  const scripts = project.scripts || [];
  const services = project.services || [];

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

  if (scripts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <FileCode className="size-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-1">No scripts yet</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-sm">
          Add scripts for common tasks like builds, tests, or deployments.
        </p>
        <Button onClick={handleAdd}>
          <Plus className="size-4 mr-2" />
          Add Script
        </Button>

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Scripts</h2>
          <p className="text-sm text-muted-foreground">
            Run builds, tests, deployments, and other tasks
          </p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="size-4 mr-2" />
          Add Script
        </Button>
      </div>

      <div className="space-y-2">
        {scripts
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
