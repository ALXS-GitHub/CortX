import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { AppWindow, MoreVertical, Pencil, Trash2, FileText, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TagBadge } from '@/components/ui/TagBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAppStore } from '@/stores/appStore';
import { toast } from 'sonner';
import type { App, TagDefinition } from '@/types';

interface AppCardProps {
  app: App;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}

export function AppCard({ app, tagDefinitions, onEdit, onDelete, onClick }: AppCardProps) {
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
    <Card className="group cursor-pointer hover:border-primary/50 transition-colors" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className="mt-1 flex-shrink-0">
            <AppWindow className="size-5" style={{ color: app.color || '#6b7280' }} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium truncate">{app.name}</h3>
              <StatusBadge status={app.status} />
            </div>
            {app.description && (
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{app.description}</p>
            )}
            {app.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-2">
                {app.tags.map((tag) => (
                  <TagBadge key={tag} tag={tag} tagDefinitions={tagDefinitions} />
                ))}
              </div>
            )}
            {app.configPaths.length > 0 && (
              <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground">
                <FileText className="size-3" />
                <span>{app.configPaths.length} config{app.configPaths.length > 1 ? 's' : ''}</span>
              </div>
            )}
          </div>

          <div className={cn('flex items-center gap-1', 'opacity-0 group-hover:opacity-100 transition-opacity')} onClick={(e) => e.stopPropagation()}>
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
                  <Pencil className="size-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="size-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
