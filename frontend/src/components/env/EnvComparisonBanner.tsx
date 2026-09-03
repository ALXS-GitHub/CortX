import type { EnvComparison } from '@/types';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertTriangle, Info } from 'lucide-react';

interface EnvComparisonBannerProps {
  comparison: EnvComparison;
  baseFileName: string;
  exampleFileName: string;
}

export function EnvComparisonBanner({
  comparison,
  baseFileName,
  exampleFileName,
}: EnvComparisonBannerProps) {
  const hasMissing = comparison.missingInBase.length > 0;
  const hasExtra = comparison.extraInBase.length > 0;

  if (!hasMissing && !hasExtra) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs text-st-done">
        <CheckCircle className="size-4 shrink-0" />
        <span>
          All variables from <span className="font-mono">{exampleFileName}</span> are present
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {hasMissing && (
        <div className="rounded-lg bg-warning/10 px-3 py-2">
          <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-st-progress">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              Missing in <span className="font-mono">{baseFileName}</span> ({comparison.missingInBase.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {comparison.missingInBase.map((key) => (
              <Badge key={key} variant="outline" className="font-mono">
                {key}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {hasExtra && (
        <div className="rounded-lg bg-info/10 px-3 py-2">
          <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-st-open">
            <Info className="size-4 shrink-0" />
            <span>
              Extra in <span className="font-mono">{baseFileName}</span> ({comparison.extraInBase.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {comparison.extraInBase.map((key) => (
              <Badge key={key} variant="outline" className="font-mono">
                {key}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
