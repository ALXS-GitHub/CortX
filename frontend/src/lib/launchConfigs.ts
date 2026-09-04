/**
 * Launch configurations (DEV-13 P2): run one ("open a dev session") and
 * capture the current Terminal window as one.
 *
 * Running is entirely frontend-driven: shells are spawned leaf by leaf, the
 * tabs are appended to the shared layout, and each command is *typed* into
 * its shell once the prompt had a moment to appear — so the profile, aliases
 * and history apply exactly as if the user had typed it.
 */
import * as api from '@/lib/tauri';
import { openTerminalWindow } from '@/components/terminal/terminalWindows';
import { useAppStore } from '@/stores/appStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import {
  collectLeaves,
  newLayoutId,
  workspaceIdForProject,
  projectIdOfWorkspace,
  tabsInScope,
  type LayoutNode,
  type LeafNode,
  type TerminalTab,
} from '@/lib/terminalLayout';
import { isLaunchSplit, type LaunchConfig, type LaunchNode, type Project } from '@/types';

/** Delay before commands are typed: long enough for the prompt to be up. */
const COMMAND_DELAY_MS = 1200;

function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\');
}

function joinPath(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/';
  const trimmedRoot = root.replace(/[\\/]+$/, '');
  const trimmedRel = rel.replace(/^[\\/.]+(?=[^.])|^\.$/, '');
  return trimmedRel ? `${trimmedRoot}${sep}${trimmedRel.replace(/[\\/]/g, sep)}` : trimmedRoot;
}

/** Resolve a leaf cwd against the project root (`.` / empty = root). */
export function resolveLaunchCwd(cwd: string | undefined, project: Project | undefined): string | undefined {
  const value = cwd?.trim();
  if (!value || value === '.') return project?.rootPath;
  if (isAbsolutePath(value)) return value;
  return project ? joinPath(project.rootPath, value) : value;
}

/** Make an absolute cwd relative to the project root when it lives inside it. */
export function relativeLaunchCwd(cwd: string | undefined | null, project: Project | undefined): string | undefined {
  if (!cwd) return undefined;
  if (!project?.rootPath) return cwd;
  const norm = (s: string) => s.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
  const root = norm(project.rootPath);
  const target = norm(cwd);
  if (target === root) return '.';
  if (target.startsWith(root + '/')) return cwd.replace(/\\/g, '/').slice(project.rootPath.replace(/[\\/]+$/, '').length + 1);
  return cwd;
}

interface BuiltTab {
  tab: TerminalTab;
  commands: Array<{ terminalId: string; command: string }>;
}

async function buildNode(
  node: LaunchNode,
  project: Project | undefined,
  projectId: string | undefined,
  surface: 'window' | 'dock',
  commands: Array<{ terminalId: string; command: string }>
): Promise<LayoutNode> {
  if (isLaunchSplit(node)) {
    const children: LayoutNode[] = [];
    for (const child of node.children) {
      children.push(await buildNode(child, project, projectId, surface, commands));
    }
    const raw = node.sizes && node.sizes.length === children.length ? node.sizes : children.map(() => 1);
    const total = raw.reduce((s, v) => s + v, 0) || 1;
    return { kind: 'split', id: newLayoutId(), direction: node.split, sizes: raw.map((v) => v / total), children };
  }
  const cwd = resolveLaunchCwd(node.cwd, project);
  const shellId = await useAppStore.getState().openShell({ projectId, cwd, surface });
  const terminalId = `shell:${shellId}`;
  if (node.command?.trim()) commands.push({ terminalId, command: node.command.trim() });
  const leaf: LeafNode = { kind: 'leaf', id: newLayoutId(), terminalId, cwd: cwd ?? null, shell: node.shell ?? null };
  return leaf;
}

/**
 * Run a configuration. Returns the ids of the terminals it opened.
 * `target` overrides the setting / config (`window` or `dock`).
 */
export async function runLaunchConfig(config: LaunchConfig, target?: 'window' | 'dock'): Promise<string[]> {
  const app = useAppStore.getState();
  if (app.projects.length === 0) await app.loadProjects();
  const projects = useAppStore.getState().projects;
  const project = config.projectId ? projects.find((p) => p.id === config.projectId) : undefined;
  const projectId = project?.id;
  const surface: 'window' | 'dock' =
    target ?? (config.window === 'dock' ? 'dock' : (app.settings?.terminal.openDevSessionsIn ?? 'window'));

  const built: BuiltTab[] = [];
  for (const tab of config.tabs) {
    const commands: BuiltTab['commands'] = [];
    const layout = await buildNode(tab.layout, project, projectId, surface, commands);
    const leaves = collectLeaves(layout);
    built.push({
      tab: {
        id: newLayoutId(),
        workspaceId: workspaceIdForProject(projectId),
        title: tab.title ?? null,
        color: null,
        pinned: false,
        order: 0,
        layout,
        activeLeafId: leaves[0].id,
      },
      commands,
    });
  }

  const openedIds = built.flatMap((b) => collectLeaves(b.tab.layout).map((l) => l.terminalId));
  if (surface === 'window') {
    useTerminalLayoutStore.getState().addLaunchTabs(
      built.map((b) => b.tab),
      projectId ?? null
    );
    openTerminalWindow(undefined, { projectId }).catch(() => {});
  }
  // Commands go in after the prompts are up (typed, not executed by Rust).
  const commands = built.flatMap((b) => b.commands);
  if (commands.length > 0) {
    setTimeout(() => {
      for (const c of commands) api.writeTerminal(c.terminalId, `${c.command}\r`).catch(() => {});
    }, COMMAND_DELAY_MS);
  }
  return openedIds;
}

/** Turn a name into a file-safe id (`Zorg dev` → `zorg-dev-x7k2`). */
export function launchIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'session'}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Capture the Terminal window's tabs in scope as a launch configuration
 * (cwd only; commands are not recorded). The scoped project, if any, makes
 * the cwd relative.
 */
export function captureLaunchConfig(name: string): LaunchConfig {
  const { doc } = useTerminalLayoutStore.getState();
  const { projects, terminalStates, shellRuntimes } = useAppStore.getState();
  const scope = doc.window.scope;
  const projectId = scope === 'global' ? undefined : scope.projectId;
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined;
  const tabs = tabsInScope(doc.window, scope);
  const liveCwd = (leaf: LeafNode): string | undefined => {
    const state = terminalStates.get(leaf.terminalId);
    if (state?.cwd) return state.cwd;
    if (leaf.cwd) return leaf.cwd;
    if (leaf.terminalId.startsWith('shell:')) return shellRuntimes.get(leaf.terminalId.slice('shell:'.length))?.cwd;
    return undefined;
  };
  const toLaunchNode = (node: LayoutNode): LaunchNode => {
    if (node.kind === 'split') {
      return { split: node.direction, children: node.children.map(toLaunchNode), sizes: node.sizes.map((s) => Math.round(s * 100) / 100) };
    }
    const cwd = relativeLaunchCwd(liveCwd(node), project);
    return { ...(cwd ? { cwd } : {}), ...(node.shell ? { shell: node.shell } : {}) };
  };
  return {
    id: launchIdFromName(name),
    name,
    projectId: projectId ?? (tabs.length > 0 ? projectIdOfWorkspace(tabs[0].workspaceId) ?? undefined : undefined),
    window: 'terminal',
    tabs: tabs.map((t) => ({ ...(t.title ? { title: t.title } : {}), layout: toLaunchNode(t.layout) })),
  };
}

/** A one-shell default configuration for a project (used when it has none). */
export function defaultLaunchConfigFor(project: Project): LaunchConfig {
  return {
    id: launchIdFromName(`${project.name} dev`),
    name: `${project.name} dev`,
    projectId: project.id,
    window: 'terminal',
    tabs: [{ layout: { cwd: '.' } }],
  };
}
