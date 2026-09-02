import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function BetaBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-4 px-1.5 text-[10px] font-semibold uppercase tracking-wide',
        'border-violet-500/50 text-violet-600 dark:text-violet-400',
        className,
      )}
    >
      beta
    </Badge>
  );
}
