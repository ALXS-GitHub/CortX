import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ArrowLeft,
  Pencil,
  SquareTerminal,
  Tag,
  Copy,
  Check,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { AliasForm } from './AliasForm';
import { TagBadge } from '@/components/ui/TagBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { toast } from 'sonner';
import type { UpdateShellAliasInput } from '@/types';

export function AliasDetail() {
  const {
    aliases,
    tagDefinitions,
    statusDefinitions,
    selectedAliasId,
    setCurrentView,
    updateAlias,
  } = useAppStore();

  const [showEditForm, setShowEditForm] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);

  const alias = useMemo(
    () => aliases.find((a) => a.id === selectedAliasId),
    [aliases, selectedAliasId]
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
      {alias.tags.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Tag className="size-4" />
              Information
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              {alias.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Command Card */}
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

      {/* Edit Form */}
      <AliasForm
        open={showEditForm}
        onOpenChange={setShowEditForm}
        alias={alias}
        aliases={aliases}
        tagDefinitions={tagDefinitions}
        statusDefinitions={statusDefinitions}
        onSubmit={handleUpdate}
      />
    </div>
  );
}
