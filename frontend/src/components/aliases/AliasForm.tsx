import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Segmented } from '@/components/ui/Segmented';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { TagBadge } from '@/components/ui/TagBadge';
import { ComboboxInput } from '@/components/ui/combobox-input';
import { cn } from '@/lib/utils';
import type { ShellAlias, Tool, TagDefinition, StatusDefinition, AliasType, CreateShellAliasInput, UpdateShellAliasInput } from '@/types';

// Valid alias name: alphanumeric, hyphens, underscores, dots
const ALIAS_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.-]*$/;

const SHELLS = ['powershell', 'bash', 'zsh', 'fish'] as const;
const SHELL_LABELS: Record<string, string> = {
  powershell: 'PowerShell',
  bash: 'Bash',
  zsh: 'Zsh',
  fish: 'Fish',
};

const TYPE_OPTIONS: { value: AliasType; label: string }[] = [
  { value: 'function', label: 'Function' },
  { value: 'script', label: 'Script' },
  { value: 'init', label: 'Init' },
];

const labelClass = 'text-xs font-medium text-muted-foreground';
const hintClass = 'text-xs text-faint';
const codeClass = 'rounded-xs bg-muted px-1 font-mono text-[11px] text-foreground/80';

interface AliasFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alias?: ShellAlias;
  aliases: ShellAlias[];
  tools: Tool[];
  tagDefinitions: TagDefinition[];
  statusDefinitions: StatusDefinition[];
  onSubmit: (data: CreateShellAliasInput | UpdateShellAliasInput) => Promise<void>;
  defaultToolId?: string;
}

export function AliasForm({ open, onOpenChange, alias, aliases, tools, tagDefinitions, statusDefinitions, onSubmit, defaultToolId }: AliasFormProps) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // New fields
  const [aliasType, setAliasType] = useState<AliasType>('function');
  const [setup, setSetup] = useState<Record<string, string>>({});
  const [script, setScript] = useState<Record<string, string>>({});
  const [toolId, setToolId] = useState('');
  const [executionOrder, setExecutionOrder] = useState<string>('');
  const [setupOpen, setSetupOpen] = useState(false);
  const [shim, setShim] = useState(false);

  const isEditing = !!alias;

  // All known tag names for autocomplete
  const allKnownTags = useMemo(() => {
    const set = new Set<string>();
    for (const td of tagDefinitions) set.add(td.name);
    for (const a of aliases) {
      for (const tag of a.tags) set.add(tag);
    }
    return Array.from(set).sort();
  }, [tagDefinitions, aliases]);

  const tagSuggestions = useMemo(() => {
    if (!tagInput.trim()) return allKnownTags.filter((t) => !tags.includes(t));
    const q = tagInput.toLowerCase();
    return allKnownTags.filter(
      (t) => t.toLowerCase().includes(q) && !tags.includes(t)
    );
  }, [tagInput, allKnownTags, tags]);

  const toolOptions = useMemo(() => tools.map((t) => t.name), [tools]);

  const selectedToolName = useMemo(() => {
    if (!toolId) return '';
    const t = tools.find((t) => t.id === toolId);
    return t?.name || '';
  }, [toolId, tools]);

  useEffect(() => {
    if (open) {
      if (alias) {
        setName(alias.name);
        setCommand(alias.command);
        setDescription(alias.description || '');
        setStatus(alias.status || '');
        setTags([...alias.tags]);
        setTagInput('');
        setAliasType(alias.aliasType || 'function');
        setSetup(alias.setup ? { ...alias.setup } : {});
        setScript(alias.script ? { ...alias.script } : {});
        setToolId(alias.toolId || '');
        setExecutionOrder(alias.executionOrder != null ? String(alias.executionOrder) : '');
        setSetupOpen(!!alias.setup && Object.values(alias.setup).some((v) => v.trim()));
        setShim(!!alias.shim);
      } else {
        setName('');
        setCommand('');
        setDescription('');
        setStatus('');
        setTags([]);
        setTagInput('');
        setAliasType('function');
        setSetup({});
        setScript({});
        setToolId(defaultToolId || '');
        setExecutionOrder('');
        setSetupOpen(false);
        setShim(false);
      }
      setError(null);
      setShowTagSuggestions(false);
    }
  }, [open, alias, defaultToolId]);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        tagInputRef.current &&
        !tagInputRef.current.contains(e.target as Node)
      ) {
        setShowTagSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput('');
    setShowTagSuggestions(false);
    tagInputRef.current?.focus();
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (tagInput.trim()) {
        addTag(tagInput);
      }
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    } else if (e.key === 'Escape') {
      setShowTagSuggestions(false);
    }
  };

  const updateSetup = (shell: string, value: string) => {
    setSetup((prev) => ({ ...prev, [shell]: value }));
  };

  const updateScript = (shell: string, value: string) => {
    setScript((prev) => ({ ...prev, [shell]: value }));
  };

  const handleToolChange = (toolName: string) => {
    if (!toolName) {
      setToolId('');
      return;
    }
    const t = tools.find((t) => t.name === toolName);
    setToolId(t?.id || '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Alias name is required');
      return;
    }

    if (!ALIAS_NAME_REGEX.test(name.trim())) {
      setError('Alias name must start with a letter or underscore and contain only letters, digits, hyphens, underscores, or dots');
      return;
    }

    // Validate based on type
    if (aliasType === 'function') {
      if (!command.trim()) {
        setError('Command is required for function aliases');
        return;
      }
    } else {
      // script or init: require at least one shell script
      const hasScript = SHELLS.some((s) => script[s]?.trim());
      if (!hasScript) {
        setError(`At least one shell ${aliasType === 'init' ? 'init command' : 'script'} is required`);
        return;
      }
    }

    // Check for duplicate name (excluding current alias if editing)
    const duplicate = aliases.find(
      (a) => a.name.toLowerCase() === name.trim().toLowerCase() && a.id !== alias?.id
    );
    if (duplicate) {
      setError(`An alias named "${name.trim()}" already exists`);
      return;
    }

    setIsSubmitting(true);
    try {
      // Clean up empty entries from setup/script maps
      const cleanMap = (m: Record<string, string>) => {
        const cleaned: Record<string, string> = {};
        for (const [k, v] of Object.entries(m)) {
          if (v.trim()) cleaned[k] = v;
        }
        return Object.keys(cleaned).length > 0 ? cleaned : undefined;
      };

      const data: CreateShellAliasInput | UpdateShellAliasInput = {
        name: name.trim(),
        command: command.trim(),
        description: description.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        // Sent even when empty: an empty status is how the backend is told to clear it.
        status: status.trim(),
        aliasType: aliasType,
        setup: cleanMap(setup),
        script: aliasType !== 'function' ? cleanMap(script) : undefined,
        toolId: toolId || undefined,
        executionOrder: executionOrder !== '' ? parseInt(executionOrder, 10) : undefined,
        shim: aliasType === 'function' ? shim : false,
      };
      await onSubmit(data);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit shell config' : 'Create shell config'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the shell config entry.'
                : 'Define a shell function, init script, or raw script for your terminal.'}
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
            <div className="space-y-4">
              {/* Type selector */}
              <div className="space-y-1.5">
                <Label className={labelClass}>Type</Label>
                <div>
                  <Segmented<AliasType> value={aliasType} onChange={setAliasType} options={TYPE_OPTIONS} />
                </div>
                <p className={hintClass}>
                  {aliasType === 'function' && 'Wraps a command as a shell function — arguments are passed through automatically.'}
                  {aliasType === 'script' && 'Raw per-shell code injected as-is — full control over the function definition.'}
                  {aliasType === 'init' && 'Evaluates the command output (like zoxide init, starship init) — wrapped in eval / Invoke-Expression.'}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="alias-name" className={labelClass}>Name *</Label>
                <Input
                  id="alias-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., gs, ll, dcu"
                  className="font-mono"
                />
                <p className={hintClass}>
                  The name used in your shell (e.g., typing <code className={codeClass}>gs</code> instead of <code className={codeClass}>git status</code>).
                </p>
              </div>

              {/* Command field — only for function type */}
              {aliasType === 'function' && (
                <div className="space-y-1.5">
                  <Label htmlFor="alias-command" className={labelClass}>Command *</Label>
                  <Textarea
                    id="alias-command"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="e.g., git status"
                    rows={2}
                    className="font-mono text-[12px]"
                  />
                  <p className={hintClass}>The command executed when the alias is invoked.</p>
                </div>
              )}

              {/* Shim toggle — only meaningful for function aliases */}
              {aliasType === 'function' && (
                <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card/50 p-3">
                  <div className="space-y-1">
                    <Label htmlFor="alias-shim" className="cursor-pointer text-sm">Callable from anywhere (shim)</Label>
                    <p className="text-xs text-muted-foreground">
                      Writes a real launcher file so this alias works in <strong>any</strong> process —
                      agents, scheduled tasks, non-interactive shells — not just terminals that load
                      <code className={cn(codeClass, 'mx-1')}>cortx init</code>. Requires the shim folder
                      on your PATH (set up once in <strong>Settings → Shims</strong>).
                    </p>
                  </div>
                  <Switch id="alias-shim" checked={shim} onCheckedChange={setShim} />
                </div>
              )}

              {/* Per-shell script/init content — for script and init types */}
              {aliasType !== 'function' && (
                <div className="space-y-1.5">
                  <Label className={labelClass}>{aliasType === 'init' ? 'Init command *' : 'Script *'}</Label>
                  <Tabs defaultValue="powershell">
                    <TabsList>
                      {SHELLS.map((s) => (
                        <TabsTrigger key={s} value={s}>
                          {SHELL_LABELS[s]}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {SHELLS.map((s) => (
                      <TabsContent key={s} value={s}>
                        <Textarea
                          value={script[s] || ''}
                          onChange={(e) => updateScript(s, e.target.value)}
                          placeholder={
                            aliasType === 'init'
                              ? `e.g., ${s === 'powershell' ? 'zoxide init powershell' : s === 'fish' ? 'zoxide init fish' : `zoxide init ${s}`}`
                              : `${SHELL_LABELS[s]} script code…`
                          }
                          rows={4}
                          className="font-mono text-[12px]"
                        />
                      </TabsContent>
                    ))}
                  </Tabs>
                  <p className={hintClass}>
                    {aliasType === 'init'
                      ? 'Command whose output will be evaluated (e.g., zoxide init, starship init).'
                      : 'Raw shell code injected per shell — define functions, aliases, etc.'}
                  </p>
                </div>
              )}

              {/* Setup section — collapsible, always available */}
              <Collapsible open={setupOpen} onOpenChange={setSetupOpen}>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground">
                    <ChevronDown className={cn('transition-transform', !setupOpen && '-rotate-90')} />
                    Setup code (optional)
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-1.5 pt-2">
                    <Tabs defaultValue="powershell">
                      <TabsList>
                        {SHELLS.map((s) => (
                          <TabsTrigger key={s} value={s}>
                            {SHELL_LABELS[s]}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                      {SHELLS.map((s) => (
                        <TabsContent key={s} value={s}>
                          <Textarea
                            value={setup[s] || ''}
                            onChange={(e) => updateSetup(s, e.target.value)}
                            placeholder={`Setup code for ${SHELL_LABELS[s]}…`}
                            rows={3}
                            className="font-mono text-[12px]"
                          />
                        </TabsContent>
                      ))}
                    </Tabs>
                    <p className={hintClass}>Code that runs before the alias definition (e.g., removing built-in aliases).</p>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="space-y-1.5">
                <Label htmlFor="alias-description" className={labelClass}>Description</Label>
                <Textarea
                  id="alias-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this alias do?"
                  rows={2}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Tool selector */}
                <div className="space-y-1.5">
                  <Label htmlFor="alias-tool" className={labelClass}>Linked tool</Label>
                  <ComboboxInput
                    id="alias-tool"
                    value={selectedToolName}
                    onChange={handleToolChange}
                    options={toolOptions}
                    placeholder="Select a tool…"
                  />
                  <p className={hintClass}>Shown on the tool's detail page.</p>
                </div>

                {/* Execution order */}
                <div className="space-y-1.5">
                  <Label htmlFor="alias-exec-order" className={labelClass}>Execution order</Label>
                  <Input
                    id="alias-exec-order"
                    type="number"
                    min="0"
                    value={executionOrder}
                    onChange={(e) => setExecutionOrder(e.target.value)}
                    placeholder="None (default)"
                    className="font-mono"
                  />
                  <p className={hintClass}>
                    Position in <code className={codeClass}>cortx init</code> output — lower runs first, empty runs after ordered aliases.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="alias-status" className={labelClass}>Status</Label>
                <ComboboxInput
                  id="alias-status"
                  value={status}
                  onChange={setStatus}
                  options={statusDefinitions.map((d) => d.name)}
                  placeholder="e.g., Active, Archived"
                />
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Tags</Label>
                <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-sm border border-input bg-[var(--bg-input)] px-2 py-1.5 shadow-soft transition-[border-color,box-shadow] focus-within:border-accent-border focus-within:ring-2 focus-within:ring-ring/40">
                  {tags.map((tag) => (
                    <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} onRemove={() => removeTag(tag)} />
                  ))}
                  <div className="relative min-w-[120px] flex-1">
                    <input
                      ref={tagInputRef}
                      type="text"
                      value={tagInput}
                      onChange={(e) => {
                        setTagInput(e.target.value);
                        setShowTagSuggestions(true);
                      }}
                      onFocus={() => setShowTagSuggestions(true)}
                      onKeyDown={handleTagInputKeyDown}
                      placeholder={tags.length === 0 ? 'Add tags…' : ''}
                      className="w-full border-none bg-transparent py-0.5 text-sm outline-none placeholder:text-faint"
                    />
                    {showTagSuggestions && tagSuggestions.length > 0 && (
                      <div
                        ref={suggestionsRef}
                        className="glass-strong absolute left-0 top-full z-50 mt-1.5 max-h-48 w-56 overflow-y-auto rounded-sm border border-border-strong p-1 shadow-pop"
                      >
                        {tagSuggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            className="flex w-full items-center gap-2 rounded-[calc(var(--radius-sm)-2px)] px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              addTag(suggestion);
                            }}
                          >
                            <TagBadge tag={suggestion} tagDefinitions={tagDefinitions} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <p className={hintClass}>Type and press Enter to add a tag, or pick a suggestion.</p>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : isEditing ? 'Save changes' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
