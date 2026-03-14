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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { X, ChevronDown } from 'lucide-react';
import { TagBadge } from '@/components/ui/TagBadge';
import { ComboboxInput } from '@/components/ui/combobox-input';
import type { ShellAlias, Tool, TagDefinition, StatusDefinition, AliasType, CreateShellAliasInput, UpdateShellAliasInput } from '@/types';

// Valid alias name: alphanumeric, hyphens, underscores, dots
const ALIAS_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_\-\.]*$/;

const SHELLS = ['powershell', 'bash', 'zsh', 'fish'] as const;

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
  const [setupOpen, setSetupOpen] = useState(false);

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
        setSetupOpen(!!alias.setup && Object.values(alias.setup).some((v) => v.trim()));
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
        setSetupOpen(false);
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
        status: status.trim() || undefined,
        aliasType: aliasType,
        setup: cleanMap(setup),
        script: aliasType !== 'function' ? cleanMap(script) : undefined,
        toolId: toolId || undefined,
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
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden flex-1">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{isEditing ? 'Edit Shell Config' : 'Create Shell Config'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the shell config entry.'
                : 'Define a shell function, init script, or raw script for your terminal.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 overflow-y-auto flex-1 px-1">
            {/* Type selector */}
            <div className="grid gap-2">
              <Label>Type</Label>
              <div className="flex gap-2">
                {(['function', 'script', 'init'] as AliasType[]).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant={aliasType === t ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAliasType(t)}
                  >
                    {t === 'function' ? 'Function' : t === 'script' ? 'Script' : 'Init'}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {aliasType === 'function' && 'Wraps a command as a shell function — arguments are passed through automatically'}
                {aliasType === 'script' && 'Raw per-shell code injected as-is — full control over function definition'}
                {aliasType === 'init' && 'Evaluates command output (like `zoxide init`, `starship init`) — wrapped in eval/Invoke-Expression'}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="alias-name">Name *</Label>
              <Input
                id="alias-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., gs, ll, dcu"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                The alias name used in your shell (e.g., typing <code className="bg-muted px-1 rounded">gs</code> instead of <code className="bg-muted px-1 rounded">git status</code>)
              </p>
            </div>

            {/* Command field — only for function type */}
            {aliasType === 'function' && (
              <div className="grid gap-2">
                <Label htmlFor="alias-command">Command *</Label>
                <Textarea
                  id="alias-command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="e.g., git status"
                  rows={2}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  The command that will be executed when the alias is invoked
                </p>
              </div>
            )}

            {/* Per-shell script/init content — for script and init types */}
            {aliasType !== 'function' && (
              <div className="grid gap-2">
                <Label>{aliasType === 'init' ? 'Init Command *' : 'Script *'}</Label>
                <Tabs defaultValue="powershell">
                  <TabsList className="h-8">
                    {SHELLS.map((s) => (
                      <TabsTrigger key={s} value={s} className="text-xs px-3">
                        {s === 'powershell' ? 'PowerShell' : s === 'bash' ? 'Bash' : s === 'zsh' ? 'Zsh' : 'Fish'}
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
                            : `${s === 'powershell' ? 'PowerShell' : s.charAt(0).toUpperCase() + s.slice(1)} script code...`
                        }
                        rows={4}
                        className="font-mono text-sm"
                      />
                    </TabsContent>
                  ))}
                </Tabs>
                <p className="text-xs text-muted-foreground">
                  {aliasType === 'init'
                    ? 'Command whose output will be evaluated (e.g., zoxide init, starship init)'
                    : 'Raw shell code injected per shell — define functions, aliases, etc.'}
                </p>
              </div>
            )}

            {/* Setup section — collapsible, always available */}
            <Collapsible open={setupOpen} onOpenChange={setSetupOpen}>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="flex items-center gap-1 w-full justify-start px-0 text-muted-foreground hover:text-foreground">
                  <ChevronDown className={`size-4 transition-transform ${setupOpen ? '' : '-rotate-90'}`} />
                  Setup Code (optional)
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid gap-2 pt-2">
                  <Tabs defaultValue="powershell">
                    <TabsList className="h-8">
                      {SHELLS.map((s) => (
                        <TabsTrigger key={s} value={s} className="text-xs px-3">
                          {s === 'powershell' ? 'PowerShell' : s === 'bash' ? 'Bash' : s === 'zsh' ? 'Zsh' : 'Fish'}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {SHELLS.map((s) => (
                      <TabsContent key={s} value={s}>
                        <Textarea
                          value={setup[s] || ''}
                          onChange={(e) => updateSetup(s, e.target.value)}
                          placeholder={`Setup code for ${s === 'powershell' ? 'PowerShell' : s}...`}
                          rows={3}
                          className="font-mono text-sm"
                        />
                      </TabsContent>
                    ))}
                  </Tabs>
                  <p className="text-xs text-muted-foreground">
                    Code that runs before the alias definition (e.g., removing built-in aliases)
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div className="grid gap-2">
              <Label htmlFor="alias-description">Description</Label>
              <Textarea
                id="alias-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this alias do?"
                rows={2}
              />
            </div>

            {/* Tool selector */}
            <div className="grid gap-2">
              <Label htmlFor="alias-tool">Linked Tool</Label>
              <ComboboxInput
                id="alias-tool"
                value={selectedToolName}
                onChange={handleToolChange}
                options={toolOptions}
                placeholder="Select a tool..."
              />
              <p className="text-xs text-muted-foreground">
                Link this alias to a tool — it will appear in the tool's detail page
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="alias-status">Status</Label>
              <ComboboxInput
                id="alias-status"
                value={status}
                onChange={setStatus}
                options={statusDefinitions.map((d) => d.name)}
                placeholder="e.g., Active, Archived"
              />
            </div>

            <div className="grid gap-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-1.5 p-2 border rounded-md min-h-[38px] focus-within:ring-2 focus-within:ring-ring">
                {tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1">
                    <TagBadge tag={tag} tagDefinitions={tagDefinitions} />
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => removeTag(tag)}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <div className="relative flex-1 min-w-[120px]">
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
                    placeholder={tags.length === 0 ? 'Add tags...' : ''}
                    className="w-full bg-transparent border-none outline-none text-sm py-0.5"
                  />
                  {showTagSuggestions && tagSuggestions.length > 0 && (
                    <div
                      ref={suggestionsRef}
                      className="absolute top-full left-0 z-50 mt-1 w-56 max-h-48 overflow-y-auto bg-popover border rounded-md shadow-md"
                    >
                      {tagSuggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-muted text-left cursor-pointer"
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
              <p className="text-xs text-muted-foreground">
                Type and press Enter to add a tag, or select from suggestions
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="flex-shrink-0 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
