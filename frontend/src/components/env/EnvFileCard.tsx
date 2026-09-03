import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { EnvFile, EnvComparison, Service } from '@/types';
import { EnvVariableRow } from './EnvVariableRow';
import { EnvComparisonBanner } from './EnvComparisonBanner';
import { getEnvFileContent } from '@/lib/tauri';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import {
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
import { cn } from '@/lib/utils';
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

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'info' | 'destructive';

const variantBadge: Record<string, BadgeVariant> = {
  base: 'info',
  local: 'default',
  development: 'success',
  production: 'destructive',
  test: 'warning',
  staging: 'warning',
  example: 'secondary',
  other: 'secondary',
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

  const varCount = envFile.variables.length;

  return (
    <Card size="sm" className={cn('group gap-0 py-0', isOpen && 'border-accent-border')}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center gap-2 px-3 py-2.5">
          {/* Header — the whole left part toggles the card */}
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
            <ChevronRight
              className={cn('size-4 shrink-0 text-faint transition-transform', isOpen && 'rotate-90')}
            />
            <span className="grid size-8 shrink-0 place-items-center rounded-[var(--rad-sm)] bg-muted text-muted-foreground">
              <FileText className="size-4" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <TruncatedText className="min-w-0 font-mono text-[13px] font-medium">{envFile.filename}</TruncatedText>
                <Badge variant={variantBadge[envFile.variant] ?? 'secondary'} className="shrink-0">
                  {variantLabels[envFile.variant]}
                </Badge>
                {envFile.isManuallyAdded && (
                  <Badge variant="outline" className="shrink-0">
                    Manual
                  </Badge>
                )}
                <span className="shrink-0 text-[11px] text-faint">
                  {varCount} var{varCount !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-2 font-mono text-[11px] text-faint">
                <TruncatedText className="min-w-0">{envFile.relativePath}</TruncatedText>
                {linkedService && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
                    <Link className="size-3" />
                    <span className="font-sans">Linked to {linkedService.name}</span>
                  </span>
                )}
              </div>
            </div>
          </CollapsibleTrigger>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleToggleView}
                  disabled={isLoadingRaw}
                  aria-label={viewMode === 'parsed' ? 'View raw content' : 'View parsed variables'}
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
                <Button variant="ghost" size="icon-sm" onClick={handleCopyContent} aria-label="Copy content">
                  <Copy className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy content</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={handleExport} aria-label="Export file">
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
                  aria-label="Refresh file contents"
                >
                  <RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />
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
                  aria-label="Remove from tracking"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove from tracking</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t border-border px-3 py-3">
            {/* Comparison banner - only show in parsed view */}
            {viewMode === 'parsed' && comparison && exampleFile && (
              <div className="mb-3">
                <EnvComparisonBanner
                  comparison={comparison}
                  baseFileName={envFile.filename}
                  exampleFileName={exampleFile.filename}
                />
              </div>
            )}

            {viewMode === 'parsed' ? (
              /* Parsed variables list */
              varCount > 0 ? (
                <div className="space-y-1">
                  {envFile.variables.map((variable) => (
                    <EnvVariableRow
                      key={`${envFile.id}-${variable.key}-${variable.lineNumber}`}
                      variable={variable}
                    />
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No variables found in this file
                </p>
              )
            ) : (
              /* Raw content view */
              <div className="relative">
                {isLoadingRaw ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="size-5 animate-spin text-faint" />
                  </div>
                ) : rawContent !== null ? (
                  <ScrollArea className="h-64 w-full rounded-sm border border-border bg-muted/40">
                    <pre className="whitespace-pre-wrap break-all p-3 font-mono text-[11px] text-foreground/90">
                      {rawContent}
                    </pre>
                  </ScrollArea>
                ) : (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    Failed to load content
                  </p>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
