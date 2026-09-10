import { Button } from '@/components/ui/button';
import { AppWindow, FileText, Rocket } from 'lucide-react';
import { TagBadge } from '@/components/ui/TagBadge';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { AppMenu } from './AppCard';
import { useLaunchApp } from './useLaunchApp';
import type { App, TagDefinition } from '@/types';

interface AppCompactItemProps {
  app: App;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
  onToggleFavorite: () => void;
}

/** One-line row; rendered inside a bordered list container by AppsView. */
export function AppCompactItem({ app, tagDefinitions, onEdit, onDelete, onClick, onToggleFavorite }: AppCompactItemProps) {
  const launch = useLaunchApp(app);
  const configs = app.configPaths.length;

  return (
    <div
      className="group flex h-10 cursor-pointer items-center gap-2 border-b border-border px-3 transition-colors last:border-b-0 hover:bg-accent/50"
      onClick={onClick}
    >
      <AppWindow className="size-3.5 shrink-0" style={{ color: app.color || 'var(--text-faint)' }} />

      <TruncatedText className="min-w-0 text-sm font-medium">{app.name}</TruncatedText>

      <StatusBadge status={app.status} className="shrink-0" />

      {app.tags.length > 0 && (
        <TagBadge tag={app.tags[0]} tagDefinitions={tagDefinitions} className="shrink-0" />
      )}

      <span className="hidden min-w-0 flex-1 truncate font-mono text-[11px] text-faint md:block" title={app.executablePath}>
        {app.executablePath}
      </span>
      <span className="flex-1 md:hidden" />

      {configs > 0 && (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground" title="Configuration paths">
          <FileText className="size-3" />
          {configs}
        </span>
      )}

      <FavoriteButton favorite={app.favorite} onToggle={onToggleFavorite} size="sm" />

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 has-data-[state=open]:opacity-100">
        <Button variant="ghost" size="icon-sm" onClick={launch} title="Launch" aria-label="Launch">
          <Rocket className="size-3.5" />
        </Button>
        <AppMenu onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}
