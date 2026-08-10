import { useCallback } from 'react';
import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { JobInputs, JobResults } from '../../FileFields';
import { NumberField, PanelLayout, Row, SelectField, TextField, Toggle } from '../../fields';
import { useFileJob } from '../../job';
import {
  IMAGE_FILTERS,
  IMAGE_FORMAT_LABELS,
  blobToBytes,
  encodeToTargetSize,
  loadBitmap,
  renderBitmap,
  resolveSize,
  type ImageFormat,
} from '../../lib/image';
import { usePanelOptions } from '../../options';
import type { UtilityPanelProps } from '../../types';

type CompressMode = 'quality' | 'target-size';

interface CompressOptions {
  mode: CompressMode;
  format: ImageFormat;
  quality: number;
  targetKb: number;
  maxWidth: number;
  background: string;
  keepLarger: boolean;
}

const DEFAULT_OPTIONS: CompressOptions = {
  mode: 'quality',
  format: 'webp',
  quality: 80,
  targetKb: 300,
  maxWidth: 0,
  background: '#ffffff',
  keepLarger: false,
};

const MODE_OPTIONS: { value: CompressMode; label: string }[] = [
  { value: 'quality', label: 'Target quality' },
  { value: 'target-size', label: 'Target file size' },
];

const FORMAT_OPTIONS = (Object.keys(IMAGE_FORMAT_LABELS) as ImageFormat[]).map((value) => ({
  value,
  label: IMAGE_FORMAT_LABELS[value],
}));

export default function ImageCompressPanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<CompressOptions>(ctx, DEFAULT_OPTIONS);
  const ext = options.format === 'jpeg' ? 'jpg' : options.format;
  const job = useFileJob(ctx, { suffix: '-min', ext });

  const process = useCallback(async () => {
    await job.run(async (bytes) => {
      const bitmap = await loadBitmap(bytes);

      const size =
        options.maxWidth > 0 && bitmap.width > options.maxWidth
          ? resolveSize(bitmap, { width: options.maxWidth }, true)
          : { width: bitmap.width, height: bitmap.height };

      const base = {
        ...size,
        fit: 'stretch' as const,
        background: options.format === 'jpeg' ? options.background || '#ffffff' : undefined,
        format: options.format,
      };

      const blob =
        options.mode === 'target-size'
          ? (await encodeToTargetSize(bitmap, base, options.targetKb * 1024)).blob
          : await renderBitmap(bitmap, { ...base, quality: options.quality / 100 });

      bitmap.close();

      // Re-encoding a well-compressed source can make it bigger; unless asked,
      // keep the original rather than pretending that is an optimisation.
      if (!options.keepLarger && blob.size >= bytes.byteLength) {
        throw new Error(
          `Re-encoding would grow the file (${blob.size} ≥ ${bytes.byteLength} bytes) — kept the original`,
        );
      }

      return { data: await blobToBytes(blob), ext };
    });
  }, [job, options, ext]);

  return (
    <PanelLayout
      options={
        <>
          <JobInputs
            files={ctx.files}
            job={job}
            pickOptions={{ title: 'Pick images', filters: IMAGE_FILTERS }}
            dropLabel="Drop one or more images here"
          />

          <SelectField
            label="Mode"
            value={options.mode}
            onChange={(mode) => update({ mode })}
            options={MODE_OPTIONS}
          />

          {options.mode === 'quality' ? (
            <NumberField
              label="Quality"
              min={1}
              max={100}
              suffix="%"
              value={options.quality}
              onChange={(quality) => update({ quality })}
            />
          ) : (
            <NumberField
              label="Target size"
              hint="Quality is searched to land just under this."
              min={5}
              max={20000}
              suffix="kB"
              value={options.targetKb}
              onChange={(targetKb) => update({ targetKb })}
            />
          )}

          <SelectField
            label="Output format"
            value={options.format}
            onChange={(format) => update({ format })}
            options={FORMAT_OPTIONS}
          />

          <NumberField
            label="Max width"
            hint="0 = never downscale"
            min={0}
            max={20000}
            suffix="px"
            value={options.maxWidth}
            onChange={(maxWidth) => update({ maxWidth })}
          />

          {options.format === 'jpeg' && (
            <TextField
              label="Background"
              hint="JPEG has no transparency."
              mono
              value={options.background}
              onChange={(background) => update({ background })}
            />
          )}

          <Toggle
            label="Write the result even if it is bigger"
            checked={options.keepLarger}
            onChange={(keepLarger) => update({ keepLarger })}
          />

          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
        </>
      }
      output={
        <JobResults job={job} onRun={process} actionLabel="Compress">
          {job.inputs.length === 0 && (
            <Row>
              <p className="text-sm text-muted-foreground">
                Drop images on the left. Metadata is dropped by re-encoding, so results are also
                stripped of EXIF.
              </p>
            </Row>
          )}
        </JobResults>
      }
    />
  );
}
