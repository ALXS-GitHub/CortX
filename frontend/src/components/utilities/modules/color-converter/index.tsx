import { useMemo, useState } from 'react';
import { Copy, Pipette } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { NumberField, PanelLayout, Row, Toggle } from '../../fields';
import { usePanelOptions } from '../../options';
import type { UtilityPanelProps } from '../../types';
import {
  buildScale,
  contrastRatio,
  formatHex,
  formatHsl,
  formatHsv,
  formatOklch,
  formatRgb,
  parseColor,
  readableTextOn,
  wcagRating,
  type Rgb,
} from '../../lib/color';

interface ColorOptions {
  input: string;
  alpha: number;
  showScale: boolean;
  contrastAgainst: string;
}

const DEFAULT_OPTIONS: ColorOptions = {
  input: '#6366f1',
  alpha: 100,
  showScale: true,
  contrastAgainst: '#ffffff',
};

const PRESETS = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];

/** Chromium exposes the screen colour picker; other engines simply won't. */
interface EyeDropperApi {
  open(): Promise<{ sRGBHex: string }>;
}

function Swatch({ color, className }: { color: Rgb; className?: string }) {
  return (
    <div
      className={cn('rounded-md border', className)}
      style={{ backgroundColor: formatRgb(color) }}
      aria-hidden
    />
  );
}

export default function ColorConverterPanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<ColorOptions>(ctx, DEFAULT_OPTIONS);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const parsed = useMemo(() => parseColor(options.input), [options.input]);
  const color = useMemo<Rgb | null>(
    () => (parsed ? { ...parsed, a: options.alpha / 100 } : null),
    [parsed, options.alpha],
  );

  const background = useMemo(() => parseColor(options.contrastAgainst), [options.contrastAgainst]);
  const scale = useMemo(() => (color && options.showScale ? buildScale(color) : []), [color, options.showScale]);

  const formats = useMemo(() => {
    if (!color) return [];
    return [
      { label: 'HEX', value: formatHex(color, color.a < 1) },
      { label: 'RGB', value: formatRgb(color) },
      { label: 'HSL', value: formatHsl(color) },
      { label: 'HSV', value: formatHsv(color) },
      { label: 'OKLCH', value: formatOklch(color) },
    ];
  }, [color]);

  const contrast = color && background ? contrastRatio(color, background) : null;

  const pickFromScreen = async () => {
    const EyeDropperCtor = (window as unknown as { EyeDropper?: new () => EyeDropperApi }).EyeDropper;
    if (!EyeDropperCtor) {
      setPickerError('The screen picker is not available in this webview.');
      return;
    }
    try {
      const result = await new EyeDropperCtor().open();
      setPickerError(null);
      update({ input: result.sRGBHex });
    } catch {
      // Dismissed by the user — nothing to report.
    }
  };

  return (
    <PanelLayout
      options={
        <>
          <Row label="Color" hint="hex, rgb(), hsl(), oklch() or a common name.">
            <div className="flex gap-2">
              <Input
                value={options.input}
                onChange={(e) => update({ input: e.target.value })}
                placeholder="#6366f1"
                className={cn('font-mono', !parsed && options.input && 'border-destructive')}
              />
              <Button variant="outline" size="icon" onClick={pickFromScreen} title="Pick from screen">
                <Pipette className="size-4" />
              </Button>
            </div>
          </Row>

          {pickerError && <p className="text-xs text-destructive">{pickerError}</p>}

          <Row label="Presets">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => update({ input: preset })}
                  className="size-7 rounded-md border transition-transform hover:scale-110"
                  style={{ backgroundColor: preset }}
                  title={preset}
                />
              ))}
            </div>
          </Row>

          <NumberField
            label="Alpha"
            min={0}
            max={100}
            suffix="%"
            value={options.alpha}
            onChange={(alpha) => update({ alpha })}
          />

          <Row label="Contrast against">
            <Input
              value={options.contrastAgainst}
              onChange={(e) => update({ contrastAgainst: e.target.value })}
              placeholder="#ffffff"
              className={cn('font-mono', !background && 'border-destructive')}
            />
          </Row>

          <Toggle
            label="Show 50 → 950 scale"
            checked={options.showScale}
            onChange={(showScale) => update({ showScale })}
          />

          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
            Reset to defaults
          </Button>
        </>
      }
      output={
        !color ? (
          <p className="text-sm text-muted-foreground">Enter a color to convert.</p>
        ) : (
          <>
            <div
              className="flex h-28 items-end justify-between rounded-lg border p-4"
              style={{ backgroundColor: formatRgb(color) }}
            >
              <span
                className="font-mono text-sm font-medium"
                style={{ color: formatRgb(readableTextOn(color)) }}
              >
                {formatHex(color, color.a < 1)}
              </span>
              {contrast !== null && (
                <Badge variant="secondary">
                  {contrast.toFixed(2)}:1 · {wcagRating(contrast)}
                </Badge>
              )}
            </div>

            <div className="divide-y rounded-md border">
              {formats.map((format) => (
                <button
                  key={format.label}
                  type="button"
                  onClick={() => ctx.copy(format.value)}
                  title="Click to copy"
                  className="group flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/50"
                >
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">{format.label}</span>
                  <code className="min-w-0 flex-1 break-all font-mono text-sm">{format.value}</code>
                  <Copy className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>

            {scale.length > 0 && (
              <Row label="Scale">
                <div className="overflow-hidden rounded-md border">
                  <div className="flex">
                    {scale.map(({ step, color: shade }) => (
                      <button
                        key={step}
                        type="button"
                        onClick={() => ctx.copy(formatHex(shade))}
                        title={`${step} — ${formatHex(shade)}`}
                        className="h-16 flex-1 text-[10px] font-medium"
                        style={{
                          backgroundColor: formatRgb(shade),
                          color: formatRgb(readableTextOn(shade)),
                        }}
                      >
                        {step}
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() =>
                    ctx.copy(scale.map(({ step, color: shade }) => `${step}: ${formatHex(shade)}`).join('\n'))
                  }
                >
                  <Copy className="size-4" />
                  Copy scale
                </Button>
              </Row>
            )}

            {background && (
              <Row label="Preview on background">
                <div
                  className="flex items-center gap-3 rounded-md border p-4"
                  style={{ backgroundColor: formatRgb(background) }}
                >
                  <Swatch color={color} className="size-10" />
                  <span className="font-medium" style={{ color: formatRgb(color) }}>
                    The quick brown fox jumps over the lazy dog
                  </span>
                </div>
              </Row>
            )}
          </>
        )
      }
    />
  );
}
