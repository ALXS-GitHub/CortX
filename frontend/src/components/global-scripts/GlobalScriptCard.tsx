import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusDot } from '@/components/ui/StatusDot';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TagBadge } from '@/components/ui/TagBadge';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { Play, Square, MoreVertical, FileCode, Pencil, Trash2 } from 'lucide-react';
import { cn, formatCommandDisplay } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import type { GlobalScript, ScriptStatus } from '@/types';

export interface GlobalScriptCardProps {
  script: GlobalScript;
  status: ScriptStatus;
  onRun: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
  onToggleFavorite: () => void;
}

/** Runtime state of a script as a tinted pill (nothing when idle). */
export function ScriptRunBadge({ status, className }: { status: ScriptStatus; className?: string }) {
  switch (status) {
    case 'running':
      return <Badge variant="info" className={cn('shrink-0', className)}>Running</Badge>;
    case 'completed':
      return <Badge variant="success" className={cn('shrink-0', className)}>Done</Badge>;
    case 'failed':
      return <Badge variant="destructive" className={cn('shrink-0', className)}>Failed</Badge>;
    default:
      return null;
  }
}

/** Colour tile with the script glyph and its live state, shared by the three list items. */
export function ScriptGlyph({
  color,
  status,
  size = 'md',
  className,
}: {
  color?: string | null;
  status: ScriptStatus;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const c = color || 'var(--text-faint)';
  return (
    <div className={cn('relative shrink-0', className)}>
      <span
        className={cn('grid place-items-center rounded-[var(--rad-sm)]', size === 'sm' ? 'size-7 rounded-[var(--rad-xs)]' : 'size-9')}
        style={{ backgroundColor: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }}
      >
        <FileCode className={size === 'sm' ? 'size-3.5' : 'size-4'} />
      </span>
      <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-card">
        <StatusDot status={status} size={size === 'sm' ? 8 : 9} />
      </span>
    </div>
  );
}

/** The "…" menu shared by the script list items. */
export function ScriptMenu({
  onEdit,
  onDelete,
  className,
}: {
  onEdit: () => void;
  onDelete: () => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon-sm" className={className} aria-label="Script actions">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
          <Pencil />
          Edit script
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 />
          Delete script
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Run / Stop control shared by the list items. */
export function ScriptRunButton({
  isRunning,
  onRun,
  onStop,
  variant = 'button',
}: {
  isRunning: boolean;
  onRun: () => void;
  onStop: () => void;
  /** `icon` for the compact row, `button` (with label) elsewhere. */
  variant?: 'button' | 'icon';
}) {
  const stop = (e: React.MouseEvent) => { e.stopPropagation(); onStop(); };
  const run = (e: React.MouseEvent) => { e.stopPropagation(); onRun(); };

  if (variant === 'icon') {
    return isRunning ? (
      <Button variant="ghost" size="icon-sm" onClick={stop} title="Stop" className="text-destructive hover:text-destructive">
        <Square className="size-3.5" />
      </Button>
    ) : (
      <Button variant="ghost" size="icon-sm" onClick={run} title="Run">
        <Play className="size-3.5" />
      </Button>
    );
  }

  return isRunning ? (
    <Button size="sm" variant="outline" onClick={stop} className="text-destructive hover:text-destructive">
      <Square className="size-3.5" />
      Stop
    </Button>
  ) : (
    <Button size="sm" onClick={run}>
      <Play className="size-3.5" />
      Run
    </Button>
  );
}

/** List row (the "list" view mode). */
export function GlobalScriptCard({
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
      className={cn('group py-3', isRunning && 'border-accent-border')}
      onClick={onClick}
    >
      <div className="flex items-center gap-4 px-4">
        <ScriptGlyph color={script.color} status={status} />

        {/* Left: name + description + tags */}
        <div className="w-60 min-w-0 shrink-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-display text-[15px] font-semibold tracking-tight">{script.name}</h3>
            <ScriptRunBadge status={status} />
            <StatusBadge status={script.status} className="shrink-0" />
          </div>
          {script.description && (
            <p className="line-clamp-1 text-xs text-muted-foreground">{script.description}</p>
          )}
          {script.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {script.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
              ))}
            </div>
          )}
        </div>

        {/* Middle: command */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 font-mono text-[11px]">
          <p className="truncate text-foreground/80" title={script.command}>
            {formatCommandDisplay(script.command, script.scriptPath)}
          </p>
          {script.workingDir && (
            <p className="truncate text-faint" title={script.workingDir}>{script.workingDir}</p>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          <FavoriteButton favorite={script.favorite} onToggle={onToggleFavorite} />
          <ScriptRunButton isRunning={isRunning} onRun={onRun} onStop={onStop} />
          <ScriptMenu onEdit={onEdit} onDelete={onDelete} className="opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>
    </Card>
  );
}
