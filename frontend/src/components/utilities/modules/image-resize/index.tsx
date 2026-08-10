import { useCallback } from 'react';
import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { JobInputs, JobResults } from '../../FileFields';
import { NumberField, PanelLayout, Row, SelectField, TextField, Toggle } from '../../fields';
import { useFileJob } from '../../job';
import {
  FIT_LABELS,
  IMAGE_FILTERS,
  IMAGE_FORMAT_LABELS,
  blobToBytes,
  loadBitmap,
  renderBitmap,
  resolveSize,
  type FitMode,
  type ImageFormat,
} from '../../lib/image';
import { usePanelOptions } from '../../options';
import type { UtilityPanelProps } from '../../types';

type SizeMode = 'dimensions' | 'percent' | 'keep';

interface ResizeOptions {
  sizeMode: SizeMode;
  width: number;
  height: number;
  percent: number;
  keepRatio: boolean;
  fit: FitMode;
  format: ImageFormat;
  quality: number;
  background: string;
  smoothing: boolean;
}

const DEFAULT_OPTIONS: ResizeOptions = {
  sizeMode: 'dimensions',
  width: 1920,
  height: 0,
  percent: 50,
  keepRatio: true,
  fit: 'contain',
  format: 'png',
  quality: 90,
  background: '#00000000',
  smoothing: true,
};

const SIZE_MODES: { value: SizeMode; label: string }[] = [
  { value: 'dimensions', label: 'Target dimensions' },
  { value: 'percent', label: 'Percentage of the original' },
  { value: 'keep', label: 'Keep the original size (convert only)' },
];

const FORMAT_OPTIONS = (Object.keys(IMAGE_FORMAT_LABELS) as ImageFormat[]).map((value) => ({
  value,
  label: IMAGE_FORMAT_LABELS[value],
}));

const FIT_OPTIONS = (Object.keys(FIT_LABELS) as FitMode[]).map((value) => ({
  value,
  label: FIT_LABELS[value],
}));

export default function ImageResizePanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<ResizeOptions>(ctx, DEFAULT_OPTIONS);
  const job = useFileJob(ctx, { suffix: '-resized', ext: options.format === 'jpeg' ? 'jpg' : options.format });

  const process = useCallback(async () => {
    await job.run(async (bytes) => {
      const bitmap = await loadBitmap(bytes);

      const size =
        options.sizeMode === 'keep'
          ? { width: bitmap.width, height: bitmap.height }
          : resolveSize(
              bitmap,
              options.sizeMode === 'percent'
                ? { percent: options.percent }
                : { width: options.width || undefined, height: options.height || undefined },
              options.keepRatio,
            );

      const blob = await renderBitmap(bitmap, {
        ...size,
        // Only "cover" needs cropping logic; the rest already matches the box.
        fit: options.keepRatio ? options.fit : 'stretch',
        // JPEG has no alpha: without a backdrop, transparency turns black.
        background: options.format === 'jpeg' ? options.background || '#ffffff' : options.background,
        format: options.format,
        quality: options.quality / 100,
        smoothing: options.smoothing,
      });
      bitmap.close();

      return { data: await blobToBytes(blob), ext: options.format === 'jpeg' ? 'jpg' : options.format };
    });
  }, [job, options]);

  return (
    <PanelLayout
      options={
        <>
          <JobInputs
            files={ctx.files}
            job={job}
            pickOptions={{ title: 'Pick images', filters: IMAGE_FILTERS }}
            dropLabel="Drop images here, or click to browse"
          />

          <SelectField
            label="Size"
            value={options.sizeMode}
            onChange={(sizeMode) => update({ sizeMode })}
            options={SIZE_MODES}
          />

          {options.sizeMode === 'dimensions' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Width"
                  hint="0 = derive"
                  min={0}
                  max={20000}
                  suffix="px"
                  value={options.width}
                  onChange={(width) => update({ width })}
                />
                <NumberField
                  label="Height"
                  hint="0 = derive"
                  min={0}
                  max={20000}
                  suffix="px"
                  value={options.height}
                  onChange={(height) => update({ height })}
                />
              </div>
              <Toggle
                label="Keep the aspect ratio"
                checked={options.keepRatio}
                onChange={(keepRatio) => update({ keepRatio })}
              />
              {options.keepRatio && options.width > 0 && options.height > 0 && (
                <SelectField
                  label="Fit"
                  value={options.fit}
                  onChange={(fit) => update({ fit })}
                  options={FIT_OPTIONS}
                />
              )}
            </>
          )}

          {options.sizeMode === 'percent' && (
            <NumberField
              label="Scale"
              min={1}
              max={800}
              suffix="%"
              value={options.percent}
              onChange={(percent) => update({ percent })}
            />
          )}

          <SelectField
            label="Output format"
            value={options.format}
            onChange={(format) => update({ format })}
            options={FORMAT_OPTIONS}
          />

          {options.format !== 'png' && (
            <NumberField
              label="Quality"
              min={1}
              max={100}
              suffix="%"
              value={options.quality}
              onChange={(quality) => update({ quality })}
            />
          )}

          <TextField
            label="Background"
            hint="Painted behind transparency. JPEG falls back to white."
            mono
            value={options.background}
            onChange={(background) => update({ background })}
          />

          <Toggle
            label="Smooth scaling (off = pixel art)"
            checked={options.smoothing}
            onChange={(smoothing) => update({ smoothing })}
          />

          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
        </>
      }
      output={
        <JobResults job={job} onRun={process} actionLabel="Resize">
          {job.inputs.length === 0 && (
            <Row>
              <p className="text-sm text-muted-foreground">
                Drop one or more images on the left. AVIF, GIF and BMP can be read; output is PNG,
                JPEG or WebP.
              </p>
            </Row>
          )}
        </JobResults>
      }
    />
  );
}
