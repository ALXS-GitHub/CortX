import { useCallback, useState } from 'react';
import { FolderOpen, Loader2, Play, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { FileDropZone, SelectedFiles } from '../../FileFields';
import { PanelLayout, Row, TextField, Toggle } from '../../fields';
import { formatBytes } from '../../lib/image';
import { usePanelOptions } from '../../options';
import type { UtilityContext, UtilityPanelProps } from '../../types';
import { createZip, isSafeEntryName, readZip, type ZipEntry } from './zip';

interface ArchiveOptions {
  compress: boolean;
  exclude: string;
  archiveName: string;
  intoSubfolder: boolean;
  keepStructure: boolean;
}

const DEFAULT_OPTIONS: ArchiveOptions = {
  compress: true,
  exclude: 'node_modules, .git, .DS_Store, target, dist',
  archiveName: 'archive.zip',
  intoSubfolder: true,
  keepStructure: true,
};

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

  const [inputs, setInputs] = useState<string[]>([]);
  const [archive, setArchive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const addInputs = useCallback((paths: string[]) => {
    setInputs((prev) => [...new Set([...prev, ...paths])]);
    setSaved(null);
    setError(null);
  }, []);

  const build = async () => {
    if (inputs.length === 0) return;

    setBusy(true);
    setError(null);
    setSaved(null);
    setProgress(null);

    try {
      const folder = await ctx.files.pickDirectory('Where to save the archive');
      if (!folder) return;

      const patterns = parsePatterns(options.exclude);
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

      const name = options.archiveName.trim() || 'archive.zip';
      const path = await ctx.files.join(folder, name.endsWith('.zip') ? name : `${name}.zip`);
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

    setBusy(true);
    setError(null);
    setSaved(null);
    setProgress(null);

    try {
      const folder = await ctx.files.pickDirectory('Where to extract');
      if (!folder) return;

      const entries = await readZip(await ctx.files.read(archive));

      let destination = folder;
      if (options.intoSubfolder) {
        const base = (await ctx.files.basename(archive)).replace(/\.zip$/i, '');
        destination = await ctx.files.join(folder, base);
        await ctx.files.mkdir(destination);
      }

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
        const targetDir = parts.length
          ? await ctx.files.join(destination, ...parts)
          : destination;

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

  const feedback = (
    <>
      {progress && progress.total > 1 && <Progress value={(progress.done / progress.total) * 100} />}
      {status && !error && <p className="text-xs text-muted-foreground">{status}</p>}
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

              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
                <RotateCcw className="size-3.5" />
                Reset to defaults
              </Button>
            </>
          }
          output={
            <>
              <Button onClick={build} disabled={busy || inputs.length === 0}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                Create archive
              </Button>
              {feedback}
              {inputs.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Folders are walked recursively. Everything runs locally with the platform's own
                  deflate — no external archiver needed. Passwords, 7z, RAR and tar are not covered;
                  neither are archives above 4 GB, which need Zip64.
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
                pickOptions={{ title: 'Pick a ZIP', filters: [{ name: 'ZIP', extensions: ['zip'] }] }}
                label="Drop a .zip here, or click to browse"
              />
              <SelectedFiles paths={archive ? [archive] : []} />

              <Toggle
                label="Extract into a subfolder named after the archive"
                checked={options.intoSubfolder}
                onChange={(intoSubfolder) => update({ intoSubfolder })}
              />
            </>
          }
          output={
            <>
              <Button onClick={extract} disabled={busy || !archive}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                Extract
              </Button>
              {feedback}
              {!archive && (
                <p className="text-sm text-muted-foreground">
                  Entries whose path would escape the destination folder are refused rather than
                  written.
                </p>
              )}
            </>
          }
        />
      </TabsContent>
    </Tabs>
  );
}
