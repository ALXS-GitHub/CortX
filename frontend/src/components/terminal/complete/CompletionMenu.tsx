/**
 * The floating completion list drawn above (or below) the prompt (#17).
 *
 * Rules it must never break:
 * - **It never takes the focus.** No input, no button, no tabindex; clicks are
 *   handled on `mousedown` with `preventDefault()` so the terminal keeps the
 *   keyboard. Everything is driven by `terminalSuggest.ts`, which reads the
 *   keys from xterm's own handler.
 * - **It never blocks typing.** It renders whatever the engine already has;
 *   late data arrives as a normal state update.
 * - Escape closes it (handled by the controller, alongside every other key).
 */
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import {
  acceptMenuItem,
  getMenuState,
  subscribeMenu,
  type CompletionMenuState,
} from '@/lib/terminalCompletionMenu';
import type { CompletionKind } from '@/lib/terminalCompletion';

/** Short tag shown on the right of a row. */
const KIND_LABEL: Record<CompletionKind, string> = {
  output: 'output',
  history: 'history',
  subcommand: 'cmd',
  flag: 'flag',
  branch: 'git',
  script: 'script',
  path: 'path',
};

const MAX_HEIGHT = 224;
const WIDTH = 380;

export function CompletionMenu({ terminalId }: { terminalId: string }) {
  const state: CompletionMenuState = useSyncExternalStore(
    (listener) => subscribeMenu(terminalId, listener),
    () => getMenuState(terminalId),
    () => getMenuState(terminalId)
  );
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!state.open) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [state.open, state.index]);

  if (!state.open || state.items.length === 0 || !state.anchor) return null;

  const { left, top, bottom } = state.anchor;
  // Below the cursor line when there is room, above it otherwise.
  const roomBelow = window.innerHeight - bottom;
  const above = roomBelow < 140 && top > roomBelow;
  const style: React.CSSProperties = above
    ? { left, bottom: window.innerHeight - top, maxHeight: Math.min(MAX_HEIGHT, top - 8) }
    : { left, top: bottom, maxHeight: Math.min(MAX_HEIGHT, roomBelow - 8) };
  style.width = Math.min(WIDTH, Math.max(220, window.innerWidth - left - 16));

  return (
    <div
      ref={listRef}
      className="cortx-completion-menu"
      style={style}
      role="listbox"
      aria-label="Completions"
      // Mouse only: the keyboard belongs to the terminal, always.
      onMouseDown={(e) => e.preventDefault()}
    >
      {state.items.map((item, i) => (
        <div
          key={`${item.kind}:${item.value}`}
          role="option"
          aria-selected={i === state.index}
          data-active={i === state.index}
          className="cortx-completion-row"
          onMouseDown={(e) => {
            e.preventDefault();
            acceptMenuItem(terminalId, i);
          }}
        >
          <span className="cortx-completion-value">{item.label}</span>
          {item.detail && <span className="cortx-completion-detail">{item.detail}</span>}
          <span className="cortx-completion-kind">{KIND_LABEL[item.kind]}</span>
        </div>
      ))}
    </div>
  );
}
