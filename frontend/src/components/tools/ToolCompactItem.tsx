import { StatusBadge } from '@/components/ui/StatusBadge';
import { Wrench, FileText } from 'lucide-react';
import { TagBadge } from '@/components/ui/TagBadge';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { ToolMenu, hoverMenuClass } from './ToolCard';
import type { Tool, TagDefinition } from '@/types';

interface ToolCardProps {
  tool: Tool;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
  onToggleFavorite: () => void;
}

/** One-line row; rendered inside a bordered list container by ToolsView. */
export function ToolCompactItem({ tool, tagDefinitions, onEdit, onDelete, onClick, onToggleFavorite }: ToolCardProps) {
  const configs = tool.configPaths.length;

  return (
    <div
      className="group flex h-10 cursor-pointer items-center gap-2 border-b border-border px-3 transition-colors last:border-b-0 hover:bg-accent/50"
      onClick={onClick}
    >
      <Wrench className="size-3.5 shrink-0" style={{ color: tool.color || 'var(--text-faint)' }} />

      <TruncatedText className="min-w-0 text-sm font-medium">{tool.name}</TruncatedText>

      <StatusBadge status={tool.status} className="shrink-0" />

      {tool.tags.length > 0 && (
        <TagBadge tag={tool.tags[0]} tagDefinitions={tagDefinitions} className="shrink-0" />
      )}

      <span className="hidden min-w-0 flex-1 truncate font-mono text-[11px] text-faint md:block" title={tool.installLocation}>
        {tool.installLocation}
      </span>
      <span className="flex-1 md:hidden" />

      {configs > 0 && (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground" title="Configuration paths">
          <FileText className="size-3" />
          {configs}
        </span>
      )}

      <FavoriteButton favorite={tool.favorite} onToggle={onToggleFavorite} size="sm" />

      <ToolMenu onEdit={onEdit} onDelete={onDelete} className={hoverMenuClass} />
    </div>
  );
}
