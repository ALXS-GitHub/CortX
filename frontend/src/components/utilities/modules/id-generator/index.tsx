import { useCallback, useMemo, useState } from 'react';
import { Copy, RefreshCw, RotateCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

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

const STATE_KEY = 'options';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}

export default function IdGeneratorPanel({ ctx }: UtilityPanelProps) {
  const initial = useMemo<GeneratorOptions>(
    () => ({ ...DEFAULT_OPTIONS, ...ctx.state.get<Partial<GeneratorOptions>>(STATE_KEY, {}) }),
    [ctx.state],
  );

  const [options, setOptions] = useState<GeneratorOptions>(initial);
  const [results, setResults] = useState<string[]>(() => generate(initial));

  /**
   * Options and output move together: changing a setting regenerates right
   * away, so the list doubles as the preview. Done here rather than in an
   * effect — generation is a random draw, not a sync with external state.
   */
  const apply = useCallback(
    (next: GeneratorOptions) => {
      setOptions(next);
      setResults(generate(next));
      ctx.state.set(STATE_KEY, next);
    },
    [ctx.state],
  );

  const update = useCallback(
    (patch: Partial<GeneratorOptions>) => apply({ ...options, ...patch }),
    [apply, options],
  );

  const bits = useMemo(() => entropyBits(options), [options]);
  const strength = useMemo(() => entropyLabel(bits), [bits]);

  const showAlphabet = usesAlphabet(options.kind);
  const showLength = usesLength(options.kind);
  const isPassword = options.kind === 'password';
  const showFormatting = options.kind === 'custom' || options.kind === 'nanoid';

  const copyAll = () => ctx.copy(results.join('\n'));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      {/* ---- Options ---- */}
      <div className="space-y-4">
        <Row label="Presets">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <Badge
                key={preset.id}
                variant="outline"
                className="cursor-pointer hover:bg-accent"
                onClick={() => update(preset.options)}
              >
                {preset.label}
              </Badge>
            ))}
          </div>
        </Row>

        <Separator />

        <Row label="Type">
          <Select value={options.kind} onValueChange={(v: GeneratorKind) => update({ kind: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_LABELS) as GeneratorKind[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <div className="grid grid-cols-2 gap-3">
          <Row label="How many">
            <Input
              type="number"
              min={1}
              max={500}
              value={options.count}
              onChange={(e) => update({ count: Number(e.target.value) || 1 })}
            />
          </Row>
          {showLength && (
            <Row label="Length">
              <Input
                type="number"
                min={1}
                max={512}
                value={options.length}
                onChange={(e) => update({ length: Number(e.target.value) || 1 })}
              />
            </Row>
          )}
        </div>

        {showAlphabet && (
          <Row label="Alphabet">
            <Select
              value={options.alphabet}
              onValueChange={(v: AlphabetId) => update({ alphabet: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ALPHABET_LABELS) as AlphabetId[]).map((a) => (
                  <SelectItem key={a} value={a}>
                    {ALPHABET_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        )}

        {showAlphabet && options.alphabet === 'custom' && (
          <Row label="Custom characters" hint="Duplicates are ignored.">
            <Input
              value={options.customAlphabet}
              placeholder="abcdef0123456789"
              onChange={(e) => update({ customAlphabet: e.target.value })}
            />
          </Row>
        )}

        {isPassword && (
          <Row label="Character classes">
            <div className="grid grid-cols-2 gap-2">
              <Toggle
                label="a-z"
                checked={options.useLowercase}
                onChange={(v) => update({ useLowercase: v })}
              />
              <Toggle
                label="A-Z"
                checked={options.useUppercase}
                onChange={(v) => update({ useUppercase: v })}
              />
              <Toggle
                label="0-9"
                checked={options.useDigits}
                onChange={(v) => update({ useDigits: v })}
              />
              <Toggle
                label="Symbols"
                checked={options.useSymbols}
                onChange={(v) => update({ useSymbols: v })}
              />
            </div>
          </Row>
        )}

        {(isPassword || showAlphabet) && (
          <Toggle
            label="Exclude look-alikes (0 O 1 l I)"
            checked={options.excludeAmbiguous}
            onChange={(v) => update({ excludeAmbiguous: v })}
          />
        )}

        {(isPassword || showAlphabet) && (
          <Row label="Prefix">
            <Input
              value={options.prefix}
              placeholder="sk_"
              onChange={(e) => update({ prefix: e.target.value })}
            />
          </Row>
        )}

        {showFormatting && (
          <div className="grid grid-cols-2 gap-3">
            <Row label="Group every" hint="0 = no grouping">
              <Input
                type="number"
                min={0}
                max={32}
                value={options.groupSize}
                onChange={(e) => update({ groupSize: Number(e.target.value) || 0 })}
              />
            </Row>
            <Row label="Separator">
              <Input
                value={options.groupSeparator}
                maxLength={3}
                onChange={(e) => update({ groupSeparator: e.target.value })}
              />
            </Row>
          </div>
        )}

        {!isPassword && options.kind !== 'ulid' && (
          <Row label="Case">
            <Select
              value={options.caseTransform}
              onValueChange={(v: CaseTransform) => update({ caseTransform: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">As generated</SelectItem>
                <SelectItem value="upper">UPPERCASE</SelectItem>
                <SelectItem value="lower">lowercase</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => apply(DEFAULT_OPTIONS)}
        >
          <RotateCcw className="size-3.5" />
          Reset to defaults
        </Button>
      </div>

      {/* ---- Output ---- */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setResults(generate(options))}>
            <RefreshCw className="size-4" />
            Regenerate
          </Button>
          <Button size="sm" variant="outline" onClick={copyAll} disabled={results.length === 0}>
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
      </div>
    </div>
  );
}
