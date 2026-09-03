import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/**
 * Runtime state of a service / script / shell / agent, as a small dot.
 *
 * - `live`   : filled + pulsing (running)
 * - `fill`   : filled, static (completed / done)
 * - `half`   : half-filled (starting)
 * - default  : outlined (stopped / idle)
 */
export type DotTone = 'idle' | 'starting' | 'running' | 'success' | 'error' | 'warning';

const TONE_COLOR: Record<DotTone, string> = {
  idle: 'var(--text-faint)',
  starting: 'var(--st-progress)',
  running: 'var(--st-done)',
  success: 'var(--st-done)',
  error: 'var(--st-blocked)',
  warning: 'var(--st-progress)',
};

/** Map the app's runtime statuses onto a dot tone. */
export function toneForStatus(status?: string | null): DotTone {
  switch (status) {
    case 'running':
      return 'running';
    case 'starting':
      return 'starting';
    case 'completed':
      return 'success';
    case 'failed':
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

export function StatusDot({
  tone = 'idle',
  status,
  size = 9,
  className,
  title,
}: {
  tone?: DotTone;
  /** Shortcut: derive the tone from a runtime status string. */
  status?: string | null;
  size?: number;
  className?: string;
  title?: string;
}) {
  const t = status !== undefined ? toneForStatus(status) : tone;
  const style = { width: size, height: size, '--sc': TONE_COLOR[t] } as CSSProperties;
  return (
    <span
      className={cn(
        'sdot',
        t === 'running' && 'live',
        t === 'starting' && 'half',
        (t === 'success' || t === 'error' || t === 'warning') && 'fill',
        className
      )}
      style={style}
      title={title}
      aria-label={title}
    />
  );
}
