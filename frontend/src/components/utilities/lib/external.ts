import { useCallback, useEffect, useState } from 'react';

import type { UtilityContext } from '../types';

export type ToolStatus = 'checking' | 'ready' | 'missing';

export interface ExternalTool {
  status: ToolStatus;
  version: string | null;
  /** Which candidate actually answered — Ghostscript is `gs` or `gswin64c`. */
  program: string | null;
  recheck(): void;
}

/**
 * Probes for a CLI the module needs (ffmpeg, Ghostscript…) and reports whether
 * it is on PATH.
 *
 * Modules that can do their job on a canvas do it there — needing an install
 * first is exactly what makes people go back to an online converter. This is
 * only for work a webview genuinely cannot do: video transcoding, PDF
 * rewriting. Checking up front means the user learns what is missing before
 * picking files, not after pressing Run.
 */
export function useExternalTool(
  ctx: UtilityContext,
  programs: string | string[],
  versionArgs: string[] = ['-version'],
): ExternalTool {
  const [status, setStatus] = useState<ToolStatus>('checking');
  const [version, setVersion] = useState<string | null>(null);
  const [program, setProgram] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const candidates = Array.isArray(programs) ? programs.join(',') : programs;
  const argsKey = versionArgs.join(' ');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      for (const candidate of candidates.split(',')) {
        try {
          const result = await ctx.run(candidate, argsKey.split(' '));
          if (cancelled) return;

          const output = (result.stdout || result.stderr).split('\n')[0]?.trim() ?? '';
          // Some tools report their version on a non-zero exit; the fact that
          // it ran at all is what matters here.
          setVersion(output || null);
          setProgram(candidate);
          setStatus('ready');
          return;
        } catch {
          // Try the next name — Ghostscript ships under a different one per OS.
        }
      }

      if (!cancelled) {
        setVersion(null);
        setProgram(null);
        setStatus('missing');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ctx, candidates, argsKey, nonce]);

  const recheck = useCallback(() => {
    setStatus('checking');
    setNonce((n) => n + 1);
  }, []);

  return { status, version, program, recheck };
}
