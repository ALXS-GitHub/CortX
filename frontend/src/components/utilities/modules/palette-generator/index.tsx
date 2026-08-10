import { useCallback, useMemo, useState } from 'react';
import { Copy, Loader2, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { FileDropZone } from '../../FileFields';
import { NumberField, PanelLayout, Row, SelectField, Toggle } from '../../fields';
import { formatHex, formatRgb, parseColor, readableTextOn, type Rgb } from '../../lib/color';
import { usePanelOptions } from '../../options';
import type { UtilityPanelProps } from '../../types';
import {
  EXPORT_LABELS,
  SCHEME_LABELS,
  buildPalette,
  exportPalette,
  exportScale,
  extractPalette,
  pixelsFromImage,
  type ExportFormat,
  type Scheme,
} from './palette';

interface PaletteOptions {
  base: string;
  scheme: Scheme;
  count: number;
  name: string;
  exportFormat: ExportFormat;
  exportAsScale: boolean;
  extractCount: number;
}

const DEFAULT_OPTIONS: PaletteOptions = {
  base: '#6366f1',
  scheme: 'analogous',
  count: 5,
  name: 'brand',
  exportFormat: 'css',
  exportAsScale: false,
  extractCount: 6,
};

const SCHEME_OPTIONS = (Object.keys(SCHEME_LABELS) as Scheme[]).map((value) => ({
  value,
  label: SCHEME_LABELS[value],
}));

const EXPORT_OPTIONS = (Object.keys(EXPORT_LABELS) as ExportFormat[]).map((value) => ({
  value,
  label: EXPORT_LABELS[value],
}));

const IMAGE_FILTER = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp'] },
];

function Swatches({ colors, onCopy }: { colors: Rgb[]; onCopy: (value: string) => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border">
      {colors.map((color, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onCopy(formatHex(color))}
          title={`${formatHex(color)} — click to copy`}
          className="h-24 flex-1 text-[10px] font-medium transition-transform hover:scale-y-105"
          style={{ backgroundColor: formatRgb(color), color: formatRgb(readableTextOn(color)) }}
        >
          {formatHex(color)}
        </button>
      ))}
    </div>
  );
}

export default function PaletteGeneratorPanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<PaletteOptions>(ctx, DEFAULT_OPTIONS);
  const [extracted, setExtracted] = useState<Rgb[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const base = useMemo(() => parseColor(options.base), [options.base]);

  const generated = useMemo(
    () => (base ? buildPalette(base, options.scheme, options.count) : []),
    [base, options.scheme, options.count],
  );

  const extract = useCallback(
    async (paths: string[]) => {
      const path = paths[0];
      if (!path) return;

      setExtracting(true);
      setExtractError(null);
      setSource(path);

      try {
        const bytes = await ctx.files.read(path);
        // `bytes.buffer` may be a shared or oversized buffer; slice to the view.
        const blob = new Blob([bytes.slice().buffer]);
        const pixels = await pixelsFromImage(blob);
        if (pixels.length === 0) throw new Error('No opaque pixels found in that image');
        setExtracted(extractPalette(pixels, options.extractCount));
      } catch (e) {
        setExtracted([]);
        setExtractError(e instanceof Error ? e.message : String(e));
      } finally {
        setExtracting(false);
      }
    },
    [ctx.files, options.extractCount],
  );

  const exported = useMemo(() => {
    if (options.exportAsScale && base) return exportScale(base, options.name, options.exportFormat);
    return exportPalette(generated, options.exportFormat, options.name);
  }, [options.exportAsScale, options.exportFormat, options.name, base, generated]);

  const exportedExtracted = useMemo(
    () => exportPalette(extracted, options.exportFormat, options.name),
    [extracted, options.exportFormat, options.name],
  );

  return (
    <Tabs defaultValue="generate">
      <TabsList className="mb-4">
        <TabsTrigger value="generate">From a color</TabsTrigger>
        <TabsTrigger value="image">From an image</TabsTrigger>
      </TabsList>

      <TabsContent value="generate">
        <PanelLayout
          options={
            <>
              <Row label="Base color">
                <Input
                  value={options.base}
                  onChange={(e) => update({ base: e.target.value })}
                  placeholder="#6366f1"
                  className={cn('font-mono', !base && 'border-destructive')}
                />
              </Row>

              <SelectField
                label="Scheme"
                value={options.scheme}
                onChange={(scheme) => update({ scheme })}
                options={SCHEME_OPTIONS}
              />

              <NumberField
                label="How many colors"
                min={2}
                max={16}
                value={options.count}
                onChange={(count) => update({ count })}
              />

              <Row label="Name" hint="Used as the variable prefix on export.">
                <Input value={options.name} onChange={(e) => update({ name: e.target.value })} />
              </Row>

              <SelectField
                label="Export as"
                value={options.exportFormat}
                onChange={(exportFormat) => update({ exportFormat })}
                options={EXPORT_OPTIONS}
              />

              <Toggle
                label="Export the 50 → 950 scale instead"
                checked={options.exportAsScale}
                onChange={(exportAsScale) => update({ exportAsScale })}
              />

              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
                <RotateCcw className="size-3.5" />
                Reset to defaults
              </Button>
            </>
          }
          output={
            !base ? (
              <p className="text-sm text-muted-foreground">Enter a valid base color.</p>
            ) : (
              <>
                <Swatches colors={generated} onCopy={ctx.copy} />
                <Row label={EXPORT_LABELS[options.exportFormat]}>
                  <div className="relative">
                    <pre className="max-h-72 overflow-auto rounded-md border p-3 pr-12 font-mono text-xs">
                      {exported}
                    </pre>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute right-1 top-1"
                      onClick={() => ctx.copy(exported)}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                </Row>
              </>
            )
          }
        />
      </TabsContent>

      <TabsContent value="image">
        <PanelLayout
          options={
            <>
              <FileDropZone
                files={ctx.files}
                onFiles={extract}
                pickOptions={{ title: 'Pick an image', filters: IMAGE_FILTER }}
                label="Drop an image here, or click to browse"
              />

              {source && (
                <p className="truncate font-mono text-xs text-muted-foreground" title={source}>
                  {source}
                </p>
              )}

              <NumberField
                label="How many colors"
                min={2}
                max={16}
                value={options.extractCount}
                onChange={(extractCount) => update({ extractCount })}
                hint="Re-drop the image to apply a new count."
              />

              <SelectField
                label="Export as"
                value={options.exportFormat}
                onChange={(exportFormat) => update({ exportFormat })}
                options={EXPORT_OPTIONS}
              />

              <Row label="Name">
                <Input value={options.name} onChange={(e) => update({ name: e.target.value })} />
              </Row>
            </>
          }
          output={
            extracting ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Extracting…
              </div>
            ) : extractError ? (
              <p className="text-sm text-destructive">{extractError}</p>
            ) : extracted.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Drop an image to pull its dominant colors, sorted by how much of the image they cover.
              </p>
            ) : (
              <>
                <Swatches colors={extracted} onCopy={ctx.copy} />
                <Row label={EXPORT_LABELS[options.exportFormat]}>
                  <div className="relative">
                    <pre className="max-h-72 overflow-auto rounded-md border p-3 pr-12 font-mono text-xs">
                      {exportedExtracted}
                    </pre>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute right-1 top-1"
                      onClick={() => ctx.copy(exportedExtracted)}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                </Row>
              </>
            )
          }
        />
      </TabsContent>
    </Tabs>
  );
}
