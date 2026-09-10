import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { History, Trash2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { getExecutionHistory, clearExecutionHistory } from '@/lib/tauri';
import type { ExecutionRecord } from '@/types';
import { toast } from 'sonner';

function formatDuration(ms?: number): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface ExecutionHistoryProps {
  scriptId: string;
}

export function ExecutionHistory({ scriptId }: ExecutionHistoryProps) {
  // The records **and the script they belong to**, in one piece of state: what
  // we hold is either this script's history or it is not, and "not" is exactly
  // what "loading" means. Two separate flags meant the effect had to raise one
  // of them the instant it started — a setState in the body of an effect, and
  // a cascading render for it — and then lower it again. Nothing to reset
  // here: a new `scriptId` is a mismatch, which reads as loading on the spot.
  const [loaded, setLoaded] = useState<{ scriptId: string; records: ExecutionRecord[] } | null>(null);
  const current = loaded?.scriptId === scriptId ? loaded : null;
  const records = current?.records ?? [];
  const isLoading = current === null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let history: ExecutionRecord[] = [];
      try {
        history = await getExecutionHistory(scriptId, 50);
      } catch (e) {
        console.error('Failed to load execution history:', e);
      }
      // Even a failure is an answer for this script: an empty list, and not
      // "Loading…" for ever.
      if (!cancelled) setLoaded({ scriptId, records: history });
    })();
    return () => {
      cancelled = true;
    };
  }, [scriptId]);

  const handleClear = async () => {
    try {
      await clearExecutionHistory(scriptId);
      setLoaded({ scriptId, records: [] });
      toast.success('History cleared');
    } catch (e) {
      toast.error('Failed to clear history', { description: String(e) });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold">Execution history</h2>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? 'Loading…'
              : records.length === 0
                ? 'No execution recorded'
                : `Last ${records.length} run${records.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {records.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleClear}>
            <Trash2 />
            Clear
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">Loading…</div>
      ) : records.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong">
          <EmptyState
            compact
            icon={History}
            title="No executions yet"
            description="Each run of this script is recorded here with its duration and exit code."
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-soft">
          {records.map((record) => (
            <div
              key={record.id}
              className="flex h-10 items-center gap-3 border-b border-border px-3 text-sm transition-colors last:border-b-0 hover:bg-accent/50"
            >
              {record.success ? (
                <CheckCircle2 className="size-4 shrink-0 text-st-done" />
              ) : (
                <XCircle className="size-4 shrink-0 text-st-blocked" />
              )}
              <span className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatDate(record.startedAt)}
              </span>
              <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums text-faint">
                <Clock className="size-3" />
                {formatDuration(record.durationMs)}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                {record.exitCode !== undefined && record.exitCode !== 0 && (
                  <Badge variant="destructive" className="font-mono">exit {record.exitCode}</Badge>
                )}
                {record.presetName && (
                  <Badge variant="secondary">{record.presetName}</Badge>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
