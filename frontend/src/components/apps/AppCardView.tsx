import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { AppWindow, MoreVertical, Pencil, Trash2, FileText, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TagBadge } from '@/components/ui/TagBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAppStore } from '@/stores/appStore';
import { toast } from 'sonner';
import type { App, TagDefinition } from '@/types';

interface AppCardViewProps {
  app: App;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}

export function AppCardView({ app, tagDefinitions, onEdit, onDelete, onClick }: AppCardViewProps) {
  const { launchApp } = useAppStore();

  const handleLaunch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await launchApp(app.id);
      toast.success(`Launched ${app.name}`);
    } catch (err) {
      toast.error('Failed to launch app', { description: String(err) });
    }
  };

  return (
    <Card className="group cursor-pointer hover:border-primary/50 transition-colors h-full flex flex-col" onClick={onClick}>
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AppWindow className="size-5 flex-shrink-0" style={{ color: app.color || '#6b7280' }} />
            <h3 className="font-medium truncate">{app.name}</h3>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <StatusBadge status={app.status} />
            <div
              className={cn('flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity')}
              onClick={(e) => e.stopPropagation()}
            >
              <Button variant="ghost" size="icon" className="size-7" onClick={handleLaunch} title="Launch">
                <Rocket className="size-3.5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7">
                    <MoreVertical className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onEdit}>
                    <Pencil className="size-4 mr-2" />Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onDelete} className="text-destructive">
                    <Trash2 className="size-4 mr-2" />Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 flex-1 flex flex-col">
        {app.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{app.description}</p>
        )}
        <div className="mt-auto pt-3 space-y-2">
          {app.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {app.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
              ))}
            </div>
          )}
          {app.configPaths.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <FileText className="size-3" />
              <span>{app.configPaths.length} config{app.configPaths.length > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
