import { useEffect, useRef } from 'react';
import { fitTerminal, focusTerminal, mountTerminal, unmountTerminal } from '@/lib/terminalSessions';
import { attachSuggestions } from '@/lib/terminalSuggest';

interface XtermViewProps {
  /** Canonical terminal id (`service:<id>`, `script:<id>`, `shell:<id>`, ...). */
  terminalId: string;
  /** Give the terminal keyboard focus when it becomes the active tab of the focused pane. */
  autoFocus?: boolean;
}

/**
 * Renders the persistent xterm.js session for `terminalId` into this pane.
 * The session outlives the component: unmounting only detaches the DOM.
 */
export function XtermView({ terminalId, autoFocus = false }: XtermViewProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    mountTerminal(terminalId, el);
    // Inline history suggestions (ghost text); no-op when disabled in settings.
    attachSuggestions(terminalId);
    const observer = new ResizeObserver(() => fitTerminal(terminalId));
    observer.observe(el);
    return () => {
      observer.disconnect();
      unmountTerminal(terminalId);
    };
  }, [terminalId]);

  useEffect(() => {
    if (!autoFocus) return;
    // Wait for the mount effect above to have attached the DOM.
    const frame = requestAnimationFrame(() => focusTerminal(terminalId));
    return () => cancelAnimationFrame(frame);
  }, [autoFocus, terminalId]);

  return <div ref={ref} className="cortx-xterm-host absolute inset-0 overflow-hidden bg-terminal" />;
}
