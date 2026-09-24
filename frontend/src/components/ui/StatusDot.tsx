import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/**
 * Runtime state of a service / script / shell / agent, as a small dot.
 *
 * - `live`   : filled + pulsing (`running` green, `agent` violet)
 * - `fill`   : filled, static (completed / done, waiting, `ready`)
 * - `half`   : half-filled (starting)
 * - default  : outlined (stopped / idle)
 *
 * Ticket #48: `agent` (an agent at work) and `ready` (a shell alive at its
 * prompt, doing nothing) exist so the two never share a dot again — they used
 * to be the same pulsing green. Motion and colour are kept for something
 * happening; a shell at rest is a quiet grey.
 */
export type DotTone = 'idle' | 'ready' | 'starting' | 'running' | 'agent' | 'success' | 'error' | 'warning';

const TONE_COLOR: Record<DotTone, string> = {
  idle: 'var(--text-faint)',
  ready: 'var(--text-faint)',
  starting: 'var(--st-progress)',
  running: 'var(--st-done)',
  agent: 'var(--st-agent)',
  success: 'var(--st-done)',
  error: 'var(--st-blocked)',
  warning: 'var(--st-progress)',
};

/**
 * Map the app's runtime statuses onto a dot tone. Private to this file — the
 * `status` shortcut below is how a caller reaches it, and a component module
 * that also exports a function stops fast-refreshing.
 */
function toneForStatus(status?: string | null): DotTone {
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
        (t === 'running' || t === 'agent') && 'live',
        t === 'starting' && 'half',
        (t === 'success' || t === 'error' || t === 'warning' || t === 'ready') && 'fill',
        className
      )}
      style={style}
      title={title}
      aria-label={title}
    />
  );
}
