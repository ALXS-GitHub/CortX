import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft,
  Pencil,
  Wrench,
  FolderOpen,
  ExternalLink,
  FileText,
  Globe,
  StickyNote,
  Package,
  Code,
  SquareTerminal,
  Plus,
  Star,
  MoreVertical,
  Trash2,
  Link2,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { ToolForm } from './ToolForm';
import { ToolIcon } from './ToolCard';
import { AliasForm } from '@/components/aliases/AliasForm';
import { TagBadge } from '@/components/ui/TagBadge';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { toast } from 'sonner';
import { openToolConfig, openToolLocation, openToolLocationVscode, openToolUrl, openInExplorer } from '@/lib/tauri';
import type { UpdateToolInput, CreateShellAliasInput, UpdateShellAliasInput, ShellAlias } from '@/types';

/** Card with a titled header row (icon, title, optional count and actions). */
function Section({
  icon: Icon,
  title,
  count,
  actions,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className="gap-3">
      <div className="flex items-center justify-between gap-3 px-4">
        <h2 className="inline-flex items-center gap-2 font-display text-base font-semibold">
          <Icon className="size-4 text-faint" />
          {title}
          {count !== undefined && count > 0 && <Badge variant="secondary">{count}</Badge>}
        </h2>
        {actions}
      </div>
      <div className="px-4">{children}</div>
    </Card>
  );
}

/** Label / value row of the information grid. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-2 text-sm">{children}</div>
    </>
  );
}

const codeClass = 'rounded-xs bg-muted px-1.5 py-0.5 font-mono text-[11px]';
const preClass = 'overflow-x-auto whitespace-pre-wrap rounded-sm bg-muted/70 p-3 font-mono text-[11.5px] leading-relaxed';

export function ToolDetail() {
  const {
    tools,
    aliases,
    tagDefinitions,
    statusDefinitions,
    settings,
    selectedToolId,
    setCurrentView,
    updateTool,
    deleteTool,
    createAlias,
    updateAlias,
    selectTool,
    selectAlias,
  } = useAppStore();

  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showAliasForm, setShowAliasForm] = useState(false);
  const [editingAlias, setEditingAlias] = useState<ShellAlias | undefined>(undefined);

  const tool = useMemo(
    () => tools.find((t) => t.id === selectedToolId),
    [tools, selectedToolId]
  );

  const replacementTool = useMemo(
    () => (tool?.replacedBy ? tools.find((t) => t.id === tool.replacedBy) : undefined),
    [tool, tools]
  );

  const linkedAliases = useMemo(
    () => aliases.filter((a) => a.toolId === tool?.id).sort((a, b) => a.order - b.order),
    [aliases, tool]
  );

  const handleCreateLinkedAlias = async (data: CreateShellAliasInput | UpdateShellAliasInput) => {
    await createAlias(data as CreateShellAliasInput);
    toast.success('Alias created');
  };

  const handleUpdateLinkedAlias = async (data: CreateShellAliasInput | UpdateShellAliasInput) => {
    if (!editingAlias) return;
    await updateAlias(editingAlias.id, data as UpdateShellAliasInput);
    toast.success('Alias updated');
  };

  const handleUpdate = async (data: UpdateToolInput) => {
    if (!tool) return;
    await updateTool(tool.id, data);
    toast.success('Tool updated');
  };

  const handleDelete = async () => {
    if (!tool) return;
    try {
      await deleteTool(tool.id);
      toast.success('Tool deleted');
      setCurrentView('tools');
    } catch (e) {
      toast.error('Failed to delete tool', { description: String(e) });
    }
    setShowDeleteDialog(false);
  };

  const handleOpenConfig = async (index: number) => {
    if (!tool) return;
    try {
      await openToolConfig(tool.id, index);
    } catch (e) {
      toast.error('Failed to open config', { description: String(e) });
    }
  };

  const handleOpenLocation = async () => {
    if (!tool) return;
    try {
      await openToolLocation(tool.id);
    } catch (e) {
      toast.error('Failed to open location', { description: String(e) });
    }
  };

  const handleOpenLocationVscode = async () => {
    if (!tool) return;
    try {
      await openToolLocationVscode(tool.id);
    } catch (e) {
      toast.error('Failed to open in VSCode', { description: String(e) });
    }
  };

  const resolveToolboxUrl = (url: string): string => {
    if (url.startsWith('/') && settings?.toolboxBaseUrl) {
      const base = settings.toolboxBaseUrl.replace(/\/+$/, '');
      return `${base}${url}`;
    }
    return url;
  };

  const handleOpenUrl = async (url: string) => {
    try {
      await openToolUrl(url);
    } catch (e) {
      toast.error('Failed to open URL', { description: String(e) });
    }
  };

  const handleToggleFavorite = async () => {
    if (!tool) return;
    try {
      await updateTool(tool.id, { favorite: !tool.favorite });
    } catch (e) {
      toast.error('Failed to update favorite', { description: String(e) });
    }
  };

  const openAliasForm = (alias?: ShellAlias) => {
    setEditingAlias(alias);
    setShowAliasForm(true);
  };

  if (!tool) {
    return (
      <Screen title="Tool" eyebrow="Tools" onBack={() => setCurrentView('tools')} backLabel="Back to tools">
        <EmptyState
          icon={Wrench}
          title="Tool not found"
          description="It may have been removed from another window or from the CLI."
          action={
            <Button onClick={() => setCurrentView('tools')}>
              <ArrowLeft />
              Back to tools
            </Button>
          }
        />
      </Screen>
    );
  }

  const toolboxUrl = tool.toolboxUrl ? resolveToolboxUrl(tool.toolboxUrl) : null;
  const configs = tool.configPaths.length;

  return (
    <Screen
      eyebrow="Tools"
      title={
        <span className="inline-flex items-center gap-2">
          <ToolIcon color={tool.color} size="sm" />
          {tool.name}
          <StatusBadge status={tool.status} />
        </span>
      }
      subtitle={tool.description || (tool.installLocation ? <span className="font-mono">{tool.installLocation}</span> : undefined)}
      onBack={() => setCurrentView('tools')}
      backLabel="Back to tools"
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-pressed={tool.favorite}
            onClick={handleToggleFavorite}
            title={tool.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={tool.favorite ? 'fill-warning text-warning' : ''} />
          </Button>
          {tool.installLocation && (
            <>
              <Button variant="outline" onClick={handleOpenLocationVscode} title="Open install location in VSCode">
                <Code />
                VSCode
              </Button>
              <Button variant="outline" size="icon" onClick={handleOpenLocation} title="Open install folder" aria-label="Open install folder">
                <FolderOpen />
              </Button>
            </>
          )}
          {tool.homepage && (
            <Button variant="outline" onClick={() => handleOpenUrl(tool.homepage!)} title={tool.homepage}>
              <Globe />
              Homepage
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowEditForm(true)}>
                <Pencil />
                Edit tool
              </DropdownMenuItem>
              {toolboxUrl && (
                <DropdownMenuItem onClick={() => handleOpenUrl(toolboxUrl)}>
                  <Link2 />
                  Open toolbox page
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setShowDeleteDialog(true)}>
                <Trash2 />
                Delete tool
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <div className="space-y-4">
        {/* Information */}
        <Section icon={Package} title="Information">
          <div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-2.5">
            <Row label="Status">
              {tool.status ? <StatusBadge status={tool.status} /> : <span className="text-xs text-faint">—</span>}
            </Row>

            {tool.version && (
              <Row label="Version">
                <code className={codeClass}>{tool.version}</code>
              </Row>
            )}

            {tool.installMethod && (
              <Row label="Install method">
                <code className={codeClass}>{tool.installMethod}</code>
              </Row>
            )}

            {tool.installLocation && (
              <Row label="Location">
                <TruncatedText className="min-w-0 flex-1 font-mono text-[11px] text-muted-foreground">{tool.installLocation}</TruncatedText>
                <Button variant="ghost" size="icon-xs" onClick={handleOpenLocationVscode} title="Open in VSCode" aria-label="Open in VSCode">
                  <Code />
                </Button>
                <Button variant="ghost" size="icon-xs" onClick={handleOpenLocation} title="Open in Explorer" aria-label="Open in Explorer">
                  <FolderOpen />
                </Button>
              </Row>
            )}

            {tool.homepage && (
              <Row label="Homepage">
                <TruncatedText className="min-w-0 flex-1 text-xs text-muted-foreground">{tool.homepage}</TruncatedText>
                <Button variant="ghost" size="icon-xs" onClick={() => handleOpenUrl(tool.homepage!)} title="Open homepage" aria-label="Open homepage">
                  <ExternalLink />
                </Button>
              </Row>
            )}

            {toolboxUrl && (
              <Row label="Toolbox">
                <TruncatedText className="min-w-0 flex-1 text-xs text-muted-foreground">{toolboxUrl}</TruncatedText>
                <Button variant="ghost" size="icon-xs" onClick={() => handleOpenUrl(toolboxUrl)} title="Open toolbox page" aria-label="Open toolbox page">
                  <ExternalLink />
                </Button>
              </Row>
            )}

            {tool.tags.length > 0 && (
              <Row label="Tags">
                <div className="flex flex-wrap gap-1">
                  {tool.tags.map((tag) => (
                    <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
                  ))}
                </div>
              </Row>
            )}

            {replacementTool && (
              <Row label="Replaced by">
                <Button variant="link" size="sm" className="h-auto p-0" onClick={() => selectTool(replacementTool.id)}>
                  {replacementTool.name}
                </Button>
              </Row>
            )}
          </div>
        </Section>

        {/* Configuration paths */}
        {configs > 0 && (
          <Section icon={FileText} title="Configuration paths" count={configs}>
            <div className="space-y-2">
              {tool.configPaths.map((config, index) => (
                <div key={index} className="flex items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-2">
                  {config.isDirectory ? <FolderOpen className="size-4 shrink-0 text-faint" /> : <FileText className="size-4 shrink-0 text-faint" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {config.label && <span className="truncate text-sm font-medium">{config.label}</span>}
                      {config.isDirectory && <Badge variant="outline">dir</Badge>}
                    </div>
                    <p className="truncate font-mono text-[11px] text-muted-foreground" title={config.path}>{config.path}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handleOpenConfig(index)}>
                      <Code />
                      VSCode
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const path = config.isDirectory ? config.path : config.path.replace(/[\\/][^\\/]*$/, '');
                        openInExplorer(path).catch((err) => toast.error('Failed to open explorer', { description: String(err) }));
                      }}
                    >
                      <FolderOpen />
                      Explorer
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Shell init */}
        <Section
          icon={SquareTerminal}
          title="Shell init"
          count={linkedAliases.length}
          actions={
            linkedAliases.length > 0 ? (
              <Button size="sm" variant="outline" onClick={() => openAliasForm()}>
                <Plus />
                Add alias
              </Button>
            ) : undefined
          }
        >
          {linkedAliases.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-strong">
              <EmptyState
                compact
                icon={SquareTerminal}
                title="No shell aliases for this tool"
                description="Aliases linked to a tool show up here and in its shell init."
                action={
                  <Button size="sm" variant="outline" onClick={() => openAliasForm()}>
                    <Plus />
                    Add alias
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="space-y-2">
              {linkedAliases.map((a) => (
                <div key={a.id} className="rounded-lg border border-border bg-background/40 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        className="truncate font-mono text-sm font-medium hover:text-primary hover:underline"
                        onClick={() => selectAlias(a.id)}
                      >
                        {a.name}
                      </button>
                      <Badge variant="outline">{a.aliasType || 'function'}</Badge>
                    </div>
                    <Button variant="ghost" size="xs" onClick={() => openAliasForm(a)}>
                      <Pencil />
                      Edit
                    </Button>
                  </div>
                  <pre className={preClass}>
                    {(a.aliasType || 'function') === 'function'
                      ? `function ${a.name} { ${a.command} @args }`
                      : a.script?.powershell || a.script?.bash || a.command || '(no code)'}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Notes */}
        {tool.notes && (
          <Section icon={StickyNote} title="Notes">
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{tool.notes}</p>
          </Section>
        )}
      </div>

      {/* Alias Form for this tool */}
      <AliasForm
        open={showAliasForm}
        onOpenChange={(open) => {
          setShowAliasForm(open);
          if (!open) setEditingAlias(undefined);
        }}
        alias={editingAlias}
        aliases={aliases}
        tools={tools}
        tagDefinitions={tagDefinitions}
        statusDefinitions={statusDefinitions}
        onSubmit={editingAlias ? handleUpdateLinkedAlias : handleCreateLinkedAlias}
        defaultToolId={tool.id}
      />

      {/* Edit Form */}
      <ToolForm
        open={showEditForm}
        onOpenChange={setShowEditForm}
        tool={tool}
        tools={tools}
        tagDefinitions={tagDefinitions}
        statusDefinitions={statusDefinitions}
        onSubmit={handleUpdate}
      />

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tool</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{tool.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Screen>
  );
}
