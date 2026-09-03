import { StatusDot } from '@/components/ui/StatusDot';
import { TagBadge } from '@/components/ui/TagBadge';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { FileCode } from 'lucide-react';
import { formatCommandDisplay } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { ScriptMenu, ScriptRunBadge, ScriptRunButton, type GlobalScriptCardProps } from './GlobalScriptCard';

/** One-line row; rendered inside a bordered list container by the scripts view. */
export function GlobalScriptCompactItem({
  script,
  status,
  onRun,
  onStop,
  onEdit,
  onDelete,
  onClick,
  onToggleFavorite,
}: GlobalScriptCardProps) {
  const { tagDefinitions } = useAppStore();
  const isRunning = status === 'running';
  const primaryTag = script.tags.length > 0 ? script.tags[0] : null;

  return (
    <div
      className="group flex h-10 cursor-pointer items-center gap-2 border-b border-border px-3 transition-colors last:border-b-0 hover:bg-accent/50"
      onClick={onClick}
    >
      <StatusDot status={status} size={7} className="shrink-0" />
      <FileCode className="size-3.5 shrink-0" style={{ color: script.color || 'var(--text-faint)' }} />

      <TruncatedText className="min-w-0 text-sm font-medium">{script.name}</TruncatedText>

      <ScriptRunBadge status={status} />

      {primaryTag && (
        <span className="flex shrink-0 items-center gap-1">
          <TagBadge tag={primaryTag} tagDefinitions={tagDefinitions} />
          {script.tags.length > 1 && (
            <span className="text-xs text-muted-foreground">+{script.tags.length - 1}</span>
          )}
        </span>
      )}

      <span className="hidden min-w-0 flex-1 truncate font-mono text-[11px] text-faint md:block" title={script.command}>
        {formatCommandDisplay(script.command, script.scriptPath)}
      </span>
      <span className="flex-1 md:hidden" />

      <FavoriteButton favorite={script.favorite} onToggle={onToggleFavorite} size="sm" />

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <ScriptRunButton isRunning={isRunning} onRun={onRun} onStop={onStop} variant="icon" />
        <ScriptMenu onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}
