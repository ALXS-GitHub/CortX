import { useMemo, useState } from 'react';
import { ArrowLeftRight, RotateCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { PanelLayout, Row, SelectField, Toggle } from '../../fields';
import { usePanelOptions } from '../../options';
import type { UtilityPanelProps } from '../../types';
import {
  DEFAULT_DIFF_OPTIONS,
  diff,
  toRows,
  type DiffOptions,
  type Granularity,
} from './diff';

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'line', label: 'By line' },
  { value: 'word', label: 'By word' },
  { value: 'char', label: 'By character' },
];

const ROW_STYLES: Record<string, string> = {
  equal: '',
  insert: 'bg-emerald-500/10',
  delete: 'bg-red-500/10',
  replace: 'bg-amber-500/10',
};

export default function TextDiffPanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<DiffOptions>(ctx, DEFAULT_DIFF_OPTIONS);
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');

  const result = useMemo(() => diff(left, right, options), [left, right, options]);
  const rows = useMemo(() => toRows(result.segments), [result.segments]);

  const swap = () => {
    setLeft(right);
    setRight(left);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Row label="Original">
          <Textarea
            value={left}
            onChange={(e) => setLeft(e.target.value)}
            placeholder="Paste the original text…"
            className="min-h-36 font-mono text-sm"
          />
        </Row>
        <Row label="Changed">
          <Textarea
            value={right}
            onChange={(e) => setRight(e.target.value)}
            placeholder="Paste the modified text…"
            className="min-h-36 font-mono text-sm"
          />
        </Row>
      </div>

      <PanelLayout
        options={
          <>
            <SelectField
              label="Granularity"
              value={options.granularity}
              onChange={(granularity) => update({ granularity })}
              options={GRANULARITY_OPTIONS}
            />
            <Toggle
              label="Side by side"
              checked={options.sideBySide}
              onChange={(sideBySide) => update({ sideBySide })}
            />
            <Toggle
              label="Ignore case"
              checked={options.ignoreCase}
              onChange={(ignoreCase) => update({ ignoreCase })}
            />
            <Toggle
              label="Ignore whitespace"
              checked={options.ignoreWhitespace}
              onChange={(ignoreWhitespace) => update({ ignoreWhitespace })}
            />
            {options.granularity === 'line' && (
              <Toggle
                label="Ignore blank lines"
                checked={options.ignoreBlankLines}
                onChange={(ignoreBlankLines) => update({ ignoreBlankLines })}
              />
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={swap} disabled={!left && !right}>
                <ArrowLeftRight className="size-4" />
                Swap sides
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            </div>
          </>
        }
        output={
          <>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-emerald-500">
                +{result.added}
              </Badge>
              <Badge variant="outline" className="text-red-500">
                −{result.removed}
              </Badge>
              {result.added === 0 && result.removed === 0 && (left || right) && (
                <span className="text-xs text-muted-foreground">Both sides are identical.</span>
              )}
            </div>

            {options.sideBySide ? (
              <div className="max-h-[32rem] overflow-auto rounded-md border font-mono text-xs">
                {rows.map((row, i) => (
                  <div key={i} className={cn('grid grid-cols-2 divide-x', ROW_STYLES[row.type])}>
                    <div className="whitespace-pre-wrap break-words px-3 py-1">
                      {row.left ?? ''}
                    </div>
                    <div className="whitespace-pre-wrap break-words px-3 py-1">
                      {row.right ?? ''}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="max-h-[32rem] overflow-auto rounded-md border p-3 font-mono text-xs">
                {result.segments.map((segment, i) => (
                  <span
                    key={i}
                    className={cn(
                      'whitespace-pre-wrap break-words',
                      segment.type === 'insert' && 'bg-emerald-500/20 text-emerald-500',
                      segment.type === 'delete' && 'bg-red-500/20 text-red-500 line-through',
                    )}
                  >
                    {segment.value}
                    {options.granularity === 'line' ? '\n' : ''}
                  </span>
                ))}
              </div>
            )}
          </>
        }
      />
    </div>
  );
}
