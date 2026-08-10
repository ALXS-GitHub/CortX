import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { FileDropZone, OutputFields, SelectedFiles } from '../../FileFields';
import { NumberField, PanelLayout, Row, SelectField, TextField, Toggle } from '../../fields';
import {
  IMAGE_FILTERS,
  IMAGE_FORMAT_LABELS,
  blobToBytes,
  canvasToBlob,
  loadBitmap,
  type ImageFormat,
} from '../../lib/image';
import { usePanelOptions } from '../../options';
import { useOutputTarget } from '../../output';
import type { UtilityPanelProps } from '../../types';

type Ratio = 'free' | '1:1' | '4:3' | '3:2' | '16:9' | '9:16';

const RATIO_VALUES: Record<Ratio, number | null> = {
  free: null,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
};

const RATIO_OPTIONS = (Object.keys(RATIO_VALUES) as Ratio[]).map((value) => ({
  value,
  label: value === 'free' ? 'Free' : value,
}));

const ROTATION_OPTIONS = [
  { value: '0', label: 'None' },
  { value: '90', label: '90° clockwise' },
  { value: '180', label: '180°' },
  { value: '270', label: '90° counter-clockwise' },
];

const FORMAT_OPTIONS = (Object.keys(IMAGE_FORMAT_LABELS) as ImageFormat[]).map((value) => ({
  value,
  label: IMAGE_FORMAT_LABELS[value],
}));

interface CropOptions {
  ratio: Ratio;
  rotation: string;
  flipH: boolean;
  flipV: boolean;
  format: ImageFormat;
  quality: number;
  background: string;
}

const DEFAULT_OPTIONS: CropOptions = {
  ratio: 'free',
  rotation: '0',
  flipH: false,
  flipV: false,
  format: 'png',
  quality: 92,
  background: '#00000000',
};

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PREVIEW_MAX = 520;

export default function ImageCropPanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<CropOptions>(ctx, DEFAULT_OPTIONS);

  const [inputPath, setInputPath] = useState<string | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const ext = options.format === 'jpeg' ? 'jpg' : options.format;
  const target = useOutputTarget(ctx.files, inputPath, { suffix: '-crop', ext });

  // Load the picked file into a bitmap; the setState lands in a promise
  // callback, not synchronously inside the effect.
  useEffect(() => {
    if (!inputPath) return;
    let cancelled = false;

    (async () => {
      try {
        const bytes = await ctx.files.read(inputPath);
        const loaded = await loadBitmap(bytes);
        if (cancelled) {
          loaded.close();
          return;
        }
        setBitmap(loaded);
        setSelection({ x: 0, y: 0, width: loaded.width, height: loaded.height });
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inputPath, ctx.files]);

  const scale = bitmap ? Math.min(1, PREVIEW_MAX / Math.max(bitmap.width, bitmap.height)) : 1;

  // Repaint the preview whenever the image or the selection changes.
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !bitmap) return;

    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    if (!selection) return;

    const box = {
      x: selection.x * scale,
      y: selection.y * scale,
      width: selection.width * scale,
      height: selection.height * scale,
    };

    // Dim everything outside the selection.
    context.fillStyle = 'rgba(0, 0, 0, 0.5)';
    context.fillRect(0, 0, canvas.width, box.y);
    context.fillRect(0, box.y + box.height, canvas.width, canvas.height - box.y - box.height);
    context.fillRect(0, box.y, box.x, box.height);
    context.fillRect(box.x + box.width, box.y, canvas.width - box.x - box.width, box.height);

    context.strokeStyle = '#ffffff';
    context.lineWidth = 1;
    context.strokeRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
  }, [bitmap, selection, scale]);

  /** Applies the locked ratio, if any, to a freshly dragged rectangle. */
  const constrain = useCallback(
    (rect: Rect): Rect => {
      const ratio = RATIO_VALUES[options.ratio];
      if (!ratio || rect.width === 0 || rect.height === 0) return rect;

      // Keep the larger dimension and derive the other, so the box always
      // covers what the pointer swept.
      return rect.width / rect.height > ratio
        ? { ...rect, width: Math.round(rect.height * ratio) }
        : { ...rect, height: Math.round(rect.width / ratio) };
    },
    [options.ratio],
  );

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round((event.clientX - rect.left) / scale),
      y: Math.round((event.clientY - rect.top) / scale),
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!bitmap) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = pointerPosition(event);
    setSelection({ ...dragStart.current, width: 0, height: 0 });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!bitmap || !dragStart.current) return;
    const current = pointerPosition(event);
    const start = dragStart.current;

    const rect: Rect = {
      x: Math.max(0, Math.min(start.x, current.x)),
      y: Math.max(0, Math.min(start.y, current.y)),
      width: Math.min(bitmap.width, Math.abs(current.x - start.x)),
      height: Math.min(bitmap.height, Math.abs(current.y - start.y)),
    };

    setSelection(constrain(rect));
  };

  const onPointerUp = () => {
    dragStart.current = null;
    // A click without a drag means "select everything" rather than nothing.
    setSelection((current) =>
      current && current.width < 4 && current.height < 4 && bitmap
        ? { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
        : current,
    );
  };

  const setSelectionField = (patch: Partial<Rect>) => {
    setSelection((current) => (current ? { ...current, ...patch } : current));
  };

  const exportCrop = async () => {
    if (!bitmap || !selection || !target.ready) return;

    setBusy(true);
    setError(null);
    setSaved(null);

    try {
      const width = Math.max(1, Math.round(selection.width));
      const height = Math.max(1, Math.round(selection.height));
      const rotation = Number(options.rotation);
      const swapped = rotation === 90 || rotation === 270;

      const canvas = document.createElement('canvas');
      canvas.width = swapped ? height : width;
      canvas.height = swapped ? width : height;

      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable');

      if (options.background) {
        context.fillStyle = options.format === 'jpeg' ? options.background || '#ffffff' : options.background;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Rotate and flip around the centre, then draw the crop centred on it.
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((rotation * Math.PI) / 180);
      context.scale(options.flipH ? -1 : 1, options.flipV ? -1 : 1);
      context.drawImage(
        bitmap,
        Math.round(selection.x),
        Math.round(selection.y),
        width,
        height,
        -width / 2,
        -height / 2,
        width,
        height,
      );

      const blob = await canvasToBlob(canvas, options.format, options.quality / 100);
      const path = await target.resolve();
      await ctx.files.write(path, await blobToBytes(blob));
      setSaved(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelLayout
      options={
        <>
          <FileDropZone
            files={ctx.files}
            onFiles={(paths) => setInputPath(paths[0] ?? null)}
            pickOptions={{ title: 'Pick an image', filters: IMAGE_FILTERS }}
            label="Drop an image here"
          />
          <SelectedFiles paths={inputPath ? [inputPath] : []} />

          {bitmap && selection && (
            <>
              <SelectField
                label="Aspect ratio"
                value={options.ratio}
                onChange={(ratio) => update({ ratio })}
                options={RATIO_OPTIONS}
                hint="Applies while you drag a new selection."
              />

              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="X"
                  min={0}
                  max={bitmap.width}
                  suffix="px"
                  value={Math.round(selection.x)}
                  onChange={(x) => setSelectionField({ x })}
                />
                <NumberField
                  label="Y"
                  min={0}
                  max={bitmap.height}
                  suffix="px"
                  value={Math.round(selection.y)}
                  onChange={(y) => setSelectionField({ y })}
                />
                <NumberField
                  label="Width"
                  min={1}
                  max={bitmap.width}
                  suffix="px"
                  value={Math.round(selection.width)}
                  onChange={(width) => setSelectionField({ width })}
                />
                <NumberField
                  label="Height"
                  min={1}
                  max={bitmap.height}
                  suffix="px"
                  value={Math.round(selection.height)}
                  onChange={(height) => setSelectionField({ height })}
                />
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelection({ x: 0, y: 0, width: bitmap.width, height: bitmap.height })}
              >
                Select the whole image
              </Button>

              <SelectField
                label="Rotation"
                value={options.rotation}
                onChange={(rotation) => update({ rotation })}
                options={ROTATION_OPTIONS}
              />

              <div className="grid grid-cols-2 gap-2">
                <Toggle label="Flip horizontally" checked={options.flipH} onChange={(flipH) => update({ flipH })} />
                <Toggle label="Flip vertically" checked={options.flipV} onChange={(flipV) => update({ flipV })} />
              </div>

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
                hint="Shows through where the rotation leaves gaps."
                mono
                value={options.background}
                onChange={(background) => update({ background })}
              />

              <OutputFields files={ctx.files} target={target} />
            </>
          )}

          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
        </>
      }
      output={
        <>
          {!bitmap ? (
            <p className="text-sm text-muted-foreground">
              Drop an image on the left, then drag on the preview to pick the area to keep.
            </p>
          ) : (
            <>
              <Row
                label="Preview"
                hint={`Source ${bitmap.width} × ${bitmap.height} px · selection ${Math.round(
                  selection?.width ?? 0,
                )} × ${Math.round(selection?.height ?? 0)} px`}
              >
                <canvas
                  ref={previewRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  className="max-w-full cursor-crosshair touch-none rounded-md border"
                />
              </Row>

              <Button onClick={exportCrop} disabled={busy || !target.ready}>
                {busy ? 'Exporting…' : 'Export crop'}
              </Button>

              {saved && (
                <div className="flex items-center gap-2 text-xs">
                  <code className="min-w-0 flex-1 truncate font-mono">{saved}</code>
                  <Button size="sm" variant="outline" onClick={() => ctx.files.reveal(saved)}>
                    Show in folder
                  </Button>
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      }
    />
  );
}
