import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { FileText } from 'lucide-react';
import { TagBadge } from '@/components/ui/TagBadge';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { ToolIcon, ToolMenu, hoverMenuClass } from './ToolCard';
import type { Tool, TagDefinition } from '@/types';

interface ToolCardProps {
  tool: Tool;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
  onToggleFavorite: () => void;
}

/** Card (the "card" view mode). */
export function ToolCardView({ tool, tagDefinitions, onEdit, onDelete, onClick, onToggleFavorite }: ToolCardProps) {
  const configs = tool.configPaths.length;

  return (
    <Card interactive size="sm" className="group h-full gap-3" onClick={onClick}>
      <div className="flex items-start gap-3 px-4">
        <ToolIcon color={tool.color} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-display text-[15px] font-semibold tracking-tight">{tool.name}</h3>
            <StatusBadge status={tool.status} className="shrink-0" />
          </div>
          {tool.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>
          ) : tool.installLocation ? (
            <p className="mt-0.5 truncate font-mono text-[11px] text-faint" title={tool.installLocation}>{tool.installLocation}</p>
          ) : null}
        </div>
        <FavoriteButton favorite={tool.favorite} onToggle={onToggleFavorite} />
        <ToolMenu onEdit={onEdit} onDelete={onDelete} className={hoverMenuClass} />
      </div>

      {tool.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4">
          {tool.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 border-t border-border px-4 pt-3">
        <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate font-mono text-[11px] text-faint">
          <FileText className="size-3 shrink-0" />
          {configs === 0 ? 'No config path' : `${configs} config${configs > 1 ? 's' : ''}`}
        </span>
        {tool.version && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground" title="Version">
            v{tool.version.replace(/^v/i, '')}
          </span>
        )}
        {tool.installMethod && (
          <span className="shrink-0 font-mono text-[11px] text-faint" title="Install method">
            {tool.installMethod}
          </span>
        )}
      </div>
    </Card>
  );
}
