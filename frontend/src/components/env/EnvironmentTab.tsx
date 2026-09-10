import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Project } from '@/types';
import { EnvFileCard } from './EnvFileCard';
import { AddEnvFileDialog } from './AddEnvFileDialog';
import { RefreshCw, Plus, FileSearch, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface EnvironmentTabProps {
  project: Project;
}

export function EnvironmentTab({ project }: EnvironmentTabProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const { discoverEnvFiles, isDiscoveringEnvFiles } = useAppStore();

  // Auto-discover env files if not already discovered
  useEffect(() => {
    if (!project.envFilesDiscovered) {
      discoverEnvFiles(project.id, false).catch(console.error);
    }
  }, [project.id, project.envFilesDiscovered, discoverEnvFiles]);

  const handleRescan = async () => {
    try {
      await discoverEnvFiles(project.id, true);
      toast.success('Environment files rescanned');
    } catch (error) {
      toast.error(`Failed to rescan: ${error}`);
    }
  };

  // Group env files by directory. The list is named here rather than read as
  // `project.envFiles` inside the callback: `typeof project.envFiles` is a
  // *type*, but exhaustive-deps reads it as a use of `project` and asks for
  // the whole project as a dependency — which would regroup the files on any
  // change to it. One name keeps the type and the dependency the same thing.
  const envFiles = project.envFiles;
  const groupedFiles = useMemo(() => {
    const groups: Record<string, typeof envFiles> = {};

    for (const file of envFiles) {
      // Get directory from relative path
      const lastSlash = file.relativePath.lastIndexOf('/');
      const lastBackslash = file.relativePath.lastIndexOf('\\');
      const lastSep = Math.max(lastSlash, lastBackslash);
      const dir = lastSep > 0 ? file.relativePath.substring(0, lastSep) : '.';

      if (!groups[dir]) {
        groups[dir] = [];
      }
      groups[dir].push(file);
    }

    // Sort files within each group
    for (const dir of Object.keys(groups)) {
      groups[dir].sort((a, b) => {
        // .env first, then .env.example, then others alphabetically
        if (a.variant === 'base') return -1;
        if (b.variant === 'base') return 1;
        if (a.variant === 'example') return 1;
        if (b.variant === 'example') return -1;
        return a.filename.localeCompare(b.filename);
      });
    }

    return groups;
  }, [envFiles]);

  // Find .env.example files for comparison
  const getExampleFile = (dir: string) => {
    const files = groupedFiles[dir] || [];
    return files.find((f) => f.variant === 'example');
  };

  const sortedDirs = Object.keys(groupedFiles).sort((a, b) => {
    // Root directory first
    if (a === '.') return -1;
    if (b === '.') return 1;
    return a.localeCompare(b);
  });

  const total = project.envFiles.length;
  const variables = project.envFiles.reduce((n, f) => n + f.variables.length, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold">Environment files</h2>
          <p className="text-xs text-muted-foreground">
            {total} file{total !== 1 ? 's' : ''} tracked
            {total > 0 && ` · ${variables} variable${variables !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRescan}
            disabled={isDiscoveringEnvFiles}
          >
            <RefreshCw className={cn(isDiscoveringEnvFiles && 'animate-spin')} />
            Rescan
          </Button>
          <Button size="sm" variant={total === 0 ? 'default' : 'outline'} onClick={() => setIsAddDialogOpen(true)}>
            <Plus />
            Add file
          </Button>
        </div>
      </div>

      {/* Content */}
      {isDiscoveringEnvFiles && total === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong">
          <EmptyState
            compact
            icon={FileSearch}
            title="Scanning for environment files..."
            description="Looking for .env files in the project tree."
            className="[&_svg]:animate-pulse"
          />
        </div>
      ) : total === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong">
          <EmptyState
            compact
            icon={FolderOpen}
            title="No environment files found"
            description='Click "Rescan" to search again or add a file manually.'
            action={
              <Button variant="outline" size="sm" onClick={() => setIsAddDialogOpen(true)}>
                <Plus />
                Add file manually
              </Button>
            }
          />
        </div>
      ) : (
        <div className="space-y-5">
          {sortedDirs.map((dir) => (
            <div key={dir}>
              {/* Directory header */}
              {sortedDirs.length > 1 && (
                <div className="mb-2 flex items-center gap-1.5">
                  <FolderOpen className="size-3.5 text-faint" />
                  <span className="eyebrow font-mono normal-case tracking-normal">
                    {dir === '.' ? 'Root' : dir}
                  </span>
                </div>
              )}

              {/* Files in this directory */}
              <div className="space-y-2">
                {groupedFiles[dir].map((envFile) => (
                  <EnvFileCard
                    key={envFile.id}
                    envFile={envFile}
                    projectId={project.id}
                    services={project.services}
                    exampleFile={
                      envFile.variant !== 'example' ? getExampleFile(dir) : undefined
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add file dialog */}
      <AddEnvFileDialog
        projectId={project.id}
        projectPath={project.rootPath}
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
      />
    </div>
  );
}
