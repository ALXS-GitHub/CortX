import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  const [records, setRecords] = useState<ExecutionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const history = await getExecutionHistory(scriptId, 50);
      setRecords(history);
    } catch (e) {
      console.error('Failed to load execution history:', e);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadHistory();
  }, [scriptId]);

  const handleClear = async () => {
    try {
      await clearExecutionHistory(scriptId);
      setRecords([]);
      toast.success('History cleared');
    } catch (e) {
      toast.error('Failed to clear history', { description: String(e) });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <History className="size-4" />
            Execution History
          </CardTitle>
          {records.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClear}>
              <Trash2 className="size-3.5 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-muted-foreground">No executions yet</p>
        ) : (
          <div className="space-y-2">
            {records.map((record) => (
              <div
                key={record.id}
                className="flex items-center gap-3 text-sm py-1.5 px-2 rounded hover:bg-muted/50"
              >
                {record.success ? (
                  <CheckCircle2 className="size-4 text-green-500 flex-shrink-0" />
                ) : (
                  <XCircle className="size-4 text-red-500 flex-shrink-0" />
                )}
                <span className="text-muted-foreground flex-shrink-0">
                  {formatDate(record.startedAt)}
                </span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Clock className="size-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(record.durationMs)}
                  </span>
                </div>
                {record.exitCode !== undefined && record.exitCode !== 0 && (
                  <Badge variant="outline" className="text-xs py-0">
                    exit {record.exitCode}
                  </Badge>
                )}
                {record.presetName && (
                  <Badge variant="secondary" className="text-xs py-0">
                    {record.presetName}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
