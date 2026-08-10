import { useMemo, useState } from 'react';
import { Copy, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import { NumberField, PanelLayout, Row, TextField, Toggle } from '../../fields';
import { usePanelOptions } from '../../options';
import type { UtilityPanelProps } from '../../types';
import { DEFAULT_CASE_OPTIONS, convert, type CaseOptions } from './convert';

const SAMPLE = 'Hello world, this is CortX!';

export default function CaseConverterPanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<CaseOptions>(ctx, DEFAULT_CASE_OPTIONS);
  const [input, setInput] = useState('');

  const results = useMemo(() => convert(input || SAMPLE, options), [input, options]);
  const isSample = input.trim().length === 0;

  return (
    <PanelLayout
      options={
        <>
          <Row label="Input">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={SAMPLE}
              className="min-h-32 font-mono text-sm"
            />
          </Row>

          <Toggle
            label="Convert each line separately"
            checked={options.perLine}
            onChange={(perLine) => update({ perLine })}
          />
          <Toggle
            label="Strip accents (café → cafe)"
            checked={options.stripAccents}
            onChange={(stripAccents) => update({ stripAccents })}
          />
          <Toggle
            label="Keep acronyms whole (HTMLParser → HTML Parser)"
            checked={options.splitAcronyms}
            onChange={(splitAcronyms) => update({ splitAcronyms })}
          />
          <Toggle
            label="Split letters from digits (utf8 → utf 8)"
            checked={options.splitDigits}
            onChange={(splitDigits) => update({ splitDigits })}
          />

          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Slug separator"
              maxLength={3}
              value={options.slugSeparator}
              onChange={(slugSeparator) => update({ slugSeparator })}
            />
            <NumberField
              label="Slug max length"
              hint="0 = no limit"
              min={0}
              max={200}
              value={options.slugMaxLength}
              onChange={(slugMaxLength) => update({ slugMaxLength })}
            />
          </div>

          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
        </>
      }
      output={
        <>
          {isSample && (
            <p className="text-xs text-muted-foreground">
              Showing a sample — type something on the left.
            </p>
          )}
          <div className="divide-y rounded-md border">
            {results.map((result) => (
              <button
                key={result.id}
                type="button"
                onClick={() => ctx.copy(result.value)}
                title="Click to copy"
                className="group flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-accent/50"
              >
                <span className="w-32 shrink-0 pt-0.5 text-xs text-muted-foreground">
                  {result.label}
                </span>
                <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-sm">
                  {result.value || '—'}
                </code>
                <Copy className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </>
      }
    />
  );
}
