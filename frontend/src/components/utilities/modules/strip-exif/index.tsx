import { useCallback, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { JobInputs, JobResults } from '../../FileFields';
import { PanelLayout, Row, Toggle } from '../../fields';
import { useFileJob } from '../../job';
import { usePanelOptions } from '../../options';
import type { UtilityPanelProps } from '../../types';
import { stripMetadata, type StripOptions } from './metadata';

const DEFAULT_OPTIONS: StripOptions = {
  keepColorProfile: true,
  keepDensity: false,
};

const FILTERS = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }];

export default function StripExifPanel({ ctx }: UtilityPanelProps) {
  const { options, update, reset } = usePanelOptions<StripOptions>(ctx, DEFAULT_OPTIONS);
  const [removed, setRemoved] = useState<string[]>([]);
  const job = useFileJob(ctx, { suffix: '-clean' });

  const process = useCallback(async () => {
    const seen = new Set<string>();
    setRemoved([]);

    await job.run(async (bytes) => {
      const result = stripMetadata(bytes, options);
      result.removed.forEach((entry) => seen.add(entry));
      // Keep the original extension: the bytes are the same image, only the
      // container's metadata blocks are gone.
      return { data: result.data };
    });

    setRemoved([...seen]);
  }, [job, options]);

  return (
    <PanelLayout
      options={
        <>
          <JobInputs
            files={ctx.files}
            job={job}
            pickOptions={{ title: 'Pick images', filters: FILTERS }}
            dropLabel="Drop one or more images here"
          />

          <Toggle
            label="Keep the colour profile (ICC)"
            checked={options.keepColorProfile}
            onChange={(keepColorProfile) => update({ keepColorProfile })}
          />
          <Toggle
            label="Keep resolution / density hints"
            checked={options.keepDensity}
            onChange={(keepDensity) => update({ keepDensity })}
          />

          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
        </>
      }
      output={
        <JobResults job={job} onRun={process} actionLabel="Strip metadata">
          {job.inputs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The pixels are copied byte for byte — only the metadata blocks are dropped, so there is
              no quality loss. Note that removing EXIF also removes the orientation tag: an image
              that relied on it may appear rotated.
            </p>
          ) : (
            removed.length > 0 && (
              <Row label="Removed">
                <div className="flex flex-wrap gap-1.5">
                  {removed.map((entry) => (
                    <Badge key={entry} variant="outline">
                      {entry}
                    </Badge>
                  ))}
                </div>
              </Row>
            )
          )}
        </JobResults>
      }
    />
  );
}
