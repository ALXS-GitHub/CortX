import { useCallback, useMemo, useState } from 'react';
import { Loader2, Play, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { FileDropZone, OutputFields, SelectedFiles } from '../../FileFields';
import { ToolStatusNotice } from '../../ToolStatusNotice';
import { NumberField, PanelLayout, Row, SelectField, TextField, Toggle } from '../../fields';
import { useExternalTool } from '../../lib/external';
import { usePanelOptions } from '../../options';
import { useOutputTarget } from '../../output';
import type { UtilityPanelProps } from '../../types';

type Mode = 'gif' | 'trim' | 'audio';

interface VideoOptions {
  mode: Mode;
  start: string;
  end: string;
  useRange: boolean;
  fps: number;
  width: number;
  colors: number;
  dither: string;
  loop: boolean;
  reencode: boolean;
  crf: number;
  audioFormat: string;
  audioBitrate: number;
}

const DEFAULT_OPTIONS: VideoOptions = {
  mode: 'gif',
  start: '00:00:00',
  end: '00:00:05',
  useRange: true,
  fps: 12,
  width: 480,
  colors: 128,
  dither: 'sierra2_4a',
  loop: true,
  reencode: false,
  crf: 20,
  audioFormat: 'mp3',
  audioBitrate: 192,
};

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'gif', label: 'Convert to GIF' },
  { value: 'trim', label: 'Trim (cut a section)' },
  { value: 'audio', label: 'Extract the audio' },
];

const DITHER_OPTIONS = [
  { value: 'sierra2_4a', label: 'Sierra 2-4A (default)' },
  { value: 'bayer', label: 'Bayer (banded, smaller)' },
  { value: 'floyd_steinberg', label: 'Floyd–Steinberg' },
  { value: 'none', label: 'None (flat, smallest)' },
];

const AUDIO_FORMATS = [
  { value: 'mp3', label: 'MP3', codec: 'libmp3lame' },
  { value: 'm4a', label: 'AAC (m4a)', codec: 'aac' },
  { value: 'opus', label: 'Opus', codec: 'libopus' },
  { value: 'flac', label: 'FLAC (lossless)', codec: 'flac' },
  { value: 'wav', label: 'WAV (uncompressed)', codec: 'pcm_s16le' },
];

const VIDEO_FILTERS = [
  { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'gif', 'wmv', 'flv'] },
];

/** `undefined` means "keep the input's extension", which is what trim wants. */
function extensionFor(options: VideoOptions): string | undefined {
  if (options.mode === 'gif') return 'gif';
  if (options.mode === 'audio') return options.audioFormat;
  return undefined;
}

export default function VideoConvertPanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<VideoOptions>(ctx, DEFAULT_OPTIONS);
  const ffmpeg = useExternalTool(ctx, 'ffmpeg');

  const [input, setInput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const target = useOutputTarget(ctx.files, input, {
    // Trim keeps the container, so it needs a suffix to avoid landing on the
    // source file; the other modes already change the extension.
    suffix: options.mode === 'trim' ? '-trim' : '',
    ext: extensionFor(options),
  });

  const args = useMemo(() => {
    if (!input) return [];

    const range: string[] = options.useRange
      ? ['-ss', options.start, ...(options.end ? ['-to', options.end] : [])]
      : [];

    if (options.mode === 'gif') {
      const filter =
        `fps=${options.fps},scale=${options.width}:-1:flags=lanczos,split [a][b];` +
        `[a] palettegen=max_colors=${options.colors} [p];[b][p] paletteuse=dither=${options.dither}`;
      return [
        ...range,
        '-i', input,
        '-filter_complex', filter,
        '-loop', options.loop ? '0' : '-1',
        '-y',
      ];
    }

    if (options.mode === 'audio') {
      const codec = AUDIO_FORMATS.find((f) => f.value === options.audioFormat)?.codec ?? 'libmp3lame';
      return [
        ...range,
        '-i', input,
        '-vn',
        '-c:a', codec,
        // Lossless codecs reject a bitrate setting.
        ...(codec === 'flac' || codec === 'pcm_s16le' ? [] : ['-b:a', `${options.audioBitrate}k`]),
        '-y',
      ];
    }

    return [
      ...range,
      '-i', input,
      ...(options.reencode
        ? ['-c:v', 'libx264', '-crf', String(options.crf), '-c:a', 'aac']
        : // Stream copy is instant but can only cut on a keyframe.
          ['-c', 'copy']),
      '-y',
    ];
  }, [input, options]);

  const run = useCallback(async () => {
    if (!input || !target.ready) return;

    setRunning(true);
    setError(null);
    setSaved(null);
    setLog([]);

    try {
      const output = await target.resolve();
      const result = await ctx.run('ffmpeg', [...args, output], {
        onLog: (line) => setLog((prev) => [...prev.slice(-200), line]),
      });

      if (result.code !== 0) {
        // ffmpeg writes everything to stderr, including its own errors.
        const tail = result.stderr.trim().split('\n').slice(-4).join('\n');
        throw new Error(tail || `ffmpeg exited with code ${result.code}`);
      }

      setSaved(output);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [ctx, input, args, target]);

  return (
    <PanelLayout
      options={
        <>
          <ToolStatusNotice
            tool={ffmpeg}
            name="ffmpeg"
            installHint="Install it (winget install ffmpeg, brew install ffmpeg, or apt install ffmpeg) and reopen this tool. Everything here is a thin wrapper around it."
          />

          <FileDropZone
            files={ctx.files}
            onFiles={(paths) => setInput(paths[0] ?? null)}
            pickOptions={{ title: 'Pick a video', filters: VIDEO_FILTERS }}
            label="Drop a video here, or click to browse"
          />
          <SelectedFiles paths={input ? [input] : []} />

          <SelectField
            label="What to do"
            value={options.mode}
            onChange={(mode) => update({ mode })}
            options={MODE_OPTIONS}
          />

          <Toggle
            label="Only a section of the clip"
            checked={options.useRange}
            onChange={(useRange) => update({ useRange })}
          />

          {options.useRange && (
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Start"
                hint="hh:mm:ss"
                mono
                value={options.start}
                onChange={(start) => update({ start })}
              />
              <TextField
                label="End"
                hint="Blank = to the end"
                mono
                value={options.end}
                onChange={(end) => update({ end })}
              />
            </div>
          )}

          {options.mode === 'gif' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Frame rate"
                  min={1}
                  max={50}
                  suffix="fps"
                  value={options.fps}
                  onChange={(fps) => update({ fps })}
                />
                <NumberField
                  label="Width"
                  hint="Height follows."
                  min={16}
                  max={1920}
                  suffix="px"
                  value={options.width}
                  onChange={(width) => update({ width })}
                />
              </div>
              <NumberField
                label="Colors"
                hint="A palette is computed from the clip itself."
                min={2}
                max={256}
                value={options.colors}
                onChange={(colors) => update({ colors })}
              />
              <SelectField
                label="Dithering"
                value={options.dither}
                onChange={(dither) => update({ dither })}
                options={DITHER_OPTIONS}
              />
              <Toggle label="Loop forever" checked={options.loop} onChange={(loop) => update({ loop })} />
            </>
          )}

          {options.mode === 'trim' && (
            <>
              <Toggle
                label="Re-encode (slower, cuts exactly)"
                checked={options.reencode}
                onChange={(reencode) => update({ reencode })}
              />
              {options.reencode ? (
                <NumberField
                  label="Quality (CRF)"
                  hint="Lower is better quality and a bigger file. 18-24 is the usual range."
                  min={0}
                  max={51}
                  value={options.crf}
                  onChange={(crf) => update({ crf })}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Stream copy is instant but can only cut on a keyframe, so the start may shift by up
                  to a second.
                </p>
              )}
            </>
          )}

          {options.mode === 'audio' && (
            <>
              <SelectField
                label="Audio format"
                value={options.audioFormat}
                onChange={(audioFormat) => update({ audioFormat })}
                options={AUDIO_FORMATS.map(({ value, label }) => ({ value, label }))}
              />
              {options.audioFormat !== 'flac' && options.audioFormat !== 'wav' && (
                <NumberField
                  label="Bitrate"
                  min={32}
                  max={512}
                  suffix="kbps"
                  value={options.audioBitrate}
                  onChange={(audioBitrate) => update({ audioBitrate })}
                />
              )}
            </>
          )}

          {input && <OutputFields files={ctx.files} target={target} />}

          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
        </>
      }
      output={
        <>
          <Button
            onClick={run}
            disabled={running || !input || !target.ready || ffmpeg.status !== 'ready'}
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {options.mode === 'gif' ? 'Make GIF' : options.mode === 'trim' ? 'Trim' : 'Extract audio'}
          </Button>

          {input && (
            <Row label="Command">
              <pre className="max-h-24 overflow-auto rounded-md border p-3 font-mono text-[11px]">
                ffmpeg {args.join(' ')} {'<output>'}
              </pre>
            </Row>
          )}

          {log.length > 0 && (
            <Row label="ffmpeg output">
              <pre className="max-h-64 overflow-auto rounded-md border p-3 font-mono text-[11px]">
                {log.join('\n')}
              </pre>
            </Row>
          )}

          {saved && (
            <div className="flex items-center gap-2 text-xs">
              <code className="min-w-0 flex-1 truncate font-mono">{saved}</code>
              <Button size="sm" variant="outline" onClick={() => ctx.files.reveal(saved)}>
                Show in folder
              </Button>
            </div>
          )}

          {error && (
            <pre className="whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">
              {error}
            </pre>
          )}
        </>
      }
    />
  );
}
