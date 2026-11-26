import { useEffect, useState } from 'react';
import { onAgentSessionsChanged } from '@/lib/tauri';
import { onTerminalRender, terminalScreenRows } from '@/lib/terminalSessions';
import { readAgentMenu, sameMenu, type AgentMenu } from '../agentMenu';

/**
 * A counter bumped each time the agents' files change on disk (the session's
 * transcript got a line): the transcript reloads its last page on it.
 *
 * Coalesced to a few times a second: a busy agent appends several lines per
 * second, and the conversation should follow it closely without re-rendering
 * on every one of them. `lastActivity` (the agent's own last entry, from the
 * terminal-agents broadcast) bumps it too, in case an event was missed.
 */
export function useTranscriptChanges(lastActivity: number | undefined): number {
  const [token, setToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let unlisten: (() => void) | undefined;
    const bump = () => {
      timer = undefined;
      if (!cancelled) setToken((t) => t + 1);
    };
    onAgentSessionsChanged(() => {
      if (cancelled || timer !== undefined) return;
      timer = window.setTimeout(bump, 250);
    })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {
        /* No backend (tests, browser): lastActivity still drives it. */
      });
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (lastActivity) setToken((t) => t + 1);
  }, [lastActivity]);

  return token;
}

/**
 * The menu the agent shows on its screen right now (`agentMenu.ts`), read
 * again after each repaint of the terminal — which keeps rendering while the
 * agent view covers it.
 */
export function useAgentMenu(terminalId: string): AgentMenu | null {
  const [menu, setMenu] = useState<AgentMenu | null>(() => readAgentMenu(terminalScreenRows(terminalId) ?? []));

  useEffect(() => {
    let frame: number | null = null;
    const read = () => {
      frame = null;
      const next = readAgentMenu(terminalScreenRows(terminalId) ?? []);
      setMenu((prev) => (sameMenu(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(read);
    };
    schedule();
    const off = onTerminalRender(terminalId, schedule);
    // The session may not exist yet at mount (a pane restored at boot).
    const poll = window.setInterval(schedule, 1000);
    return () => {
      off();
      window.clearInterval(poll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [terminalId]);

  return menu;
}
