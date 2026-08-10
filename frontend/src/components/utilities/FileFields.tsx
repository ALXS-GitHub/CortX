import { useEffect, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { AlertCircle, CheckCircle2, FolderOpen, Loader2, Play, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

import { Row, Toggle } from './fields';
import type { FileJob } from './job';
import { formatBytes } from './lib/image';
import type { OutputTarget } from './output';
import type { PickOptions, UtilityFiles } from './types';

/**
 * Drop target for files, and the only way a utility takes input.
 *
 * Tauri intercepts HTML5 drag & drop and emits its own event instead — a
 * feature here, since it carries real filesystem paths rather than sandboxed
 * `File` handles, and paths are what rule R2 needs to pre-fill the output
 * folder.
 *
 * The catch is that the event is webview-wide: every mounted zone hears every
 * drop. So each zone hit-tests the cursor against its own box and ignores
 * anything that landed elsewhere — otherwise a panel with two zones (a QR code
 * and its logo) would feed both from one drop, and a zone on a hidden tab would
 * steal files from the visible one.
 */
export function FileDropZone({
  files,
  onFiles,
  pickOptions,
  label = 'Drop files here',
  className,
}: {
  files: UtilityFiles;
  onFiles: (paths: string[]) => void;
  pickOptions?: PickOptions;
  label?: string;
  className?: string;
}) {
  const [hovering, setHovering] = useState(false);
  const zoneRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    /**
     * The event reports physical device pixels relative to the window, while
     * layout is in CSS pixels — hence the devicePixelRatio conversion.
     * A hidden zone measures 0×0 and so never matches.
     */
    const isOver = (position: { x: number; y: number }) => {
      const element = zoneRef.current;
      if (!element) return false;

      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;

      const ratio = window.devicePixelRatio || 1;
      const x = position.x / ratio;
      const y = position.y / ratio;

      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    };

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const { payload } = event;

        if (payload.type === 'over') {
          setHovering(isOver(payload.position));
        } else if (payload.type === 'leave') {
          setHovering(false);
        } else if (payload.type === 'drop') {
          setHovering(false);
          if (isOver(payload.position) && payload.paths.length > 0) onFiles(payload.paths);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onFiles]);

  const browse = async () => {
    const paths = await files.pick(pickOptions);
    if (paths.length > 0) onFiles(paths);
  };

  const accepted = pickOptions?.filters?.flatMap((filter) => filter.extensions) ?? [];

  return (
    <button
      ref={zoneRef}
      type="button"
      onClick={browse}
      className={cn(
        'group flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-muted/30 px-4 py-10 text-center transition-colors',
        'hover:border-primary hover:bg-accent/50',
        hovering ? 'border-primary bg-accent/70' : 'border-border',
        className,
      )}
    >
      <Upload
        className={cn(
          'size-7 text-muted-foreground transition-colors group-hover:text-primary',
          hovering && 'text-primary',
        )}
      />
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">
        or click anywhere in this box to browse
      </span>
      {accepted.length > 0 && (
        <span className="text-[11px] text-muted-foreground/80">
          {accepted.slice(0, 8).join(' · ')}
          {accepted.length > 8 ? ' · …' : ''}
        </span>
      )}
    </button>
  );
}

export function SelectedFiles({
  paths,
  onRemove,
  onClear,
}: {
  paths: string[];
  onRemove?: (path: string) => void;
  onClear?: () => void;
}) {
  if (paths.length === 0) return null;

  return (
    <Row label={paths.length > 1 ? `${paths.length} files` : 'Input file'}>
      <div className="divide-y rounded-md border">
        {paths.map((path) => (
          <div key={path} className="flex items-center gap-2 px-3 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
              {path}
            </code>
            {onRemove && (
              <Button size="icon" variant="ghost" className="size-6" onClick={() => onRemove(path)}>
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
      {onClear && paths.length > 1 && (
        <Button size="sm" variant="ghost" className="mt-1 text-muted-foreground" onClick={onClear}>
          Clear all
        </Button>
      )}
    </Row>
  );
}

/**
 * The R2 field group: output folder and output name, always shown, always
 * pre-filled. Kept here rather than in each module so every file utility asks
 * for exactly the same things in the same order.
 */
export function OutputFields({
  files,
  target,
  hint,
}: {
  files: UtilityFiles;
  target: OutputTarget;
  hint?: string;
}) {
  const browseFolder = async () => {
    const folder = await files.pickDirectory('Output folder');
    if (folder) target.setDir(folder);
  };

  return (
    <>
      <Row label="Output folder" hint={hint}>
        <div className="flex gap-2">
          <Input
            value={target.dir}
            onChange={(e) => target.setDir(e.target.value)}
            placeholder="Same folder as the input"
            className="font-mono text-xs"
          />
          <Button variant="outline" size="icon" onClick={browseFolder} title="Browse">
            <FolderOpen className="size-4" />
          </Button>
        </div>
      </Row>

      <Row label="Output name">
        <Input
          value={target.name}
          onChange={(e) => target.setName(e.target.value)}
          placeholder="output.png"
          className="font-mono text-xs"
        />
      </Row>

      <Toggle
        label="Overwrite if the file already exists"
        checked={target.overwrite}
        onChange={target.setOverwrite}
      />
    </>
  );
}

/**
 * Input side of a file utility: drop zone, the selected files, and the R2
 * output fields. With several inputs the name field disappears — each file
 * derives its own — but the folder still applies to all of them.
 */
export function JobInputs({
  files,
  job,
  pickOptions,
  dropLabel,
}: {
  files: UtilityFiles;
  job: FileJob;
  pickOptions?: PickOptions;
  dropLabel?: string;
}) {
  return (
    <>
      <FileDropZone
        files={files}
        onFiles={job.addInputs}
        pickOptions={{ multiple: true, ...pickOptions }}
        label={dropLabel}
      />

      <SelectedFiles paths={job.inputs} onRemove={job.removeInput} onClear={job.clearInputs} />

      {job.inputs.length > 0 &&
        (job.inputs.length === 1 ? (
          <OutputFields files={files} target={job.target} />
        ) : (
          <>
            <Row label="Output folder" hint="Each file keeps its own name.">
              <div className="flex gap-2">
                <Input
                  value={job.target.dir}
                  onChange={(e) => job.target.setDir(e.target.value)}
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  title="Browse"
                  onClick={async () => {
                    const folder = await files.pickDirectory('Output folder');
                    if (folder) job.target.setDir(folder);
                  }}
                >
                  <FolderOpen className="size-4" />
                </Button>
              </div>
            </Row>
            <Toggle
              label="Overwrite if the file already exists"
              checked={job.target.overwrite}
              onChange={job.target.setOverwrite}
            />
          </>
        ))}
    </>
  );
}

/** Output side: the run button, progress, and what came out. */
export function JobResults({
  job,
  onRun,
  actionLabel = 'Run',
  disabled,
  children,
}: {
  job: FileJob;
  onRun: () => void;
  actionLabel?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const succeeded = job.results.filter((r) => r.output);
  const failed = job.results.filter((r) => r.error);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onRun} disabled={disabled || job.running || job.inputs.length === 0}>
          {job.running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {actionLabel}
        </Button>
        {succeeded.length > 0 && !job.running && (
          <Button variant="outline" onClick={job.revealOutput}>
            <FolderOpen className="size-4" />
            Show in folder
          </Button>
        )}
      </div>

      {job.running && job.progress.total > 1 && (
        <Progress value={(job.progress.done / job.progress.total) * 100} />
      )}

      {children}

      {job.results.length > 0 && (
        <div className="divide-y rounded-md border">
          {job.results.map((result, i) => (
            <div key={`${result.input}-${i}`} className="flex items-start gap-2 px-3 py-2 text-xs">
              {result.error ? (
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              ) : (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              )}
              <div className="min-w-0 flex-1">
                <code className="block truncate font-mono" title={result.output ?? result.input}>
                  {result.output ?? result.input}
                </code>
                {result.error ? (
                  <span className="text-destructive">{result.error}</span>
                ) : (
                  result.sizeBefore !== undefined &&
                  result.sizeAfter !== undefined && (
                    <span className="text-muted-foreground">
                      {formatBytes(result.sizeBefore)} → {formatBytes(result.sizeAfter)}
                      {result.sizeBefore > 0 && (
                        <>
                          {' '}
                          ({result.sizeAfter <= result.sizeBefore ? '−' : '+'}
                          {Math.abs(
                            Math.round((1 - result.sizeAfter / result.sizeBefore) * 100),
                          )}
                          %)
                        </>
                      )}
                    </span>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {failed.length > 0 && !job.running && (
        <p className="text-xs text-destructive">
          {failed.length} file{failed.length > 1 ? 's' : ''} failed.
        </p>
      )}
    </>
  );
}
