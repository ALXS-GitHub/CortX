import { useCallback, useState } from 'react';
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

/**
 * Two very different jobs live behind "compress a PDF":
 *
 * - qpdf rewrites the file's *structure* — object streams, flate levels,
 *   duplicate objects. Strictly lossless: forms, annotations and tagging come
 *   out intact. It wins on PDFs bloated by their generator, and does nothing
 *   for a scan.
 * - Ghostscript re-interprets the document and downsamples its *images*. It is
 *   the only one that helps on scans and slide exports, and the cost is real:
 *   form fields and tagging can be flattened, fonts re-subset.
 *
 * Picking the wrong one either does nothing or quietly damages the document,
 * and you cannot tell which from the outside — hence Auto as the default, with
 * both still selectable when you already know.
 */
type Mode = 'auto' | 'lossless' | 'downsample';

type Preset = 'screen' | 'ebook' | 'printer' | 'prepress' | 'custom';

interface PdfOptions {
  mode: Mode;
  autoThreshold: number;
  preset: Preset;
  imageDpi: number;
  downsample: boolean;
  grayscale: boolean;
  compatibility: string;
  linearize: boolean;
  keepLarger: boolean;
}

const DEFAULT_OPTIONS: PdfOptions = {
  mode: 'auto',
  autoThreshold: 10,
  preset: 'ebook',
  imageDpi: 150,
  downsample: true,
  grayscale: false,
  compatibility: '1.5',
  linearize: false,
  keepLarger: false,
};

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'auto', label: 'Auto — lossless first, downsample if needed' },
  { value: 'lossless', label: 'Lossless only — never touches the images' },
  { value: 'downsample', label: 'Downsample images — for scans and slides' },
];

const PRESET_OPTIONS: { value: Preset; label: string }[] = [
  { value: 'screen', label: 'Screen — 72 dpi, smallest' },
  { value: 'ebook', label: 'Ebook — 150 dpi, good default' },
  { value: 'printer', label: 'Printer — 300 dpi' },
  { value: 'prepress', label: 'Prepress — 300 dpi, colour preserved' },
  { value: 'custom', label: 'Custom dpi' },
];

const PDF_FILTERS = [{ name: 'PDF', extensions: ['pdf'] }];

interface Attempt {
  backend: 'qpdf' | 'ghostscript';
  path: string;
  size: number;
}

export default function PdfCompressPanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<PdfOptions>(ctx, DEFAULT_OPTIONS);

  const qpdf = useExternalTool(ctx, 'qpdf', ['--version']);
  // Ghostscript's console binary is named differently on Windows.
  const ghostscript = useExternalTool(ctx, ['gs', 'gswin64c', 'gswin32c'], ['--version']);

  const [input, setInput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    path: string;
    before: number;
    after: number;
    backend: string;
  } | null>(null);

  const target = useOutputTarget(ctx.files, input, { suffix: '-min', ext: 'pdf' });

  const needsQpdf = options.mode !== 'downsample';
  const needsGhostscript = options.mode !== 'lossless';
  const ready =
    (!needsQpdf || qpdf.status === 'ready') && (!needsGhostscript || ghostscript.status === 'ready');

  const qpdfArgs = useCallback(
    (source: string, output: string) => [
      '--object-streams=generate',
      '--compress-streams=y',
      '--recompress-flate',
      '--compression-level=9',
      ...(options.linearize ? ['--linearize'] : []),
      source,
      output,
    ],
    [options.linearize],
  );

  const ghostscriptArgs = useCallback(
    (source: string, output: string) => {
      const args = [
        '-sDEVICE=pdfwrite',
        `-dCompatibilityLevel=${options.compatibility}`,
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        '-dSAFER',
      ];

      if (options.preset === 'custom') {
        args.push(
          '-dPDFSETTINGS=/default',
          `-dDownsampleColorImages=${options.downsample}`,
          `-dDownsampleGrayImages=${options.downsample}`,
          `-dDownsampleMonoImages=${options.downsample}`,
          `-dColorImageResolution=${options.imageDpi}`,
          `-dGrayImageResolution=${options.imageDpi}`,
          `-dMonoImageResolution=${options.imageDpi * 2}`,
        );
      } else {
        args.push(`-dPDFSETTINGS=/${options.preset}`);
      }

      if (options.grayscale) {
        args.push('-sColorConversionStrategy=Gray', '-dProcessColorModel=/DeviceGray');
      }

      return [...args, `-sOutputFile=${output}`, source];
    },
    [options.compatibility, options.preset, options.downsample, options.imageDpi, options.grayscale],
  );

  const run = useCallback(async () => {
    if (!input || !target.ready) return;

    setRunning(true);
    setError(null);
    setResult(null);
    setStatus(null);

    try {
      const output = await target.resolve();
      const before = (await ctx.files.read(input)).byteLength;
      const attempts: Attempt[] = [];

      const runQpdf = async (destination: string) => {
        setStatus('Rewriting the structure with qpdf…');
        const run = await ctx.run('qpdf', qpdfArgs(input, destination));
        // qpdf exits 3 on warnings but still writes a valid file.
        if (run.code !== 0 && run.code !== 3) {
          throw new Error(run.stderr.trim() || `qpdf exited with code ${run.code}`);
        }
        attempts.push({
          backend: 'qpdf',
          path: destination,
          size: (await ctx.files.read(destination)).byteLength,
        });
      };

      const runGhostscript = async (destination: string) => {
        if (!ghostscript.program) throw new Error('Ghostscript was not found');
        setStatus('Downsampling images with Ghostscript…');
        const run = await ctx.run(ghostscript.program, ghostscriptArgs(input, destination));
        if (run.code !== 0) {
          throw new Error(run.stderr.trim() || `Ghostscript exited with code ${run.code}`);
        }
        attempts.push({
          backend: 'ghostscript',
          path: destination,
          size: (await ctx.files.read(destination)).byteLength,
        });
      };

      if (options.mode === 'lossless') {
        await runQpdf(output);
      } else if (options.mode === 'downsample') {
        await runGhostscript(output);
      } else {
        // Auto: try the safe pass first, and only reach for the lossy one when
        // the safe pass didn't get far enough.
        await runQpdf(output);
        const gain = 1 - attempts[0].size / before;

        if (gain * 100 < options.autoThreshold) {
          const scratch = await ctx.files.join(
            await ctx.files.tempDir(),
            `cortx-pdf-${before}-${attempts[0].size}.pdf`,
          );
          await runGhostscript(scratch);

          // Keep whichever actually came out smaller.
          if (attempts[1].size < attempts[0].size) {
            await ctx.files.write(output, await ctx.files.read(scratch));
          }
        }
      }

      const best = attempts.reduce((a, b) => (b.size < a.size ? b : a));
      const after = (await ctx.files.read(output)).byteLength;

      setResult({ path: output, before, after, backend: best.backend });
      setStatus(
        attempts.length > 1
          ? `qpdf reached ${formatBytes(attempts[0].size)}, Ghostscript ${formatBytes(attempts[1].size)} — kept ${best.backend}.`
          : null,
      );

      // Both backends will happily rewrite an already-optimised PDF into a
      // bigger one; saying so beats silently "compressing" it upwards.
      if (!options.keepLarger && after >= before) {
        setError(
          `The result is not smaller (${formatBytes(after)} vs ${formatBytes(before)}). ` +
            'It was written anyway — this PDF is probably already optimised.',
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [ctx, input, target, options, qpdfArgs, ghostscriptArgs, ghostscript.program]);

  return (
    <PanelLayout
      options={
        <>
          <FileDropZone
            files={ctx.files}
            onFiles={(paths) => setInput(paths[0] ?? null)}
            pickOptions={{ title: 'Pick a PDF', filters: PDF_FILTERS }}
            label="Drop a PDF here"
          />
          <SelectedFiles paths={input ? [input] : []} />

          <SelectField
            label="Mode"
            value={options.mode}
            onChange={(mode) => update({ mode })}
            options={MODE_OPTIONS}
          />

          {needsQpdf && (
            <ToolStatusNotice
              tool={qpdf}
              name="qpdf"
              installHint="Install it (winget install qpdf, brew install qpdf, or apt install qpdf) — it does the lossless pass, and never degrades the document."
            />
          )}
          {needsGhostscript && (
            <ToolStatusNotice
              tool={ghostscript}
              name="Ghostscript"
              installHint="Install it (winget install Ghostscript, brew install ghostscript, or apt install ghostscript) — it is the only one that can downsample the images in a scan."
            />
          )}

          {options.mode === 'auto' && (
            <NumberField
              label="Fall back below"
              hint="If the lossless pass saves less than this, Ghostscript is tried too."
              min={0}
              max={90}
              suffix="%"
              value={options.autoThreshold}
              onChange={(autoThreshold) => update({ autoThreshold })}
            />
          )}

          {needsGhostscript && (
            <>
              <SelectField
                label="Downsampling preset"
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
            </>
          )}

          {needsQpdf && (
            <Toggle
              label="Linearize (fast web view)"
              checked={options.linearize}
              onChange={(linearize) => update({ linearize })}
            />
          )}

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
          <Button onClick={run} disabled={running || !input || !target.ready || !ready}>
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Compress
          </Button>

          {!input && (
            <p className="text-sm text-muted-foreground">
              Lossless keeps form fields, annotations and tagging intact but cannot shrink a scan.
              Downsampling is the opposite: it is the only thing that helps on scanned pages, and it
              can flatten interactive parts of the document. Auto runs the safe one first and only
              escalates when it wasn't enough.
            </p>
          )}

          {input && (
            <Row label="Commands">
              <pre className="max-h-32 overflow-auto rounded-md border p-3 font-mono text-[11px]">
                {needsQpdf && `qpdf ${qpdfArgs('<input>', '<output>').join(' ')}\n`}
                {needsGhostscript &&
                  `${ghostscript.program ?? 'gs'} ${ghostscriptArgs('<input>', '<output>').join(' ')}`}
              </pre>
            </Row>
          )}

          {status && <p className="text-xs text-muted-foreground">{status}</p>}

          {result && (
            <div className="space-y-1 rounded-md border p-3 text-xs">
              <code className="block truncate font-mono">{result.path}</code>
              <p className="text-muted-foreground">
                {formatBytes(result.before)} → {formatBytes(result.after)} (
                {result.after <= result.before ? '−' : '+'}
                {Math.abs(Math.round((1 - result.after / result.before) * 100))}%) · {result.backend}
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
