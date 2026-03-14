import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  ArrowLeft,
  Pencil,
  Wrench,
  FolderOpen,
  Tag,
  ExternalLink,
  FileText,
  Globe,
  StickyNote,
  Package,
  MapPin,
  Code,
  SquareTerminal,
  Plus,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { ToolForm } from './ToolForm';
import { AliasForm } from '@/components/aliases/AliasForm';
import { TagBadge } from '@/components/ui/TagBadge';
import { toast } from 'sonner';
import { openToolConfig, openToolLocation, openToolLocationVscode, openToolUrl, openInExplorer } from '@/lib/tauri';
import type { UpdateToolInput, CreateShellAliasInput, UpdateShellAliasInput, ShellAlias } from '@/types';

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
    createAlias,
    updateAlias,
    selectTool,
    selectAlias,
  } = useAppStore();

  const [showEditForm, setShowEditForm] = useState(false);
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

  if (!tool) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => setCurrentView('tools')}>
          <ArrowLeft className="size-4 mr-2" />
          Back to Tools
        </Button>
        <p className="text-muted-foreground mt-4">Tool not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Back + Header */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => setCurrentView('tools')} className="mb-4">
          <ArrowLeft className="size-4 mr-2" />
          Back to Tools
        </Button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Wrench className="size-8" style={{ color: tool.color || '#6b7280' }} />
            <div>
              <h1 className="text-2xl font-bold">{tool.name}</h1>
              {tool.description && (
                <p className="text-sm text-muted-foreground mt-0.5">{tool.description}</p>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowEditForm(true)}>
            <Pencil className="size-4 mr-2" />
            Edit
          </Button>
        </div>
      </div>

      {/* Info Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Package className="size-4" />
            Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Status:</span>
            <StatusBadge status={tool.status} />
          </div>

          {tool.version && (
            <div>
              <span className="text-muted-foreground">Version:</span>
              <code className="ml-2 px-1.5 py-0.5 bg-muted rounded text-xs font-mono">{tool.version}</code>
            </div>
          )}

          {tool.installMethod && (
            <div>
              <span className="text-muted-foreground">Install method:</span>
              <code className="ml-2 px-1.5 py-0.5 bg-muted rounded text-xs font-mono">{tool.installMethod}</code>
            </div>
          )}

          {tool.installLocation && (
            <div className="flex items-center gap-2">
              <MapPin className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Location:</span>
              <span className="font-mono text-xs truncate">{tool.installLocation}</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleOpenLocationVscode}>
                <Code className="size-3 mr-1" />
                VSCode
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleOpenLocation}>
                <FolderOpen className="size-3 mr-1" />
                Explorer
              </Button>
            </div>
          )}

          {tool.homepage && (
            <div className="flex items-center gap-2">
              <Globe className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Homepage:</span>
              <span className="text-xs truncate">{tool.homepage}</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => handleOpenUrl(tool.homepage!)}>
                <ExternalLink className="size-3 mr-1" />
                Open
              </Button>
            </div>
          )}

          {tool.toolboxUrl && (
            <div className="flex items-center gap-2">
              <Globe className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Toolbox:</span>
              <span className="text-xs truncate">{resolveToolboxUrl(tool.toolboxUrl)}</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => handleOpenUrl(resolveToolboxUrl(tool.toolboxUrl!))}>
                <ExternalLink className="size-3 mr-1" />
                Open
              </Button>
            </div>
          )}

          {tool.tags.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Tag className="size-3.5 text-muted-foreground" />
              {tool.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
              ))}
            </div>
          )}

          {replacementTool && (
            <div className="flex items-center gap-2 mt-2 pt-2 border-t">
              <span className="text-muted-foreground">Replaced by:</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-sm"
                onClick={() => selectTool(replacementTool.id)}
              >
                {replacementTool.name}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Configs Card */}
      {tool.configPaths.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="size-4" />
              Configuration Paths
              <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                {tool.configPaths.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {tool.configPaths.map((config, index) => (
                <div key={index} className="flex items-center justify-between p-2 rounded-md border">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {config.label && (
                        <span className="text-sm font-medium">{config.label}</span>
                      )}
                      {config.isDirectory && (
                        <Badge variant="outline" className="text-xs py-0">dir</Badge>
                      )}
                    </div>
                    <p className="text-xs font-mono text-muted-foreground truncate mt-0.5">{config.path}</p>
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleOpenConfig(index)}
                    >
                      Open in VSCode
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        const path = config.isDirectory ? config.path : config.path.replace(/[\\/][^\\/]*$/, '');
                        openInExplorer(path).catch((err) => toast.error('Failed to open explorer', { description: String(err) }));
                      }}
                    >
                      <FolderOpen className="size-3 mr-1" />
                      Explorer
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Shell Init Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <SquareTerminal className="size-4" />
            Shell Init
            {linkedAliases.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                {linkedAliases.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {linkedAliases.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-3">No shell aliases configured for this tool</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingAlias(undefined);
                  setShowAliasForm(true);
                }}
              >
                <Plus className="size-4 mr-2" />
                Add Alias
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {linkedAliases.map((a) => (
                <div key={a.id} className="border rounded-md p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <button
                        className="font-mono font-medium text-sm hover:underline cursor-pointer"
                        onClick={() => selectAlias(a.id)}
                      >
                        {a.name}
                      </button>
                      <Badge variant="outline" className="text-xs">{a.aliasType || 'function'}</Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setEditingAlias(a);
                        setShowAliasForm(true);
                      }}
                    >
                      <Pencil className="size-3 mr-1" />
                      Edit
                    </Button>
                  </div>
                  <pre className="bg-muted p-3 rounded text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                    {(a.aliasType || 'function') === 'function'
                      ? `function ${a.name} { ${a.command} @args }`
                      : a.script?.powershell || a.script?.bash || a.command || '(no code)'}
                  </pre>
                </div>
              ))}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingAlias(undefined);
                    setShowAliasForm(true);
                  }}
                >
                  <Plus className="size-4 mr-2" />
                  Add Alias
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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

      {/* Notes Card */}
      {tool.notes && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <StickyNote className="size-4" />
              Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{tool.notes}</p>
          </CardContent>
        </Card>
      )}

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
    </div>
  );
}
