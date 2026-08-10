import { useEffect, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { FolderOpen, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { Row, Toggle } from './fields';
import type { OutputTarget } from './output';
import type { PickOptions, UtilityFiles } from './types';

/**
 * Drop target for files. Tauri intercepts HTML5 drag & drop and emits its own
 * event instead — which is a feature here, because it carries real filesystem
 * paths rather than sandboxed `File` handles, and paths are what rule R2 needs
 * to pre-fill the output folder.
 */
export function FileDropZone({
  files,
  onFiles,
  pickOptions,
  label = 'Drop a file here, or click to browse',
  className,
}: {
  files: UtilityFiles;
  onFiles: (paths: string[]) => void;
  pickOptions?: PickOptions;
  label?: string;
  className?: string;
}) {
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'over') setHovering(true);
        else if (event.payload.type === 'leave') setHovering(false);
        else if (event.payload.type === 'drop') {
          setHovering(false);
          if (event.payload.paths.length > 0) onFiles(event.payload.paths);
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

  return (
    <button
      type="button"
      onClick={browse}
      className={cn(
        'flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent/40',
        hovering && 'border-primary bg-accent/60',
        className,
      )}
    >
      <Upload className="size-6" />
      {label}
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
