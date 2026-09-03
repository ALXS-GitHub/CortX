import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  SquareTerminal,
  Tag,
  Copy,
  Check,
  Wrench,
  Settings,
  Globe,
  Star,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { AliasForm } from './AliasForm';
import { AliasTypeIcon } from './AliasCard';
import { TagBadge } from '@/components/ui/TagBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { toast } from 'sonner';
import type { AliasType, UpdateShellAliasInput } from '@/types';

const SHELLS = ['powershell', 'bash', 'zsh', 'fish'] as const;
const SHELL_LABELS: Record<string, string> = {
  powershell: 'PowerShell',
  bash: 'Bash',
  zsh: 'Zsh',
  fish: 'Fish',
};

const preClass = 'overflow-x-auto whitespace-pre-wrap rounded-sm bg-muted/70 p-3 font-mono text-[12px] leading-relaxed';

/** Card with a titled header row (icon, title, optional actions). */
function Section({
  icon: Icon,
  title,
  actions,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className="gap-3">
      <div className="flex items-center justify-between gap-3 px-4">
        <h2 className="inline-flex items-center gap-2 font-display text-base font-semibold">
          <Icon className="size-4 text-faint" />
          {title}
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

/** Per-shell code viewer (script / setup). */
function ShellCodeTabs({ code }: { code: Partial<Record<string, string>> }) {
  const shells = SHELLS.filter((s) => code[s]?.trim());
  return (
    <Tabs defaultValue={shells[0] || 'powershell'}>
      <TabsList>
        {shells.map((s) => (
          <TabsTrigger key={s} value={s}>
            {SHELL_LABELS[s]}
          </TabsTrigger>
        ))}
      </TabsList>
      {shells.map((s) => (
        <TabsContent key={s} value={s}>
          <pre className={preClass}>{code[s]}</pre>
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function AliasDetail() {
  const {
    aliases,
    tools,
    tagDefinitions,
    statusDefinitions,
    selectedAliasId,
    setCurrentView,
    updateAlias,
    deleteAlias,
    selectTool,
  } = useAppStore();

  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);

  const alias = useMemo(
    () => aliases.find((a) => a.id === selectedAliasId),
    [aliases, selectedAliasId]
  );

  const handleToggleFavorite = async () => {
    if (!alias) return;
    try {
      await updateAlias(alias.id, { favorite: !alias.favorite });
    } catch (e) {
      toast.error('Failed to update favorite', { description: String(e) });
    }
  };

  const linkedTool = useMemo(
    () => (alias?.toolId ? tools.find((t) => t.id === alias.toolId) : undefined),
    [alias, tools]
  );

  const handleUpdate = async (data: UpdateShellAliasInput) => {
    if (!alias) return;
    await updateAlias(alias.id, data);
    toast.success('Alias updated');
  };

  const handleDelete = async () => {
    if (!alias) return;
    try {
      await deleteAlias(alias.id);
      toast.success('Alias deleted');
      setCurrentView('aliases');
    } catch (e) {
      toast.error('Failed to delete alias', { description: String(e) });
    }
    setShowDeleteDialog(false);
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
      <Screen title="Shell config" eyebrow="Shell Config" onBack={() => setCurrentView('aliases')} backLabel="Back to shell config">
        <EmptyState
          icon={SquareTerminal}
          title="Alias not found"
          description="It may have been removed from another window or from the CLI."
          action={
            <Button onClick={() => setCurrentView('aliases')}>
              <ArrowLeft />
              Back to shell config
            </Button>
          }
        />
      </Screen>
    );
  }

  const aliasType = (alias.aliasType || 'function') as AliasType;
  const hasSetup = alias.setup && Object.values(alias.setup).some((v) => v.trim());
  const hasScript = alias.script && Object.values(alias.script).some((v) => v.trim());

  return (
    <Screen
      eyebrow="Shell Config"
      title={
        <span className="inline-flex items-center gap-2">
          <AliasTypeIcon type={aliasType} size="sm" />
          <span className="font-mono">{alias.name}</span>
          <Badge variant="outline">{aliasType}</Badge>
          {alias.shim && (
            <Badge variant="secondary" title="Shim enabled — callable from any process (agents, scheduled tasks)">
              <Globe />
              shim
            </Badge>
          )}
          <StatusBadge status={alias.status} />
        </span>
      }
      subtitle={alias.description}
      onBack={() => setCurrentView('aliases')}
      backLabel="Back to shell config"
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-pressed={alias.favorite}
            onClick={handleToggleFavorite}
            title={alias.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={alias.favorite ? 'fill-warning text-warning' : ''} />
          </Button>
          {linkedTool && (
            <Button variant="outline" onClick={() => selectTool(linkedTool.id)} title="Open the linked tool">
              <Wrench />
              {linkedTool.name}
            </Button>
          )}
          {aliasType === 'function' && (
            <Button variant="outline" onClick={handleCopyCommand}>
              {commandCopied ? <Check className="text-st-done" /> : <Copy />}
              {commandCopied ? 'Copied' : 'Copy command'}
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
                Edit alias
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setShowDeleteDialog(true)}>
                <Trash2 />
                Delete alias
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <div className="space-y-4">
        {/* Command — for function type */}
        {aliasType === 'function' && (
          <Section
            icon={SquareTerminal}
            title="Command"
            actions={
              <Button variant="ghost" size="sm" onClick={handleCopyCommand}>
                {commandCopied ? <Check className="text-st-done" /> : <Copy />}
                {commandCopied ? 'Copied' : 'Copy'}
              </Button>
            }
          >
            <pre className={preClass}>{alias.command}</pre>
          </Section>
        )}

        {/* Script / Init — for script and init types */}
        {aliasType !== 'function' && hasScript && (
          <Section icon={SquareTerminal} title={aliasType === 'init' ? 'Init command' : 'Script'}>
            <ShellCodeTabs code={alias.script!} />
          </Section>
        )}

        {/* Setup */}
        {hasSetup && (
          <Section icon={Settings} title="Setup code">
            <ShellCodeTabs code={alias.setup!} />
          </Section>
        )}

        {/* Information */}
        {(alias.tags.length > 0 || linkedTool || alias.executionOrder != null) && (
          <Section icon={Tag} title="Information">
            <div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-2.5">
              {linkedTool && (
                <Row label="Linked tool">
                  <Button variant="link" size="sm" className="h-auto p-0" onClick={() => selectTool(linkedTool.id)}>
                    <Wrench className="size-3.5" />
                    {linkedTool.name}
                  </Button>
                </Row>
              )}
              {alias.executionOrder != null && (
                <Row label="Execution order">
                  <code className="rounded-xs bg-muted px-1.5 py-0.5 font-mono text-[11px]">{alias.executionOrder}</code>
                </Row>
              )}
              {alias.tags.length > 0 && (
                <Row label="Tags">
                  <div className="flex flex-wrap gap-1">
                    {alias.tags.map((tag) => (
                      <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
                    ))}
                  </div>
                </Row>
              )}
            </div>
          </Section>
        )}
      </div>

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

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete shell config</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{alias.name}"? This cannot be undone.
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
