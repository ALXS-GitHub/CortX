import { useCallback, useMemo, useState } from 'react';
import { Copy, RefreshCw, RotateCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

import { NumberField, PanelLayout, Row, SelectField, TextField, Toggle } from '../../fields';
import { usePanelOptions } from '../../options';
import type { UtilityPanelProps } from '../../types';
import {
  ALPHABET_LABELS,
  DEFAULT_OPTIONS,
  KIND_LABELS,
  PRESETS,
  entropyBits,
  entropyLabel,
  generate,
  usesAlphabet,
  usesLength,
  type AlphabetId,
  type CaseTransform,
  type GeneratorKind,
  type GeneratorOptions,
} from './generate';

const KIND_OPTIONS = (Object.keys(KIND_LABELS) as GeneratorKind[]).map((value) => ({
  value,
  label: KIND_LABELS[value],
}));

const ALPHABET_OPTIONS = (Object.keys(ALPHABET_LABELS) as AlphabetId[]).map((value) => ({
  value,
  label: ALPHABET_LABELS[value],
}));

const CASE_OPTIONS: { value: CaseTransform; label: string }[] = [
  { value: 'none', label: 'As generated' },
  { value: 'upper', label: 'UPPERCASE' },
  { value: 'lower', label: 'lowercase' },
];

export default function IdGeneratorPanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<GeneratorOptions>(ctx, DEFAULT_OPTIONS);
  const [results, setResults] = useState<string[]>(() => generate(options));

  /**
   * Settings and output move together: changing anything redraws the list, so
   * it doubles as a live preview. Done in the handler rather than an effect —
   * generating is a random draw, not a sync with external state.
   */
  const apply = useCallback(
    (patch: Partial<GeneratorOptions>) => setResults(generate(update(patch))),
    [update],
  );

  const resetAll = useCallback(() => setResults(generate(reset())), [reset]);

  const bits = useMemo(() => entropyBits(options), [options]);
  const strength = useMemo(() => entropyLabel(bits), [bits]);

  const showAlphabet = usesAlphabet(options.kind);
  const showLength = usesLength(options.kind);
  const isPassword = options.kind === 'password';
  const showFormatting = options.kind === 'custom' || options.kind === 'nanoid';

  return (
    <PanelLayout
      options={
        <>
          <Row label="Presets">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <Badge
                  key={preset.id}
                  variant="outline"
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => apply(preset.options)}
                >
                  {preset.label}
                </Badge>
              ))}
            </div>
          </Row>

          <Separator />

          <SelectField
            label="Type"
            value={options.kind}
            onChange={(kind) => apply({ kind })}
            options={KIND_OPTIONS}
          />

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="How many"
              min={1}
              max={500}
              value={options.count}
              onChange={(count) => apply({ count })}
            />
            {showLength && (
              <NumberField
                label="Length"
                min={1}
                max={512}
                value={options.length}
                onChange={(length) => apply({ length })}
              />
            )}
          </div>

          {showAlphabet && (
            <SelectField
              label="Alphabet"
              value={options.alphabet}
              onChange={(alphabet) => apply({ alphabet })}
              options={ALPHABET_OPTIONS}
            />
          )}

          {showAlphabet && options.alphabet === 'custom' && (
            <TextField
              label="Custom characters"
              hint="Duplicates are ignored."
              placeholder="abcdef0123456789"
              mono
              value={options.customAlphabet}
              onChange={(customAlphabet) => apply({ customAlphabet })}
            />
          )}

          {isPassword && (
            <Row label="Character classes">
              <div className="grid grid-cols-2 gap-2">
                <Toggle
                  label="a-z"
                  checked={options.useLowercase}
                  onChange={(useLowercase) => apply({ useLowercase })}
                />
                <Toggle
                  label="A-Z"
                  checked={options.useUppercase}
                  onChange={(useUppercase) => apply({ useUppercase })}
                />
                <Toggle
                  label="0-9"
                  checked={options.useDigits}
                  onChange={(useDigits) => apply({ useDigits })}
                />
                <Toggle
                  label="Symbols"
                  checked={options.useSymbols}
                  onChange={(useSymbols) => apply({ useSymbols })}
                />
              </div>
            </Row>
          )}

          {(isPassword || showAlphabet) && (
            <Toggle
              label="Exclude look-alikes (0 O 1 l I)"
              checked={options.excludeAmbiguous}
              onChange={(excludeAmbiguous) => apply({ excludeAmbiguous })}
            />
          )}

          {(isPassword || showAlphabet) && (
            <TextField
              label="Prefix"
              placeholder="sk_"
              value={options.prefix}
              onChange={(prefix) => apply({ prefix })}
            />
          )}

          {showFormatting && (
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Group every"
                hint="0 = no grouping"
                min={0}
                max={32}
                value={options.groupSize}
                onChange={(groupSize) => apply({ groupSize })}
              />
              <TextField
                label="Separator"
                maxLength={3}
                value={options.groupSeparator}
                onChange={(groupSeparator) => apply({ groupSeparator })}
              />
            </div>
          )}

          {!isPassword && options.kind !== 'ulid' && (
            <SelectField
              label="Case"
              value={options.caseTransform}
              onChange={(caseTransform) => apply({ caseTransform })}
              options={CASE_OPTIONS}
            />
          )}

          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetAll}>
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
        </>
      }
      output={
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setResults(generate(options))}>
              <RefreshCw className="size-4" />
              Regenerate
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => ctx.copy(results.join('\n'))}
              disabled={results.length === 0}
            >
              <Copy className="size-4" />
              Copy all
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              ~{Math.round(bits)} bits · <span className={strength.className}>{strength.label}</span>
            </span>
          </div>

          <div className="divide-y rounded-md border">
            {results.map((value, i) => (
              <button
                key={`${i}-${value}`}
                type="button"
                onClick={() => ctx.copy(value)}
                title="Click to copy"
                className="group flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/50"
              >
                <span className="w-6 shrink-0 text-xs text-muted-foreground">{i + 1}</span>
                <code className="min-w-0 flex-1 break-all font-mono text-sm">{value}</code>
                <Copy className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </>
      }
    />
  );
}
