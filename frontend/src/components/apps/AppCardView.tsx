import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Rocket } from 'lucide-react';
import { TagBadge } from '@/components/ui/TagBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { AppIcon, AppMenu, hoverMenuClass } from './AppCard';
import { useLaunchApp } from './useLaunchApp';
import type { App, TagDefinition } from '@/types';

interface AppCardViewProps {
  app: App;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
  onToggleFavorite: () => void;
}

/** Card (the "card" view mode). */
export function AppCardView({ app, tagDefinitions, onEdit, onDelete, onClick, onToggleFavorite }: AppCardViewProps) {
  const launch = useLaunchApp(app);
  const configs = app.configPaths.length;

  return (
    <Card interactive size="sm" className="group h-full gap-3" onClick={onClick}>
      <div className="flex items-start gap-3 px-4">
        <AppIcon color={app.color} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-display text-[15px] font-semibold tracking-tight">{app.name}</h3>
            <StatusBadge status={app.status} className="shrink-0" />
          </div>
          {app.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{app.description}</p>
          ) : app.executablePath ? (
            <p className="mt-0.5 truncate font-mono text-[11px] text-faint" title={app.executablePath}>{app.executablePath}</p>
          ) : null}
        </div>
        <FavoriteButton favorite={app.favorite} onToggle={onToggleFavorite} />
        <AppMenu onEdit={onEdit} onDelete={onDelete} className={hoverMenuClass} />
      </div>

      {app.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4">
          {app.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 border-t border-border px-4 pt-3">
        <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate font-mono text-[11px] text-faint">
          <FileText className="size-3 shrink-0" />
          {configs === 0 ? 'No config path' : `${configs} config${configs > 1 ? 's' : ''}`}
        </span>
        {app.version && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground" title="Version">
            v{app.version.replace(/^v/i, '')}
          </span>
        )}
        <Button size="sm" onClick={launch}>
          <Rocket className="size-3.5" />
          Launch
        </Button>
      </div>
    </Card>
  );
}
