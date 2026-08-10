import {
  AppWindow,
  ArrowRight,
  Code,
  ExternalLink,
  FileCode,
  FolderKanban,
  FolderOpen,
  Play,
  ScrollText,
  Settings as SettingsIcon,
  Square,
  SquareTerminal,
  Terminal,
  Wand2,
  Wrench,
} from 'lucide-react';
import { createElement, type ReactNode } from 'react';

import { UTILITIES } from '@/components/utilities/registry';
import { useUtilitySelection } from '@/components/utilities/selection';
import { openAppUrl, openInExplorer, openInVscode, openToolUrl } from '@/lib/tauri';
import type { useAppStore } from '@/stores/appStore';

import { SHORTCUTS } from './shortcuts';
import type { CommandEntity, EntityAction } from './types';

type Store = ReturnType<typeof useAppStore.getState>;

const iconSize = 'size-4';

/**
 * Favorites first. cmdk ranks by match score and breaks ties in render order,
 * so emitting starred entities earlier makes them win an equal-quality match.
 */
function favoritesFirst<T extends { favorite: boolean }>(items: T[]): T[] {
  return items.slice().sort((a, b) => (a.favorite === b.favorite ? 0 : a.favorite ? -1 : 1));
}

/**
 * Build the list of entities surfaced by the command palette from the current
 * store snapshot. Each entity has a default action plus optional ones bound
 * to specific shortcuts.
 */
export function buildEntities(store: Store): CommandEntity[] {
  const entities: CommandEntity[] = [];

  // -- Navigation ----------------------------------------------------------
  const navItems: { view: Parameters<Store['setCurrentView']>[0]; label: string; icon: typeof FolderKanban }[] = [
    { view: 'dashboard', label: 'Go to Projects', icon: FolderKanban },
    { view: 'scripts', label: 'Go to Scripts', icon: FileCode },
    { view: 'tools', label: 'Go to Tools', icon: Wrench },
    { view: 'utilities', label: 'Go to Utilities', icon: Wand2 },
    { view: 'aliases', label: 'Go to Shell Config', icon: SquareTerminal },
    { view: 'apps', label: 'Go to Apps', icon: AppWindow },
    { view: 'settings', label: 'Go to Settings', icon: SettingsIcon },
  ];
  for (const { view, label, icon } of navItems) {
    entities.push({
      id: `nav:${view}`,
      category: 'Navigation',
      label,
      icon: createElement(icon, { className: iconSize }),
      keywords: `view tab navigate ${view}`,
      actions: [
        {
          id: 'go',
          label,
          shortcut: SHORTCUTS.primary,
          run: () => {
            store.setCurrentView(view);
            if (view === 'dashboard') store.selectProject(null);
          },
        },
      ],
    });
  }

  // -- Apps ----------------------------------------------------------------
  for (const app of favoritesFirst(store.apps)) {
    const actions: EntityAction[] = [
      {
        id: 'launch',
        label: 'Launch',
        icon: createElement(Play, { className: iconSize }),
        shortcut: SHORTCUTS.primary,
        run: () => store.launchApp(app.id),
      },
      {
        id: 'open-in-cortx',
        label: 'Open in CortX',
        icon: createElement(ArrowRight, { className: iconSize }),
        shortcut: SHORTCUTS.openInCortx,
        run: () => store.selectApp(app.id),
      },
    ];
    if (app.configPaths && app.configPaths.length > 0) {
      const cfg = app.configPaths[0].path;
      actions.push({
        id: 'open-config',
        label: 'Open Config',
        icon: createElement(FolderOpen, { className: iconSize }),
        shortcut: SHORTCUTS.openConfig,
        run: () => openInExplorer(cfg),
      });
    }
    if (app.homepage) {
      const url = app.homepage;
      actions.push({
        id: 'open-homepage',
        label: 'Open Homepage',
        icon: createElement(ExternalLink, { className: iconSize }),
        shortcut: SHORTCUTS.openHomepage,
        run: () => openAppUrl(url),
      });
    }
    entities.push({
      id: `app:${app.id}`,
      category: 'Apps',
      label: app.name,
      subtitle: 'App',
      icon: createElement(AppWindow, { className: iconSize }),
      keywords: `app launch ${app.tags.join(' ')} ${actionLabels(actions)}`,
      actions,
    });
  }

  // -- Services (one entity per service) -----------------------------------
  for (const project of favoritesFirst(store.projects)) {
    for (const service of project.services) {
      const runtime = store.serviceRuntimes.get(service.id);
      const isRunning = runtime?.status === 'running' || runtime?.status === 'starting';

      const primary: EntityAction = isRunning
        ? {
            id: 'stop',
            label: 'Stop',
            icon: createElement(Square, { className: iconSize }),
            shortcut: SHORTCUTS.primary,
            run: () => store.stopService(service.id),
          }
        : {
            id: 'start',
            label: 'Start',
            icon: createElement(Play, { className: iconSize }),
            shortcut: SHORTCUTS.primary,
            run: () => store.startService(service.id),
          };

      const actions: EntityAction[] = [
        primary,
        {
          id: 'open-project',
          label: 'Open Project in CortX',
          icon: createElement(ArrowRight, { className: iconSize }),
          shortcut: SHORTCUTS.openInCortx,
          run: () => store.selectProject(project.id),
        },
      ];

      entities.push({
        id: `svc:${service.id}`,
        category: 'Services',
        label: service.name,
        subtitle: `${project.name}${isRunning ? ' · running' : ''}`,
        icon: createElement(Terminal, { className: iconSize }),
        keywords: `service ${project.name} ${service.command} ${actionLabels(actions)}`,
        actions,
      });
    }
  }

  // -- Scripts (global only) -----------------------------------------------
  for (const script of favoritesFirst(store.globalScripts)) {
    const hasParams = script.parameters.length > 0;
    const actions: EntityAction[] = [
      {
        id: 'run',
        label: hasParams ? 'Run (defaults)' : 'Run',
        icon: createElement(Play, { className: iconSize }),
        shortcut: SHORTCUTS.primary,
        run: () => store.runGlobalScript(script.id),
      },
      {
        id: 'open-in-cortx',
        label: 'Open in CortX',
        icon: createElement(ArrowRight, { className: iconSize }),
        shortcut: SHORTCUTS.openInCortx,
        run: () => store.selectGlobalScript(script.id),
      },
    ];
    entities.push({
      id: `script:${script.id}`,
      category: 'Scripts',
      label: script.name,
      subtitle: 'Global script',
      icon: createElement(ScrollText, { className: iconSize }),
      keywords: `script run ${script.tags.join(' ')} ${script.command} ${actionLabels(actions)}`,
      actions,
    });
  }

  // -- Projects ------------------------------------------------------------
  for (const project of favoritesFirst(store.projects)) {
    const services = project.services;
    const actions: EntityAction[] = [
      {
        id: 'start-all',
        label: services.length > 0 ? `Start All Services (${services.length})` : 'Start All Services',
        icon: createElement(Play, { className: iconSize }),
        shortcut: SHORTCUTS.primary,
        run: () => {
          for (const svc of services) {
            const rt = store.serviceRuntimes.get(svc.id);
            const running = rt?.status === 'running' || rt?.status === 'starting';
            if (!running) {
              void store.startService(svc.id);
            }
          }
        },
      },
      {
        id: 'open-in-cortx',
        label: 'Open in CortX',
        icon: createElement(ArrowRight, { className: iconSize }),
        shortcut: SHORTCUTS.openInCortx,
        run: () => store.selectProject(project.id),
      },
      {
        id: 'open-folder',
        label: 'Open Folder',
        icon: createElement(FolderOpen, { className: iconSize }),
        shortcut: SHORTCUTS.openFolder,
        run: () => openInExplorer(project.rootPath),
      },
      {
        id: 'open-vscode',
        label: 'Open in VS Code',
        icon: createElement(Code, { className: iconSize }),
        shortcut: SHORTCUTS.openVSCode,
        run: () => openInVscode(project.rootPath),
      },
    ];
    entities.push({
      id: `project:${project.id}`,
      category: 'Projects',
      label: project.name,
      subtitle: project.rootPath,
      icon: createElement(FolderKanban, { className: iconSize }),
      keywords: `project ${project.tags.join(' ')} ${actionLabels(actions)}`,
      actions,
    });
  }

  // -- Tools ---------------------------------------------------------------
  for (const tool of favoritesFirst(store.tools)) {
    const actions: EntityAction[] = [
      {
        id: 'open-in-cortx',
        label: 'Open in CortX',
        icon: createElement(ArrowRight, { className: iconSize }),
        shortcut: SHORTCUTS.primary,
        run: () => store.selectTool(tool.id),
      },
    ];
    if (tool.installLocation) {
      const loc = tool.installLocation;
      actions.push({
        id: 'open-install',
        label: 'Open Install Location',
        icon: createElement(FolderOpen, { className: iconSize }),
        shortcut: SHORTCUTS.openInstall,
        run: () => openInExplorer(loc),
      });
    }
    if (tool.configPaths && tool.configPaths.length > 0) {
      const cfg = tool.configPaths[0].path;
      actions.push({
        id: 'open-config',
        label: 'Open Config',
        icon: createElement(FolderOpen, { className: iconSize }),
        shortcut: SHORTCUTS.openConfig,
        run: () => openInExplorer(cfg),
      });
    }
    if (tool.homepage) {
      const url = tool.homepage;
      actions.push({
        id: 'open-homepage',
        label: 'Open Homepage',
        icon: createElement(ExternalLink, { className: iconSize }),
        shortcut: SHORTCUTS.openHomepage,
        run: () => openToolUrl(url),
      });
    }
    entities.push({
      id: `tool:${tool.id}`,
      category: 'Tools',
      label: tool.name,
      subtitle: tool.description ?? 'Tool',
      icon: createElement(Wrench, { className: iconSize }),
      keywords: `tool ${tool.tags.join(' ')} ${actionLabels(actions)}`,
      actions,
    });
  }

  // -- Shell Config (aliases) ----------------------------------------------
  for (const alias of favoritesFirst(store.aliases)) {
    entities.push({
      id: `alias:${alias.id}`,
      category: 'Shell Config',
      label: alias.name,
      subtitle: alias.description ?? alias.command,
      icon: createElement(SquareTerminal, { className: iconSize }),
      keywords: `alias shell config ${alias.tags.join(' ')} ${alias.command}`,
      actions: [
        {
          id: 'open-in-cortx',
          label: 'Open in CortX',
          icon: createElement(ArrowRight, { className: iconSize }),
          shortcut: SHORTCUTS.primary,
          run: () => store.selectAlias(alias.id),
        },
      ],
    });
  }

  // -- Utilities -----------------------------------------------------------
  // Static, so no store read: the registry is built at module load.
  for (const { meta } of UTILITIES) {
    entities.push({
      id: `utility:${meta.id}`,
      category: 'Utilities',
      label: meta.name,
      subtitle: meta.description,
      icon: createElement(meta.icon, { className: iconSize }),
      keywords: `utility tool ${meta.category} ${(meta.keywords ?? []).join(' ')}`,
      actions: [
        {
          id: 'open',
          label: 'Open',
          icon: createElement(ArrowRight, { className: iconSize }),
          shortcut: SHORTCUTS.primary,
          run: () => {
            useUtilitySelection.getState().openUtility(meta.id);
            store.setCurrentView('utilities');
          },
        },
      ],
    });
  }

  return entities;
}

function actionLabels(actions: EntityAction[]): string {
  return actions.map((a) => a.label).join(' ');
}

// Silence unused-icon imports while the action surface settles.
void (null as unknown as ReactNode);
