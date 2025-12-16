import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Project } from '@/types';
import { EnvFileCard } from './EnvFileCard';
import { AddEnvFileDialog } from './AddEnvFileDialog';
import { RefreshCw, Plus, FileSearch, FolderOpen } from 'lucide-react';
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

  // Group env files by directory
  const groupedFiles = useMemo(() => {
    const groups: Record<string, typeof project.envFiles> = {};

    for (const file of project.envFiles) {
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
  }, [project.envFiles]);

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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Environment Files</h2>
          <Badge variant="secondary">{project.envFiles.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRescan}
            disabled={isDiscoveringEnvFiles}
          >
            <RefreshCw
              className={`size-4 mr-2 ${isDiscoveringEnvFiles ? 'animate-spin' : ''}`}
            />
            Rescan
          </Button>
          <Button size="sm" onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="size-4 mr-2" />
            Add File
          </Button>
        </div>
      </div>

      {/* Content */}
      {isDiscoveringEnvFiles && project.envFiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <FileSearch className="size-12 mb-4 animate-pulse" />
          <p className="text-sm">Scanning for environment files...</p>
        </div>
      ) : project.envFiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
          <FolderOpen className="size-12 mb-4" />
          <p className="text-sm mb-2">No environment files found</p>
          <p className="text-xs mb-4">
            Click "Rescan" to search again or "Add File" to manually add one
          </p>
          <Button variant="outline" size="sm" onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="size-4 mr-2" />
            Add File Manually
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedDirs.map((dir) => (
            <div key={dir}>
              {/* Directory header */}
              {sortedDirs.length > 1 && (
                <div className="flex items-center gap-2 mb-2">
                  <FolderOpen className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground font-mono">
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
