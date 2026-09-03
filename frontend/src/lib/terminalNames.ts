import type { Project, GlobalScript, TerminalShellState } from '@/types';
import type { ShellRuntime } from '@/stores/appStore';

/** Last path segment, tolerant of both separators and trailing slashes. */
export function basename(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** `1.2s`, `48s`, `3m 05s`, `1h 02m`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s - m * 60);
  if (m < 60) return `${m}m ${String(rs).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m - h * 60).padStart(2, '0')}m`;
}

/** Tab title of an interactive shell: `pwsh · CortX`, following the live cwd. */
export function shellTabName(runtime: ShellRuntime, live?: TerminalShellState | null): string {
  const cwd = live?.cwd || runtime.cwd;
  return `${basename(runtime.program).replace(/\.exe$/i, '')} · ${basename(cwd)}`;
}

/**
 * Human name of any terminal id (`service:<id>`, `script:<id>`,
 * `global-script:<id>`, `shell:<id>`) from the store's data. Used by
 * notifications, which don't go through the dock's item list.
 */
export function terminalDisplayName(
  id: string,
  data: {
    projects: Project[];
    globalScripts: GlobalScript[];
    shellRuntimes: Map<string, ShellRuntime>;
    terminalStates: Map<string, TerminalShellState>;
  }
): { name: string; projectName: string } {
  const sep = id.indexOf(':');
  const kind = id.slice(0, sep);
  const key = id.slice(sep + 1);
  if (kind === 'service') {
    for (const p of data.projects) {
      const s = p.services.find((x) => x.id === key);
      if (s) return { name: s.name, projectName: p.name };
    }
  } else if (kind === 'script') {
    for (const p of data.projects) {
      const s = p.scripts?.find((x) => x.id === key);
      if (s) return { name: s.name, projectName: p.name };
    }
  } else if (kind === 'global-script') {
    const s = data.globalScripts.find((x) => x.id === key);
    if (s) return { name: s.name, projectName: 'Global' };
  } else if (kind === 'shell') {
    const rt = data.shellRuntimes.get(key);
    if (rt) {
      const project = rt.projectId ? data.projects.find((p) => p.id === rt.projectId) : undefined;
      return { name: shellTabName(rt, data.terminalStates.get(id)), projectName: project?.name ?? '' };
    }
  }
  return { name: id, projectName: '' };
}
