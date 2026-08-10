import { useCallback, useMemo } from 'react';
import { RotateCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { JobInputs, JobResults } from '../../FileFields';
import { NumberField, PanelLayout, Row, TextField, Toggle } from '../../fields';
import { useFileJob, type Processed } from '../../job';
import { IMAGE_FILTERS, blobToBytes, loadBitmap, renderBitmap } from '../../lib/image';
import { usePanelOptions } from '../../options';
import type { UtilityPanelProps } from '../../types';
import { buildIco } from './ico';

interface IconSetOptions {
  sizes: string;
  makeIco: boolean;
  icoSizes: string;
  padding: number;
  background: string;
  prefix: string;
}

const DEFAULT_OPTIONS: IconSetOptions = {
  sizes: '16, 32, 48, 64, 128, 180, 192, 256, 512',
  makeIco: true,
  icoSizes: '16, 32, 48, 256',
  padding: 0,
  background: '#00000000',
  prefix: 'icon',
};

const PRESETS: { label: string; sizes: string; icoSizes?: string }[] = [
  { label: 'Web complete', sizes: '16, 32, 48, 180, 192, 512', icoSizes: '16, 32, 48' },
  { label: 'Favicon only', sizes: '16, 32, 48', icoSizes: '16, 32, 48' },
  { label: 'PWA', sizes: '192, 512' },
  { label: 'Tauri', sizes: '32, 128, 256, 512', icoSizes: '16, 32, 48, 256' },
  { label: 'Apple touch', sizes: '120, 152, 167, 180' },
];

/** "16, 32, x, 48" -> [16, 32, 48], deduped and ordered. */
function parseSizes(value: string): number[] {
  const sizes = value
    .split(/[\s,;]+/)
    .map((part) => Number.parseInt(part, 10))
    .filter((size) => Number.isFinite(size) && size > 0 && size <= 4096);
  return [...new Set(sizes)].sort((a, b) => a - b);
}

export default function IconSetPanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<IconSetOptions>(ctx, DEFAULT_OPTIONS);
  const job = useFileJob(ctx, { suffix: '-icons', ext: 'png' });

  const sizes = useMemo(() => parseSizes(options.sizes), [options.sizes]);
  const icoSizes = useMemo(() => parseSizes(options.icoSizes), [options.icoSizes]);

  const process = useCallback(async () => {
    await job.run(async (bytes) => {
      const bitmap = await loadBitmap(bytes);
      const prefix = options.prefix.trim() || 'icon';
      const outputs: Processed[] = [];

      const renderAt = async (size: number) => {
        const blob = await renderBitmap(bitmap, {
          width: size,
          height: size,
          // Square output from a non-square source: contain, so nothing is cut.
          fit: 'contain',
          background: options.background,
          format: 'png',
          padding: options.padding / 100,
        });
        return blobToBytes(blob);
      };

      for (const size of sizes) {
        outputs.push({ data: await renderAt(size), name: `${prefix}-${size}x${size}.png` });
      }

      if (options.makeIco && icoSizes.length > 0) {
        const icoImages = await Promise.all(
          icoSizes.map(async (size) => ({ size, png: await renderAt(size) })),
        );
        outputs.push({ data: buildIco(icoImages), name: `${prefix}.ico` });
      }

      bitmap.close();

      if (outputs.length === 0) throw new Error('No sizes requested');
      return outputs;
    });
  }, [job, options, sizes, icoSizes]);

  return (
    <PanelLayout
      options={
        <>
          <JobInputs
            files={ctx.files}
            job={job}
            pickOptions={{ title: 'Pick a source image', filters: IMAGE_FILTERS, multiple: false }}
            dropLabel="Drop the source image (square works best)"
          />

          <Row label="Presets">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <Badge
                  key={preset.label}
                  variant="outline"
                  className="cursor-pointer hover:bg-accent"
                  onClick={() =>
                    update({
                      sizes: preset.sizes,
                      makeIco: Boolean(preset.icoSizes),
                      icoSizes: preset.icoSizes ?? options.icoSizes,
                    })
                  }
                >
                  {preset.label}
                </Badge>
              ))}
            </div>
          </Row>

          <TextField
            label="PNG sizes"
            hint={`${sizes.length} size${sizes.length === 1 ? '' : 's'} — comma separated, in pixels.`}
            mono
            value={options.sizes}
            onChange={(value) => update({ sizes: value })}
          />

          <Toggle
            label="Also build a .ico"
            checked={options.makeIco}
            onChange={(makeIco) => update({ makeIco })}
          />

          {options.makeIco && (
            <TextField
              label="Sizes inside the .ico"
              hint="256 max — larger entries are dropped."
              mono
              value={options.icoSizes}
              onChange={(value) => update({ icoSizes: value })}
            />
          )}

          <TextField
            label="File prefix"
            value={options.prefix}
            onChange={(prefix) => update({ prefix })}
          />

          <NumberField
            label="Padding"
            hint="Empty margin around the artwork."
            min={0}
            max={45}
            suffix="%"
            value={options.padding}
            onChange={(padding) => update({ padding })}
          />

          <TextField
            label="Background"
            hint="Transparent by default. Use a solid colour for iOS icons."
            mono
            value={options.background}
            onChange={(background) => update({ background })}
          />

          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
        </>
      }
      output={
        <JobResults job={job} onRun={process} actionLabel="Generate">
          {job.inputs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Drop one image on the left. It produces {sizes.length} PNG
              {options.makeIco ? ' plus a multi-size .ico' : ''}, written next to the source unless
              you point the output folder elsewhere.
            </p>
          )}
        </JobResults>
      }
    />
  );
}
