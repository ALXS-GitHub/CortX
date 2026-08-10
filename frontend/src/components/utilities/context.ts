import { useMemo } from 'react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, readDir, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { Command } from '@tauri-apps/plugin-shell';
import { basename, dirname, extname, join, tempDir } from '@tauri-apps/api/path';
import { toast } from 'sonner';

import { openInExplorer } from '@/lib/tauri';

import type {
  PickOptions,
  RunOptions,
  RunResult,
  UtilityContext,
  UtilityFiles,
  UtilityState,
} from './types';

const STATE_PREFIX = 'cortx:utility';

/**
 * Per-module persisted settings. Deliberately localStorage and not the Rust
 * storage layer: these are UI preferences (last format picked, last length),
 * they are worthless on another machine and must not end up in the synced data
 * dir. Keys are namespaced by module id so two modules can't collide.
 */
function makeState(moduleId: string): UtilityState {
  const keyFor = (key: string) => `${STATE_PREFIX}:${moduleId}:${key}`;

  return {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = localStorage.getItem(keyFor(key));
        return raw === null ? fallback : (JSON.parse(raw) as T);
      } catch {
        return fallback;
      }
    },
    set(key: string, value: unknown) {
      try {
        localStorage.setItem(keyFor(key), JSON.stringify(value));
      } catch {
        // Quota or private mode: losing a UI preference is not worth surfacing.
      }
    },
  };
}

const files: UtilityFiles = {
  async pick(options: PickOptions = {}) {
    const selection = await openDialog({
      title: options.title,
      multiple: options.multiple ?? false,
      directory: false,
      filters: options.filters,
    });
    if (selection === null) return [];
    return Array.isArray(selection) ? selection : [selection];
  },

  async pickDirectory(title?: string) {
    const selection = await openDialog({ title, directory: true, multiple: false });
    return typeof selection === 'string' ? selection : null;
  },

  read: (path) => readFile(path),
  write: (path, data) => writeFile(path, data),
  exists: (path) => exists(path),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  readDir: async (path) => {
    const entries = await readDir(path);
    return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory }));
  },
  reveal: (path) => openInExplorer(path),
  tempDir: () => tempDir(),
  dirname: (path) => dirname(path),
  basename: (path) => basename(path),
  extname: (path) => extname(path),
  join: (...parts) => join(...parts),
};

/**
 * Runs an external CLI with an argument array — never a shell string, so a
 * space or a quote in a user-supplied path can't turn into extra arguments.
 */
async function run(program: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const command = Command.create(program, args, options.cwd ? { cwd: options.cwd } : undefined);

  let stdout = '';
  let stderr = '';

  command.stdout.on('data', (line: string) => {
    stdout += line + '\n';
    options.onLog?.(line, 'stdout');
  });
  command.stderr.on('data', (line: string) => {
    stderr += line + '\n';
    options.onLog?.(line, 'stderr');
  });

  const child = await command.execute();

  return {
    code: child.code,
    // `execute()` already collects the full output; the listeners above only
    // exist to stream progress while it runs.
    stdout: stdout || child.stdout,
    stderr: stderr || child.stderr,
  };
}

export function useUtilityContext(moduleId: string): UtilityContext {
  return useMemo<UtilityContext>(
    () => ({
      state: makeState(moduleId),
      async copy(text: string) {
        try {
          await writeText(text);
          toast.success('Copied to clipboard');
        } catch {
          toast.error('Could not copy to clipboard');
        }
      },
      files,
      run,
    }),
    [moduleId],
  );
}
