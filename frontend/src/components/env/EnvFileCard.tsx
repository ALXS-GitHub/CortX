import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { EnvFile, EnvComparison, Service } from '@/types';
import { EnvVariableRow } from './EnvVariableRow';
import { EnvComparisonBanner } from './EnvComparisonBanner';
import { getEnvFileContent } from '@/lib/tauri';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Trash2,
  Link,
  FileText,
  Copy,
  Download,
  List,
  Code,
} from 'lucide-react';
import { toast } from 'sonner';

type ViewMode = 'parsed' | 'raw';

interface EnvFileCardProps {
  envFile: EnvFile;
  projectId: string;
  services: Service[];
  exampleFile?: EnvFile;
}

const variantLabels: Record<string, string> = {
  base: 'Base',
  local: 'Local',
  development: 'Dev',
  production: 'Prod',
  test: 'Test',
  staging: 'Staging',
  example: 'Example',
  other: 'Other',
};

const variantColors: Record<string, string> = {
  base: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  local: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  development: 'bg-green-500/10 text-green-600 dark:text-green-400',
  production: 'bg-red-500/10 text-red-600 dark:text-red-400',
  test: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  staging: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  example: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  other: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
};

export function EnvFileCard({ envFile, projectId, services, exampleFile }: EnvFileCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [comparison, setComparison] = useState<EnvComparison | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('parsed');
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [isLoadingRaw, setIsLoadingRaw] = useState(false);

  const { refreshEnvFile, removeEnvFile, compareEnvFiles, envFileComparisons } = useAppStore();

  const linkedService = services.find((s) => s.id === envFile.linkedServiceId);

  // Load comparison if example file exists
  useEffect(() => {
    if (exampleFile && envFile.variant !== 'example') {
      const cached = envFileComparisons.get(envFile.id);
      if (cached) {
        setComparison(cached);
      } else {
        compareEnvFiles(projectId, envFile.id, exampleFile.id)
          .then(setComparison)
          .catch(console.error);
      }
    }
  }, [exampleFile, envFile.id, projectId, compareEnvFiles, envFileComparisons, envFile.variant]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshEnvFile(projectId, envFile.id);
      // Re-compare if example file exists
      if (exampleFile && envFile.variant !== 'example') {
        const newComparison = await compareEnvFiles(projectId, envFile.id, exampleFile.id);
        setComparison(newComparison);
      }
      toast.success('File refreshed');
    } catch (error) {
      toast.error(`Failed to refresh: ${error}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRemove = async () => {
    try {
      await removeEnvFile(projectId, envFile.id);
      toast.success('File removed from tracking');
    } catch (error) {
      toast.error(`Failed to remove: ${error}`);
    }
  };

  const handleToggleView = async () => {
    if (viewMode === 'parsed') {
      // Switch to raw view - load content if not already loaded
      if (rawContent === null) {
        setIsLoadingRaw(true);
        try {
          const content = await getEnvFileContent(projectId, envFile.id);
          setRawContent(content);
        } catch (error) {
          toast.error(`Failed to load file content: ${error}`);
          return;
        } finally {
          setIsLoadingRaw(false);
        }
      }
      setViewMode('raw');
    } else {
      setViewMode('parsed');
    }
  };

  const handleCopyContent = async () => {
    let content: string;
    if (viewMode === 'raw' && rawContent !== null) {
      content = rawContent;
    } else {
      // Generate content from variables
      content = envFile.variables.map((v) => `${v.key}=${v.value}`).join('\n');
    }
    try {
      await navigator.clipboard.writeText(content);
      toast.success('Content copied to clipboard');
    } catch (error) {
      toast.error(`Failed to copy: ${error}`);
    }
  };

  const handleExport = async () => {
    try {
      const savePath = await save({
        defaultPath: envFile.filename,
        filters: [
          { name: 'Environment Files', extensions: ['env'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (!savePath) return;

      let content: string;
      if (viewMode === 'raw' && rawContent !== null) {
        content = rawContent;
      } else {
        // Generate content from variables
        content = envFile.variables.map((v) => `${v.key}=${v.value}`).join('\n');
      }

      await writeTextFile(savePath, content);
      toast.success('File exported successfully');
    } catch (error) {
      toast.error(`Failed to export: ${error}`);
    }
  };

  // Clear raw content cache when file is refreshed
  const handleRefreshWithClear = async () => {
    setRawContent(null);
    await handleRefresh();
  };

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="p-4">
          <CollapsibleTrigger className="w-full">
            <div className="flex items-start gap-3">
              {/* Expand/collapse icon */}
              <div className="mt-0.5">
                {isOpen ? (
                  <ChevronDown className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 text-muted-foreground" />
                )}
              </div>

              {/* File icon */}
              <FileText className="size-4 mt-0.5 text-muted-foreground flex-shrink-0" />

              {/* Content */}
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium font-mono">{envFile.filename}</span>
                  <Badge className={variantColors[envFile.variant]}>
                    {variantLabels[envFile.variant]}
                  </Badge>
                  {envFile.isManuallyAdded && (
                    <Badge variant="outline" className="text-xs">
                      Manual
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {envFile.variables.length} vars
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {envFile.relativePath}
                </p>
                {linkedService && (
                  <div className="flex items-center gap-1 mt-1">
                    <Link className="size-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Linked to {linkedService.name}
                    </span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div
                className="flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={handleToggleView}
                      disabled={isLoadingRaw}
                    >
                      {viewMode === 'parsed' ? (
                        <Code className="size-3.5" />
                      ) : (
                        <List className="size-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {viewMode === 'parsed' ? 'View raw content' : 'View parsed variables'}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={handleCopyContent}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy content</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={handleExport}
                    >
                      <Download className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Export file</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={handleRefreshWithClear}
                      disabled={isRefreshing}
                    >
                      <RefreshCw
                        className={`size-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh file contents</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={handleRemove}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove from tracking</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="px-4 pb-4 pt-0">
            {/* Comparison banner - only show in parsed view */}
            {viewMode === 'parsed' && comparison && exampleFile && (
              <div className="mb-4">
                <EnvComparisonBanner
                  comparison={comparison}
                  baseFileName={envFile.filename}
                  exampleFileName={exampleFile.filename}
                />
              </div>
            )}

            {viewMode === 'parsed' ? (
              /* Parsed variables list */
              envFile.variables.length > 0 ? (
                <div className="space-y-1">
                  {envFile.variables.map((variable) => (
                    <EnvVariableRow
                      key={`${envFile.id}-${variable.key}-${variable.lineNumber}`}
                      variable={variable}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No variables found in this file
                </p>
              )
            ) : (
              /* Raw content view */
              <div className="relative">
                {isLoadingRaw ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : rawContent !== null ? (
                  <ScrollArea className="h-64 w-full rounded border bg-muted/30">
                    <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all">
                      {rawContent}
                    </pre>
                  </ScrollArea>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Failed to load content
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
