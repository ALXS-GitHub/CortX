import { useCallback, useState } from 'react';

import { useOutputTarget, type OutputTarget } from './output';
import type { UtilityContext } from './types';

export interface JobResult {
  input: string;
  output?: string;
  error?: string;
  /** Bytes in / bytes out, when the processor produced a file. */
  sizeBefore?: number;
  sizeAfter?: number;
}

export interface Processed {
  data: Uint8Array;
  /** Overrides the configured extension for this file, e.g. after a format switch. */
  ext?: string;
  /**
   * Full file name, overriding the derived one. Used when a single input
   * produces several files that must stay distinguishable (an icon set).
   */
  name?: string;
}

export type Processor = (bytes: Uint8Array, path: string) => Promise<Processed | Processed[]>;

export interface FileJob {
  inputs: string[];
  addInputs(paths: string[]): void;
  removeInput(path: string): void;
  clearInputs(): void;
  target: OutputTarget;
  running: boolean;
  progress: { done: number; total: number };
  results: JobResult[];
  run(processor: Processor): Promise<void>;
  revealOutput(): Promise<void>;
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * The shape every file-based utility shares: pick inputs, derive an output
 * target (rule R2), run a processor over each file, report what happened.
 *
 * With a single input the output name is fully editable. With several, the
 * folder stays editable but names are derived per file — otherwise every
 * result would fight over the same name.
 */
export function useFileJob(
  ctx: UtilityContext,
  config: { suffix?: string; ext?: string } = {},
): FileJob {
  const [inputs, setInputs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<JobResult[]>([]);

  const target = useOutputTarget(ctx.files, inputs[0] ?? null, config);

  const addInputs = useCallback((paths: string[]) => {
    setResults([]);
    setInputs((prev) => [...new Set([...prev, ...paths])]);
  }, []);

  const removeInput = useCallback((path: string) => {
    setInputs((prev) => prev.filter((p) => p !== path));
  }, []);

  const clearInputs = useCallback(() => {
    setInputs([]);
    setResults([]);
  }, []);

  /** Output path for one produced file, honouring the collision policy. */
  const pathFor = useCallback(
    async (input: string, item: Processed, single: boolean) => {
      const folder = target.dir || (await ctx.files.dirname(input));

      let name: string;
      if (item.name) {
        name = item.name;
      } else if (single) {
        return target.resolve();
      } else {
        const base = stripExtension(await ctx.files.basename(input));
        const ext = item.ext ?? config.ext ?? (await ctx.files.extname(input).catch(() => ''));
        name = `${base}${config.suffix ?? ''}${ext ? `.${ext}` : ''}`;
      }

      const candidate = await ctx.files.join(folder, name);
      if (target.overwrite || !(await ctx.files.exists(candidate))) return candidate;

      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const extension = dot > 0 ? name.slice(dot) : '';

      for (let i = 1; i < 1000; i++) {
        const numbered = await ctx.files.join(folder, `${stem}-${i}${extension}`);
        if (!(await ctx.files.exists(numbered))) return numbered;
      }
      return candidate;
    },
    [ctx.files, target, config.suffix, config.ext],
  );

  const run = useCallback(
    async (processor: Processor) => {
      if (inputs.length === 0) return;

      setRunning(true);
      setResults([]);
      setProgress({ done: 0, total: inputs.length });

      const collected: JobResult[] = [];

      for (const [index, input] of inputs.entries()) {
        try {
          const bytes = await ctx.files.read(input);
          const produced = await processor(bytes, input);
          const outputs = Array.isArray(produced) ? produced : [produced];

          // A single input producing a single file is the case where the
          // user-edited output name applies; anything else derives its name.
          const single = inputs.length === 1 && outputs.length === 1;

          for (const item of outputs) {
            const path = await pathFor(input, item, single);
            await ctx.files.write(path, item.data);
            collected.push({
              input,
              output: path,
              sizeBefore: bytes.byteLength,
              sizeAfter: item.data.byteLength,
            });
          }
        } catch (e) {
          collected.push({ input, error: e instanceof Error ? e.message : String(e) });
        }

        setProgress({ done: index + 1, total: inputs.length });
      }

      setResults(collected);
      setRunning(false);
    },
    [ctx.files, inputs, pathFor],
  );

  const revealOutput = useCallback(async () => {
    const first = results.find((r) => r.output)?.output;
    if (first) await ctx.files.reveal(first);
  }, [ctx.files, results]);

  return {
    inputs,
    addInputs,
    removeInput,
    clearInputs,
    target,
    running,
    progress,
    results,
    run,
    revealOutput,
  };
}
