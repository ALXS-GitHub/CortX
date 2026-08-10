import { useCallback, useEffect, useRef, useState } from 'react';

import type { UtilityFiles } from './types';

export interface OutputTargetConfig {
  /** Appended to the input's base name, e.g. `-resized`. */
  suffix?: string;
  /** Extension of the produced file, without the dot. Defaults to the input's. */
  ext?: string;
}

export interface OutputTarget {
  dir: string;
  name: string;
  overwrite: boolean;
  setDir(value: string): void;
  setName(value: string): void;
  setOverwrite(value: boolean): void;
  /** Restores the derived defaults, discarding manual edits. */
  reset(): void;
  /** Full path with the collision policy applied. */
  resolve(): Promise<string>;
  ready: boolean;
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/**
 * Rule R2, implemented once: every file-producing utility asks for an output
 * folder and an output name, and both arrive pre-filled — folder from the
 * input's folder, name from the input's name plus the tool's suffix and
 * extension. Manual edits are remembered so switching input doesn't stomp on
 * a name the user typed.
 */
export function useOutputTarget(
  files: UtilityFiles,
  inputPath: string | null,
  config: OutputTargetConfig = {},
): OutputTarget {
  const [dir, setDirState] = useState('');
  const [name, setNameState] = useState('');
  const [overwrite, setOverwrite] = useState(false);

  const dirTouched = useRef(false);
  const nameTouched = useRef(false);

  const { suffix = '', ext } = config;

  // Derives the defaults from the input path. Async because the path helpers
  // live on the Rust side; the setState calls land in a promise callback, not
  // synchronously inside the effect.
  useEffect(() => {
    if (!inputPath) return;
    let cancelled = false;

    (async () => {
      const [folder, base, inputExt] = await Promise.all([
        files.dirname(inputPath),
        files.basename(inputPath),
        files.extname(inputPath).catch(() => ''),
      ]);
      if (cancelled) return;

      if (!dirTouched.current) setDirState(folder);
      if (!nameTouched.current) {
        const finalExt = ext ?? inputExt;
        setNameState(`${stripExtension(base)}${suffix}${finalExt ? `.${finalExt}` : ''}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inputPath, files, suffix, ext]);

  const setDir = useCallback((value: string) => {
    dirTouched.current = true;
    setDirState(value);
  }, []);

  const setName = useCallback((value: string) => {
    nameTouched.current = true;
    setNameState(value);
  }, []);

  const reset = useCallback(() => {
    dirTouched.current = false;
    nameTouched.current = false;
    setDirState('');
    setNameState('');
  }, []);

  /**
   * Never silently clobbers: unless the user asked for overwrite, an existing
   * target gets `-1`, `-2`… inserted before the extension.
   */
  const resolve = useCallback(async () => {
    const target = await files.join(dir, name);
    if (overwrite || !(await files.exists(target))) return target;

    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';

    for (let i = 1; i < 1000; i++) {
      const candidate = await files.join(dir, `${stem}-${i}${extension}`);
      if (!(await files.exists(candidate))) return candidate;
    }

    return target;
  }, [files, dir, name, overwrite]);

  return {
    dir,
    name,
    overwrite,
    setDir,
    setName,
    setOverwrite,
    reset,
    resolve,
    ready: Boolean(dir && name),
  };
}
