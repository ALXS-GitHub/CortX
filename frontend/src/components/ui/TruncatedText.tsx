import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface TruncatedTextProps {
  children: string;
  /** Text to show in the tooltip when overflowing. Defaults to `children`. */
  tooltip?: ReactNode;
  /** HTML tag to render. Defaults to `span`. */
  as?: ElementType;
  className?: string;
}

/**
 * Single-line text that ellipsizes when its container is too narrow,
 * and reveals the full value in a tooltip on hover — but only when actually
 * truncated, so short text doesn't get a noisy tooltip.
 *
 * Always renders with `truncate`; the parent flex container must have
 * `min-w-0` for truncation to engage.
 */
export function TruncatedText({
  children,
  tooltip,
  as: Tag = 'span',
  className,
}: TruncatedTextProps) {
  const ref = useRef<HTMLElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  const node = (
    <Tag ref={ref} className={cn('truncate', className)}>
      {children}
    </Tag>
  );

  if (!overflowing) return node;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent>{tooltip ?? children}</TooltipContent>
    </Tooltip>
  );
}
