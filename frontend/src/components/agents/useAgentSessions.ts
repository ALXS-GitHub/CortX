import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import { onAgentSessionsChanged } from '@/lib/tauri';

interface UseAgentSessionsOptions {
  /** null => every session; number => finished sessions from the last N days. */
  sinceDays: number | null;
  includeHidden: boolean;
}

/**
 * Loads the session list (lazily: only while an Agents view is mounted) and
 * keeps it fresh from the `agent-sessions-changed` event.
 *
 * Returns a counter bumped on every backend change so the open transcript can
 * reload its last page.
 */
export function useAgentSessions({ sinceDays, includeHidden }: UseAgentSessionsOptions): { changeToken: number } {
  const loadAgentSessions = useAppStore((s) => s.loadAgentSessions);
  const loadAgentsHealth = useAppStore((s) => s.loadAgentsHealth);
  const [changeToken, setChangeToken] = useState(0);

  // (Re)load when the backend-side options change.
  useEffect(() => {
    loadAgentSessions({ sinceDays, includeHidden }).catch((e) => {
      toast.error('Failed to load agent sessions', { description: String(e) });
    });
  }, [loadAgentSessions, sinceDays, includeHidden]);

  // Health once on mount + live updates while mounted.
  useEffect(() => {
    loadAgentsHealth().catch(console.error);

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onAgentSessionsChanged(() => {
      if (cancelled) return;
      const store = useAppStore.getState();
      store.loadAgentSessions().catch(console.error);
      store.loadAgentsHealth().catch(console.error);
      setChangeToken((t) => t + 1);
    })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(console.error);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadAgentsHealth]);

  return { changeToken };
}

/** Current time, refreshed every `intervalMs` (keeps "2 min ago" honest). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
