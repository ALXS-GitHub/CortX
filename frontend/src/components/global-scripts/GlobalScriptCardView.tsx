import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TagBadge } from '@/components/ui/TagBadge';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { cn, formatCommandDisplay } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import {
  ScriptGlyph,
  ScriptMenu,
  ScriptRunBadge,
  ScriptRunButton,
  type GlobalScriptCardProps,
} from './GlobalScriptCard';

/** Card (the "card" view mode). */
export function GlobalScriptCardView({
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

  return (
    <Card
      interactive
      size="sm"
      className={cn('group h-full gap-3', isRunning && 'border-accent-border')}
      onClick={onClick}
    >
      <div className="flex items-start gap-3 px-4">
        <ScriptGlyph color={script.color} status={status} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-display text-[15px] font-semibold tracking-tight">{script.name}</h3>
            <StatusBadge status={script.status} className="shrink-0" />
          </div>
          {script.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{script.description}</p>
          ) : (
            <p className="mt-0.5 truncate font-mono text-[11px] text-faint" title={script.command}>
              {formatCommandDisplay(script.command, script.scriptPath)}
            </p>
          )}
        </div>
        <FavoriteButton favorite={script.favorite} onToggle={onToggleFavorite} />
        <ScriptMenu onEdit={onEdit} onDelete={onDelete} className="opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      {(script.description || script.tags.length > 0) && (
        <div className="flex flex-col gap-2 px-4">
          {script.description && (
            <p className="truncate font-mono text-[11px] text-faint" title={script.command}>
              {formatCommandDisplay(script.command, script.scriptPath)}
            </p>
          )}
          {script.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {script.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 border-t border-border px-4 pt-3">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <ScriptRunBadge status={status} />
          {status === 'idle' && (
            <span className="truncate font-mono text-[11px] text-faint" title={script.workingDir}>
              {script.workingDir || 'Idle'}
            </span>
          )}
        </span>
        <ScriptRunButton isRunning={isRunning} onRun={onRun} onStop={onStop} />
      </div>
    </Card>
  );
}
