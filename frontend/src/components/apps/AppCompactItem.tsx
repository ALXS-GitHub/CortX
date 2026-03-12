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

interface AppCompactItemProps {
  app: App;
  tagDefinitions?: TagDefinition[];
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}

export function AppCompactItem({ app, tagDefinitions, onEdit, onDelete, onClick }: AppCompactItemProps) {
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
    <div
      className="group flex items-center h-9 border rounded-md px-3 py-1.5 cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={onClick}
    >
      <AppWindow className="size-3.5 flex-shrink-0 mr-2" style={{ color: app.color || '#6b7280' }} />
      <span className="font-medium text-sm truncate mr-2">{app.name}</span>
      <StatusBadge status={app.status} />
      {app.tags.length > 0 && (
        <span className="ml-1.5">
          <TagBadge tag={app.tags[0]} tagDefinitions={tagDefinitions} />
        </span>
      )}
      <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
        {app.configPaths.length > 0 && (
          <div className={cn(
            'flex items-center gap-1 text-xs text-muted-foreground',
            'opacity-0 group-hover:opacity-100 transition-opacity',
          )}>
            <FileText className="size-3" />
            <span>{app.configPaths.length}</span>
          </div>
        )}
        <div
          className={cn('flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity')}
          onClick={(e) => e.stopPropagation()}
        >
          <Button variant="ghost" size="icon" className="size-6" onClick={handleLaunch} title="Launch">
            <Rocket className="size-3" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6">
                <MoreVertical className="size-3" />
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
  );
}
