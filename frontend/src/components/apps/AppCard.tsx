import type { CSSProperties } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { AppWindow, MoreVertical, Pencil, Trash2, FileText, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TagBadge } from '@/components/ui/TagBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { useAppStore } from '@/stores/appStore';
import { toast } from 'sonner';
import type { App, TagDefinition } from '@/types';

interface AppCardProps {
  app: App;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
  onToggleFavorite: () => void;
}

/** Tinted tile with the app icon, coloured with the app's colour. Shared by the list shapes and the detail header. */
export function AppIcon({ color, size = 'md', className }: { color?: string | null; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const c = color || 'var(--text-faint)';
  const box = size === 'sm' ? 'size-6 rounded-[var(--rad-xs)]' : size === 'lg' ? 'size-10 rounded-[var(--rad-sm)]' : 'size-9 rounded-[var(--rad-sm)]';
  const icon = size === 'sm' ? 'size-3.5' : size === 'lg' ? 'size-5' : 'size-4';
  return (
    <span
      className={cn('grid shrink-0 place-items-center', box, className)}
      style={{ color: c, backgroundColor: `color-mix(in srgb, ${c} 14%, transparent)` } as CSSProperties}
      aria-hidden
    >
      <AppWindow className={icon} />
    </span>
  );
}

/** Launch handler shared by the three app list shapes (never navigates to the row underneath). */
export function useLaunchApp(app: App) {
  const { launchApp } = useAppStore();
  return async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await launchApp(app.id);
      toast.success(`Launched ${app.name}`);
    } catch (err) {
      toast.error('Failed to launch app', { description: String(err) });
    }
  };
}

/** The "…" menu shared by the three app list shapes. */
export function AppMenu({ onEdit, onDelete, className }: { onEdit: () => void; onDelete: () => void; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon-sm" className={className} aria-label="App actions">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
          <Pencil />
          Edit app
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 />
          Delete app
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Hover-only control classes (stay visible while a menu is open). */
export const hoverMenuClass = 'opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100';

/** List row (the "list" view mode). */
export function AppCard({ app, tagDefinitions, onEdit, onDelete, onClick, onToggleFavorite }: AppCardProps) {
  const launch = useLaunchApp(app);
  const configs = app.configPaths.length;

  return (
    <Card interactive size="sm" className="group py-3" onClick={onClick}>
      <div className="flex items-center gap-4 px-4">
        <AppIcon color={app.color} />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-display text-[15px] font-semibold tracking-tight">{app.name}</h3>
            <StatusBadge status={app.status} className="shrink-0" />
          </div>
          {app.description ? (
            <p className="line-clamp-1 text-xs text-muted-foreground">{app.description}</p>
          ) : app.executablePath ? (
            <p className="truncate font-mono text-[11px] text-faint" title={app.executablePath}>{app.executablePath}</p>
          ) : null}
          {app.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {app.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
              ))}
            </div>
          )}
        </div>

        {configs > 0 && (
          <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex" title="Configuration paths">
            <FileText />
            {configs} config{configs > 1 ? 's' : ''}
          </Badge>
        )}

        <div className="flex shrink-0 items-center gap-1.5">
          <FavoriteButton favorite={app.favorite} onToggle={onToggleFavorite} />
          <Button size="sm" variant="outline" onClick={launch} title="Launch">
            <Rocket className="size-3.5" />
            Launch
          </Button>
          <AppMenu onEdit={onEdit} onDelete={onDelete} className={hoverMenuClass} />
        </div>
      </div>
    </Card>
  );
}
