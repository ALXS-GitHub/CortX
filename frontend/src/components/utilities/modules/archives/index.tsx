import { useCallback, useState } from 'react';
import { FolderOpen, Loader2, Play, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { FileDropZone, SelectedFiles } from '../../FileFields';
import { ToolStatusNotice } from '../../ToolStatusNotice';
import { PanelLayout, Row, SelectField, TextField, Toggle } from '../../fields';
import { useExternalTool } from '../../lib/external';
import { formatBytes } from '../../lib/image';
import { usePanelOptions } from '../../options';
import type { UtilityContext, UtilityPanelProps } from '../../types';
import { createZip, isSafeEntryName, readZip, type ZipEntry } from './zip';

/**
 * Two backends, because they cover different needs:
 *
 * - built-in: plain ZIP through the platform's own deflate. Nothing to install,
 *   which is the point — but ZIP only, no password, no Zip64.
 * - 7-Zip: everything else. 7z/tar/gzip, real encryption, and extraction of
 *   whatever 7-Zip can read (rar, iso, cab…). Needs the CLI on PATH.
 */
type Backend = 'builtin' | '7z';

interface ArchiveOptions {
  backend: Backend;
  compress: boolean;
  exclude: string;
  archiveName: string;
  intoSubfolder: boolean;
  keepStructure: boolean;
  format: string;
  level: number;
  password: string;
  encryptNames: boolean;
}

const DEFAULT_OPTIONS: ArchiveOptions = {
  backend: 'builtin',
  compress: true,
  exclude: 'node_modules, .git, .DS_Store, target, dist',
  archiveName: 'archive.zip',
  intoSubfolder: true,
  keepStructure: true,
  format: '7z',
  level: 5,
  password: '',
  encryptNames: true,
};

const BACKEND_OPTIONS: { value: Backend; label: string }[] = [
  { value: 'builtin', label: 'Built-in — ZIP, nothing to install' },
  { value: '7z', label: '7-Zip — 7z/tar/gz, passwords, more formats' },
];

const FORMAT_OPTIONS = [
  { value: '7z', label: '7z — best compression' },
  { value: 'zip', label: 'zip — most portable' },
  { value: 'tar', label: 'tar — no compression, keeps permissions' },
  { value: 'gzip', label: 'gzip — single file only' },
];

const LEVEL_OPTIONS = [
  { value: '0', label: '0 — store, no compression' },
  { value: '1', label: '1 — fastest' },
  { value: '5', label: '5 — normal' },
  { value: '7', label: '7 — maximum' },
  { value: '9', label: '9 — ultra, slow and memory hungry' },
];

/** Simple wildcard match, enough for the exclusion list. */
function matches(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(name);
}

function parsePatterns(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Walks a folder into archive entries, skipping anything the patterns exclude. */
async function collect(
  ctx: UtilityContext,
  root: string,
  prefix: string,
  patterns: string[],
  out: ZipEntry[],
  onFile: (path: string) => void,
): Promise<void> {
  for (const entry of await ctx.files.readDir(root)) {
    if (patterns.some((pattern) => matches(entry.name, pattern))) continue;

    const child = await ctx.files.join(root, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory) {
      await collect(ctx, child, name, patterns, out, onFile);
    } else {
      onFile(child);
      out.push({ name, data: await ctx.files.read(child) });
    }
  }
}

export default function ArchivesPanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<ArchiveOptions>(ctx, DEFAULT_OPTIONS);
  // 7-Zip ships as `7z` on Windows, `7zz` for the official Linux/macOS build,
  // and `7za` for the standalone one.
  const sevenZip = useExternalTool(ctx, ['7z', '7zz', '7za'], ['i']);

  const [inputs, setInputs] = useState<string[]>([]);
  const [archive, setArchive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const usingCli = options.backend === '7z';
  const cliReady = !usingCli || sevenZip.status === 'ready';

  const addInputs = useCallback((paths: string[]) => {
    setInputs((prev) => [...new Set([...prev, ...paths])]);
    setSaved(null);
    setError(null);
  }, []);

  const begin = () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    setProgress(null);
    setStatus(null);
  };

  const build = async () => {
    if (inputs.length === 0) return;
    begin();

    try {
      const folder = await ctx.files.pickDirectory('Where to save the archive');
      if (!folder) return;

      const patterns = parsePatterns(options.exclude);

      if (usingCli) {
        if (!sevenZip.program) throw new Error('7-Zip was not found');

        const extension = options.format === 'gzip' ? 'gz' : options.format;
        const requested = options.archiveName.trim() || `archive.${extension}`;
        const name = requested.includes('.') ? requested : `${requested}.${extension}`;
        const path = await ctx.files.join(folder, name);

        const args = [
          'a',
          `-t${options.format}`,
          `-mx=${options.level}`,
          ...patterns.map((pattern) => `-xr!${pattern}`),
          ...(options.password
            ? [`-p${options.password}`, ...(options.format === '7z' && options.encryptNames ? ['-mhe=on'] : [])]
            : []),
          '-y',
          path,
          ...inputs,
        ];

        setStatus('Running 7-Zip…');
        const run = await ctx.run(sevenZip.program, args, {
          onLog: (line) => setStatus(line),
        });
        // 7-Zip returns 1 for non-fatal warnings (a file it could not open).
        if (run.code !== 0 && run.code !== 1) {
          throw new Error(run.stderr.trim() || run.stdout.trim() || `7-Zip exited with code ${run.code}`);
        }

        const size = (await ctx.files.read(path)).byteLength;
        setSaved(path);
        setStatus(`${formatBytes(size)}${run.code === 1 ? ' · finished with warnings' : ''}`);
        return;
      }

      const entries: ZipEntry[] = [];

      for (const input of inputs) {
        const name = await ctx.files.basename(input);
        if (patterns.some((pattern) => matches(name, pattern))) continue;

        // `readDir` on a file throws; that is how we tell the two apart
        // without a dedicated stat call.
        let isDirectory = true;
        try {
          await ctx.files.readDir(input);
        } catch {
          isDirectory = false;
        }

        if (isDirectory) {
          setStatus(`Reading ${name}…`);
          await collect(ctx, input, options.keepStructure ? name : '', patterns, entries, (path) =>
            setStatus(`Reading ${path}`),
          );
        } else {
          entries.push({ name, data: await ctx.files.read(input) });
        }
      }

      if (entries.length === 0) throw new Error('Everything was excluded — nothing to archive');

      setStatus(`Compressing ${entries.length} files…`);
      const zipped = await createZip(entries, { compress: options.compress }, new Date(), (done, total) =>
        setProgress({ done, total }),
      );

      const requested = options.archiveName.trim() || 'archive.zip';
      const path = await ctx.files.join(folder, requested.endsWith('.zip') ? requested : `${requested}.zip`);
      await ctx.files.write(path, zipped);

      setSaved(path);
      setStatus(`${entries.length} files · ${formatBytes(zipped.byteLength)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const extract = async () => {
    if (!archive) return;
    begin();

    try {
      const folder = await ctx.files.pickDirectory('Where to extract');
      if (!folder) return;

      let destination = folder;
      if (options.intoSubfolder) {
        const base = (await ctx.files.basename(archive)).replace(/\.[^.]+$/, '');
        destination = await ctx.files.join(folder, base);
        await ctx.files.mkdir(destination);
      }

      if (usingCli) {
        if (!sevenZip.program) throw new Error('7-Zip was not found');

        setStatus('Running 7-Zip…');
        const run = await ctx.run(
          sevenZip.program,
          [
            'x',
            archive,
            `-o${destination}`,
            ...(options.password ? [`-p${options.password}`] : []),
            '-y',
          ],
          { onLog: (line) => setStatus(line) },
        );
        if (run.code !== 0 && run.code !== 1) {
          throw new Error(run.stderr.trim() || run.stdout.trim() || `7-Zip exited with code ${run.code}`);
        }

        setSaved(destination);
        setStatus(run.code === 1 ? 'Extracted, with warnings' : 'Extracted');
        return;
      }

      const entries = await readZip(await ctx.files.read(archive));
      let written = 0;

      for (const [index, entry] of entries.entries()) {
        setProgress({ done: index + 1, total: entries.length });

        // Directory entries are recreated implicitly by their children.
        if (entry.name.endsWith('/')) continue;
        if (!isSafeEntryName(entry.name)) {
          throw new Error(`Refusing to extract "${entry.name}": it points outside the destination`);
        }

        const parts = entry.name.split('/');
        const fileName = parts.pop() as string;
        const targetDir = parts.length ? await ctx.files.join(destination, ...parts) : destination;

        if (parts.length) await ctx.files.mkdir(targetDir);
        await ctx.files.write(await ctx.files.join(targetDir, fileName), await entry.read());
        written++;
      }

      setSaved(destination);
      setStatus(`${written} files extracted`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const backendPicker = (
    <>
      <SelectField
        label="Backend"
        value={options.backend}
        onChange={(backend) => update({ backend })}
        options={BACKEND_OPTIONS}
      />
      {usingCli && (
        <ToolStatusNotice
          tool={sevenZip}
          name="7-Zip"
          installHint="Install it (winget install 7zip.7zip, brew install sevenzip, or apt install p7zip-full) and make sure the CLI is on your PATH."
        />
      )}
    </>
  );

  const feedback = (
    <>
      {progress && progress.total > 1 && <Progress value={(progress.done / progress.total) * 100} />}
      {status && !error && (
        <p className="truncate text-xs text-muted-foreground" title={status}>
          {status}
        </p>
      )}
      {saved && (
        <div className="flex items-center gap-2 text-xs">
          <code className="min-w-0 flex-1 truncate font-mono">{saved}</code>
          <Button size="sm" variant="outline" onClick={() => ctx.files.reveal(saved)}>
            <FolderOpen className="size-4" />
            Show
          </Button>
        </div>
      )}
      {error && (
        <pre className="whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">
          {error}
        </pre>
      )}
    </>
  );

  return (
    <Tabs defaultValue="create">
      <TabsList className="mb-4">
        <TabsTrigger value="create">Create</TabsTrigger>
        <TabsTrigger value="extract">Extract</TabsTrigger>
      </TabsList>

      <TabsContent value="create">
        <PanelLayout
          options={
            <>
              <FileDropZone
                files={ctx.files}
                onFiles={addInputs}
                pickOptions={{ title: 'Pick files', multiple: true }}
                label="Drop files or folders here"
              />
              <SelectedFiles
                paths={inputs}
                onRemove={(path) => setInputs((prev) => prev.filter((p) => p !== path))}
                onClear={() => setInputs([])}
              />

              {backendPicker}

              <TextField
                label="Archive name"
                value={options.archiveName}
                onChange={(archiveName) => update({ archiveName })}
              />

              <Row label="Exclude" hint="Names or wildcards, comma separated.">
                <Input
                  value={options.exclude}
                  onChange={(e) => update({ exclude: e.target.value })}
                  className="font-mono text-xs"
                />
              </Row>

              {usingCli ? (
                <>
                  <SelectField
                    label="Format"
                    value={options.format}
                    onChange={(format) => update({ format })}
                    options={FORMAT_OPTIONS}
                  />
                  <SelectField
                    label="Compression level"
                    value={String(options.level)}
                    onChange={(value) => update({ level: Number(value) })}
                    options={LEVEL_OPTIONS}
                  />
                  <TextField
                    label="Password"
                    hint="Optional. It is passed as a command-line argument, so it is briefly visible to other processes on this machine."
                    value={options.password}
                    onChange={(password) => update({ password })}
                  />
                  {options.password && options.format === '7z' && (
                    <Toggle
                      label="Encrypt the file names too"
                      checked={options.encryptNames}
                      onChange={(encryptNames) => update({ encryptNames })}
                    />
                  )}
                </>
              ) : (
                <>
                  <Toggle
                    label="Compress (off = store, much faster)"
                    checked={options.compress}
                    onChange={(compress) => update({ compress })}
                  />
                  <Toggle
                    label="Keep the folder name inside the archive"
                    checked={options.keepStructure}
                    onChange={(keepStructure) => update({ keepStructure })}
                  />
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
              <Button onClick={build} disabled={busy || inputs.length === 0 || !cliReady}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                Create archive
              </Button>
              {feedback}
              {inputs.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Folders are walked recursively. The built-in backend runs entirely locally with the
                  platform's own deflate — ZIP only, no password, and nothing above 4 GB, which would
                  need Zip64. Switch to 7-Zip for 7z, tar, encryption and larger archives.
                </p>
              )}
            </>
          }
        />
      </TabsContent>

      <TabsContent value="extract">
        <PanelLayout
          options={
            <>
              <FileDropZone
                files={ctx.files}
                onFiles={(paths) => setArchive(paths[0] ?? null)}
                pickOptions={{
                  title: 'Pick an archive',
                  filters: usingCli
                    ? [{ name: 'Archives', extensions: ['zip', '7z', 'tar', 'gz', 'bz2', 'xz', 'rar', 'iso', 'cab'] }]
                    : [{ name: 'ZIP', extensions: ['zip'] }],
                }}
                label={usingCli ? 'Drop an archive here' : 'Drop a .zip archive here'}
              />
              <SelectedFiles paths={archive ? [archive] : []} />

              {backendPicker}

              <Toggle
                label="Extract into a subfolder named after the archive"
                checked={options.intoSubfolder}
                onChange={(intoSubfolder) => update({ intoSubfolder })}
              />

              {usingCli && (
                <TextField
                  label="Password"
                  hint="Only if the archive is encrypted."
                  value={options.password}
                  onChange={(password) => update({ password })}
                />
              )}
            </>
          }
          output={
            <>
              <Button onClick={extract} disabled={busy || !archive || !cliReady}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                Extract
              </Button>
              {feedback}
              {!archive && (
                <p className="text-sm text-muted-foreground">
                  {usingCli
                    ? '7-Zip reads far more than ZIP: 7z, tar, gz, bz2, xz, rar, iso, cab.'
                    : 'Entries whose path would escape the destination folder are refused rather than written. Switch to 7-Zip to open anything other than a ZIP.'}
                </p>
              )}
            </>
          }
        />
      </TabsContent>
    </Tabs>
  );
}
