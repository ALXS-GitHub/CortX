import { useCallback, useMemo, useState } from 'react';
import { Loader2, Play, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { FileDropZone, OutputFields, SelectedFiles } from '../../FileFields';
import { ToolStatusNotice } from '../../ToolStatusNotice';
import { NumberField, PanelLayout, Row, SelectField, Toggle } from '../../fields';
import { useExternalTool } from '../../lib/external';
import { formatBytes } from '../../lib/image';
import { usePanelOptions } from '../../options';
import { useOutputTarget } from '../../output';
import type { UtilityPanelProps } from '../../types';

type Preset = 'screen' | 'ebook' | 'printer' | 'prepress' | 'custom';

interface PdfOptions {
  preset: Preset;
  imageDpi: number;
  downsample: boolean;
  grayscale: boolean;
  compatibility: string;
  keepLarger: boolean;
}

const DEFAULT_OPTIONS: PdfOptions = {
  preset: 'ebook',
  imageDpi: 150,
  downsample: true,
  grayscale: false,
  compatibility: '1.5',
  keepLarger: false,
};

const PRESET_OPTIONS: { value: Preset; label: string }[] = [
  { value: 'screen', label: 'Screen — 72 dpi, smallest' },
  { value: 'ebook', label: 'Ebook — 150 dpi, good default' },
  { value: 'printer', label: 'Printer — 300 dpi' },
  { value: 'prepress', label: 'Prepress — 300 dpi, colour preserved' },
  { value: 'custom', label: 'Custom dpi' },
];

const PDF_FILTERS = [{ name: 'PDF', extensions: ['pdf'] }];

export default function PdfCompressPanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<PdfOptions>(ctx, DEFAULT_OPTIONS);
  // Ghostscript's console binary is named differently on Windows.
  const ghostscript = useExternalTool(ctx, ['gs', 'gswin64c', 'gswin32c'], ['--version']);

  const [input, setInput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ path: string; before: number; after: number } | null>(null);

  const target = useOutputTarget(ctx.files, input, { suffix: '-min', ext: 'pdf' });

  const args = useMemo(() => {
    const base = [
      '-sDEVICE=pdfwrite',
      `-dCompatibilityLevel=${options.compatibility}`,
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      '-dSAFER',
    ];

    if (options.preset === 'custom') {
      base.push(
        '-dPDFSETTINGS=/default',
        `-dDownsampleColorImages=${options.downsample}`,
        `-dDownsampleGrayImages=${options.downsample}`,
        `-dDownsampleMonoImages=${options.downsample}`,
        `-dColorImageResolution=${options.imageDpi}`,
        `-dGrayImageResolution=${options.imageDpi}`,
        `-dMonoImageResolution=${options.imageDpi * 2}`,
      );
    } else {
      base.push(`-dPDFSETTINGS=/${options.preset}`);
    }

    if (options.grayscale) {
      base.push(
        '-sColorConversionStrategy=Gray',
        '-dProcessColorModel=/DeviceGray',
      );
    }

    return base;
  }, [options]);

  const run = useCallback(async () => {
    if (!input || !target.ready || !ghostscript.program) return;

    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const output = await target.resolve();
      const before = (await ctx.files.read(input)).byteLength;

      const run = await ctx.run(ghostscript.program, [...args, `-sOutputFile=${output}`, input]);

      if (run.code !== 0) {
        throw new Error(run.stderr.trim() || `Ghostscript exited with code ${run.code}`);
      }

      const after = (await ctx.files.read(output)).byteLength;

      // Ghostscript happily rewrites an already-optimised PDF into a bigger
      // one; saying so beats silently "compressing" it upwards.
      if (!options.keepLarger && after >= before) {
        setError(
          `The result is not smaller (${formatBytes(after)} vs ${formatBytes(before)}). ` +
            'The file is written anyway — tick the option below to stop warning about this.',
        );
      }

      setResult({ path: output, before, after });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [ctx, input, args, target, ghostscript.program, options.keepLarger]);

  return (
    <PanelLayout
      options={
        <>
          <ToolStatusNotice
            tool={ghostscript}
            name="Ghostscript"
            installHint="Install it (winget install Ghostscript, brew install ghostscript, or apt install ghostscript) and reopen this tool. Rewriting a PDF is not something a webview can do."
          />

          <FileDropZone
            files={ctx.files}
            onFiles={(paths) => setInput(paths[0] ?? null)}
            pickOptions={{ title: 'Pick a PDF', filters: PDF_FILTERS }}
            label="Drop a PDF here, or click to browse"
          />
          <SelectedFiles paths={input ? [input] : []} />

          <SelectField
            label="Preset"
            value={options.preset}
            onChange={(preset) => update({ preset })}
            options={PRESET_OPTIONS}
          />

          {options.preset === 'custom' && (
            <>
              <NumberField
                label="Image resolution"
                min={36}
                max={600}
                suffix="dpi"
                value={options.imageDpi}
                onChange={(imageDpi) => update({ imageDpi })}
              />
              <Toggle
                label="Downsample images above that resolution"
                checked={options.downsample}
                onChange={(downsample) => update({ downsample })}
              />
            </>
          )}

          <Toggle
            label="Convert to grayscale"
            checked={options.grayscale}
            onChange={(grayscale) => update({ grayscale })}
          />

          <SelectField
            label="PDF compatibility"
            value={options.compatibility}
            onChange={(compatibility) => update({ compatibility })}
            options={[
              { value: '1.3', label: '1.3 — most compatible' },
              { value: '1.4', label: '1.4' },
              { value: '1.5', label: '1.5 — default' },
              { value: '1.7', label: '1.7 — newest features' },
            ]}
          />

          <Toggle
            label="Don't warn when the result is bigger"
            checked={options.keepLarger}
            onChange={(keepLarger) => update({ keepLarger })}
          />

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
            disabled={running || !input || !target.ready || ghostscript.status !== 'ready'}
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Compress
          </Button>

          {input && (
            <Row label="Command">
              <pre className="max-h-24 overflow-auto rounded-md border p-3 font-mono text-[11px]">
                {ghostscript.program ?? 'gs'} {args.join(' ')} -sOutputFile={'<output>'} {'<input>'}
              </pre>
            </Row>
          )}

          {result && (
            <div className="space-y-1 rounded-md border p-3 text-xs">
              <code className="block truncate font-mono">{result.path}</code>
              <p className="text-muted-foreground">
                {formatBytes(result.before)} → {formatBytes(result.after)} (
                {result.after <= result.before ? '−' : '+'}
                {Math.abs(Math.round((1 - result.after / result.before) * 100))}%)
              </p>
              <Button size="sm" variant="outline" onClick={() => ctx.files.reveal(result.path)}>
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
