import { Chip } from '@/components/ui/Chip';
import { useAppStore } from '@/stores/appStore';

interface StatusBadgeProps {
  status?: string;
  className?: string;
}

/** Project status as a colour-coded chip (colour comes from the status definitions). */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { statusDefinitions } = useAppStore();

  if (!status) return null;

  const def = statusDefinitions.find(
    (d) => d.name.toLowerCase() === status.toLowerCase()
  );

  return (
    <Chip color={def?.color} neutral={!def?.color} className={className}>
      {status}
    </Chip>
  );
}
