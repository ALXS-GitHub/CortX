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
import { X } from 'lucide-react';
import { TagBadge } from '@/components/ui/TagBadge';
import { ComboboxInput } from '@/components/ui/combobox-input';
import type { ShellAlias, TagDefinition, StatusDefinition, CreateShellAliasInput, UpdateShellAliasInput } from '@/types';

// Valid alias name: alphanumeric, hyphens, underscores, dots
const ALIAS_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_\-\.]*$/;

interface AliasFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alias?: ShellAlias;
  aliases: ShellAlias[];
  tagDefinitions: TagDefinition[];
  statusDefinitions: StatusDefinition[];
  onSubmit: (data: CreateShellAliasInput | UpdateShellAliasInput) => Promise<void>;
}

export function AliasForm({ open, onOpenChange, alias, aliases, tagDefinitions, statusDefinitions, onSubmit }: AliasFormProps) {
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

  useEffect(() => {
    if (open) {
      if (alias) {
        setName(alias.name);
        setCommand(alias.command);
        setDescription(alias.description || '');
        setStatus(alias.status || '');
        setTags([...alias.tags]);
        setTagInput('');
      } else {
        setName('');
        setCommand('');
        setDescription('');
        setStatus('');
        setTags([]);
        setTagInput('');
      }
      setError(null);
      setShowTagSuggestions(false);
    }
  }, [open, alias]);

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

    if (!command.trim()) {
      setError('Command is required');
      return;
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
      const data: CreateShellAliasInput | UpdateShellAliasInput = {
        name: name.trim(),
        command: command.trim(),
        description: description.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        status: status.trim() || undefined,
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
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden flex-1">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{isEditing ? 'Edit Alias' : 'Create Alias'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the shell alias.'
                : 'Define a shell alias that will be available in your terminal.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 overflow-y-auto flex-1 px-1">
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
              {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Alias'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
