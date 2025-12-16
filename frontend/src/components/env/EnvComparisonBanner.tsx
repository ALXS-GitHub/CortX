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
      <div className="flex items-center gap-2 p-3 bg-green-500/10 rounded-lg">
        <CheckCircle className="size-4 text-green-600 dark:text-green-400 flex-shrink-0" />
        <span className="text-sm text-green-700 dark:text-green-400">
          All variables from {exampleFileName} are present
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {hasMissing && (
        <div className="p-3 bg-amber-500/10 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Missing in {baseFileName} ({comparison.missingInBase.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {comparison.missingInBase.map((key) => (
              <Badge key={key} variant="outline" className="font-mono text-xs">
                {key}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {hasExtra && (
        <div className="p-3 bg-blue-500/10 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Info className="size-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
              Extra in {baseFileName} ({comparison.extraInBase.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {comparison.extraInBase.map((key) => (
              <Badge key={key} variant="outline" className="font-mono text-xs">
                {key}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
