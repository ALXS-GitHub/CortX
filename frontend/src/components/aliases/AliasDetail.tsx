import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  Pencil,
  SquareTerminal,
  Tag,
  Copy,
  Check,
  Wrench,
  Settings,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { AliasForm } from './AliasForm';
import { TagBadge } from '@/components/ui/TagBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { toast } from 'sonner';
import type { UpdateShellAliasInput } from '@/types';

const SHELLS = ['powershell', 'bash', 'zsh', 'fish'] as const;
const SHELL_LABELS: Record<string, string> = {
  powershell: 'PowerShell',
  bash: 'Bash',
  zsh: 'Zsh',
  fish: 'Fish',
};

export function AliasDetail() {
  const {
    aliases,
    tools,
    tagDefinitions,
    statusDefinitions,
    selectedAliasId,
    setCurrentView,
    updateAlias,
    selectTool,
  } = useAppStore();

  const [showEditForm, setShowEditForm] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);

  const alias = useMemo(
    () => aliases.find((a) => a.id === selectedAliasId),
    [aliases, selectedAliasId]
  );

  const linkedTool = useMemo(
    () => (alias?.toolId ? tools.find((t) => t.id === alias.toolId) : undefined),
    [alias, tools]
  );

  const handleUpdate = async (data: UpdateShellAliasInput) => {
    if (!alias) return;
    await updateAlias(alias.id, data);
    toast.success('Alias updated');
  };

  const handleCopyCommand = async () => {
    if (!alias) return;
    try {
      await navigator.clipboard.writeText(alias.command);
      setCommandCopied(true);
      setTimeout(() => setCommandCopied(false), 2000);
      toast.success('Command copied');
    } catch {
      toast.error('Failed to copy');
    }
  };

  if (!alias) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => setCurrentView('aliases')}>
          <ArrowLeft className="size-4 mr-2" />
          Back to Aliases
        </Button>
        <p className="text-muted-foreground mt-4">Alias not found.</p>
      </div>
    );
  }

  const aliasType = alias.aliasType || 'function';
  const hasSetup = alias.setup && Object.values(alias.setup).some((v) => v.trim());
  const hasScript = alias.script && Object.values(alias.script).some((v) => v.trim());

  return (
    <div className="p-6 space-y-6">
      {/* Back + Header */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => setCurrentView('aliases')} className="mb-4">
          <ArrowLeft className="size-4 mr-2" />
          Back to Aliases
        </Button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <SquareTerminal className="size-8 text-muted-foreground" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold font-mono">{alias.name}</h1>
                <Badge variant="outline" className="text-xs">{aliasType}</Badge>
                <StatusBadge status={alias.status} />
              </div>
              {alias.description && (
                <p className="text-sm text-muted-foreground mt-0.5">{alias.description}</p>
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
      {(alias.tags.length > 0 || linkedTool) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Tag className="size-4" />
              Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {alias.tags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {alias.tags.map((tag) => (
                  <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
                ))}
              </div>
            )}
            {linkedTool && (
              <div className="flex items-center gap-2">
                <Wrench className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Linked tool:</span>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-sm"
                  onClick={() => selectTool(linkedTool.id)}
                >
                  {linkedTool.name}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Command Card — for function type */}
      {aliasType === 'function' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <SquareTerminal className="size-4" />
              Command
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <pre className="bg-muted p-4 rounded-md text-sm font-mono overflow-x-auto whitespace-pre-wrap">
                {alias.command}
              </pre>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2"
                onClick={handleCopyCommand}
              >
                {commandCopied ? (
                  <Check className="size-4 text-green-500" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Script/Init Card — for script and init types */}
      {aliasType !== 'function' && hasScript && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <SquareTerminal className="size-4" />
              {aliasType === 'init' ? 'Init Command' : 'Script'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue={SHELLS.find((s) => alias.script?.[s]?.trim()) || 'powershell'}>
              <TabsList className="h-8">
                {SHELLS.filter((s) => alias.script?.[s]?.trim()).map((s) => (
                  <TabsTrigger key={s} value={s} className="text-xs px-3">
                    {SHELL_LABELS[s]}
                  </TabsTrigger>
                ))}
              </TabsList>
              {SHELLS.filter((s) => alias.script?.[s]?.trim()).map((s) => (
                <TabsContent key={s} value={s}>
                  <pre className="bg-muted p-4 rounded-md text-sm font-mono overflow-x-auto whitespace-pre-wrap">
                    {alias.script![s]}
                  </pre>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Setup Card */}
      {hasSetup && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Settings className="size-4" />
              Setup Code
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue={SHELLS.find((s) => alias.setup?.[s]?.trim()) || 'powershell'}>
              <TabsList className="h-8">
                {SHELLS.filter((s) => alias.setup?.[s]?.trim()).map((s) => (
                  <TabsTrigger key={s} value={s} className="text-xs px-3">
                    {SHELL_LABELS[s]}
                  </TabsTrigger>
                ))}
              </TabsList>
              {SHELLS.filter((s) => alias.setup?.[s]?.trim()).map((s) => (
                <TabsContent key={s} value={s}>
                  <pre className="bg-muted p-4 rounded-md text-sm font-mono overflow-x-auto whitespace-pre-wrap">
                    {alias.setup![s]}
                  </pre>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Edit Form */}
      <AliasForm
        open={showEditForm}
        onOpenChange={setShowEditForm}
        alias={alias}
        aliases={aliases}
        tools={tools}
        tagDefinitions={tagDefinitions}
        statusDefinitions={statusDefinitions}
        onSubmit={handleUpdate}
      />
    </div>
  );
}
