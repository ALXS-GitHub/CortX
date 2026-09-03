import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { ExternalTool } from './lib/external';

/**
 * Tells the user up front that a module needs a CLI it cannot find, and how to
 * get it — rather than letting them configure everything and hit a failure on
 * Run.
 */
export function ToolStatusNotice({
  tool,
  name,
  installHint,
}: {
  tool: ExternalTool;
  name: string;
  installHint: string;
}) {
  if (tool.status === 'checking') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Looking for {name}…
      </div>
    );
  }

  if (tool.status === 'ready') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5 shrink-0 text-st-done" />
        <span className="min-w-0 truncate font-mono text-[11px]" title={tool.version ?? undefined}>
          {tool.version ?? `${name} found`}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" />
        <div>
          <p className="font-medium">{name} is not on your PATH.</p>
          <p className="mt-1 text-muted-foreground">{installHint}</p>
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={tool.recheck}>
        <RefreshCw />
        Check again
      </Button>
    </div>
  );
}
