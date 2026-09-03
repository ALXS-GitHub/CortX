import { Sparkles, Braces } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { AgentProvider } from '@/types';
import { PROVIDER_LABEL } from './agentUtils';

interface AgentProviderIconProps {
  provider: AgentProvider;
  className?: string;
  /** Skip the tooltip (when a label is displayed next to it). */
  plain?: boolean;
}

export function AgentProviderIcon({ provider, className, plain = false }: AgentProviderIconProps) {
  const icon = provider === 'codex'
    ? <Braces className={cn('size-3.5 shrink-0 text-st-open', className)} aria-label={PROVIDER_LABEL[provider]} />
    : <Sparkles className={cn('size-3.5 shrink-0 text-primary', className)} aria-label={PROVIDER_LABEL[provider]} />;

  if (plain) return icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{icon}</TooltipTrigger>
      <TooltipContent>{PROVIDER_LABEL[provider]}</TooltipContent>
    </Tooltip>
  );
}
