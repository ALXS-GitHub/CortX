import { toast } from 'sonner';
import { Chip } from '@/components/ui/Chip';
import { cn } from '@/lib/utils';

interface AgentTicketChipsProps {
  refs: string[];
  max?: number;
  className?: string;
}

/** Small "DEV-11" / "#42" chips; click copies the reference. */
export function AgentTicketChips({ refs, max = 3, className }: AgentTicketChipsProps) {
  if (refs.length === 0) return null;
  const shown = refs.slice(0, max);
  const rest = refs.length - shown.length;

  const copy = async (e: React.MouseEvent, ref: string) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(ref);
      toast.success(`Copied ${ref}`);
    } catch (err) {
      toast.error('Failed to copy', { description: String(err) });
    }
  };

  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)}>
      {shown.map((ref) => (
        <button
          key={ref}
          type="button"
          onClick={(e) => copy(e, ref)}
          title={`Copy ${ref}`}
          className="cursor-pointer rounded-full opacity-80 transition-opacity hover:opacity-100"
        >
          <Chip neutral dot={false} className="font-mono text-[10px]">
            {ref}
          </Chip>
        </button>
      ))}
      {rest > 0 && <span className="text-[10px] text-faint">+{rest}</span>}
    </span>
  );
}
