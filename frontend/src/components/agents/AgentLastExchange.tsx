import { Loader2, MessageCircleQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentSession } from '@/types';
import { lastExchange } from './agentUtils';

interface AgentLastExchangeProps {
  session: AgentSession;
  className?: string;
  /** Allow two lines (card mode). */
  lines?: 1 | 2;
}

/** One line: current tool, "waiting" hint, or the last user prompt. */
export function AgentLastExchange({ session, className, lines = 1 }: AgentLastExchangeProps) {
  const { kind, text } = lastExchange(session);
  const clamp = lines === 2 ? 'line-clamp-2' : 'truncate';

  if (kind === 'none') {
    return <span className={cn('text-xs text-muted-foreground/60', className)}>—</span>;
  }
  if (kind === 'tool') {
    return (
      <span className={cn('inline-flex items-center gap-1 min-w-0 text-xs text-emerald-600 dark:text-emerald-400', className)}>
        <Loader2 className="size-3 shrink-0 animate-spin" />
        <span className="truncate">{text}…</span>
      </span>
    );
  }
  if (kind === 'waiting') {
    return (
      <span className={cn('inline-flex items-center gap-1 min-w-0 text-xs', className)} title={text}>
        <MessageCircleQuestion className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className={cn('text-amber-700 dark:text-amber-300', clamp)}>{text}</span>
      </span>
    );
  }
  return (
    <span className={cn('block min-w-0 text-xs text-muted-foreground', clamp, className)} title={text}>
      {kind === 'prompt' ? `“${text}”` : text}
    </span>
  );
}
