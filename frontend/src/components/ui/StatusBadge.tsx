import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status?: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { statusDefinitions } = useAppStore();

  if (!status) return null;

  const def = statusDefinitions.find(
    (d) => d.name.toLowerCase() === status.toLowerCase()
  );

  const color = def?.color;

  return (
    <Badge
      variant="outline"
      className={cn('text-xs font-medium', className)}
      style={
        color
          ? {
              borderColor: color,
              color: color,
              backgroundColor: `${color}15`,
            }
          : undefined
      }
    >
      {status}
    </Badge>
  );
}
